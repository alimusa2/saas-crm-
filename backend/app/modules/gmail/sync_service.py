"""
Gmail Sync Service
Handles background scheduled synchronization of incoming Gmail messages.
Fully additive & resilient: does not crash on single mailbox failures.
"""
import base64
import json
import logging
import re
from datetime import datetime, timezone
from email.utils import parseaddr, parsedate_to_datetime
from typing import Dict, List, Optional, Tuple

import httpx
from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.core.events import EmailReceivedEvent, publish
from app.modules.crm.models import Activity, Company, Contact, Lead
from app.modules.gmail.models import GmailIntegration, GmailSyncLog
from app.modules.gmail.services import GmailService
from app.modules.inbox.models import Message
from app.modules.inbox.services import InboxService
from app.modules.notifications.models import Notification

logger = logging.getLogger(__name__)


def extract_clean_email(raw_val: str) -> Tuple[str, str]:
    """
    Extracts display name and email address from a header like 'John Doe <john@example.com>'.
    Returns (display_name, email).
    """
    if not raw_val:
        return ("", "")
    name, addr = parseaddr(raw_val)
    if not addr:
        match = re.search(r'[\w\.-]+@[\w\.-]+\.\w+', raw_val)
        addr = match.group(0) if match else raw_val.strip()
    return (name.strip(), addr.strip().lower())


def parse_gmail_body(payload: dict) -> str:
    """
    Recursively extracts text or HTML body from a Gmail message payload.
    """
    body_text = ""

    def _walk_parts(parts: list) -> str:
        text_content = ""
        html_content = ""
        for part in parts:
            mime_type = part.get("mimeType", "")
            if "parts" in part:
                res = _walk_parts(part["parts"])
                if res:
                    return res
            data = part.get("body", {}).get("data", "")
            if data:
                try:
                    decoded = base64.urlsafe_b64decode(data.encode()).decode("utf-8", errors="ignore")
                    if mime_type == "text/plain":
                        text_content = decoded
                    elif mime_type == "text/html":
                        html_content = decoded
                except Exception:
                    pass
        return html_content or text_content

    if "parts" in payload:
        body_text = _walk_parts(payload["parts"])
    else:
        data = payload.get("body", {}).get("data", "")
        if data:
            try:
                body_text = base64.urlsafe_b64decode(data.encode()).decode("utf-8", errors="ignore")
            except Exception:
                body_text = ""

    return body_text or "(No body content)"


def parse_gmail_attachments(payload: dict) -> List[Dict]:
    """
    Extracts attachment metadata (filename, mimeType, size, attachmentId).
    """
    attachments = []

    def _walk_attachments(parts: list):
        for part in parts:
            if "parts" in part:
                _walk_attachments(part["parts"])
            filename = part.get("filename")
            body = part.get("body", {})
            attachment_id = body.get("attachmentId")
            if filename and attachment_id:
                attachments.append({
                    "id": attachment_id,
                    "filename": filename,
                    "mime_type": part.get("mimeType", "application/octet-stream"),
                    "size": body.get("size", 0)
                })

    if "parts" in payload:
        _walk_attachments(payload["parts"])

    return attachments


