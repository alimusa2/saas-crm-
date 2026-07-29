import json
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from fastapi import HTTPException
from typing import Sequence, Dict, Any, Optional
from jinja2 import Template

from app.modules.email.models import EmailTemplate, EmailCampaign, EmailLog, EmailConfig
from app.modules.email.schemas import EmailTemplateCreate, EmailCampaignCreate, EmailSendRequest, EmailConfigCreate, EmailConfigUpdate
from app.core.security import encrypt_data, decrypt_data
from app.modules.email.tasks import send_email_task

class EmailConfigService:
    @staticmethod
    async def get_config(db: AsyncSession, organization_id: str) -> Optional[EmailConfig]:
        stmt = select(EmailConfig).where(
            EmailConfig.organization_id == organization_id,
            EmailConfig.is_active == True
        )
        result = await db.execute(stmt)
        return result.scalars().first()

    @staticmethod
    async def get_config_decrypted(db: AsyncSession, organization_id: str) -> Optional[Dict[str, Any]]:
        config = await EmailConfigService.get_config(db, organization_id)
        if not config:
            return None
        
        settings_dict = {}
        if config.settings_enc:
            try:
                decrypted = decrypt_data(config.settings_enc)
                settings_dict = json.loads(decrypted)
            except Exception:
                settings_dict = {}

        # Mask sensitive keys
        masked_settings = {}
        for k, v in settings_dict.items():
            if any(term in k.lower() for term in ["password", "secret", "key", "token"]):
                masked_settings[k] = "********"
            else:
                masked_settings[k] = v

        return {
            "id": config.id,
            "provider": config.provider,
            "is_active": config.is_active,
            "organization_id": config.organization_id,
            "settings": masked_settings
        }

    @staticmethod
    async def create_or_update_config(
        db: AsyncSession, obj_in: EmailConfigCreate, organization_id: str
    ) -> EmailConfig:
        stmt = select(EmailConfig).where(
            EmailConfig.organization_id == organization_id
        )
        result = await db.execute(stmt)
        config = result.scalars().first()

        # Encrypt the settings dictionary
        encrypted_settings = encrypt_data(json.dumps(obj_in.settings))

        if config:
            config.provider = obj_in.provider
            config.settings_enc = encrypted_settings
            config.is_active = obj_in.is_active
        else:
            config = EmailConfig(
                provider=obj_in.provider,
                settings_enc=encrypted_settings,
                is_active=obj_in.is_active,
                organization_id=organization_id
            )
            db.add(config)
            
        await db.commit()
        await db.refresh(config)
        return config


class EmailTemplateService:
    @staticmethod
    async def get_templates(db: AsyncSession, organization_id: str) -> Sequence[EmailTemplate]:
        stmt = select(EmailTemplate).where(EmailTemplate.organization_id == organization_id)
        result = await db.execute(stmt)
        return result.scalars().all()

    @staticmethod
    async def create_template(db: AsyncSession, obj_in: EmailTemplateCreate, organization_id: str) -> EmailTemplate:
        db_obj = EmailTemplate(**obj_in.model_dump(), organization_id=organization_id)
        db.add(db_obj)
        await db.commit()
        await db.refresh(db_obj)
        return db_obj


class EmailCampaignService:
    @staticmethod
    async def get_campaigns(db: AsyncSession, organization_id: str) -> Sequence[EmailCampaign]:
        stmt = select(EmailCampaign).where(EmailCampaign.organization_id == organization_id)
        result = await db.execute(stmt)
        return result.scalars().all()

    @staticmethod
    async def create_campaign(db: AsyncSession, obj_in: EmailCampaignCreate, organization_id: str) -> EmailCampaign:
        db_obj = EmailCampaign(**obj_in.model_dump(), organization_id=organization_id)
        db.add(db_obj)
        await db.commit()
        await db.refresh(db_obj)
        return db_obj


class EmailLogService:
    @staticmethod
    async def send_email(db: AsyncSession, obj_in: EmailSendRequest, organization_id: str) -> EmailLog:
        # Verify template exists
        stmt = select(EmailTemplate).where(
            EmailTemplate.id == obj_in.template_id, 
            EmailTemplate.organization_id == organization_id
        )
        result = await db.execute(stmt)
        template = result.scalar_one_or_none()
        if not template:
            raise HTTPException(status_code=404, detail="Email Template not found")
            
        # Render the template using Jinja2
        variables = obj_in.variables or {}
        try:
            rendered_subject = Template(template.subject).render(**variables)
            rendered_html = Template(template.html_content).render(**variables)
        except Exception as e:
            raise HTTPException(
                status_code=400, 
                detail=f"Template rendering failed: {str(e)}"
            )
        
        # Save to database in 'Queued' status
        log_obj = EmailLog(
            organization_id=organization_id,
            recipient=obj_in.recipient_email,
            subject=rendered_subject,
            body=rendered_html,
            status="Queued",
            lead_id=obj_in.lead_id
        )
        db.add(log_obj)

        # Also create a CRM inbox Message record so the lead's Inbox shows the sent email
        try:
            from app.modules.inbox.models import Message
            from app.modules.inbox.services import InboxService
            msg_obj = Message(
                subject=rendered_subject,
                body=rendered_html,
                sender_id="system",
                lead_id=obj_in.lead_id,
                contact_id=variables.get("contact_id") if isinstance(variables, dict) else None,
                is_read=True,
                message_type="Email",
                direction="Outgoing",
                delivery_status="Sent",
                recipient_email=obj_in.recipient_email,
                organization_id=organization_id
            )
            await InboxService.route_inbox_message(db, msg_obj, variables)
            db.add(msg_obj)
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning(f"Failed to copy email log to inbox message: {e}")

        await db.commit()
        await db.refresh(log_obj)
        
        # Dispatch to Celery background task
        send_email_task.delay(log_obj.id)
        
        return log_obj
