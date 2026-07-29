import json
import logging
from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.modules.crm.models import Lead, Activity
from app.modules.organization.models import Organization
from app.core.events import subscribe

logger = logging.getLogger(__name__)

def get_org_settings(org_settings_str: str) -> dict:
    default_rules = {
        "New": 10,
        "Contacted": 25,
        "Interested": 30,
        "Qualified": 45,
        "Proposal Sent": 65,
        "Proposal": 65,
        "Negotiation": 80,
        "Won": 100,
        "Lost": 0
    }
    defaults = {
        "contact_auto_creation": True,
        "pipeline_scoring_rules": default_rules
    }
    if not org_settings_str:
        return defaults
    try:
        data = json.loads(org_settings_str)
        merged_rules = {**default_rules, **data.get("pipeline_scoring_rules", {})}
        return {
            "contact_auto_creation": data.get("contact_auto_creation", True),
            "pipeline_scoring_rules": merged_rules
        }
    except Exception:
        return defaults

async def calculate_and_update_score(
    db: AsyncSession,
    lead_id: str,
    org_id: str,
    event_name: str,
    score_delta: int,
    source_detail: str
) -> None:
    """
    Update automatic_score and recalculate lead_score (final score) for a Lead.
    If lead.is_score_manual is True, automatic_score is updated, but lead_score (final score) remains unchanged.
    Appends a log to score_history and creates a CRM Activity for timeline display.
    """
    res_lead = await db.execute(select(Lead).where(Lead.id == lead_id, Lead.organization_id == org_id))
    lead = res_lead.scalars().first()
    if not lead:
        return
        
    old_score = lead.lead_score or 0
    new_auto_score = (lead.automatic_score or 0) + score_delta
    lead.automatic_score = new_auto_score
    
    # Calculate final score
    if lead.is_score_manual:
        final_score = lead.manual_score or 0
        score_source = "Manual"
    else:
        final_score = new_auto_score
        score_source = "Automatic"
        
    lead.lead_score = max(0, min(100, final_score))
    lead.score_source = score_source
    lead.score_last_updated = datetime.now(timezone.utc)
    
    # Update score history
    history = []
    if lead.score_history:
        try:
            history = json.loads(lead.score_history)
        except Exception:
            history = []
            
    history.append({
        "event": event_name,
        "detail": source_detail,
        "delta": score_delta,
        "automatic_score": lead.automatic_score,
        "manual_score": lead.manual_score,
        "final_score": lead.lead_score,
        "source": score_source,
        "timestamp": datetime.now(timezone.utc).isoformat()
    })
    lead.score_history = json.dumps(history)
    
    try:
        # Create CRM timeline Activity record so history is displayed
        if old_score != lead.lead_score or score_delta != 0:
            author_id = lead.owner_id
            if not author_id:
                from app.modules.auth.models import User
                res_usr = await db.execute(select(User.id).where(User.organization_id == org_id))
                author_id = res_usr.scalars().first()
                
            if author_id:
                act = Activity(
                    type="System",
                    description=f"Lead Score updated from {old_score} to {lead.lead_score} ({event_name}: {source_detail})",
                    lead_id=lead.id,
                    author_id=author_id,
                    timestamp=datetime.now(timezone.utc),
                    organization_id=org_id
                )
                db.add(act)
            
        await db.commit()
        logger.info(f"Updated score for Lead {lead.id}: automatic_score={lead.automatic_score}, final={lead.lead_score}")
    except Exception as e:
        logger.error(f"EXCEPTION IN SCORING: {e}", exc_info=True)
        await db.rollback()
        raise

# Event listener handlers
async def handle_lead_created(event):
    from app.db.session import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        res_lead = await db.execute(select(Lead).where(Lead.id == event.lead_id))
        lead = res_lead.scalars().first()
        if lead and lead.lead_source != "Import":
            await calculate_and_update_score(
                db, event.lead_id, event.organization_id,
                "Lead Created", 10, "Manual Lead Created"
            )

async def handle_form_submitted(event):
    if not event.lead_id:
        return
    from app.db.session import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        await calculate_and_update_score(
            db, event.lead_id, event.organization_id,
            "Form Submission", 20, f"Submitted form ID: {event.form_id}"
        )

