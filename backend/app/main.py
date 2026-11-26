import os
from dotenv import load_dotenv

load_dotenv()

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from app.modules.auth.router import router as auth_router
from app.modules.crm.router import router as crm_router
from app.modules.pipeline.router import router as pipeline_router
from app.modules.workflow.router import router as workflow_router
from app.modules.tasks.router import router as tasks_router
from app.modules.calendar.router import router as calendar_router
from app.modules.forms.router import router as forms_router
from app.modules.email.router import router as email_router
from app.modules.notifications.router import router as notifications_router
from app.modules.funnels.router import router as funnels_router
from app.modules.inbox.router import router as inbox_router
from app.modules.reviews.router import router as reviews_router
from app.modules.payments.router import router as payments_router
from app.modules.integrations.router import router as integrations_router
from app.modules.reports.router import router as reports_router
from app.modules.settings.router import router as settings_router
from app.modules.gmail.router import router as gmail_router
from app.modules.team.router import router as team_router
from app.modules.campaigns.router import router as campaigns_router
from app.db.session import engine
from app.db.base import Base
from sqlalchemy import text

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize lead scoring event listeners
    from app.modules.crm.scoring import init_scoring_listeners
    init_scoring_listeners()

    # Create all tables
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)



        async def _get_cols(c, t_name: str):
            if c.dialect.name == "sqlite":
                r_cols = await c.execute(text(f"PRAGMA table_info({t_name})"))
                return [r[1] for r in r_cols.fetchall()]
            else:
                r_cols = await c.execute(text(f"SELECT column_name FROM information_schema.columns WHERE table_name = '{t_name}'"))
                return [r[0] for r in r_cols.fetchall()]

        # Alter table task if task assignment columns do not exist
        cols = await _get_cols(conn, "task")
        if "assigned_to_id" not in cols:
            await conn.execute(text("ALTER TABLE task ADD COLUMN assigned_to_id TEXT REFERENCES teammember(id)"))
        if "assigned_by_id" not in cols:
            await conn.execute(text("ALTER TABLE task ADD COLUMN assigned_by_id TEXT REFERENCES user(id)"))
        if "assigned_at" not in cols:
            await conn.execute(text("ALTER TABLE task ADD COLUMN assigned_at TIMESTAMP"))
        if "department" not in cols:
            await conn.execute(text("ALTER TABLE task ADD COLUMN department TEXT"))

        # Alter table pipeline if status_stage_mapping does not exist
        cols_pipe = await _get_cols(conn, "pipeline")
        if "status_stage_mapping" not in cols_pipe:
            await conn.execute(text("ALTER TABLE pipeline ADD COLUMN status_stage_mapping JSON"))

        # Alter table workflowexecution if execution_metadata does not exist
        cols_exec = await _get_cols(conn, "workflowexecution")
        if "execution_metadata" not in cols_exec:
            await conn.execute(text("ALTER TABLE workflowexecution ADD COLUMN execution_metadata JSON"))

        # Alter table appointment for participant columns
        cols_appt = await _get_cols(conn, "appointment")
        for col_name in ["related_entity_type", "related_entity_id", "display_name", "email", "phone"]:
            if col_name not in cols_appt:
                await conn.execute(text(f"ALTER TABLE appointment ADD COLUMN {col_name} TEXT"))
        if "assigned_to_id" not in cols_appt:
            await conn.execute(text("ALTER TABLE appointment ADD COLUMN assigned_to_id TEXT REFERENCES teammember(id)"))

        # Alter table invoice for recipient details
        cols_inv = await _get_cols(conn, "invoice")
        for col_name in ["related_entity_type", "related_entity_id", "recipient_name", "recipient_email", "recipient_phone", "recipient_company", "billing_address", "tax_information"]:
            if col_name not in cols_inv:
                await conn.execute(text(f"ALTER TABLE invoice ADD COLUMN {col_name} TEXT"))

        # Alter table lead for address and tax details
        cols_lead = await _get_cols(conn, "lead")
        for col_name in ["billing_address", "tax_information"]:
            if col_name not in cols_lead:
                await conn.execute(text(f"ALTER TABLE lead ADD COLUMN {col_name} TEXT"))
        
        # Lead scoring columns migration
        for col_name in ["automatic_score", "manual_score", "is_score_manual", "score_source", "score_history", "score_last_updated"]:
            if col_name not in cols_lead:
                if col_name == "is_score_manual":
                    await conn.execute(text(f"ALTER TABLE lead ADD COLUMN {col_name} BOOLEAN DEFAULT FALSE"))
                elif col_name in ["automatic_score", "manual_score"]:
                    await conn.execute(text(f"ALTER TABLE lead ADD COLUMN {col_name} INTEGER"))
                else:
                    await conn.execute(text(f"ALTER TABLE lead ADD COLUMN {col_name} TEXT"))

        # Alter table organization for settings_json
        cols_org = await _get_cols(conn, "organization")
        if "settings_json" not in cols_org:
            await conn.execute(text("ALTER TABLE organization ADD COLUMN settings_json TEXT"))

        # Alter table teammember for missing fields
        cols_tm = await _get_cols(conn, "teammember")
        if "is_deleted" not in cols_tm:
            await conn.execute(text("ALTER TABLE teammember ADD COLUMN is_deleted BOOLEAN DEFAULT FALSE"))
        if "status" not in cols_tm:
            await conn.execute(text("ALTER TABLE teammember ADD COLUMN status TEXT DEFAULT 'Active'"))
        if "role" not in cols_tm:
            await conn.execute(text("ALTER TABLE teammember ADD COLUMN role TEXT DEFAULT 'Member'"))
        for col_name in ["avatar", "notes", "joining_date", "department", "designation", "job_title", "phone"]:
            if col_name not in cols_tm:
                await conn.execute(text(f"ALTER TABLE teammember ADD COLUMN {col_name} TEXT"))
        for col_name in ["assigned_pipelines", "assigned_contacts", "assigned_deals", "assigned_funnels", "assigned_forms", "assigned_calendars", "assigned_workflows", "permissions"]:
            if col_name not in cols_tm:
                await conn.execute(text(f"ALTER TABLE teammember ADD COLUMN {col_name} JSON"))

        # Alter table message for internal team inbox integration links
        cols_msg = await _get_cols(conn, "message")
        for col_name in ["task_id", "appointment_id", "invoice_id", "automation_source"]:
            if col_name not in cols_msg:
                await conn.execute(text(f"ALTER TABLE message ADD COLUMN {col_name} TEXT"))
        if "is_ambiguous" not in cols_msg:
            await conn.execute(text("ALTER TABLE message ADD COLUMN is_ambiguous BOOLEAN DEFAULT FALSE"))
        if "gmail_thread_id" not in cols_msg:
            await conn.execute(text("ALTER TABLE message ADD COLUMN gmail_thread_id TEXT"))
        if "company_id" not in cols_msg:
            await conn.execute(text("ALTER TABLE message ADD COLUMN company_id TEXT REFERENCES company(id)"))
        if "is_starred" not in cols_msg:
            await conn.execute(text("ALTER TABLE message ADD COLUMN is_starred BOOLEAN DEFAULT FALSE"))
        if "is_archived" not in cols_msg:
            await conn.execute(text("ALTER TABLE message ADD COLUMN is_archived BOOLEAN DEFAULT FALSE"))
        if "is_unknown_contact" not in cols_msg:
            await conn.execute(text("ALTER TABLE message ADD COLUMN is_unknown_contact BOOLEAN DEFAULT FALSE"))
        if "attachments_metadata" not in cols_msg:
            await conn.execute(text("ALTER TABLE message ADD COLUMN attachments_metadata TEXT"))

        # Alter table gmailintegration for sync status and tracking fields
        cols_gmail = await _get_cols(conn, "gmailintegration")
        if "last_synced_at" not in cols_gmail:
            await conn.execute(text("ALTER TABLE gmailintegration ADD COLUMN last_synced_at TIMESTAMP"))
        if "sync_status" not in cols_gmail:
            await conn.execute(text("ALTER TABLE gmailintegration ADD COLUMN sync_status TEXT DEFAULT 'Idle'"))
        if "last_sync_message" not in cols_gmail:
            await conn.execute(text("ALTER TABLE gmailintegration ADD COLUMN last_sync_message TEXT"))

        # Alter table contact for address and tax details
        try:
            cols_contact = await _get_cols(conn, "contact")
            for col_name in ["billing_address", "tax_information"]:
                if col_name not in cols_contact:
                    await conn.execute(text(f"ALTER TABLE contact ADD COLUMN {col_name} TEXT"))
        except Exception:
            pass

        # Alter table company for tax details
        cols_company = await _get_cols(conn, "company")
        if "tax_information" not in cols_company:
            await conn.execute(text("ALTER TABLE company ADD COLUMN tax_information TEXT"))

        # Alter table activity for contact_id
        cols_act = await _get_cols(conn, "activity")
        if "contact_id" not in cols_act:
            await conn.execute(text("ALTER TABLE activity ADD COLUMN contact_id TEXT REFERENCES contact(id)"))
        if "task_id" not in cols_act:
            await conn.execute(text("ALTER TABLE activity ADD COLUMN task_id TEXT REFERENCES task(id)"))
        if "appointment_id" not in cols_act:
            await conn.execute(text("ALTER TABLE activity ADD COLUMN appointment_id TEXT REFERENCES appointment(id)"))

        # Alter table funnel for publish status and metadata
        cols_funnel = await _get_cols(conn, "funnel")
        if "status" not in cols_funnel:
            await conn.execute(text("ALTER TABLE funnel ADD COLUMN status TEXT DEFAULT 'Draft'"))
        if "published_url" not in cols_funnel:
            await conn.execute(text("ALTER TABLE funnel ADD COLUMN published_url TEXT"))
        if "published_at" not in cols_funnel:
            await conn.execute(text("ALTER TABLE funnel ADD COLUMN published_at TIMESTAMP"))

        # Alter table funnelstep for simple page attributes
        cols_step = await _get_cols(conn, "funnelstep")
        for col_name in ["title", "heading", "paragraph_text", "image_url", "button_text", "background_color"]:
            if col_name not in cols_step:
                await conn.execute(text(f"ALTER TABLE funnelstep ADD COLUMN {col_name} TEXT"))
        for col_name in ["next_step_id", "status", "action_type", "action_value"]:
            if col_name not in cols_step:
                if col_name == "status":
                    await conn.execute(text("ALTER TABLE funnelstep ADD COLUMN status TEXT DEFAULT 'Active'"))
                elif col_name == "action_type":
                    await conn.execute(text("ALTER TABLE funnelstep ADD COLUMN action_type TEXT DEFAULT 'go_to_next_step'"))
                else:
                    await conn.execute(text(f"ALTER TABLE funnelstep ADD COLUMN {col_name} TEXT"))

        # Alter table funnelvisit for tracking attributes
        cols_visit = await _get_cols(conn, "funnelvisit")
        if "event_type" not in cols_visit:
            await conn.execute(text("ALTER TABLE funnelvisit ADD COLUMN event_type TEXT DEFAULT 'page_view'"))
        if "referrer" not in cols_visit:
            await conn.execute(text("ALTER TABLE funnelvisit ADD COLUMN referrer TEXT"))
        if "device" not in cols_visit:
            await conn.execute(text("ALTER TABLE funnelvisit ADD COLUMN device TEXT"))
        if "browser" not in cols_visit:
            await conn.execute(text("ALTER TABLE funnelvisit ADD COLUMN browser TEXT"))
        if "os" not in cols_visit:
            await conn.execute(text("ALTER TABLE funnelvisit ADD COLUMN os TEXT"))
        if "utm_term" not in cols_visit:
            await conn.execute(text("ALTER TABLE funnelvisit ADD COLUMN utm_term TEXT"))
        if "utm_content" not in cols_visit:
            await conn.execute(text("ALTER TABLE funnelvisit ADD COLUMN utm_content TEXT"))

        # Create composite database indexes for fast query execution
        indexes = [
            "CREATE INDEX IF NOT EXISTS idx_lead_org_owner ON lead(organization_id, owner_id)",
            "CREATE INDEX IF NOT EXISTS idx_contact_org ON contact(organization_id)",
            "CREATE INDEX IF NOT EXISTS idx_message_org_created ON message(organization_id, created_at DESC)",
            "CREATE INDEX IF NOT EXISTS idx_message_lead ON message(lead_id)",
            "CREATE INDEX IF NOT EXISTS idx_message_contact ON message(contact_id)",
            "CREATE INDEX IF NOT EXISTS idx_task_org_due ON task(organization_id, due_date)",
            "CREATE INDEX IF NOT EXISTS idx_tasklead_task ON tasklead(task_id, organization_id)",
            "CREATE INDEX IF NOT EXISTS idx_activity_lead ON activity(lead_id, organization_id)",
            "CREATE INDEX IF NOT EXISTS idx_deal_org_stage ON deal(organization_id, stage_id)",
            "CREATE INDEX IF NOT EXISTS idx_teammember_org_user ON teammember(organization_id, user_id)",
        ]
        for idx_sql in indexes:
            try:
                await conn.execute(text(idx_sql))
            except Exception:
                pass



    # Wire up workflow engine listeners to the event bus
    from app.modules.workflow.executor import init_workflow_listeners
    init_workflow_listeners()

    # Register email sent listener to update lead status to contacted
    from app.core.events import subscribe, publish
    from app.modules.crm.services import CRMService
    from app.modules.crm.schemas import LeadUpdate
    from app.db.session import AsyncSessionLocal
    from sqlalchemy import select
    from app.modules.crm.models import Lead

    async def on_email_sent(event):
        org_id = getattr(event, "organization_id", None)
        recipient = getattr(event, "recipient_email", None)
        lead_id = getattr(event, "lead_id", None)
        if not org_id:
            return

        async with AsyncSessionLocal() as db:
            lead = None
            if lead_id:
                res = await db.execute(select(Lead).where(Lead.id == lead_id, Lead.organization_id == org_id))
                lead = res.scalars().first()
            if not lead and recipient:
                res = await db.execute(select(Lead).where(Lead.email == recipient, Lead.organization_id == org_id))
                lead = res.scalars().first()
            
            if lead and lead.status != "Contacted":
                crm_svc = CRMService(db)
                await crm_svc.update_lead(lead.id, LeadUpdate(status="Contacted"), org_id)

    subscribe("email.sent", on_email_sent)

    # Register pipeline stage changed subscriber to emit specific stage events
    from app.modules.pipeline.models import Stage

    async def on_pipeline_stage_changed(event):
        stage_name = getattr(event, "current_stage", None)
        if not stage_name:
            try:
                async with AsyncSessionLocal() as db:
                    res = await db.execute(select(Stage).where(Stage.id == event.new_stage_id))
                    stage = res.scalars().first()
                    if stage:
                        stage_name = stage.name
            except Exception:
                pass

        if not stage_name:
            return

        stage_lower = stage_name.lower().strip()
        
        # Use exact or prefix matching to avoid false positives
        # (e.g. "new" should not match "renewed")
        specific_event = None
        if stage_lower == "new" or stage_lower.startswith("new "):
            specific_event = "pipeline.stage_new"
        elif stage_lower == "contacted" or "contacted" in stage_lower:
            specific_event = "pipeline.stage_contacted"
        elif stage_lower == "qualified" or "qualified" in stage_lower:
            specific_event = "pipeline.stage_qualified"
        elif stage_lower == "proposal" or "proposal" in stage_lower:
            specific_event = "pipeline.stage_proposal"
        elif stage_lower == "negotiation" or "negotiation" in stage_lower:
            specific_event = "pipeline.stage_negotiation"
        elif "lost" in stage_lower or "deal lost" in stage_lower:
            specific_event = "pipeline.stage_deal_lost"
        elif "won" in stage_lower or "deal won" in stage_lower:
            specific_event = "pipeline.stage_deal_won"

        import logging
        logging.getLogger(__name__).info(
            f"pipeline.stage_changed -> stage='{stage_name}' -> specific_event='{specific_event}'"
        )

        if specific_event:
            await publish(specific_event, event)

    subscribe("pipeline.stage_changed", on_pipeline_stage_changed)

    # Synchronize lead creation to default pipeline Deal
    async def on_lead_created(event):
        org_id = getattr(event, "organization_id", None)
        lead_id = getattr(event, "lead_id", None)
        if not org_id or not lead_id:
            return

        async with AsyncSessionLocal() as db:
            from app.modules.pipeline.models import Pipeline, Stage, Deal
            from app.modules.crm.models import Lead

            # 1. Check if Deal already exists
            deal_check = await db.execute(select(Deal).where(Deal.lead_id == lead_id, Deal.organization_id == org_id))
            if deal_check.scalars().first():
                return

            # 2. Get Lead info
            lead_res = await db.execute(select(Lead).where(Lead.id == lead_id, Lead.organization_id == org_id))
            lead = lead_res.scalars().first()
            if not lead:
                return

            # 3. Find default pipeline
            res_pipe = await db.execute(select(Pipeline).where(Pipeline.organization_id == org_id))
            pipeline = res_pipe.scalars().first()
            if not pipeline:
                # If no pipeline exists, create one
                pipeline = Pipeline(name="Default Pipeline", organization_id=org_id)
                db.add(pipeline)
                await db.flush()

            # 4. Find stages
            res_stages = await db.execute(
                select(Stage).where(Stage.pipeline_id == pipeline.id).order_by(Stage.order)
            )
            stages = list(res_stages.scalars().all())
            if not stages:
                # Create standard stages
                stage_names = ["New", "Contacted", "Qualified", "Proposal", "Negotiation", "Won", "Lost"]
                stages = []
                for i, name in enumerate(stage_names):
                    stage = Stage(name=name, pipeline_id=pipeline.id, order=i, organization_id=org_id)
                    db.add(stage)
                    stages.append(stage)
                await db.flush()

            # 5. Resolve target stage
            target_stage = stages[0]
            lead_status_lower = (lead.status or "new").lower()
            for stage in stages:
                if lead_status_lower in stage.name.lower() or stage.name.lower() in lead_status_lower:
                    target_stage = stage
                    break

            # 6. Create Deal
            new_deal = Deal(
                title=f"{lead.first_name} {lead.last_name} Deal",
                value=getattr(lead, "budget", 0.0) or 0.0,
                stage_id=target_stage.id,
                lead_id=lead.id,
                owner_id=getattr(lead, "owner_id", None),
                organization_id=org_id,
                status="Open"
            )
            db.add(new_deal)
            await db.commit()

    subscribe("lead.created", on_lead_created)
    subscribe("form.submitted", on_lead_created)

    # Seed default admin user on fresh database if no users exist
    try:
        from app.modules.auth.models import User
        from app.core.security import get_password_hash
        from sqlalchemy import select
        async with AsyncSessionLocal() as session:
            user_res = await session.execute(select(User).limit(1))
            if not user_res.scalars().first():
                admin_user = User(
                    email="admin@growthos.com",
                    hashed_password=get_password_hash("Pass123!"),
                    first_name="Admin",
                    last_name="User",
                    is_superuser=True,
                    is_active=True,
                    organization_id="org_demo"
                )
                session.add(admin_user)
                await session.commit()
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning(f"Could not seed default user: {e}")

    # Start background scheduler loop for campaign sending (in-app fallback for local development)
    import asyncio
    from app.modules.campaigns.tasks import _async_schedule_campaigns
    
    async def run_scheduler():
        import logging
        logger = logging.getLogger("app.scheduler")
        logger.info("Starting background campaign scheduler loop...")
        while True:
            try:
                await _async_schedule_campaigns()
            except Exception as e:
                logger.error(f"Error in campaign scheduler loop: {e}", exc_info=True)
            await asyncio.sleep(5)  # Poll database every 5 seconds for responsive local scheduling

    scheduler_task = asyncio.create_task(run_scheduler())

    # Start background scheduler loop for incoming Gmail synchronization (2-minute cycle)
    from app.modules.gmail.sync_service import GmailSyncService
    from app.db.session import AsyncSessionLocal

    async def run_gmail_sync_scheduler():
        import logging
        logger = logging.getLogger("app.gmail_scheduler")
        logger.info("Starting background incoming Gmail sync scheduler loop (120s interval)...")
        await asyncio.sleep(5)  # initial startup delay
        while True:
            try:
                async with AsyncSessionLocal() as db:
                    sync_svc = GmailSyncService(db)
                    await sync_svc.sync_all_mailboxes()
            except Exception as e:
                logger.error(f"Error in Gmail sync scheduler loop: {e}", exc_info=True)
            await asyncio.sleep(120)  # Poll every 2 minutes

    gmail_sync_task = asyncio.create_task(run_gmail_sync_scheduler())

    yield

    scheduler_task.cancel()
    gmail_sync_task.cancel()




