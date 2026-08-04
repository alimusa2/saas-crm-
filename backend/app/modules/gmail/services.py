"""
Gmail OAuth Service
Handles the full OAuth 2.0 lifecycle:
  - Building the authorization URL
  - Exchanging the auth code for tokens
  - Encrypting/decrypting tokens at rest
  - Auto-refreshing expired access tokens
  - Sending email via the Gmail API
  - Disconnecting a Gmail account
"""
import base64
import email as email_lib
import json
import os
from datetime import datetime, timezone, timedelta
from email.mime.text import MIMEText
from typing import Optional, List, Dict, Any


from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.modules.gmail.models import GmailIntegration
from app.core.config import settings

from app.core.security import encrypt_data, decrypt_data

def _encrypt(text: str) -> str:
    return encrypt_data(text)


def _decrypt(ciphertext: str) -> str:
    return decrypt_data(ciphertext)



# ─── OAuth URL builder ────────────────────────────────────────────────────────
GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_SCOPES = [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/calendar.events",
]


def build_oauth_url(organization_id: str) -> str:
    """
    Build the Google OAuth 2.0 authorization URL.
    The organization_id is encoded in the `state` parameter so we can
    associate the callback with the correct tenant.
    """
    client_id = (settings.GOOGLE_CLIENT_ID or "").strip('"').strip("'")
    redirect_uri = (settings.GOOGLE_REDIRECT_URI or "").strip('"').strip("'")

    if not client_id or client_id == "YOUR_GOOGLE_CLIENT_ID":
        # Simulation mode: return a fake URL that points to our own backend callback
        state = base64.urlsafe_b64encode(
            json.dumps({"org_id": organization_id, "sim": True}).encode()
        ).decode()
        return f"{redirect_uri}?code=sim_code&state={state}&sim=1"

    import urllib.parse
    state = base64.urlsafe_b64encode(
        json.dumps({"org_id": organization_id}).encode()
    ).decode()

    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": " ".join(GOOGLE_SCOPES),
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
    }
    return f"{GOOGLE_AUTH_URL}?{urllib.parse.urlencode(params)}"