async def handle_email_sent(event):
    from app.db.session import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        lead_id = event.lead_id
        if not lead_id:
            res_l = await db.execute(select(Lead.id).where(Lead.email == event.recipient_email, Lead.organization_id == event.organization_id))
            lead_id = res_l.scalars().first()
        if lead_id:
            await calculate_and_update_score(
                db, lead_id, event.organization_id,
                "Email Sent", 2, f"Sent email to {event.recipient_email}"
            )

async def handle_email_received(event):
    # Customer replies to an email: do NOT automatically change score
    pass

async def handle_appointment_booked(event):
    lead_id = event.lead_id or event.data.get("lead_id")
    if not lead_id:
        return
    from app.db.session import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        await calculate_and_update_score(
            db, lead_id, event.organization_id,
            "Appointment Booked", 25, "Scheduled an appointment"
        )

async def handle_task_completed(event):
    from app.db.session import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        from app.modules.tasks.models import Task
        res_t = await db.execute(select(Task).where(Task.id == event.task_id))
        task = res_t.scalars().first()
        if task and task.lead_id:
            await calculate_and_update_score(
                db, task.lead_id, event.organization_id,
                "Task Completed", 5, f"Completed task: {task.title}"
            )

async def handle_invoice_created(event):
    invoice_id = event.data.get("invoice_id") if hasattr(event, "data") else getattr(event, "invoice_id", None)
    if not invoice_id:
        return
    from app.db.session import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        from app.modules.payments.models import Invoice
        res_i = await db.execute(select(Invoice).where(Invoice.id == invoice_id))
        inv = res_i.scalars().first()
        if inv and inv.related_entity_type == "Lead" and inv.related_entity_id:
            await calculate_and_update_score(
                db, inv.related_entity_id, event.organization_id,
                "Invoice Generated", 10, f"Generated Invoice: {inv.invoice_number}"
            )

async def handle_invoice_paid(event):
    invoice_id = getattr(event, "invoice_id", None)
    if not invoice_id and hasattr(event, "data"):
        invoice_id = event.data.get("invoice_id")
    if not invoice_id:
        return
    from app.db.session import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        from app.modules.payments.models import Invoice
        res_i = await db.execute(select(Invoice).where(Invoice.id == invoice_id))
        inv = res_i.scalars().first()
        if inv and inv.related_entity_type == "Lead" and inv.related_entity_id:
            await calculate_and_update_score(
                db, inv.related_entity_id, event.organization_id,
                "Invoice Paid", 30, f"Paid Invoice: {inv.invoice_number}"
            )

async def handle_pipeline_stage_changed(event):
    lead_id = event.lead_id
    if not lead_id:
        return
    from app.db.session import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        res_org = await db.execute(select(Organization).where(Organization.id == event.organization_id))
        org = res_org.scalars().first()
        settings = get_org_settings(org.settings_json if org else None)
        rules = settings.get("pipeline_scoring_rules", {})
        
        from app.modules.pipeline.models import Stage
        res_stg = await db.execute(select(Stage).where(Stage.id == event.new_stage_id))
        stage = res_stg.scalars().first()
        if not stage:
            return
            
        new_score = rules.get(stage.name, 10)
        old_stage_name = getattr(event, "previous_stage", None)
        old_score = rules.get(old_stage_name, 0) if old_stage_name else 0
        delta = new_score - old_score
        
        await calculate_and_update_score(
            db, lead_id, event.organization_id,
            "Pipeline Stage Changed", delta, f"Moved to stage: {stage.name}"
        )

# Register subscribers
def init_scoring_listeners():
    subscribe("lead.created", handle_lead_created)
    subscribe("form.submitted", handle_form_submitted)
    subscribe("email.sent", handle_email_sent)
    subscribe("email.received", handle_email_received)
    subscribe("appointment.booked", handle_appointment_booked)
    subscribe("task.completed", handle_task_completed)
    subscribe("invoice.created", handle_invoice_created)
    subscribe("invoice.paid", handle_invoice_paid)
    subscribe("pipeline.stage_changed", handle_pipeline_stage_changed)
