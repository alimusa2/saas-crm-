import os
import json
import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email import encoders
from typing import Optional, List, Dict, Any
import httpx
import asyncio

logger = logging.getLogger(__name__)

class BaseEmailProvider:
    async def send(
        self,
        to_email: str,
        subject: str,
        body: str,
        cc: Optional[str] = None,
        bcc: Optional[str] = None,
        reply_to: Optional[str] = None,
        html_body: Optional[str] = None,
        attachments: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """
        Sends an email. Returns a dict with keys:
        - success (bool)
        - message_id (str, optional)
        - error (str, optional)
        """
        raise NotImplementedError

    async def health_check(self) -> Dict[str, Any]:
        """Verify provider connection."""
        raise NotImplementedError


class SMTPProvider(BaseEmailProvider):
    def __init__(self, config: Dict[str, Any]):
        self.host = config.get("smtp_host", "localhost")
        self.port = int(config.get("smtp_port", 587))
        self.username = config.get("smtp_username", "")
        self.password = config.get("smtp_password", "")
        self.use_tls = config.get("smtp_use_tls", True)
        self.from_email = config.get("from_email", "no-reply@growthos.local")

    def _sync_send(self, to_email: str, subject: str, body: str, cc: Optional[str], bcc: Optional[str], reply_to: Optional[str], html_body: Optional[str], attachments: Optional[List[Dict[str, Any]]]) -> Dict[str, Any]:
        try:
            msg = MIMEMultipart("alternative" if html_body else "mixed")
            msg["Subject"] = subject
            msg["From"] = self.from_email
            msg["To"] = to_email

            if cc:
                msg["Cc"] = cc
            if bcc:
                msg["Bcc"] = bcc
            if reply_to:
                msg["Reply-To"] = reply_to

            # Attach body
            part_text = MIMEText(body, "plain", "utf-8")
            msg.attach(part_text)

            if html_body:
                part_html = MIMEText(html_body, "html", "utf-8")
                msg.attach(part_html)

            # Handle attachments
            if attachments:
                for att in attachments:
                    part = MIMEBase("application", "octet-stream")
                    part.set_payload(att["content"])
                    encoders.encode_base64(part)
                    part.add_header(
                        "Content-Disposition",
                        f'attachment; filename="{att["filename"]}"',
                    )
                    msg.attach(part)

            # Build list of recipients
            recipients = [to_email]
            if cc:
                recipients.extend([x.strip() for x in cc.split(",")])
            if bcc:
                recipients.extend([x.strip() for x in bcc.split(",")])

            with smtplib.SMTP(self.host, self.port, timeout=15) as server:
                if self.use_tls:
                    server.starttls()
                if self.username and self.password:
                    server.login(self.username, self.password)
                server.sendmail(self.from_email, recipients, msg.as_string())

            logger.info(f"Email sent successfully to {to_email} via SMTP")
            return {"success": True, "message_id": msg.get("Message-ID")}
        except Exception as e:
            logger.error(f"SMTP send failed to {to_email}: {e}")
            return {"success": False, "error": str(e)}

    async def send(
        self,
        to_email: str,
        subject: str,
        body: str,
        cc: Optional[str] = None,
        bcc: Optional[str] = None,
        reply_to: Optional[str] = None,
        html_body: Optional[str] = None,
        attachments: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        return await asyncio.to_thread(self._sync_send, to_email, subject, body, cc, bcc, reply_to, html_body, attachments)

    def _sync_health_check(self) -> Dict[str, Any]:
        try:
            with smtplib.SMTP(self.host, self.port, timeout=5) as server:
                if self.use_tls:
                    server.starttls()
                if self.username and self.password:
                    server.login(self.username, self.password)
            return {"success": True, "message": "SMTP Connection OK"}
        except Exception as e:
            return {"success": False, "message": f"SMTP Connection Failed: {e}"}

    async def health_check(self) -> Dict[str, Any]:
        return await asyncio.to_thread(self._sync_health_check)


class GmailOAuthProvider(BaseEmailProvider):
    def __init__(self, organization_id: str, db_session: Any):
        self.organization_id = organization_id
        self.db = db_session

    async def send(
        self,
        to_email: str,
        subject: str,
        body: str,
        cc: Optional[str] = None,
        bcc: Optional[str] = None,
        reply_to: Optional[str] = None,
        html_body: Optional[str] = None,
        attachments: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        from app.modules.gmail.services import GmailService
        gmail_svc = GmailService(self.db)
        # Directly await the coroutine (we are already in an event loop)
        res = await gmail_svc.send_email(
            organization_id=self.organization_id,
            to_email=to_email,
            subject=subject,
            body=body,
        )
        return res

    async def health_check(self) -> Dict[str, Any]:
        from app.modules.gmail.services import GmailService
        gmail_svc = GmailService(self.db)
        res = await gmail_svc.test_connection(self.organization_id)
        return res


class MockSendGridProvider(BaseEmailProvider):
    def __init__(self, config: Dict[str, Any]):
        self.api_key = config.get("api_key", "")
        self.from_email = config.get("from_email", "no-reply@growthos.local")

    async def send(
        self,
        to_email: str,
        subject: str,
        body: str,
        cc: Optional[str] = None,
        bcc: Optional[str] = None,
        reply_to: Optional[str] = None,
        html_body: Optional[str] = None,
        attachments: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        logger.info(f"[Mock SendGrid] Sending email to {to_email} (API Key: {self.api_key[:5]}...)")
        if not self.api_key:
            return {"success": False, "error": "SendGrid API Key is missing."}
        return {"success": True, "message_id": "sg_mock_msg_12345"}

    async def health_check(self) -> Dict[str, Any]:
        if not self.api_key:
            return {"success": False, "message": "SendGrid key not configured"}
        return {"success": True, "message": "SendGrid Integration OK"}


class MockSESProvider(BaseEmailProvider):
    def __init__(self, config: Dict[str, Any]):
        self.aws_access_key = config.get("aws_access_key", "")
        self.aws_secret_key = config.get("aws_secret_key", "")
        self.aws_region = config.get("aws_region", "us-east-1")
        self.from_email = config.get("from_email", "no-reply@growthos.local")

    async def send(
        self,
        to_email: str,
        subject: str,
        body: str,
        cc: Optional[str] = None,
        bcc: Optional[str] = None,
        reply_to: Optional[str] = None,
        html_body: Optional[str] = None,
        attachments: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        logger.info(f"[Mock SES] Sending email to {to_email} (AWS Key: {self.aws_access_key[:5]}...)")
        if not self.aws_access_key or not self.aws_secret_key:
            return {"success": False, "error": "AWS Credentials are missing."}
        return {"success": True, "message_id": "ses_mock_msg_12345"}

    async def health_check(self) -> Dict[str, Any]:
        if not self.aws_access_key or not self.aws_secret_key:
            return {"success": False, "message": "AWS SES credentials not configured"}
        return {"success": True, "message": "AWS SES Integration OK"}


class EmailProviderRegistry:
    @staticmethod
    def get_provider(
        provider_name: str, settings_dict: Dict[str, Any], organization_id: str, db_session: Any = None
    ) -> BaseEmailProvider:
        prov = provider_name.lower()
        if prov == "smtp":
            return SMTPProvider(settings_dict)
        elif prov == "gmail":
            return GmailOAuthProvider(organization_id, db_session)
        elif prov == "sendgrid":
            return MockSendGridProvider(settings_dict)
        elif prov == "ses":
            return MockSESProvider(settings_dict)
        else:
            raise ValueError(f"Unknown email provider: {provider_name}")
