from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from typing import List, Dict, Any

from app.db.session import get_db
from app.modules.auth.dependencies import get_current_active_user
from app.modules.auth.models import User
from app.modules.email.schemas import (
    EmailTemplateResponse, EmailTemplateCreate,
    EmailCampaignResponse, EmailCampaignCreate,
    EmailSendRequest, EmailConfigCreate, EmailConfigResponse
)
from app.modules.email.services import (
    EmailTemplateService, EmailCampaignService, EmailLogService, EmailConfigService
)

router = APIRouter()

@router.get("/config")
async def get_email_config(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Retrieve decrypted settings with masked credentials."""
    config_dict = await EmailConfigService.get_config_decrypted(db, current_user.organization_id)
    if not config_dict:
        raise HTTPException(status_code=404, detail="Email configuration not found")
    return config_dict

@router.post("/config")
async def save_email_config(
    obj_in: EmailConfigCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Create or update email provider settings (encrypted at rest)."""
    return await EmailConfigService.create_or_update_config(db, obj_in, current_user.organization_id)

@router.post("/config/test")
async def test_email_config(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Run a health check on the active email provider."""
    from app.modules.email.providers import EmailProviderRegistry
    from app.core.security import decrypt_data
    import json

    config = await EmailConfigService.get_config(db, current_user.organization_id)
    if not config:
        # Fall back to Gmail OAuth if connected
        from app.modules.gmail.models import GmailIntegration
        r = await db.execute(
            select(GmailIntegration).where(
                GmailIntegration.organization_id == current_user.organization_id,
                GmailIntegration.is_connected == True
            )
        )
        gmail_int = r.scalars().first()
        if gmail_int:
            provider = EmailProviderRegistry.get_provider("gmail", {}, current_user.organization_id, db)
            return provider.health_check()
        raise HTTPException(status_code=404, detail="No email configuration or active Gmail integration found")

    settings_dict = {}
    if config.settings_enc:
        try:
            settings_dict = json.loads(decrypt_data(config.settings_enc))
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to decrypt credentials: {e}")

    try:
        provider = EmailProviderRegistry.get_provider(
            provider_name=config.provider,
            settings_dict=settings_dict,
            organization_id=current_user.organization_id,
            db_session=db
        )
        return provider.health_check()
    except Exception as e:
        return {"success": False, "message": str(e)}

@router.get("/templates", response_model=List[EmailTemplateResponse])
async def read_templates(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    return await EmailTemplateService.get_templates(db, current_user.organization_id)

@router.post("/templates", response_model=EmailTemplateResponse)
async def create_template(
    obj_in: EmailTemplateCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    return await EmailTemplateService.create_template(db, obj_in, current_user.organization_id)

@router.get("/campaigns", response_model=List[EmailCampaignResponse])
async def read_campaigns(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    return await EmailCampaignService.get_campaigns(db, current_user.organization_id)

@router.post("/campaigns", response_model=EmailCampaignResponse)
async def create_campaign(
    obj_in: EmailCampaignCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    return await EmailCampaignService.create_campaign(db, obj_in, current_user.organization_id)

@router.post("/send")
async def send_email(
    obj_in: EmailSendRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    log = await EmailLogService.send_email(db, obj_in, current_user.organization_id)
    return {"message": "Email queued for sending", "log_id": log.id}

@router.post("/webhook")
async def email_webhook(
    payload: dict,
    db: AsyncSession = Depends(get_db)
):
    """Receive webhooks from email providers to simulate tracking events."""
    from sqlalchemy.future import select
    from app.modules.email.models import EmailLog
    
    msg_id = payload.get("message_id")
    event_type = payload.get("event")
    if not msg_id or not event_type:
        raise HTTPException(status_code=400, detail="Missing message_id or event")
        
    res = await db.execute(select(EmailLog).where(EmailLog.message_id == msg_id))
    log = res.scalars().first()
    if not log:
        res = await db.execute(select(EmailLog).where(EmailLog.id == msg_id))
        log = res.scalars().first()
        
    if not log:
        raise HTTPException(status_code=404, detail="Email log not found")
        
    status_map = {
        "delivered": "Delivered",
        "failed": "Failed",
        "opened": "Opened",
        "clicked": "Clicked",
        "bounce": "Bounced",
        "reply": "Replied"
    }
    if event_type in status_map:
        log.status = status_map[event_type]
        await db.commit()
        
    event_name = f"email.{event_type}"
    if event_type == "bounce":
        event_name = "email.bounce_detected"
    elif event_type == "reply":
        event_name = "email.reply_received"
        
    from app.core.events import publish, GenericEvent
    await publish(event_name, GenericEvent(
        event_name=event_name,
        organization_id=log.organization_id,
        entity_id=log.id,
        trigger_name=event_name,
        data={
            "message_id": log.id,
            "recipient_email": log.recipient,
            "lead_id": log.lead_id
        }
    ))
    return {"status": "success"}
