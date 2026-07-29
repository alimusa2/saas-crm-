import json
import logging
import asyncio
from sqlalchemy.future import select
from app.core.celery_app import celery_app
from app.db.session import AsyncSessionLocal
from app.core.security import decrypt_data
from app.modules.inbox.models import Message
from app.modules.email.models import EmailConfig
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
def send_inbox_email_task(self, message_id: str):
    """Async background task to dispatch outbound messages from Inbox."""
    return run_async_coro(_async_send(self, message_id))

async def _async_send(self, message_id: str):
    async with AsyncSessionLocal() as db:
        # Fetch Message
        res = await db.execute(select(Message).where(Message.id == message_id))
        msg = res.scalars().first()
        if not msg:
            logger.error(f"Inbox Message not found: {message_id}")
            return
            
        # Get active email configuration
        res_cfg = await db.execute(
            select(EmailConfig).where(
                EmailConfig.organization_id == msg.organization_id,
                EmailConfig.is_active == True
            )
        )
        config_obj = res_cfg.scalars().first()
        
        provider_name = "smtp"
        settings_dict = {}
        
        if not config_obj:
            # Fallback to connected Gmail integration
            from app.modules.gmail.models import GmailIntegration
            r = await db.execute(
                select(GmailIntegration).where(
                    GmailIntegration.organization_id == msg.organization_id,
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
                    logger.error(f"Failed decrypting credentials for inbox message {message_id}: {e}")
                    msg.delivery_status = "Failed"
                    msg.error_message = f"Decryption failed: {e}"
                    await db.commit()
                    return

        try:
            # Get provider from registry
            provider = EmailProviderRegistry.get_provider(
                provider_name=provider_name,
                settings_dict=settings_dict,
                organization_id=msg.organization_id,
                db_session=db
            )
            
            # Send
            res_send = await provider.send(
                to_email=msg.recipient_email,
                subject=msg.subject or "Outbound Message",
                body=msg.body,
                cc=None,
                bcc=None,
                reply_to=None,
                html_body=None,
                attachments=None
            )
            
            if res_send.get("success"):
                msg.delivery_status = "Sent"
                msg.gmail_message_id = res_send.get("message_id")
                msg.error_message = None
                await db.commit()
                
                # Emit event EmailSent
                from app.core.events import publish, EmailSentEvent
                event = EmailSentEvent(
                    message_id=msg.id,
                    organization_id=msg.organization_id,
                    recipient_email=msg.recipient_email,
                    lead_id=msg.lead_id
                )
                await publish("email.sent", event)
            else:
                raise Exception(res_send.get("error", "Unknown provider send failure"))
        except Exception as e:
            logger.warning(f"Failed sending inbox email message {message_id}: {e}. Retry: {self.request.retries}/3")
            msg.error_message = str(e)
            await db.commit()
            
            try:
                countdown = 10 * (4 ** self.request.retries)
                self.retry(exc=e, countdown=countdown)
            except self.MaxRetriesExceededError:
                msg.delivery_status = "Failed"
                msg.error_message = f"Max retries exceeded: {e}"
                await db.commit()


@celery_app.task(bind=True)
def fetch_incoming_emails_task(self):
    """Periodic sync task to fetch incoming emails for connected organizations."""
    return run_async_coro(_async_fetch(self))

async def _async_fetch(self):
    from app.modules.gmail.sync_service import GmailSyncService
    async with AsyncSessionLocal() as db:
        sync_svc = GmailSyncService(db)
        return await sync_svc.sync_all_mailboxes()