class GmailSyncService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def sync_all_mailboxes(self) -> Dict[str, any]:
        """
        Synchronizes all active connected Gmail accounts.
        Never lets one failed mailbox abort syncing of other mailboxes.
        """
        res = await self.db.execute(
            select(GmailIntegration).where(GmailIntegration.is_connected == True)
        )
        integrations = list(res.scalars().all())

        results = {"total": len(integrations), "success": 0, "failed": 0, "details": []}

        for integration in integrations:
            try:
                summary = await self.sync_mailbox(integration)
                results["success"] += 1
                results["details"].append({"org_id": integration.organization_id, "status": "Success", "summary": summary})
            except Exception as exc:
                logger.error(f"Error syncing Gmail mailbox for org {integration.organization_id}: {exc}", exc_info=True)
                results["failed"] += 1
                results["details"].append({"org_id": integration.organization_id, "status": "Failed", "error": str(exc)})

        return results

    async def sync_mailbox(self, integration: GmailIntegration) -> str:
        """
        Performs incremental synchronization for a single connected Gmail account.
        """
        org_id = integration.organization_id
        start_time = datetime.now(timezone.utc)

        # 1. Start Sync Log
        sync_log = GmailSyncLog(
            organization_id=org_id,
            gmail_address=integration.gmail_address,
            started_at=start_time,
            status="In Progress",
            imported_count=0,
            skipped_count=0,
        )
        self.db.add(sync_log)
        integration.sync_status = "Syncing"
        await self.db.commit()

        gmail_svc = GmailService(self.db)
        access_token = await gmail_svc.get_valid_access_token(org_id)

        if not access_token:
            error_msg = f"Failed to retrieve valid OAuth token for org {org_id}"
            integration.sync_status = "Failed"
            integration.error_message = error_msg
            integration.last_sync_message = error_msg
            sync_log.status = "Failed"
            sync_log.error_message = error_msg
            sync_log.completed_at = datetime.now(timezone.utc)
            await self.db.commit()
            return error_msg

        # 2. Simulation Mode handling
        if access_token == "sim_access_token":
            return await self._handle_simulation_sync(integration, sync_log)

        # 3. Real Gmail API Sync
        imported_count = 0
        skipped_count = 0

        try:
            headers_api = {"Authorization": f"Bearer {access_token}"}
            
            # Query incoming messages. If last_synced_at exists, filter by timestamp
            query_parts = []
            if integration.last_synced_at:
                epoch_sec = int(integration.last_synced_at.timestamp()) - 300 # 5 min overlap safety margin
                query_parts.append(f"after:{epoch_sec}")
            
            q_str = " ".join(query_parts) if query_parts else ""
            list_url = "https://gmail.googleapis.com/gmail/v1/users/me/messages"
            params = {}
            if q_str:
                params["q"] = q_str

            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.get(list_url, headers=headers_api, params=params)
                if resp.status_code != 200:
                    raise Exception(f"Gmail API list messages failed: {resp.status_code} {resp.text}")

                msg_items = resp.json().get("messages", [])

                for item in msg_items:
                    msg_id = item["id"]

                    # Deduplication check
                    check_exists = await self.db.execute(
                        select(Message.id).where(
                            Message.organization_id == org_id,
                            Message.gmail_message_id == msg_id
                        )
                    )
                    if check_exists.scalars().first():
                        skipped_count += 1
                        continue

                    # Fetch full message details
                    detail_url = f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{msg_id}?format=full"
                    detail_resp = await client.get(detail_url, headers=headers_api)
                    if detail_resp.status_code != 200:
                        logger.warning(f"Failed fetching details for Gmail message {msg_id}: {detail_resp.text}")
                        continue

                    msg_data = detail_resp.json()
                    payload = msg_data.get("payload", {})
                    headers = payload.get("headers", [])

                    # Extract headers
                    header_dict = {}
                    for h in headers:
                        header_dict[h["name"].lower()] = h["value"]

                    msg_from_raw = header_dict.get("from", "")
                    sender_name, sender_email = extract_clean_email(msg_from_raw)
                    msg_subject = header_dict.get("subject", "(No Subject)")
                    msg_date_raw = header_dict.get("date")
                    thread_id = msg_data.get("threadId", msg_id)

                    # Extract Body & Attachments
                    body_content = parse_gmail_body(payload)
                    attachments = parse_gmail_attachments(payload)

                    # Process incoming attachments and upload to Cloudinary / Storage
                    if attachments:
                        from app.utils.storage import StorageManager
                        gmail_svc = GmailService(self.db)
                        for att in attachments:
                            try:
                                att_res = await gmail_svc.get_attachment_data(org_id, msg_id, att["id"])
                                if att_res.get("success") and att_res.get("data_base64"):
                                    raw_bytes = base64.urlsafe_b64decode(att_res["data_base64"].encode())
                                    cloud_url = await StorageManager.upload_bytes(
                                        raw_bytes,
                                        att.get("filename", "file"),
                                        att.get("mime_type", "application/octet-stream")
                                    )
                                    att["url"] = cloud_url
                            except Exception as att_err:
                                logger.error(f"Failed to upload incoming attachment {att.get('filename')} to Cloudinary: {att_err}")

                    # Match Contacts -> Leads -> Company Email
                    lead_id, contact_id, company_id, is_unknown_contact, is_ambiguous, assigned_user_id = await self.match_email_address(org_id, sender_email)

                    # Parse date timestamp
                    msg_timestamp = datetime.now(timezone.utc)
                    if msg_date_raw:
                        try:
                            msg_timestamp = parsedate_to_datetime(msg_date_raw)
                        except Exception:
                            pass

                    # Create Inbox Message
                    new_msg = Message(
                        organization_id=org_id,
                        subject=msg_subject,
                        body=body_content,
                        sender_id=None,
                        sender_email=sender_email,
                        recipient_email=integration.gmail_address,
                        message_type="Email",
                        direction="Incoming",
                        delivery_status="Delivered",
                        gmail_message_id=msg_id,
                        gmail_thread_id=thread_id,
                        lead_id=lead_id,
                        contact_id=contact_id,
                        company_id=company_id,
                        is_unknown_contact=is_unknown_contact,
                        is_ambiguous=is_ambiguous,
                        is_read=False,
                        attachments_metadata=json.dumps(attachments) if attachments else None,
                        created_at=msg_timestamp
                    )

                    
                    # Route internal / team links
                    await InboxService.route_inbox_message(self.db, new_msg)
                    self.db.add(new_msg)
                    await self.db.flush()

                    # Add Lead / Contact Timeline Activity
                    if lead_id or contact_id:
                        activity = Activity(
                            organization_id=org_id,
                            type="Email",
                            description=f"Incoming Email Received from {sender_name or sender_email}: {msg_subject}",
                            lead_id=lead_id,
                            contact_id=contact_id,
                            author_id=assigned_user_id or "system",
                            timestamp=msg_timestamp
                        )
                        self.db.add(activity)

                    # Create Notification for assigned user
                    if assigned_user_id:
                        notif = Notification(
                            organization_id=org_id,
                            user_id=assigned_user_id,
                            type="Email",
                            title=f"New Email from {sender_name or sender_email}",
                            content=f"Subject: {msg_subject}\n{body_content[:120]}...",
                            related_entity_type="Lead" if lead_id else ("Contact" if contact_id else "Message"),
                            related_entity_id=lead_id or contact_id or new_msg.id
                        )
                        self.db.add(notif)

                    # Emit Event
                    event = EmailReceivedEvent(
                        message_id=new_msg.id,
                        organization_id=org_id,
                        sender_email=sender_email,
                        subject=msg_subject
                    )
                    await publish("email.received", event)

                    imported_count += 1

            # Update Integration state
            integration.last_synced_at = datetime.now(timezone.utc)
            integration.sync_status = "Success"
            summary_msg = f"Synced {imported_count} new emails ({skipped_count} skipped)"
            integration.last_sync_message = summary_msg

            # Update Log
            sync_log.status = "Success"
            sync_log.imported_count = imported_count
            sync_log.skipped_count = skipped_count
            sync_log.completed_at = datetime.now(timezone.utc)

            await self.db.commit()
            return summary_msg

        except Exception as exc:
            logger.error(f"Gmail sync failed for organization {org_id}: {exc}", exc_info=True)
            integration.sync_status = "Failed"
            integration.error_message = str(exc)
            integration.last_sync_message = f"Error: {exc}"
            sync_log.status = "Failed"
            sync_log.error_message = str(exc)
            sync_log.completed_at = datetime.now(timezone.utc)
            await self.db.commit()
            raise exc

    async def match_email_address(self, org_id: str, email: str) -> Tuple[Optional[str], Optional[str], Optional[str], bool, bool, Optional[str]]:
        """
        Email Matching Algorithm:
        Search: Contacts -> Leads -> Company
        Returns: (lead_id, contact_id, company_id, is_unknown_contact, is_ambiguous, assigned_user_id)
        Does NOT automatically create new leads!
        """
        if not email:
            return (None, None, None, True, False, None)

        email_clean = email.strip().lower()

        # 1. Search Contacts
        r_con = await self.db.execute(
            select(Contact).where(
                Contact.organization_id == org_id,
                func.lower(Contact.email) == email_clean
            )
        )
        contact = r_con.scalars().first()
        if contact:
            # Contact matched
            company_id = contact.company_id
            return (None, contact.id, company_id, False, False, None)

        # 2. Search Leads
        r_leads = await self.db.execute(
            select(Lead).where(
                Lead.organization_id == org_id,
                func.lower(Lead.email) == email_clean,
                func.lower(Lead.status) != "archived"
            )
        )
        leads = list(r_leads.scalars().all())
        if len(leads) == 1:
            lead = leads[0]
            return (lead.id, None, lead.company_id, False, False, lead.owner_id)
        elif len(leads) > 1:
            lead = leads[0]
            return (lead.id, None, lead.company_id, False, True, lead.owner_id)

        # 3. Search Companies
        r_comp = await self.db.execute(
            select(Company).where(
                Company.organization_id == org_id,
                func.lower(Company.website).contains(email_clean.split("@")[-1]) if "@" in email_clean else False
            )
        )
        company = r_comp.scalars().first()
        if company:
            return (None, None, company.id, False, False, None)

        # 4. Unknown Contact (No match found)
        return (None, None, None, True, False, None)

    async def _handle_simulation_sync(self, integration: GmailIntegration, sync_log: GmailSyncLog) -> str:
        """Simulation mode fallback for development and testing."""
        org_id = integration.organization_id
        
        # Check if demo incoming email already exists
        check_sim = await self.db.execute(
            select(Message.id).where(
                Message.organization_id == org_id,
                Message.sender_email == "client.demo@growthos-simulation.com"
            )
        )
        if not check_sim.scalars().first():
            # Create mock lead or unknown contact message
            sim_msg = Message(
                organization_id=org_id,
                subject="Inquiry regarding SaaS enterprise license",
                body="Hello GrowthOS team,\n\nWe are reviewing your platform for our sales workflow. Could you provide details on your API limits and incoming email sync capabilities?\n\nBest regards,\nAlex Demo",
                sender_id=None,
                sender_email="client.demo@growthos-simulation.com",
                recipient_email=integration.gmail_address or "demo@gmail.com",
                message_type="Email",
                direction="Incoming",
                delivery_status="Delivered",
                gmail_message_id="sim_msg_inc_" + datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S"),
                gmail_thread_id="sim_thread_1001",
                is_unknown_contact=True,
                is_read=False,
                attachments_metadata=json.dumps([{
                    "id": "sim_att_1",
                    "filename": "GrowthOS_RF_Requirement.pdf",
                    "mime_type": "application/pdf",
                    "size": 245760
                }])
            )
            self.db.add(sim_msg)
            sync_log.imported_count = 1
            summary = "Simulation sync complete: 1 sample incoming email created"
        else:
            sync_log.skipped_count = 1
            summary = "Simulation sync complete: Up to date"

        integration.last_synced_at = datetime.now(timezone.utc)
        integration.sync_status = "Success"
        integration.last_sync_message = summary

        sync_log.status = "Success"
        sync_log.completed_at = datetime.now(timezone.utc)
        await self.db.commit()
        return summary
