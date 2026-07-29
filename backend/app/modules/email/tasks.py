import json
import logging
import asyncio
from sqlalchemy.future import select
from app.core.celery_app import celery_app
from app.db.session import AsyncSessionLocal
from app.core.security import decrypt_data
from app.modules.email.models import EmailLog, EmailConfig
from app.modules.email.providers import EmailProviderRegistry

logger = logging.getLogger(__name__)

def run_async_coro(coro):
    import asyncio
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        return loop.create_task(coro)
    else:
        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
        return loop.run_until_complete(coro)


@celery_app.task(bind=True, max_retries=3)
def send_email_task(self, email_log_id: str):
    """Celery background task to send emails."""
    return run_async_coro(_async_send(self, email_log_id))

async def _async_send(self, email_log_id: str):
    async with AsyncSessionLocal() as db:
        # Fetch the email log
        result = await db.execute(select(EmailLog).where(EmailLog.id == email_log_id))
        log_obj = result.scalars().first()
        if not log_obj:
            logger.error(f"Email log not found for ID: {email_log_id}")
            return
            
        # Fetch organization email config
        res = await db.execute(
            select(EmailConfig).where(
                EmailConfig.organization_id == log_obj.organization_id,
                EmailConfig.is_active == True
            )
        )
        config_obj = res.scalars().first()
        
        provider_name = "smtp"
        settings_dict = {}
        
        # If no config is set, check for connected Gmail integration
        if not config_obj:
            from app.modules.gmail.models import GmailIntegration
            r = await db.execute(
                select(GmailIntegration).where(
                    GmailIntegration.organization_id == log_obj.organization_id,
                    GmailIntegration.is_connected == True
                )
            )
            gmail_int = r.scalars().first()
            if gmail_int:
                provider_name = "gmail"
        else:
            provider_name = config_obj.provider
            if config_obj.settings_enc:
                try:
                    decrypted = decrypt_data(config_obj.settings_enc)
                    settings_dict = json.loads(decrypted)
                except Exception as e:
                    logger.error(f"Failed to decrypt email config for log {email_log_id}: {e}")
                    log_obj.status = "Failed"
                    log_obj.error_message = f"Decryption failed: {e}"
                    await db.commit()
                    return

        try:
            # Instantiate provider from registry
            provider = EmailProviderRegistry.get_provider(
                provider_name=provider_name,
                settings_dict=settings_dict,
                organization_id=log_obj.organization_id,
                db_session=db
            )
            
            # Determine if body is HTML
            is_html = False
            body_content = log_obj.body or ""
            if "<html" in body_content.lower() or "<div" in body_content.lower() or "<p" in body_content.lower():
                is_html = True

            html_body = body_content if is_html else None
            # Simple text conversion by stripping HTML tags if it is HTML
            text_body = body_content
            if is_html:
                import re
                text_body = re.sub(r"<[^>]+>", "", body_content)

            # Send email
            res_send = await provider.send(
                to_email=log_obj.recipient,
                subject=log_obj.subject,
                body=text_body,
                cc=log_obj.cc,
                bcc=log_obj.bcc,
                reply_to=log_obj.reply_to,
                html_body=html_body,
                attachments=None
            )
            
            if res_send.get("success"):
                log_obj.status = "Sent"
                log_obj.message_id = res_send.get("message_id")
                log_obj.error_message = None
                await db.commit()
                
                # Emit event EmailSent
                from app.core.events import publish, EmailSentEvent
                event = EmailSentEvent(
                    message_id=log_obj.id,
                    organization_id=log_obj.organization_id,
                    recipient_email=log_obj.recipient,
                    lead_id=log_obj.lead_id,
                    campaign_id=log_obj.campaign_id
                )
                await publish("email.sent", event)
            else:
                raise Exception(res_send.get("error", "Unknown provider send failure"))
                
        except Exception as e:
            logger.warning(f"Failed sending email ID {email_log_id}: {e}. Retry: {self.request.retries}/3")
            log_obj.retry_count = self.request.retries + 1
            log_obj.error_message = str(e)
            await db.commit()
            
            # Trigger celery retry
            try:
                countdown = 10 * (4 ** self.request.retries)
                self.retry(exc=e, countdown=countdown)
            except self.MaxRetriesExceededError:
                log_obj.status = "Failed"
                log_obj.error_message = f"Max retries exceeded: {e}"
                await db.commit()
