from datetime import datetime, timedelta, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.modules.pipeline.models import Pipeline, Stage, Deal
from app.modules.crm.models import Lead
from app.modules.tasks.models import Task
from app.modules.workflow.models import Workflow

async def seed_organization_data(db: AsyncSession, organization_id: str, owner_id: str):
    """
    Seeds a newly registered organization with demo data so that their dashboard
    and interactive pages look populated and highly professional.
    """
    # 1. Create a default Pipeline
    pipeline = Pipeline(
        name="Sales Pipeline",
        description="Standard sales pipeline for tracking deals",
        organization_id=organization_id
    )
    db.add(pipeline)
    await db.flush()  # to populate pipeline.id

    # 2. Create default Stages
    stages_info = [
        {"name": "New Lead", "order": 1},
        {"name": "Contacted", "order": 2},
        {"name": "Proposal", "order": 3},
        {"name": "Won", "order": 4},
        {"name": "Lost", "order": 5}
    ]
    stages = []
    for info in stages_info:
        stage = Stage(
            name=info["name"],
            order=info["order"],
            pipeline_id=pipeline.id,
            organization_id=organization_id
        )
        db.add(stage)
        stages.append(stage)
    await db.flush()  # populate stage IDs

    # Map stages by name for easy deal assignment
    stage_map = {s.name: s.id for s in stages}

    # 3. Create default Leads
    now = datetime.now(timezone.utc)
    leads_info = [
        {
            "first_name": "John",
            "last_name": "Doe",
            "email": "john@acme.com",
            "phone": "+1 (555) 019-2834",
            "status": "New",
            "priority": "High",
            "lead_source": "Website",
            "lead_score": 80
        },
        {
            "first_name": "Jane",
            "last_name": "Smith",
            "email": "jane@globex.io",
            "phone": "+1 (555) 048-9122",
            "status": "Contacted",
            "priority": "Normal",
            "lead_source": "Referral",
            "lead_score": 95
        },
        {
            "first_name": "Robert",
            "last_name": "Johnson",
            "email": "robert@initech.com",
            "phone": "+1 (555) 039-4455",
            "status": "Contacted",
            "priority": "Low",
            "lead_source": "Cold Call",
            "lead_score": 45
        },
        {
            "first_name": "Emily",
            "last_name": "Davis",
            "email": "emily@umbrella.org",
            "phone": "+1 (555) 077-8899",
            "status": "Qualified",
            "priority": "High",
            "lead_source": "LinkedIn",
            "lead_score": 85
        },
        {
            "first_name": "Michael",
            "last_name": "Brown",
            "email": "michael@hooli.com",
            "phone": "+1 (555) 012-3456",
            "status": "Lost",
            "priority": "Normal",
            "lead_source": "Google Search",
            "lead_score": 20
        }
    ]
    
    leads = []
    for li in leads_info:
        lead = Lead(
            first_name=li["first_name"],
            last_name=li["last_name"],
            email=li["email"],
            phone=li["phone"],
            status=li["status"],
            priority=li["priority"],
            lead_source=li["lead_source"],
            lead_score=li["lead_score"],
            owner_id=owner_id,
            organization_id=organization_id
        )
        db.add(lead)
        leads.append(lead)
    await db.flush()  # populate lead IDs

    # 4. Create default Deals
    deals_info = [
        {
            "title": "Acme Enterprise License Deal",
            "value": 12500.0,
            "status": "Open",
            "stage_name": "New Lead",
            "lead_index": 0
        },
        {
            "title": "Globex CRM Integration Contract",
            "value": 8200.0,
            "status": "Open",
            "stage_name": "Contacted",
            "lead_index": 1
        },
        {
            "title": "Initech Software Subscription",
            "value": 3500.0,
            "status": "Open",
            "stage_name": "Proposal",
            "lead_index": 2
        },
        {
            "title": "Umbrella Consulting Engagement",
            "value": 15000.0,
            "status": "Won",
            "stage_name": "Won",
            "lead_index": 3
        }
    ]

    for di in deals_info:
        deal = Deal(
            title=di["title"],
            value=di["value"],
            status=di["status"],
            stage_id=stage_map[di["stage_name"]],
            lead_id=leads[di["lead_index"]].id,
            owner_id=owner_id,
            organization_id=organization_id
        )
        db.add(deal)

    # 5. Create default Tasks
    tasks_info = [
        {
            "title": "Follow up with John Doe",
            "description": "Send enterprise pricing quote and schedule product walk-through.",
            "due_date": now + timedelta(days=1),
            "priority": "High",
            "is_completed": False,
            "lead_index": 0
        },
        {
            "title": "Prepare proposal for Globex integration",
            "description": "Consult engineering regarding custom API endpoints requested.",
            "due_date": now + timedelta(days=2),
            "priority": "High",
            "is_completed": False,
            "lead_index": 1
        },
        {
            "title": "Send introduction email to Initech",
            "description": "Introduce team and share link to schedule kick-off call.",
            "due_date": now - timedelta(days=1),
            "priority": "Normal",
            "is_completed": True,
            "lead_index": 2
        }
    ]

    for ti in tasks_info:
        task = Task(
            title=ti["title"],
            description=ti["description"],
            due_date=ti["due_date"],
            priority=ti["priority"],
            is_completed=ti["is_completed"],
            status="Completed" if ti["is_completed"] else "Pending",
            lead_id=leads[ti["lead_index"]].id,
            owner_id=owner_id,
            organization_id=organization_id
        )
        db.add(task)

    # 6. Create default Automations (Workflows)
    workflows_info = [
        {
            "name": "Auto-Welcome Email Flow",
            "description": "Send a welcome email automatically when a new lead is created via website.",
            "trigger": "lead.created",
            "is_active": True
        },
        {
            "name": "Slack Alert on Deal Won",
            "description": "Notify #sales channel when a deal status updates to Won.",
            "trigger": "deal.won",
            "is_active": True
        }
    ]

    for wi in workflows_info:
        wf = Workflow(
            name=wi["name"],
            description=wi["description"],
            trigger=wi["trigger"],
            is_active=wi["is_active"],
            flow_data={"nodes": [], "edges": []},
            organization_id=organization_id
        )
        db.add(wf)

    # Flush changes
    await db.flush()
