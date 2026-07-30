from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from typing import List, Optional
from app.modules.inbox.models import Message
from app.modules.inbox.schemas import MessageCreate, EmailSendRequest


class InboxService:
    def __init__(self, db: AsyncSession):
        self.db = db

    @staticmethod
    async def get_team_user_id(db: AsyncSession, email: str, org_id: str) -> Optional[str]:
        if not email:
            return None
        from app.modules.team.models import TeamMember
        from app.modules.auth.models import User
        
        # Check TeamMember
        res_tm = await db.execute(
            select(TeamMember).where(
                TeamMember.organization_id == org_id,
                TeamMember.email == email,
                TeamMember.is_deleted == False
            )
        )
        tm = res_tm.scalars().first()
        if tm and tm.user_id:
            return tm.user_id
            
        # Check User
        res_usr = await db.execute(
            select(User).where(
                User.organization_id == org_id,
                User.email == email,
                User.is_active == True
            )
        )
        usr = res_usr.scalars().first()
        if usr:
            return usr.id
            
        return None

    @staticmethod
    async def check_email_exists_in_team(db: AsyncSession, email: str, org_id: str) -> bool:
        if not email:
            return False
        from app.modules.team.models import TeamMember
        from app.modules.auth.models import User
        
        # Check TeamMember
        res_tm = await db.execute(
            select(TeamMember.id).where(
                TeamMember.organization_id == org_id,
                TeamMember.email == email,
                TeamMember.is_deleted == False
            )
        )
        if res_tm.scalars().first():
            return True
            
        # Check User
        res_usr = await db.execute(
            select(User.id).where(
                User.organization_id == org_id,
                User.email == email,
                User.is_active == True
            )
        )
        if res_usr.scalars().first():
            return True
            
        return False

    @staticmethod
    async def route_inbox_message(db: AsyncSession, msg: Message, variables: Optional[dict] = None) -> None:
        """
        Routes message internally if both sender and recipient are within the organization,
        or if system sends to a team member.
        Links task, appointment, invoice, and automation metadata where applicable.
        """
        recipient_user_id = await InboxService.get_team_user_id(db, msg.recipient_email, msg.organization_id)
        sender_user_id = await InboxService.get_team_user_id(db, msg.sender_email, msg.organization_id)
        
        is_recipient_team = recipient_user_id is not None or await InboxService.check_email_exists_in_team(db, msg.recipient_email, msg.organization_id)
        is_sender_team = sender_user_id is not None or await InboxService.check_email_exists_in_team(db, msg.sender_email, msg.organization_id) or msg.sender_id == "system" or msg.sender_email == "system"
        
        if is_recipient_team and is_sender_team:
            msg.message_type = "Internal"
            msg.lead_id = None
            msg.contact_id = None
            if recipient_user_id:
                msg.recipient_id = recipient_user_id
            if sender_user_id:
                msg.sender_id = sender_user_id
            elif msg.sender_id == "system":
                msg.sender_id = None
        else:
            if sender_user_id:
                msg.sender_id = sender_user_id
            elif msg.sender_id == "system":
                msg.sender_id = None
                
        # Link integration fields if provided
        if variables:
            msg.task_id = variables.get("task_id")
            msg.appointment_id = variables.get("appointment_id")
            msg.invoice_id = variables.get("invoice_id")
            if "workflow_name" in variables:
                msg.automation_source = variables.get("workflow_name")
            elif "action_name" in variables:
                msg.automation_source = variables.get("action_name")
            elif msg.automation_source is None:
                msg.automation_source = "System Notification"

    async def get_messages(
        self,
        organization_id: str,
        user_id: str,
        skip: int = 0,
        limit: int = 100,
        include_full_body: bool = False,
        lead_id: Optional[str] = None,
        contact_id: Optional[str] = None,
        thread_id: Optional[str] = None,
    ) -> List[Message]:
        """Return messages for an org with pagination, optional thread filtering, and body truncation."""
        from app.modules.auth.models import User
        import copy
        
        res_usr = await self.db.execute(select(User).where(User.id == user_id))
        user = res_usr.scalars().first()
        is_admin = user.is_superuser if user else False
        user_email = user.email if user else ""

        stmt = select(Message).where(Message.organization_id == organization_id)
        if lead_id:
            stmt = stmt.where(Message.lead_id == lead_id)
        if contact_id:
            stmt = stmt.where(Message.contact_id == contact_id)
        if thread_id:
            stmt = stmt.where(Message.gmail_thread_id == thread_id)

        stmt = stmt.order_by(Message.created_at.desc()).offset(skip).limit(limit)
        result = await self.db.execute(stmt)
        messages = list(result.scalars().all())

        if not is_admin:
            from app.core.permissions import get_employee_permissions_context
            perm_ctx = await get_employee_permissions_context(self.db, {"sub": user_id, "org": organization_id, "is_superuser": False, "role": "Member"})
            assigned_contacts = set(perm_ctx["assigned_contacts"])
        else:
            assigned_contacts = set()

        filtered = []
        for msg in messages:
            if is_admin:
                filtered.append(msg)
            else:
                is_sender = (msg.sender_id == user_id) or (msg.sender_email and msg.sender_email.lower() == user_email.lower())
                is_recipient = (msg.recipient_id == user_id) or (msg.recipient_email and msg.recipient_email.lower() == user_email.lower())
                is_assigned_contact = (msg.contact_id in assigned_contacts) or (msg.lead_id in assigned_contacts)
                if is_sender or is_recipient or is_assigned_contact:
                    filtered.append(msg)
                
        if not include_full_body:
            truncated = []
            for m in filtered:
                if m.body and len(m.body) > 300:
                    m_copy = copy.copy(m)
                    m_copy.body = m.body[:300] + "..."
                    truncated.append(m_copy)
                else:
                    truncated.append(m)
            return truncated

        return filtered

    async def get_message_by_id(self, message_id: str, organization_id: str) -> Optional[Message]:
        stmt = select(Message).where(Message.id == message_id, Message.organization_id == organization_id)
        res = await self.db.execute(stmt)
        return res.scalars().first()

    async def send_message(
        self,
        msg_in: MessageCreate,
        organization_id: str,
        sender_id: str,
    ) -> Message:
        """Save a simple internal or SMS message."""
        msg = Message(
            **msg_in.model_dump(),
            organization_id=organization_id,
            sender_id=sender_id,
        )
        
        if msg.recipient_id and not msg.recipient_email:
            from app.modules.auth.models import User
            res_usr = await self.db.execute(select(User).where(User.id == msg.recipient_id))
            usr = res_usr.scalars().first()
            if usr:
                msg.recipient_email = usr.email
                
        if msg.sender_id and not msg.sender_email:
            from app.modules.auth.models import User
            res_usr = await self.db.execute(select(User).where(User.id == msg.sender_id))
            usr = res_usr.scalars().first()
            if usr:
                msg.sender_email = usr.email

        await InboxService.route_inbox_message(self.db, msg, msg_in.model_dump())
        self.db.add(msg)
        await self.db.commit()
        await self.db.refresh(msg)
        return msg

    async def send_email_via_gmail(
        self,
        req: EmailSendRequest,
        organization_id: str,
        sender_id: str,
        sender_crm_email: str,
    ) -> Message:
        """
        Send an email via the active provider (SMTP, Gmail OAuth, etc.) directly (no Celery needed).
        """
        import json
        from app.modules.email.models import EmailConfig
        from app.modules.email.providers import EmailProviderRegistry
        from app.core.security import decrypt_data
        from sqlalchemy.future import select

        # Check parent thread for gmail_thread_id
        parent_thread_id = None
        if req.parent_id:
            r_p = await self.db.execute(select(Message).where(Message.id == req.parent_id))
            p_msg = r_p.scalars().first()
            if p_msg:
                parent_thread_id = p_msg.gmail_thread_id

        # Create Message in 'Sending' status first
        msg = Message(
            body=req.body,
            subject=req.subject,
            sender_id=sender_id,
            lead_id=req.lead_id,
            contact_id=req.contact_id,
            parent_id=req.parent_id,
            gmail_thread_id=parent_thread_id,
            message_type="Email",
            direction="Outgoing",
            delivery_status="Sending",
            sender_email=sender_crm_email,
            recipient_email=req.to_email,
            organization_id=organization_id,
        )
        await InboxService.route_inbox_message(self.db, msg)
        self.db.add(msg)
        await self.db.commit()
        await self.db.refresh(msg)

        # Determine provider
        provider_name = "smtp"
        settings_dict = {}

        res_cfg = await self.db.execute(
            select(EmailConfig).where(
                EmailConfig.organization_id == organization_id,
                EmailConfig.is_active == True
            )
        )
        config_obj = res_cfg.scalars().first()

        if not config_obj:
            # Fallback to Gmail OAuth if connected
            from app.modules.gmail.models import GmailIntegration
            r = await self.db.execute(
                select(GmailIntegration).where(
                    GmailIntegration.organization_id == organization_id,
                    GmailIntegration.is_connected == True
                )
            )
            gmail_int = r.scalars().first()
            if gmail_int:
                provider_name = "gmail"
            else:
                msg.delivery_status = "Failed"
                msg.error_message = "No email provider configured. Please connect Gmail or SMTP in Settings → Email Integration."
                await self.db.commit()
                await self.db.refresh(msg)
                return msg
        else:
            provider_name = config_obj.provider
            if config_obj.settings_enc:
                try:
                    settings_dict = json.loads(decrypt_data(config_obj.settings_enc))
                except Exception:
                    pass

        try:
            if provider_name == "gmail":
                from app.modules.gmail.services import GmailService
                gmail_svc = GmailService(self.db)
                res_send = await gmail_svc.send_email(
                    organization_id=organization_id,
                    to_email=msg.recipient_email,
                    subject=msg.subject or "Outbound Message",
                    body=msg.body,
                    thread_id=msg.gmail_thread_id,
                )
            else:
                provider = EmailProviderRegistry.get_provider(
                    provider_name=provider_name,
                    settings_dict=settings_dict,
                    organization_id=organization_id,
                    db_session=self.db,
                )
                res_send = await provider.send(
                    to_email=msg.recipient_email,
                    subject=msg.subject or "Outbound Message",
                    body=msg.body,
                    cc=None,
                    bcc=None,
                    reply_to=None,
                    html_body=None,
                    attachments=None,
                )

            if res_send.get("success"):
                msg.delivery_status = "Sent"
                msg.gmail_message_id = res_send.get("message_id") or res_send.get("gmail_message_id")
                if res_send.get("gmail_thread_id"):
                    msg.gmail_thread_id = res_send.get("gmail_thread_id")
                msg.error_message = None
            else:
                msg.delivery_status = "Failed"
                msg.error_message = res_send.get("error", "Unknown send failure")
        except Exception as e:
            msg.delivery_status = "Failed"
            msg.error_message = str(e)

        await self.db.commit()
        await self.db.refresh(msg)
        return msg


    async def mark_as_read(
        self,
        message_id: str,
        organization_id: str,
    ) -> Optional[Message]:
        result = await self.db.execute(
            select(Message).where(
                Message.id == message_id,
                Message.organization_id == organization_id,
            )
        )
        msg = result.scalars().first()
        if not msg:
            return None
        msg.is_read = True
        await self.db.commit()
        await self.db.refresh(msg)
        return msg

    async def toggle_star(self, message_id: str, organization_id: str) -> Optional[Message]:
        result = await self.db.execute(
            select(Message).where(
                Message.id == message_id,
                Message.organization_id == organization_id,
            )
        )
        msg = result.scalars().first()
        if not msg:
            return None
        msg.is_starred = not bool(msg.is_starred)
        await self.db.commit()
        await self.db.refresh(msg)
        return msg

    async def toggle_archive(self, message_id: str, organization_id: str) -> Optional[Message]:
        result = await self.db.execute(
            select(Message).where(
                Message.id == message_id,
                Message.organization_id == organization_id,
            )
        )
        msg = result.scalars().first()
        if not msg:
            return None
        msg.is_archived = not bool(msg.is_archived)
        await self.db.commit()
        await self.db.refresh(msg)
        return msg