app = FastAPI(
    title="GrowthOS Backend",
    description="AI Powered CRM & Sales Automation Platform API",
    version="0.1.0",
    lifespan=lifespan,
)

# Allow CORS for local frontend dev server, FRONTEND_URL env var, and Render domains
frontend_url = os.getenv("FRONTEND_URL")
allowed_origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
]
if frontend_url:
    for u in [x.strip() for x in frontend_url.split(",") if x.strip()]:
        if u not in allowed_origins:
            allowed_origins.append(u)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=r"https?://.*\.onrender\.com|https?://.*\.vercel\.app|https?://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

# GZip compression for payloads > 1000 bytes over remote connections (Supabase & Hostinger)
app.add_middleware(GZipMiddleware, minimum_size=1000)


from app.modules.health.router import router as health_router

@app.get("/")
async def root():
    return {
        "status": "online",
        "message": "GrowthOS Backend API is running",
        "docs": "http://127.0.0.1:8000/docs"
    }

app.include_router(health_router, prefix="", tags=["health"])
app.include_router(health_router, prefix="/api/v1", tags=["health"])

# Mount static files for media uploads
os.makedirs("static/uploads", exist_ok=True)
app.mount("/static", StaticFiles(directory="static"), name="static")

app.include_router(auth_router, prefix="/api/v1/auth", tags=["auth"])
app.include_router(crm_router, prefix="/api/v1/crm", tags=["crm"])
app.include_router(pipeline_router, prefix="/api/v1/pipeline", tags=["pipeline"])
app.include_router(workflow_router, prefix="/api/v1/workflow", tags=["workflow"])
app.include_router(tasks_router, prefix="/api/v1/tasks", tags=["tasks"])
app.include_router(calendar_router, prefix="/api/v1/calendar", tags=["calendar"])
app.include_router(forms_router, prefix="/api/v1/forms", tags=["forms"])
app.include_router(email_router, prefix="/api/v1/email", tags=["email"])
app.include_router(notifications_router, prefix="/api/v1/notifications", tags=["notifications"])
app.include_router(funnels_router, prefix="/api/v1/funnels", tags=["funnels"])
app.include_router(inbox_router, prefix="/api/v1/inbox", tags=["inbox"])
app.include_router(reviews_router, prefix="/api/v1/reviews", tags=["reviews"])
app.include_router(payments_router, prefix="/api/v1/payments", tags=["payments"])
app.include_router(integrations_router, prefix="/api/v1/integrations", tags=["integrations"])
app.include_router(reports_router, prefix="/api/v1/reports", tags=["reports"])
app.include_router(settings_router, prefix="/api/v1/settings", tags=["settings"])
app.include_router(gmail_router, prefix="/api/v1/gmail", tags=["gmail"])
from app.modules.team.performance_router import router as performance_router
app.include_router(performance_router, prefix="/api/v1/team/performance", tags=["team-performance"])
app.include_router(team_router, prefix="/api/v1/team", tags=["team"])
app.include_router(campaigns_router, prefix="/api/v1/campaigns", tags=["campaigns"])
from app.modules.ai_coach.router import router as ai_coach_router
app.include_router(ai_coach_router, prefix="/api/v1/ai-coach", tags=["ai-coach"])
from app.modules.ai_lead_handler.router import router as ai_lead_handler_router
app.include_router(ai_lead_handler_router, prefix="/api/v1", tags=["ai-lead-handler"])
from app.modules.websocket.router import router as ws_router
app.include_router(ws_router, tags=["websocket"])