# ─── Service class ────────────────────────────────────────────────────────────
class GmailService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def _get_or_create(self, organization_id: str) -> GmailIntegration:
        """Fetch existing record or create a blank one for this org."""
        result = await self.db.execute(
            select(GmailIntegration)
            .where(GmailIntegration.organization_id == organization_id)
            .order_by(GmailIntegration.is_connected.desc(), GmailIntegration.updated_at.desc())
        )
        record = result.scalars().first()
        if not record:
            record = GmailIntegration(organization_id=organization_id)
            self.db.add(record)
            await self.db.flush()
        return record

    async def get_status(self, organization_id: str) -> GmailIntegration:
        """Return the Gmail integration status for an organization."""
        return await self._get_or_create(organization_id)

    async def handle_oauth_callback(
        self,
        code: str,
        state: str,
        organization_id: str,
    ) -> GmailIntegration:
        """
        Exchange the authorization code for access + refresh tokens.
        Fetches the user's email from the Google userinfo endpoint,
        then stores everything encrypted in the database.
        """
        record = await self._get_or_create(organization_id)

        # Check if simulation mode
        try:
            state_data = json.loads(base64.urlsafe_b64decode(state.encode()).decode())
            is_sim = state_data.get("sim", False)
        except Exception:
            is_sim = False

        if is_sim or not settings.GOOGLE_CLIENT_ID or settings.GOOGLE_CLIENT_ID == "YOUR_GOOGLE_CLIENT_ID":
            # Simulation mode — store a fake connected state
            record.is_connected = True
            record.gmail_address = "demo@gmail.com (simulation mode)"
            record.connected_at = datetime.now(timezone.utc)
            record.error_message = None
            record.access_token_enc = _encrypt("sim_access_token")
            record.refresh_token_enc = _encrypt("sim_refresh_token")
            record.token_expiry = datetime.now(timezone.utc) + timedelta(hours=1)
            await self.db.commit()
            await self.db.refresh(record)
            return record

        # Real OAuth token exchange
        try:
            import httpx
            token_resp = httpx.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "code": code,
                    "client_id": settings.GOOGLE_CLIENT_ID,
                    "client_secret": settings.GOOGLE_CLIENT_SECRET,
                    "redirect_uri": settings.GOOGLE_REDIRECT_URI,
                    "grant_type": "authorization_code",
                },
            )
            token_resp.raise_for_status()
            token_data = token_resp.json()

            access_token = token_data["access_token"]
            refresh_token = token_data.get("refresh_token", "")
            expires_in = token_data.get("expires_in", 3600)

            # Fetch Gmail address from userinfo
            userinfo_resp = httpx.get(
                "https://www.googleapis.com/oauth2/v2/userinfo",
                headers={"Authorization": f"Bearer {access_token}"},
            )
            userinfo_resp.raise_for_status()
            gmail_address = userinfo_resp.json().get("email", "unknown@gmail.com")

            # Store encrypted
            record.access_token_enc = _encrypt(access_token)
            if refresh_token:
                record.refresh_token_enc = _encrypt(refresh_token)
            record.token_expiry = datetime.now(timezone.utc) + timedelta(seconds=expires_in)
            record.gmail_address = gmail_address
            record.is_connected = True
            record.connected_at = datetime.now(timezone.utc)
            record.error_message = None

            await self.db.commit()
            await self.db.refresh(record)

            # Sync Integration catalog item status
            try:
                from app.modules.integrations.models import Integration
                res_int = await self.db.execute(select(Integration).where(Integration.organization_id == organization_id))
                integrations_list = res_int.scalars().all()
                for it in integrations_list:
                    if it.slug in ("google-calendar", "gmail") or "google" in it.name.lower():
                        it.is_connected = True
                await self.db.commit()
            except Exception as e:
                print(f"Failed to update integration record status: {e}")

            return record

        except Exception as exc:
            record.is_connected = False
            record.error_message = str(exc)
            await self.db.commit()
            await self.db.refresh(record)
            return record

    async def disconnect(self, organization_id: str) -> GmailIntegration:
        """Revoke the Gmail connection for this org."""
        record = await self._get_or_create(organization_id)
        record.is_connected = False
        record.access_token_enc = None
        record.refresh_token_enc = None
        record.token_expiry = None
        record.gmail_address = None
        record.connected_at = None
        record.error_message = None
        await self.db.commit()
        await self.db.refresh(record)
        return record

    async def get_valid_access_token(self, organization_id: str) -> Optional[str]:
        """
        Return a valid access token, refreshing it if expired.
        Returns None if the org is not connected.
        """
        record = await self._get_or_create(organization_id)

        if not record.is_connected or not record.access_token_enc:
            return None

        # Check if simulation
        access_token = _decrypt(record.access_token_enc)
        if access_token == "sim_access_token":
            return access_token  # simulation mode

        # Check expiry (refresh 5 minutes early)
        now = datetime.now(timezone.utc)
        token_expiry = record.token_expiry
        if token_expiry and token_expiry.tzinfo is None:
            token_expiry = token_expiry.replace(tzinfo=timezone.utc)

        if token_expiry and token_expiry > now + timedelta(minutes=5):
            return access_token

        # Token expired — attempt refresh
        if not record.refresh_token_enc:
            return None

        try:
            import httpx
            refresh_token = _decrypt(record.refresh_token_enc)
            resp = httpx.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "client_id": settings.GOOGLE_CLIENT_ID,
                    "client_secret": settings.GOOGLE_CLIENT_SECRET,
                    "refresh_token": refresh_token,
                    "grant_type": "refresh_token",
                },
            )
            resp.raise_for_status()
            data = resp.json()
            new_access = data["access_token"]
            expires_in = data.get("expires_in", 3600)

            record.access_token_enc = _encrypt(new_access)
            record.token_expiry = now + timedelta(seconds=expires_in)
            await self.db.commit()
            return new_access
        except Exception as exc:
            record.error_message = f"Token refresh failed: {exc}"
            await self.db.commit()
            return None

    async def test_connection(self, organization_id: str) -> dict:
        """Test that the stored token is still valid by calling Gmail userinfo."""
        record = await self._get_or_create(organization_id)
        if not record.is_connected:
            return {"success": False, "message": "Gmail is not connected."}

        access_token = await self.get_valid_access_token(organization_id)
        if not access_token:
            return {"success": False, "message": "No valid token. Please reconnect."}

        if access_token == "sim_access_token":
            return {
                "success": True,
                "message": "Connection OK (simulation mode)",
                "gmail_address": record.gmail_address,
            }

        try:
            import httpx
            resp = httpx.get(
                "https://www.googleapis.com/oauth2/v2/userinfo",
                headers={"Authorization": f"Bearer {access_token}"},
            )
            resp.raise_for_status()
            email = resp.json().get("email", record.gmail_address)
            return {
                "success": True,
                "message": f"Connected as {email}",
                "gmail_address": email,
            }
        except Exception as exc:
            return {"success": False, "message": f"Connection test failed: {exc}"}

    async def send_email(
        self,
        organization_id: str,
        to_email: str,
        subject: str,
        body: str,
        thread_id: Optional[str] = None,
        in_reply_to: Optional[str] = None,
        references: Optional[str] = None,
        attachments: Optional[List[Dict[str, Any]]] = None,
    ) -> dict:
        """
        Send an email via the Gmail API using the org's OAuth credentials.
        Supports threadId, In-Reply-To/References headers, and file attachments.
        Returns a dict with success, gmail_message_id, gmail_thread_id, and error fields.
        """
        record = await self._get_or_create(organization_id)
        if not record.is_connected:
            return {
                "success": False,
                "error": "Gmail is not connected. Please connect a Gmail account in Settings → Email Integration.",
            }

        access_token = await self.get_valid_access_token(organization_id)
        if not access_token:
            return {"success": False, "error": "No valid Gmail access token. Please reconnect."}

        # Simulation mode
        if access_token == "sim_access_token":
            return {
                "success": True,
                "gmail_message_id": "sim_msg_" + datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S"),
                "gmail_thread_id": thread_id or ("sim_thread_" + datetime.now(timezone.utc).strftime("%Y%m%d")),
                "from_email": record.gmail_address,
            }

        # Real Gmail API send
        try:
            import httpx
            from email.mime.multipart import MIMEMultipart
            from email.mime.base import MIMEBase
            from email import encoders

            if attachments:
                mime_msg = MIMEMultipart("mixed")
                mime_msg.attach(MIMEText(body, "plain"))
                mime_msg["to"] = to_email
                mime_msg["from"] = record.gmail_address
                mime_msg["subject"] = subject
                if in_reply_to:
                    mime_msg["In-Reply-To"] = in_reply_to
                if references:
                    mime_msg["References"] = references

                for att in attachments:
                    att_url = att.get("url")
                    att_filename = att.get("filename") or "attachment"
                    file_data = None
                    if att_url:
                        if att_url.startswith("http://") or att_url.startswith("https://"):
                            r_att = httpx.get(att_url, timeout=15.0)
                            if r_att.status_code == 200:
                                file_data = r_att.content
                        elif os.path.exists(att_url.lstrip("/")):
                            with open(att_url.lstrip("/"), "rb") as f:
                                file_data = f.read()

                    if file_data:
                        part = MIMEBase("application", "octet-stream")
                        part.set_payload(file_data)
                        encoders.encode_base64(part)
                        part.add_header(
                            "Content-Disposition",
                            f'attachment; filename="{att_filename}"',
                        )
                        mime_msg.attach(part)
            else:
                mime_msg = MIMEText(body, "plain")
                mime_msg["to"] = to_email
                mime_msg["from"] = record.gmail_address
                mime_msg["subject"] = subject
                if in_reply_to:
                    mime_msg["In-Reply-To"] = in_reply_to
                if references:
                    mime_msg["References"] = references

            raw = base64.urlsafe_b64encode(mime_msg.as_bytes()).decode()

            payload = {"raw": raw}
            if thread_id:
                payload["threadId"] = thread_id

            resp = httpx.post(
                "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            resp.raise_for_status()
            resp_json = resp.json()
            gmail_msg_id = resp_json.get("id", "")
            gmail_th_id = resp_json.get("threadId", thread_id or "")

            return {
                "success": True,
                "gmail_message_id": gmail_msg_id,
                "gmail_thread_id": gmail_th_id,
                "from_email": record.gmail_address,
            }
        except Exception as exc:
            return {"success": False, "error": str(exc)}


    async def get_attachment_data(
        self,
        organization_id: str,
        message_id: str,
        attachment_id: str,
    ) -> dict:
        """
        Proxy method to download an attachment directly via Gmail API.
        """
        access_token = await self.get_valid_access_token(organization_id)
        if not access_token:
            return {"success": False, "error": "No valid Gmail access token."}

        if access_token == "sim_access_token":
            # Return dummy simulation attachment content
            sim_bytes = base64.b64encode(b"%PDF-1.4 Simulated PDF Document Content for GrowthOS CRM").decode()
            return {"success": True, "data_base64": sim_bytes}

        try:
            import httpx
            url = f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{message_id}/attachments/{attachment_id}"
            async with httpx.AsyncClient(timeout=20.0) as client:
                resp = await client.get(url, headers={"Authorization": f"Bearer {access_token}"})
                resp.raise_for_status()
                data_b64 = resp.json().get("data", "")
                return {"success": True, "data_base64": data_b64}
        except Exception as exc:
            return {"success": False, "error": str(exc)}

    async def get_sync_logs(self, organization_id: str, limit: int = 20) -> list:
        """Fetch sync execution history for Settings display."""
        from app.modules.gmail.models import GmailSyncLog
        res = await self.db.execute(
            select(GmailSyncLog)
            .where(GmailSyncLog.organization_id == organization_id)
            .order_by(GmailSyncLog.started_at.desc())
            .limit(limit)
        )
        return list(res.scalars().all())

