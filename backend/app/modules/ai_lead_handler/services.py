from typing import List, Optional
from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload
from fastapi import HTTPException, status

from app.modules.ai_lead_handler.models import LeadAIThread, LeadAIMessage
from app.modules.ai_lead_handler.schemas import LeadContext
from app.modules.crm.models import Lead, Company, Note, Activity


class LeadAIService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # ── Thread management ───────────────────────────────────────────────

    async def get_or_create_thread(self, lead_id: str, user_id: str, org_id: str) -> LeadAIThread:
        stmt = (
            select(LeadAIThread)
            .options(selectinload(LeadAIThread.messages))
            .where(
                LeadAIThread.lead_id == lead_id,
                LeadAIThread.organization_id == org_id,
            )
            .execution_options(populate_existing=True)
        )
        res = await self.db.execute(stmt)
        thread = res.scalars().first()
        if thread:
            return thread

        thread = LeadAIThread(lead_id=lead_id, user_id=user_id, organization_id=org_id)
        self.db.add(thread)
        await self.db.commit()
        await self.db.refresh(thread)
        thread.messages = []
        return thread

    async def get_thread_or_404(self, lead_id: str, org_id: str) -> LeadAIThread:
        # Ownership scoped in the query itself (same fix applied to
        # ai_coach.services.get_session_by_id) — a thread for a lead outside
        # this org simply doesn't match, so it 404s rather than leaking
        # existence via a 403.
        stmt = (
            select(LeadAIThread)
            .options(selectinload(LeadAIThread.messages))
            .where(
                LeadAIThread.lead_id == lead_id,
                LeadAIThread.organization_id == org_id,
            )
        )
        res = await self.db.execute(stmt)
        thread = res.scalars().first()
        if not thread:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No AI thread for this lead yet.")
        return thread

    async def delete_thread(self, lead_id: str, org_id: str):
        stmt = select(LeadAIThread).where(
            LeadAIThread.lead_id == lead_id,
            LeadAIThread.organization_id == org_id,
        )
        res = await self.db.execute(stmt)
        thread = res.scalars().first()
        if thread:
            await self.db.delete(thread)
            await self.db.commit()

    async def add_message(self, thread: LeadAIThread, role: str, content: str) -> LeadAIMessage:

        message = LeadAIMessage(thread_id=thread.id, role=role, content=content)
        self.db.add(message)
        thread.updated_at = datetime.now(timezone.utc)
        await self.db.commit()
        await self.db.refresh(message)
        return message

    # ── Lead context (this is the "no RAG needed" part) ─────────────────

    async def build_lead_context(self, lead_id: str, org_id: str) -> LeadContext:
        """
        Pull the lead's current CRM fields directly from the Lead model and
        associated models (Company, Note, Activity), returning a structured LeadContext.
        """
        stmt = select(Lead).where(Lead.id == lead_id, Lead.organization_id == org_id)
        res = await self.db.execute(stmt)
        lead = res.scalars().first()
        if not lead:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lead not found.")

        # Company name
        company_name = None
        if lead.company_id:
            comp_stmt = select(Company.name).where(Company.id == lead.company_id, Company.organization_id == org_id)
            comp_res = await self.db.execute(comp_stmt)
            company_name = comp_res.scalar_one_or_none()

        # Notes
        notes_stmt = (
            select(Note.content)
            .where(Note.lead_id == lead.id, Note.organization_id == org_id)
            .order_by(Note.created_at.desc())
        )
        notes_res = await self.db.execute(notes_stmt)
        notes_list = notes_res.scalars().all()
        notes_text = "\n".join(notes_list) if notes_list else None

        # Latest activity
        act_stmt = (
            select(Activity)
            .where(Activity.lead_id == lead.id, Activity.organization_id == org_id)
            .order_by(Activity.timestamp.desc())
        )
        act_res = await self.db.execute(act_stmt)
        latest_activity = act_res.scalars().first()

        last_act_summary = None
        if latest_activity:
            if latest_activity.description:
                last_act_summary = f"{latest_activity.type}: {latest_activity.description}"
            else:
                last_act_summary = latest_activity.type

        full_name = f"{lead.first_name or ''} {lead.last_name or ''}".strip() or None

        return LeadContext(
            lead_id=lead.id,
            name=full_name,
            company=company_name,
            industry=lead.industry,
            stage=lead.status,
            deal_value=lead.expected_revenue or lead.budget,
            last_activity_at=latest_activity.timestamp if latest_activity else None,
            last_activity_summary=last_act_summary,
            notes=notes_text,
            stated_objection=None,
        )

    @staticmethod
    def render_context_block(ctx: LeadContext) -> str:
        """Turn a LeadContext into the text block injected ahead of the
        user's message. Keeping this as its own function makes it easy to
        unit-test independently of the DB or the LLM call."""
        lines = ["LEAD CONTEXT (live CRM data for this lead — treat as ground truth):"]
        lines.append(f"- Lead ID: {ctx.lead_id}")
        if ctx.name:
            lines.append(f"- Contact: {ctx.name}")
        if ctx.company:
            lines.append(f"- Company: {ctx.company}")
        if ctx.industry:
            lines.append(f"- Industry: {ctx.industry}")
        if ctx.stage:
            lines.append(f"- Pipeline stage: {ctx.stage}")
        if ctx.deal_value is not None:
            lines.append(f"- Deal value: {ctx.deal_value}")
        if ctx.last_activity_at:
            lines.append(f"- Last activity: {ctx.last_activity_at.isoformat()}")
        if ctx.last_activity_summary:
            lines.append(f"- Last activity summary: {ctx.last_activity_summary}")
        if ctx.stated_objection:
            lines.append(f"- Stated objection on file: {ctx.stated_objection}")
        if ctx.notes:
            lines.append(f"- Notes: {ctx.notes}")
        if len(lines) == 2:  # only the header + lead_id — nothing else on file
            lines.append("- (No other fields on file yet for this lead.)")
        return "\n".join(lines)
