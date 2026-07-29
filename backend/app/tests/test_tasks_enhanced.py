import unittest
import asyncio
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy import select, text
from fastapi import HTTPException
from datetime import datetime, timezone

from app.db.base import Base
from app.modules.auth.models import User
from app.modules.team.models import TeamMember
from app.modules.tasks.models import Task, TaskLead
from app.modules.tasks.schemas import TaskCreate, TaskUpdate
from app.modules.tasks.services import TaskService
from app.modules.crm.models import Lead, Activity, Company
from app.modules.pipeline.models import Deal, Stage
from app.modules.notifications.models import Notification
from app.modules.email.models import EmailTemplate, EmailLog

DATABASE_URL = "sqlite+aiosqlite:///test_enhanced_tasks.db"

class TestEnhancedTasks(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        import os
        for suffix in ["", "-wal", "-shm"]:
            fpath = f"test_enhanced_tasks.db{suffix}"
            if os.path.exists(fpath):
                try:
                    os.remove(fpath)
                except Exception:
                    pass

        self.engine = create_async_engine(DATABASE_URL, echo=False)
        async with self.engine.begin() as conn:
            await conn.execute(text("PRAGMA journal_mode=WAL"))
            await conn.run_sync(Base.metadata.create_all)
            
        self.AsyncSessionLocal = async_sessionmaker(
            self.engine, class_=AsyncSession, expire_on_commit=False
        )
        self.db = self.AsyncSessionLocal()

    async def asyncTearDown(self):
        await self.db.close()
        await self.engine.dispose()

    async def test_enhanced_task_features(self):
        # 1. Setup seed data
        org_id = "org_test_1"
        other_org_id = "org_test_2"
        
        # Creator User
        creator = User(id="user_creator", email="creator@example.com", hashed_password="mockedhash", is_active=True, organization_id=org_id)
        self.db.add(creator)
        
        # Team Members
        member_sales = TeamMember(
            id="member_sales",
            first_name="Alice",
            last_name="Sales",
            email="alice@example.com",
            department="Sales",
            status="Active",
            user_id="user_alice",
            organization_id=org_id
        )
        member_inactive = TeamMember(
            id="member_inactive",
            first_name="Bob",
            last_name="Inactive",
            email="bob@example.com",
            department="Sales",
            status="Inactive",
            user_id="user_bob",
            organization_id=org_id
        )
        member_other_org = TeamMember(
            id="member_other",
            first_name="Charlie",
            last_name="Other",
            email="charlie@example.com",
            department="Sales",
            status="Active",
            user_id="user_charlie",
            organization_id=other_org_id
        )
        self.db.add_all([member_sales, member_inactive, member_other_org])
        
        # Leads
        lead1 = Lead(
            id="lead_1",
            first_name="John",
            last_name="Doe",
            email="john@example.com",
            lead_score=50,
            lead_source="Website",
            status="New",
            organization_id=org_id
        )
        lead2 = Lead(
            id="lead_2",
            first_name="Jane",
            last_name="Smith",
            email="jane@example.com",
            lead_score=90,
            lead_source="Referral",
            status="Qualified",
            organization_id=org_id
        )
        lead_other_org = Lead(
            id="lead_other",
            first_name="Foreign",
            last_name="Lead",
            email="foreign@example.com",
            lead_score=10,
            lead_source="Cold Call",
            status="New",
            organization_id=other_org_id
        )
        self.db.add_all([lead1, lead2, lead_other_org])
        
        await self.db.commit()
        
        # Initialize Service
        task_svc = TaskService(self.db)
        
        # 2. Test Department validation (non-existent department)
        task_in = TaskCreate(
            title="Follow up leads",
            department="Engineering",
            assigned_to_id="member_sales"
        )
        with self.assertRaises(HTTPException) as ctx:
            await task_svc.create_task(task_in, org_id, creator.id)
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("does not exist", ctx.exception.detail)
        
        # 3. Test Assignment validation (inactive member)
        task_in = TaskCreate(
            title="Follow up leads",
            department="Sales",
            assigned_to_id="member_inactive"
        )
        with self.assertRaises(HTTPException) as ctx:
            await task_svc.create_task(task_in, org_id, creator.id)
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("inactive", ctx.exception.detail)

        # 4. Test Cross-tenant isolation (foreign assignee)
        task_in = TaskCreate(
            title="Follow up leads",
            department="Sales",
            assigned_to_id="member_other"
        )
        with self.assertRaises(HTTPException) as ctx:
            await task_svc.create_task(task_in, org_id, creator.id)
        self.assertEqual(ctx.exception.status_code, 404)

        # 5. Test Cross-tenant isolation (foreign related lead)
        task_in = TaskCreate(
            title="Follow up leads",
            department="Sales",
            assigned_to_id="member_sales",
            lead_ids=["lead_1", "lead_other"]
        )
        with self.assertRaises(HTTPException) as ctx:
            await task_svc.create_task(task_in, org_id, creator.id)
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("do not belong to this organization", ctx.exception.detail)

        # 6. Test successful creation with department and multiple related leads
        task_in = TaskCreate(
            title="Follow up leads",
            description="Call them today",
            priority="High",
            department="Sales",
            assigned_to_id="member_sales",
            lead_ids=["lead_1", "lead_2"]
        )
        task = await task_svc.create_task(task_in, org_id, creator.id)
        self.assertIsNotNone(task.id)
        self.assertEqual(task.department, "Sales")
        self.assertEqual(task.lead_id, "lead_1") # legacy fallback
        
        # Check junction table associations
        res = await self.db.execute(select(TaskLead).where(TaskLead.task_id == task.id))
        relations = res.scalars().all()
        self.assertEqual(len(relations), 2)
        rel_leads = [r.lead_id for r in relations]
        self.assertIn("lead_1", rel_leads)
        self.assertIn("lead_2", rel_leads)
        
        # Check in-app notification content formatting
        res_notif = await self.db.execute(select(Notification).where(Notification.user_id == "user_alice"))
        notif = res_notif.scalars().first()
        self.assertIsNotNone(notif)
        self.assertEqual(notif.title, "New Task Assigned")
        self.assertIn("Task: Follow up leads", notif.content)
        self.assertIn("Department: Sales", notif.content)
        self.assertIn("Related Leads: 2", notif.content)
        self.assertIn("Priority: High", notif.content)

        # Check email log exists
        res_email = await self.db.execute(select(EmailLog).where(EmailLog.recipient == "alice@example.com"))
        email_log = res_email.scalars().first()
        self.assertIsNotNone(email_log)
        
        # Check timeline activities
        res_act = await self.db.execute(select(Activity).where(Activity.task_id == task.id))
        activities = res_act.scalars().all()
        self.assertEqual(len(activities), 4)
        types = [a.type for a in activities]
        self.assertEqual(types.count("Task Created"), 2)
        self.assertEqual(types.count("Task Assigned"), 2)

        # 7. Test get_tasks loads related leads summary correctly (N+1 query check)
        tasks_list = await task_svc.get_tasks(org_id)
        self.assertEqual(len(tasks_list), 1)
        retrieved_task = tasks_list[0]
        self.assertEqual(len(retrieved_task.lead_ids), 2)
        self.assertEqual(len(retrieved_task.related_leads), 2)
        
        rl1 = next(l for l in retrieved_task.related_leads if l["id"] == "lead_1")
        self.assertEqual(rl1["first_name"], "John")
        self.assertEqual(rl1["lead_score"], 50)
        self.assertEqual(rl1["lead_source"], "Website")
        
        # 8. Test update_task completed activity logging
        task_up = TaskUpdate(
            status="Completed"
        )
        await task_svc.update_task(task.id, task_up, org_id, creator.id)
        
        res_act_comp = await self.db.execute(select(Activity).where(Activity.task_id == task.id, Activity.type == "Task Completed"))
        comp_activities = res_act_comp.scalars().all()
        self.assertEqual(len(comp_activities), 2)
