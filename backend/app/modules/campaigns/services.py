"""
Campaign Service
================
Orchestration layer for email campaigns. Never sends email directly.
All delivery flows through EmailLog → send_email_task → GmailOAuthProvider.
"""
import logging
from datetime import datetime, timezone
from typing import List, Sequence, Optional, Dict, Any

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import func
from fastapi import HTTPException

from app.modules.campaigns.models import Campaign, CampaignRecipient
from app.modules.campaigns.schemas import (
    CampaignCreate, CampaignUpdate, CampaignReviewResponse,
    RecipientPreview, CampaignAnalyticsResponse, RecipientFilter
)
from app.modules.email.models import EmailTemplate
from app.modules.crm.models import Lead, Contact
from app.modules.pipeline.models import Stage, Deal

logger = logging.getLogger("campaign_service")


class CampaignService:

    # ─── CRUD ────────────────────────────────────────────────────────────────

    @staticmethod
    async def get_campaigns(db: AsyncSession, org_id: str) -> Sequence[Campaign]:
        res = await db.execute(
            select(Campaign)
            .where(Campaign.organization_id == org_id)
            .order_by(Campaign.created_at.desc())
        )
        return res.scalars().all()

    @staticmethod
    async def get_campaign(db: AsyncSession, campaign_id: str, org_id: str) -> Campaign:
        res = await db.execute(
            select(Campaign).where(Campaign.id == campaign_id, Campaign.organization_id == org_id)
        )
        c = res.scalars().first()
        if not c:
            raise HTTPException(status_code=404, detail="Campaign not found")
        return c

    @staticmethod
    async def create_campaign(db: AsyncSession, obj_in: CampaignCreate, org_id: str, user_id: str) -> Campaign:
        data = obj_in.model_dump()

        campaign = Campaign(**data, organization_id=org_id, created_by_id=user_id)
        db.add(campaign)
        await db.commit()
        await db.refresh(campaign)
        logger.info(f"Campaign created: {campaign.id} ({campaign.name}) org={org_id}")
        return campaign

    @staticmethod
    async def _prepare_recipients(db: AsyncSession, campaign: Campaign, org_id: str) -> List[str]:
        # Validate pre-conditions
        review = await CampaignService.get_review(db, campaign.id, org_id)
        if not review.can_send:
            raise HTTPException(status_code=400, detail=f"Campaign cannot be sent: {'; '.join(review.warnings)}")

        # Stamp sender gmail account for display
        campaign.sender_gmail_account = review.gmail_account

        # Resolve deduplicated recipient list
        recipients_data = await CampaignService.resolve_recipients(db, campaign.id, org_id)
        if not recipients_data:
            raise HTTPException(status_code=400, detail="No valid recipients found")

        # Clear any existing recipients for this campaign to prevent duplicates
        from sqlalchemy import delete
        await db.execute(
            delete(CampaignRecipient).where(CampaignRecipient.campaign_id == campaign.id)
        )

        # Create CampaignRecipient rows
        recip_ids = []
        for r in recipients_data:
            recip = CampaignRecipient(
                campaign_id=campaign.id,
                recipient_email=r["email"],
                lead_id=r.get("lead_id"),
                contact_id=r.get("contact_id"),
                status="Queued",
                organization_id=org_id,
            )
            db.add(recip)
            await db.flush()  # get recip.id
            recip_ids.append(recip.id)

        campaign.recipient_count = len(recipients_data)
        return recip_ids

    @staticmethod
    async def update_campaign(db: AsyncSession, campaign_id: str, obj_in: CampaignUpdate, org_id: str) -> Campaign:
        campaign = await CampaignService.get_campaign(db, campaign_id, org_id)
        if campaign.status in ("Sending", "Completed"):
            raise HTTPException(status_code=400, detail="Cannot edit a campaign that is Sending or Completed")
        
        data = obj_in.model_dump(exclude_unset=True)

        is_scheduling = (data.get("status") == "Scheduled" or (campaign.status == "Scheduled" and "recipient_filter" in data))

        # Apply basic fields first
        for k, v in data.items():
            if k not in ("status", "scheduled_for"):
                setattr(campaign, k, v)

        if is_scheduling:
            # Resolve and seed recipients in Queued state immediately!
            # (Ensures recipient logs display correctly in UI during Scheduled state)
            scheduled_for = data.get("scheduled_for") or campaign.scheduled_for
            if not scheduled_for:
                raise HTTPException(status_code=400, detail="scheduled_for is required to schedule a campaign")
            campaign.scheduled_for = scheduled_for
            campaign.status = "Scheduled"
            
            await CampaignService._prepare_recipients(db, campaign, org_id)
        else:
            if "status" in data:
                campaign.status = data["status"]
            if "scheduled_for" in data:
                campaign.scheduled_for = data["scheduled_for"]

        await db.commit()
        await db.refresh(campaign)
        return campaign

    @staticmethod
    async def delete_campaign(db: AsyncSession, campaign_id: str, org_id: str) -> None:
        campaign = await CampaignService.get_campaign(db, campaign_id, org_id)
        if campaign.status == "Sending":
            # Safely cancel the campaign first before deleting it
            await CampaignService.cancel_campaign(db, campaign_id, org_id)
        await db.delete(campaign)
        await db.commit()

    # ─── Recipient Resolution ─────────────────────────────────────────────────

    @staticmethod
    async def resolve_recipients(
        db: AsyncSession,
        campaign_id: str,
        org_id: str,
        return_duplicates: bool = False
    ) -> Any:
        """
        Builds a deduplicated list of recipients from CRM data based on campaign.recipient_filter.
        Returns a list of dicts: {email, first_name, last_name, lead_id, contact_id}
        """
        campaign = await CampaignService.get_campaign(db, campaign_id, org_id)
        rf = campaign.recipient_filter or {"type": "all_leads", "value": None}
        filter_type = rf.get("type", "all_leads")
        filter_value = rf.get("value")

        recipients: List[Dict[str, Any]] = []
        seen_emails = set()
        duplicate_count = 0

        def _add(email, first_name, last_name, lead_id=None, contact_id=None):
            nonlocal duplicate_count
            if email and email.strip():
                email_lower = email.strip().lower()
                if email_lower not in seen_emails:
                    seen_emails.add(email_lower)
                    recipients.append({
                        "email": email.strip(),
                        "first_name": first_name or "",
                        "last_name": last_name or "",
                        "lead_id": lead_id,
                        "contact_id": contact_id,
                    })
                else:
                    duplicate_count += 1

        if filter_type in ("all_leads", "tag", "owner", "pipeline_stage"):
            stmt = select(Lead).where(Lead.organization_id == org_id, Lead.email.isnot(None))

            if filter_type == "tag":
                # Tags stored as comma-separated in lead.lead_source (or skip if no tag model)
                # Use lead_source field as a proxy filter for now
                if filter_value:
                    stmt = stmt.where(Lead.lead_source.ilike(f"%{filter_value}%"))

            elif filter_type == "owner":
                if filter_value:
                    stmt = stmt.where(Lead.owner_id == filter_value)

            elif filter_type == "pipeline_stage":
                if filter_value:
                    # Find deals in the given stage name
                    stage_res = await db.execute(
                        select(Stage).where(
                            Stage.organization_id == org_id,
                            Stage.name.ilike(f"%{filter_value}%")
                        )
                    )
                    stages = stage_res.scalars().all()
                    stage_ids = [s.id for s in stages]
                    if stage_ids:
                        deal_res = await db.execute(
                            select(Deal.lead_id).where(Deal.stage_id.in_(stage_ids), Deal.organization_id == org_id)
                        )
                        lead_ids = [r[0] for r in deal_res.all() if r[0]]
                        stmt = stmt.where(Lead.id.in_(lead_ids))
                    else:
                        return ([], 0) if return_duplicates else []  # No matching stage

            lead_res = await db.execute(stmt)
            leads = lead_res.scalars().all()
            for lead in leads:
                _add(lead.email, lead.first_name, lead.last_name, lead_id=lead.id)

        elif filter_type == "all_contacts":
            stmt = select(Contact).where(Contact.organization_id == org_id, Contact.email.isnot(None))
            res = await db.execute(stmt)
            contacts = res.scalars().all()
            for c in contacts:
                _add(c.email, c.first_name, c.last_name, contact_id=c.id)

        elif filter_type == "manual":
            # filter_value = comma-separated email addresses
            if filter_value:
                for raw_email in filter_value.split(","):
                    email = raw_email.strip()
                    if email:
                        # Try to match to a Lead
                        lr = await db.execute(
                            select(Lead).where(Lead.email == email, Lead.organization_id == org_id)
                        )
                        lead = lr.scalars().first()
                        if lead:
                            _add(email, lead.first_name, lead.last_name, lead_id=lead.id)
                        else:
                            _add(email, "", "")

        logger.info(f"Resolved {len(recipients)} recipients for campaign {campaign_id} (type={filter_type})")
        if return_duplicates:
            return recipients, duplicate_count
        return recipients

    # ─── Review ───────────────────────────────────────────────────────────────

    @staticmethod
    async def get_review(db: AsyncSession, campaign_id: str, org_id: str) -> CampaignReviewResponse:
        campaign = await CampaignService.get_campaign(db, campaign_id, org_id)

        # Template
        tpl_name = None
        if campaign.template_id:
            tr = await db.execute(select(EmailTemplate).where(EmailTemplate.id == campaign.template_id))
            tpl = tr.scalars().first()
            tpl_name = tpl.name if tpl else None

        # Gmail connection
        from app.modules.gmail.models import GmailIntegration
        gr = await db.execute(
            select(GmailIntegration).where(
                GmailIntegration.organization_id == org_id,
                GmailIntegration.is_connected == True
            )
        )
        gmail_int = gr.scalars().first()
        gmail_connected = gmail_int is not None
        gmail_account = gmail_int.gmail_address if gmail_int else None

        # Recipients
        recipients_data, duplicate_count = await CampaignService.resolve_recipients(db, campaign_id, org_id, return_duplicates=True)

        # Warnings
        warnings: List[str] = []
        if not gmail_connected:
            warnings.append("No Gmail account connected. Connect one in Settings → Email Integration before sending.")
        if not campaign.template_id or not tpl_name:
            warnings.append("No email template selected. Choose a template before sending.")
        if not recipients_data:
            warnings.append("No recipients found for the current filter. Adjust the recipient filter.")
        if campaign.status not in ("Draft", "Scheduled"):
            warnings.append(f"Campaign is already {campaign.status} and cannot be re-queued.")

        can_send = gmail_connected and bool(tpl_name) and bool(recipients_data) and campaign.status in ("Draft", "Scheduled")

        return CampaignReviewResponse(
            campaign_id=campaign.id,
            campaign_name=campaign.name,
            subject=campaign.subject,
            template_name=tpl_name,
            gmail_account=gmail_account,
            gmail_connected=gmail_connected,
            recipient_count=len(recipients_data),
            duplicate_count=duplicate_count,
            recipients_preview=[
                RecipientPreview(**r) for r in recipients_data[:10]
            ],
            warnings=warnings,
            can_send=can_send,
        )

    # ─── Queue ────────────────────────────────────────────────────────────────

    @staticmethod
    async def queue_campaign(db: AsyncSession, campaign_id: str, org_id: str, user_id: str) -> Campaign:
        """
        Transitions a Draft/Scheduled campaign to Sending.
        Reuses pre-resolved/created CampaignRecipient rows if Scheduled,
        otherwise resolves and creates them now. Dispatches Celery tasks.
        """
        campaign = await CampaignService.get_campaign(db, campaign_id, org_id)

        if campaign.status not in ("Draft", "Scheduled"):
            raise HTTPException(status_code=400, detail=f"Cannot queue a campaign in {campaign.status} status")

        # Check if recipients are already resolved (e.g. from Scheduled transition)
        res = await db.execute(
            select(CampaignRecipient.id).where(CampaignRecipient.campaign_id == campaign_id)
        )
        recip_ids = [r[0] for r in res.all()]

        if not recip_ids:
            # First-time resolution (from Draft status)
            recip_ids = await CampaignService._prepare_recipients(db, campaign, org_id)
        else:
            # Re-validate conditions for safety
            review = await CampaignService.get_review(db, campaign_id, org_id)
            if not review.can_send:
                raise HTTPException(status_code=400, detail=f"Campaign cannot be sent: {'; '.join(review.warnings)}")
            campaign.sender_gmail_account = review.gmail_account

        # Transition to Sending
        campaign.status = "Sending"
        campaign.sent_at = datetime.now(timezone.utc)
        campaign.sent_count = 0
        campaign.failed_count = 0
        await db.commit()

        # Dispatch Celery tasks AFTER transaction commit so they can read the records
        from app.modules.campaigns.tasks import send_campaign_recipient_task
        for rid in recip_ids:
            send_campaign_recipient_task.delay(rid)

        # Emit automation event
        try:
            from app.core.events import publish, GenericEvent
            await publish("campaign.queued", GenericEvent(
                event_name="campaign.queued",
                organization_id=org_id,
                entity_id=campaign.id,
                trigger_name="campaign.queued",
                data={"campaign_id": campaign.id, "campaign_name": campaign.name, "recipient_count": len(recip_ids)}
            ))
        except Exception:
            pass

        return campaign

    # ─── Cancel ──────────────────────────────────────────────────────────────

    @staticmethod
    async def cancel_campaign(db: AsyncSession, campaign_id: str, org_id: str) -> Campaign:
        campaign = await CampaignService.get_campaign(db, campaign_id, org_id)
        if campaign.status == "Completed":
            raise HTTPException(status_code=400, detail="Cannot cancel a completed campaign")

        # Mark all pending recipients as Cancelled
        res = await db.execute(
            select(CampaignRecipient).where(
                CampaignRecipient.campaign_id == campaign_id,
                CampaignRecipient.status.in_(["Queued", "Processing", "Sending"])
            )
        )
        pending = res.scalars().all()
        for p in pending:
            p.status = "Cancelled"

        campaign.status = "Cancelled"
        await db.commit()
        await db.refresh(campaign)
        return campaign

    @staticmethod
    async def resume_campaign(db: AsyncSession, campaign_id: str, org_id: str) -> dict:
        """
        Resume a Sending campaign by re-dispatching tasks for all recipients
        still in Queued or Processing status.

        This is crash-recovery: if the server went down mid-send (e.g., 300/500
        sent), this picks up from the remaining 200 without resending the first 300.

        Returns {"campaign_id": ..., "re_queued": <count>}
        """
        campaign = await CampaignService.get_campaign(db, campaign_id, org_id)

        if campaign.status not in ("Sending",):
            raise HTTPException(
                status_code=400,
                detail=f"Only Sending campaigns can be resumed. Current status: {campaign.status}"
            )

        from app.modules.campaigns.tasks import send_campaign_recipient_task

        # Find all recipients that haven't reached a terminal state
        res = await db.execute(
            select(CampaignRecipient).where(
                CampaignRecipient.campaign_id == campaign_id,
                CampaignRecipient.status.in_(["Queued", "Processing"]),
            )
        )
        pending = res.scalars().all()

        # Reset stuck Processing recipients to Queued so the UI shows the right state
        recip_ids = []
        for r in pending:
            if r.status == "Processing":
                r.status = "Queued"
            recip_ids.append(r.id)

        await db.commit()

        # Dispatch tasks AFTER transaction commit
        for rid in recip_ids:
            send_campaign_recipient_task.delay(rid)

        logger.info(f"Campaign {campaign_id} resumed: {len(recip_ids)} recipients re-dispatched")
        return {"campaign_id": campaign_id, "re_queued": len(recip_ids)}

    @staticmethod
    async def retry_campaign(db: AsyncSession, campaign_id: str, org_id: str) -> dict:
        """
        Retry all failed or invalid recipients in a campaign.
        Resets recipient states to Queued and triggers tasks again.
        """
        campaign = await CampaignService.get_campaign(db, campaign_id, org_id)

        # Allow retry for completed, failed, cancelled or completed with errors campaigns
        allowed_statuses = {"Completed", "Completed with Errors", "Failed", "Cancelled"}
        if campaign.status not in allowed_statuses:
            raise HTTPException(
                status_code=400,
                detail=f"Campaign is currently '{campaign.status}'. Only finished/cancelled campaigns can be retried."
            )

        from app.modules.campaigns.tasks import send_campaign_recipient_task

        # Find all failed or invalid recipients
        res = await db.execute(
            select(CampaignRecipient).where(
                CampaignRecipient.campaign_id == campaign_id,
                CampaignRecipient.status.in_(["Failed", "Invalid"]),
            )
        )
        failed_recipients = res.scalars().all()

        if not failed_recipients:
            raise HTTPException(
                status_code=400,
                detail="No failed or invalid recipients found to retry."
            )

        # Reset campaign status to Sending
        campaign.status = "Sending"
        campaign.sent_at = datetime.now(timezone.utc)
        campaign.completed_at = None

        recip_ids = []
        for r in failed_recipients:
            r.status = "Queued"
            r.error_message = None
            recip_ids.append(r.id)

        await db.commit()

        # Dispatch Celery tasks AFTER database transaction commits
        for rid in recip_ids:
            send_campaign_recipient_task.delay(rid)

        logger.info(f"Campaign {campaign_id} retried: {len(recip_ids)} failed recipients re-dispatched")
        return {"campaign_id": campaign_id, "re_queued": len(recip_ids)}


    # ─── Recipients List ─────────────────────────────────────────────────────

    @staticmethod
    async def get_recipients(db: AsyncSession, campaign_id: str, org_id: str) -> Sequence[CampaignRecipient]:
        await CampaignService.get_campaign(db, campaign_id, org_id)
        res = await db.execute(
            select(CampaignRecipient)
            .where(CampaignRecipient.campaign_id == campaign_id)
            .order_by(CampaignRecipient.created_at)
        )
        return res.scalars().all()

    # ─── Analytics ───────────────────────────────────────────────────────────

    @staticmethod
    async def get_analytics(db: AsyncSession, campaign_id: str, org_id: str) -> CampaignAnalyticsResponse:
        campaign = await CampaignService.get_campaign(db, campaign_id, org_id)

        res = await db.execute(
            select(
                CampaignRecipient.status,
                func.count(CampaignRecipient.id).label("cnt")
            )
            .where(CampaignRecipient.campaign_id == campaign_id)
            .group_by(CampaignRecipient.status)
        )
        rows = res.all()
        counts: Dict[str, int] = {r[0]: r[1] for r in rows}

        total = sum(counts.values())
        sent = counts.get("Sent", 0)
        failed = counts.get("Failed", 0)
        skipped = counts.get("Skipped", 0)
        invalid = counts.get("Invalid", 0)
        cancelled = counts.get("Cancelled", 0)
        processing = counts.get("Processing", 0)
        queued = counts.get("Queued", 0)

        terminal = sent + failed + skipped + invalid + cancelled
        success_rate = round((sent / total * 100) if total > 0 else 0.0, 1)
        progress_pct = round((terminal / total * 100) if total > 0 else 0.0, 1)

        duration = None
        if campaign.sent_at and campaign.completed_at:
            duration = (campaign.completed_at - campaign.sent_at).total_seconds()

        return CampaignAnalyticsResponse(
            campaign_id=campaign_id,
            recipient_count=total,
            queued_count=queued,
            processing_count=processing,
            sent_count=sent,
            failed_count=failed,
            skipped_count=skipped,
            invalid_count=invalid,
            cancelled_count=cancelled,
            reply_count=campaign.reply_count,
            success_rate=success_rate,
            progress_pct=progress_pct,
            duration_seconds=duration,
        )


    # ─── Filter Preview (for wizard step 3) ──────────────────────────────────

    @staticmethod
    async def preview_filter(db: AsyncSession, org_id: str, filter_type: str, filter_value: Optional[str] = None) -> List[RecipientPreview]:
        """
        Used by the frontend wizard to show a live preview of who will receive the campaign
        before it is created. Does not require a campaign_id.
        """
        # Build a temporary filter dict
        tmp_filter: Dict[str, Any] = {"type": filter_type, "value": filter_value}

        # Re-use resolve logic by constructing a temporary Campaign in memory
        # (not saved to DB)
        class _TmpCampaign:
            id = "__preview__"
            recipient_filter = tmp_filter
            organization_id = org_id

        seen_emails: set = set()
        previews: List[RecipientPreview] = []

        def _add(email, first_name, last_name, lead_id=None, contact_id=None):
            if email and email.strip().lower() not in seen_emails:
                seen_emails.add(email.strip().lower())
                previews.append(RecipientPreview(
                    email=email.strip(),
                    first_name=first_name or "",
                    last_name=last_name or "",
                    lead_id=lead_id,
                    contact_id=contact_id,
                ))

        if filter_type in ("all_leads", "tag", "owner", "pipeline_stage"):
            stmt = select(Lead).where(Lead.organization_id == org_id, Lead.email.isnot(None))

            if filter_type == "tag" and filter_value:
                stmt = stmt.where(Lead.lead_source.ilike(f"%{filter_value}%"))
            elif filter_type == "owner" and filter_value:
                stmt = stmt.where(Lead.owner_id == filter_value)
            elif filter_type == "pipeline_stage" and filter_value:
                stage_res = await db.execute(
                    select(Stage).where(Stage.organization_id == org_id, Stage.name.ilike(f"%{filter_value}%"))
                )
                stages = stage_res.scalars().all()
                stage_ids = [s.id for s in stages]
                if stage_ids:
                    deal_res = await db.execute(
                        select(Deal.lead_id).where(Deal.stage_id.in_(stage_ids), Deal.organization_id == org_id)
                    )
                    lead_ids = [r[0] for r in deal_res.all() if r[0]]
                    stmt = stmt.where(Lead.id.in_(lead_ids))
                else:
                    return []

            res = await db.execute(stmt)
            for lead in res.scalars().all():
                _add(lead.email, lead.first_name, lead.last_name, lead_id=lead.id)

        elif filter_type == "all_contacts":
            res = await db.execute(
                select(Contact).where(Contact.organization_id == org_id, Contact.email.isnot(None))
            )
            for c in res.scalars().all():
                _add(c.email, c.first_name, c.last_name, contact_id=c.id)

        elif filter_type == "manual" and filter_value:
            for raw_email in filter_value.split(","):
                email = raw_email.strip()
                if email:
                    lr = await db.execute(
                        select(Lead).where(Lead.email == email, Lead.organization_id == org_id)
                    )
                    lead = lr.scalars().first()
                    _add(email, lead.first_name if lead else "", lead.last_name if lead else "", lead_id=lead.id if lead else None)

        return previews
