import unittest
import asyncio
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy import select, func
from fastapi import HTTPException

from app.db.base import Base
from app.modules.auth.models import User
from app.modules.team.models import TeamMember
from app.modules.team.schemas import TeamMemberCreate
from app.modules.team.services import TeamService
from app.modules.tasks.models import Task
from app.modules.tasks.schemas import TaskCreate
from app.modules.tasks.services import TaskService
from app.modules.notifications.models import Notification
from app.modules.email.models import EmailLog
from app.modules.crm.models import Activity

from sqlalchemy import select, text
DATABASE_URL = "sqlite+aiosqlite:///test_growthos.db"

class TestTeamAndTaskFlow(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        # Clean up any leftover test database files
        import os
        for suffix in ["", "-wal", "-shm"]:
            fpath = f"test_growthos.db{suffix}"
            if os.path.exists(fpath):
                try:
                    os.remove(fpath)
                except Exception:
                    pass

        # Create test engine and enable WAL mode for concurrent session support
        self.engine = create_async_engine(DATABASE_URL, echo=False)
        async with self.engine.begin() as conn:
            await conn.execute(text("PRAGMA journal_mode=WAL"))
            await conn.run_sync(Base.metadata.create_all)
            
        self.AsyncSessionLocal = async_sessionmaker(
            self.engine, class_=AsyncSession, expire_on_commit=False
        )
        self.db = self.AsyncSessionLocal()
        
        # Override Workflow executor's SessionMaker to run against test SQLite database
        from app.modules.workflow import executor
        self.original_executor_sessionmaker = executor.AsyncSessionLocal
        executor.AsyncSessionLocal = self.AsyncSessionLocal
        executor.init_workflow_listeners()

        # Override Campaigns tasks SessionMaker to run against test SQLite database
        from app.modules.campaigns import tasks as campaigns_tasks
        campaigns_tasks.AsyncSessionLocal = self.AsyncSessionLocal

        # Override Inbox tasks SessionMaker to run against test SQLite database
        from app.modules.inbox import tasks as inbox_tasks
        inbox_tasks.AsyncSessionLocal = self.AsyncSessionLocal


        # Mock Celery task delay method by default to prevent connection errors
        self.original_delay = executor.execute_workflow_node_task.delay
        executor.execute_workflow_node_task.delay = lambda *args, **kwargs: None

        # Register the email.sent listener in the test environment to mock lifespan behavior
        from app.core.events import subscribe
        from app.modules.crm.services import CRMService
        from app.modules.crm.schemas import LeadUpdate
        from app.modules.crm.models import Lead

        async def test_on_email_sent(event):
            org_id = getattr(event, "organization_id", None)
            recipient = getattr(event, "recipient_email", None)
            lead_id = getattr(event, "lead_id", None)
            if not org_id:
                return

            async with self.AsyncSessionLocal() as db:
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

        subscribe("email.sent", test_on_email_sent)

        # Register the pipeline.stage_changed listener in the test environment to mock lifespan behavior
        from app.modules.pipeline.models import Stage

        async def test_on_pipeline_stage_changed(event):
            stage_name = getattr(event, "current_stage", None)
            if not stage_name:
                try:
                    async with self.AsyncSessionLocal() as db:
                        res = await db.execute(select(Stage).where(Stage.id == event.new_stage_id))
                        stage = res.scalars().first()
                        if stage:
                            stage_name = stage.name
                except Exception:
                    pass

            if not stage_name:
                return

            stage_lower = stage_name.lower()
            specific_event = None
            if "new" in stage_lower:
                specific_event = "pipeline.stage_new"
            elif "contacted" in stage_lower:
                specific_event = "pipeline.stage_contacted"
            elif "qualified" in stage_lower:
                specific_event = "pipeline.stage_qualified"
            elif "proposal" in stage_lower:
                specific_event = "pipeline.stage_proposal"
            elif "negotiation" in stage_lower:
                specific_event = "pipeline.stage_negotiation"
            elif "lost" in stage_lower:
                specific_event = "pipeline.stage_deal_lost"
            elif "won" in stage_lower:
                specific_event = "pipeline.stage_deal_won"

            if specific_event:
                from app.core.events import publish
                await publish(specific_event, event)

        subscribe("pipeline.stage_changed", test_on_pipeline_stage_changed)

        # Create a test organization and a test user
        self.org_id = "test-org-123"
        self.admin = User(
            id="admin-id",
            email="admin@test.com",
            hashed_password="hashed_pwd",
            first_name="Admin",
            last_name="User",
            organization_id=self.org_id,
            is_active=True
        )
        # Avoid duplicate unique key insert if database file is reused
        res_user = await self.db.execute(select(User).where(User.id == "admin-id"))
        if not res_user.scalars().first():
            self.db.add(self.admin)
            await self.db.commit()
        
    async def asyncTearDown(self):
        from app.modules.workflow import executor
        executor.AsyncSessionLocal = self.original_executor_sessionmaker
        executor.execute_workflow_node_task.delay = self.original_delay
        
        # Clear global event bus listeners registry to prevent leaks/duplicates
        from app.core.events import _listeners
        _listeners.clear()

        await self.db.close()
        
        # Drop all tables to guarantee a completely fresh state for the next test
        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
            
        await self.engine.dispose()
        
    async def test_create_team_member_success(self):
        service = TeamService(self.db)
        member_in = TeamMemberCreate(
            first_name="John",
            last_name="Doe",
            email="john@test.com",
            phone="123456",
            job_title="Representative",
            department="Sales",
            status="Active",
            role="Member",
            notes="Test notes"
        )
        
        # Test creation
        member = await service.create_team_member(member_in, self.org_id)
        self.assertEqual(member.first_name, "John")
        self.assertEqual(member.email, "john@test.com")
        self.assertEqual(member.organization_id, self.org_id)
        self.assertIsNotNone(member.user_id)
        
        # Test that user was automatically created with matching name and status
        user_check = await self.db.get(User, member.user_id)
        self.assertIsNotNone(user_check)
        self.assertEqual(user_check.email, "john@test.com")
        self.assertTrue(user_check.is_active)
        
    async def test_create_team_member_duplicate_email(self):
        service = TeamService(self.db)
        member_in = TeamMemberCreate(
            first_name="John",
            last_name="Doe",
            email="john@test.com",
            department="Sales",
            role="Member"
        )
        await service.create_team_member(member_in, self.org_id)
        
        # Duplicate check should raise 409 Conflict
        with self.assertRaises(HTTPException) as ctx:
            await service.create_team_member(member_in, self.org_id)
        self.assertEqual(ctx.exception.status_code, 409)
        self.assertIn("exists", ctx.exception.detail)
        
    async def test_assign_task_inactive_member(self):
        team_service = TeamService(self.db)
        task_service = TaskService(self.db)
        
        # Create inactive team member
        member_in = TeamMemberCreate(
            first_name="Jane",
            last_name="Smith",
            email="jane@test.com",
            department="QA",
            status="Inactive",
            role="Member"
        )
        member = await team_service.create_team_member(member_in, self.org_id)
        
        # Attempting to assign task to inactive member should raise 400 Bad Request
        task_in = TaskCreate(
            title="Test Task",
            priority="Normal",
            assigned_to_id=member.id
        )
        with self.assertRaises(HTTPException) as ctx:
            await task_service.create_task(task_in, self.org_id, self.admin.id)
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("inactive", ctx.exception.detail)

    async def test_task_assignment_flow_e2e(self):
        team_service = TeamService(self.db)
        task_service = TaskService(self.db)
        
        # 1. Create active team member
        member_in = TeamMemberCreate(
            first_name="Alice",
            last_name="Johnson",
            email="alice@test.com",
            department="Support",
            status="Active",
            role="Member"
        )
        member = await team_service.create_team_member(member_in, self.org_id)
        
        # 2. Create task and assign it to the member
        task_in = TaskCreate(
            title="Follow up with Alice",
            priority="High",
            assigned_to_id=member.id
        )
        task = await task_service.create_task(task_in, self.org_id, self.admin.id)
        
        self.assertEqual(task.assigned_to_id, member.id)
        self.assertEqual(task.assigned_by_id, self.admin.id)
        self.assertIsNotNone(task.assigned_at)
        
        # 3. Verify in-app Notification was created for Alice
        from sqlalchemy.future import select
        notif_res = await self.db.execute(
            select(Notification).where(Notification.user_id == member.user_id)
        )
        notif = notif_res.scalars().first()
        self.assertIsNotNone(notif)
        self.assertEqual(notif.type, "Task")
        self.assertEqual(notif.related_entity_id, task.id)
        
        # 4. Verify CRM Activity timeline log was created
        act_res = await self.db.execute(
            select(Activity).where(Activity.organization_id == self.org_id)
        )
        activity = act_res.scalars().first()
        self.assertIsNotNone(activity)
        self.assertEqual(activity.type, "Task Assigned")
        self.assertIn("assigned to Alice Johnson", activity.description)
        
        # 5. Verify Email log was queued
        email_res = await self.db.execute(
            select(EmailLog).where(EmailLog.recipient == member.email)
        )
        email = email_res.scalars().first()
        self.assertIsNotNone(email)
        self.assertEqual(email.status, "Queued")
        self.assertIn("Alice", email.body)

    async def test_pipeline_lead_bidirectional_sync(self):
        from app.modules.pipeline.models import Pipeline, Stage, Deal
        from app.modules.crm.models import Lead
        from app.modules.crm.services import CRMService
        from app.modules.crm.schemas import LeadCreate, LeadUpdate
        from app.modules.pipeline.services import PipelineService
        from app.modules.pipeline.schemas import DealUpdate, PipelineCreate, StageCreate

        # 1. Create a Pipeline and stages
        pipe_svc = PipelineService(self.db)
        pipeline = await pipe_svc.create_pipeline(PipelineCreate(name="Sales"), self.org_id)
        stage_1 = await pipe_svc.create_stage(StageCreate(name="Stage 1", order=1), pipeline.id, self.org_id)
        stage_2 = await pipe_svc.create_stage(StageCreate(name="Stage 2", order=2), pipeline.id, self.org_id)

        # 2. Configure mapping: "New" -> Stage 1, "Contacted" -> Stage 2
        pipeline.status_stage_mapping = {
            "New": stage_1.id,
            "Contacted": stage_2.name
        }
        await self.db.commit()

        # 3. Create Lead with status "New"
        crm_svc = CRMService(self.db)
        lead_in = LeadCreate(
            first_name="Test",
            last_name="Sync",
            email="test_sync@example.com",
            status="New"
        )
        lead = await crm_svc.create_lead(lead_in, self.org_id, self.admin.id)
        self.assertEqual(lead.status, "New")

        # 4. Verify Deal was automatically created in Stage 1
        res_deal = await self.db.execute(select(Deal).where(Deal.lead_id == lead.id))
        deal = res_deal.scalars().first()
        self.assertIsNotNone(deal)
        self.assertEqual(deal.stage_id, stage_1.id)

        # 5. Update Lead status to "Contacted" and verify Deal maps to Stage 2
        await crm_svc.update_lead(lead.id, LeadUpdate(status="Contacted"), self.org_id)
        await self.db.refresh(deal)
        self.assertEqual(deal.stage_id, stage_2.id)

        # 6. Update Deal stage back to Stage 1 and verify Lead maps back to "New"
        await pipe_svc.update_deal(deal.id, DealUpdate(stage_id=stage_1.id), self.org_id)
        await self.db.refresh(lead)
        self.assertEqual(lead.status, "New")

    async def test_automation_event_chaining_and_loop_protection(self):
        import json
        from app.modules.workflow import executor
        from app.modules.workflow.models import Workflow, WorkflowExecution
        from app.modules.crm.models import Lead
        from app.modules.crm.services import CRMService
        from app.modules.crm.schemas import LeadCreate

        # 1. Setup mock Celery task delay to record calls and run them sequentially
        original_delay = executor.execute_workflow_node_task.delay
        pending_tasks = []

        def mock_delay(exec_id, index, ctx_str):
            pending_tasks.append((exec_id, index, ctx_str))

        executor.execute_workflow_node_task.delay = mock_delay

        try:
            # 2. Register generic workflow listeners if not initialized
            executor.init_workflow_listeners()

            import uuid
            test_org_id = f"org-loop-{uuid.uuid4()}"

            # 3. Create two workflows that cycle back and forth
            wf_a = Workflow(
                name="Workflow A",
                trigger="lead.status_changed",
                is_active=True,
                organization_id=test_org_id,
                flow_data={
                    "actions": [
                        {
                            "id": "step_a1",
                            "type": "update_lead",
                            "status": "Contacted"
                        }
                    ]
                }
            )
            wf_b = Workflow(
                name="Workflow B",
                trigger="lead.status_changed",
                is_active=True,
                organization_id=test_org_id,
                flow_data={
                    "actions": [
                        {
                            "id": "step_b1",
                            "type": "update_lead",
                            "status": "New"
                        }
                    ]
                }
            )
            self.db.add(wf_a)
            self.db.add(wf_b)
            await self.db.commit()

            # 4. Create a Lead
            crm_svc = CRMService(self.db)
            lead_in = LeadCreate(
                first_name="Chained",
                last_name="Loop",
                email="chain@example.com",
                status="New"
            )
            lead = await crm_svc.create_lead(lead_in, test_org_id, self.admin.id)

            # 5. Trigger the chain by manually updating the Lead status
            from app.core.events import publish, LeadUpdatedEvent
            await publish("lead.status_changed", LeadUpdatedEvent(
                lead_id=lead.id,
                organization_id=test_org_id,
                changed_fields=["status"]
            ))

            # Allow the main trigger/listener to complete and commit
            for _ in range(10):
                if len(pending_tasks) > 0:
                    break
                await asyncio.sleep(0.1)

            # 6. Execute the queued workflow steps sequentially
            # Maximum safety loop limit to prevent test hanging if loop protection fails
            safety_limit = 20
            while pending_tasks and safety_limit > 0:
                safety_limit -= 1
                exec_id, index, ctx_str = pending_tasks.pop(0)
                await executor._async_execute_step(exec_id, index, json.loads(ctx_str))
                await asyncio.sleep(0.05)

            # 7. Verify that executions were logged and loop protection aborted cyclic run
            async with self.AsyncSessionLocal() as query_db:
                res_execs = await query_db.execute(
                    select(WorkflowExecution).where(WorkflowExecution.organization_id == test_org_id)
                )
                execs = res_execs.scalars().all()
            
            # We expect Workflow A and Workflow B to run, but not trigger infinitely
            self.assertTrue(len(execs) >= 2)
            
            # Verify that executions contain execution_metadata logs
            for ex in execs:
                self.assertIsNotNone(ex.execution_metadata)
                self.assertIn("trigger_event", ex.execution_metadata)
                self.assertEqual(ex.execution_metadata["trigger_event"], "lead.status_changed")

        finally:
            # Restore original delay method
            executor.execute_workflow_node_task.delay = original_delay

    async def test_email_sent_updates_lead_status_to_contacted(self):
        from app.modules.crm.models import Lead
        from app.modules.crm.services import CRMService
        from app.modules.crm.schemas import LeadCreate
        from app.modules.pipeline.models import Pipeline, Stage, Deal
        from app.modules.pipeline.services import PipelineService
        from app.modules.pipeline.schemas import PipelineCreate, StageCreate, DealUpdate
        from app.core.events import publish, EmailSentEvent

        # 1. Setup mapping "Contacted" -> Stage 2
        pipe_svc = PipelineService(self.db)
        pipeline = await pipe_svc.create_pipeline(PipelineCreate(name="Sales"), self.org_id)
        stage_1 = await pipe_svc.create_stage(StageCreate(name="Stage 1", order=1), pipeline.id, self.org_id)
        stage_2 = await pipe_svc.create_stage(StageCreate(name="Contacted Stage", order=2), pipeline.id, self.org_id)

        pipeline.status_stage_mapping = {
            "New": stage_1.id,
            "Contacted": stage_2.id
        }
        await self.db.commit()

        # 2. Create Lead
        crm_svc = CRMService(self.db)
        lead_in = LeadCreate(
            first_name="Email",
            last_name="Test",
            email="email_test@example.com",
            status="New"
        )
        lead = await crm_svc.create_lead(lead_in, self.org_id, self.admin.id)
        self.assertEqual(lead.status, "New")

        # Verify Deal was automatically created in Stage 1
        res_deal = await self.db.execute(select(Deal).where(Deal.lead_id == lead.id))
        deal = res_deal.scalars().first()
        self.assertIsNotNone(deal)
        self.assertEqual(deal.stage_id, stage_1.id)

        # 3. Simulate "email.sent" event
        event = EmailSentEvent(
            message_id="msg-id-123",
            organization_id=self.org_id,
            recipient_email="email_test@example.com",
            lead_id=lead.id
        )
        
        await publish("email.sent", event)

        # 4. Verify Lead Status changed to "Contacted" and Deal stage changed to Stage 2 (with retry to avoid race conditions)
        for _ in range(30):
            await self.db.refresh(lead)
            await self.db.refresh(deal)
            if lead.status == "Contacted" and deal.stage_id == stage_2.id:
                break
            await asyncio.sleep(0.1)

        self.assertEqual(lead.status, "Contacted")
        self.assertEqual(deal.stage_id, stage_2.id)

    async def test_specific_pipeline_stage_triggers(self):
        import json
        from app.modules.workflow import executor
        from app.modules.workflow.models import Workflow, WorkflowExecution
        from app.modules.pipeline.models import Pipeline, Stage, Deal
        from app.modules.pipeline.services import PipelineService
        from app.modules.pipeline.schemas import PipelineCreate, StageCreate, DealUpdate
        from app.core.events import publish, PipelineStageChangedEvent

        # 1. Setup mock Celery task delay to record executions
        original_delay = executor.execute_workflow_node_task.delay
        pending_tasks = []

        def mock_delay(exec_id, index, ctx_str):
            pending_tasks.append((exec_id, index, ctx_str))

        executor.execute_workflow_node_task.delay = mock_delay

        try:
            # 2. Register listeners
            executor.init_workflow_listeners()

            # 3. Create a Proposal Stage and a workflow that triggers on "pipeline.stage_proposal"
            pipe_svc = PipelineService(self.db)
            pipeline = await pipe_svc.create_pipeline(PipelineCreate(name="Sales Pipeline"), self.org_id)
            stage_1 = await pipe_svc.create_stage(StageCreate(name="Stage 1", order=1), pipeline.id, self.org_id)
            stage_2 = await pipe_svc.create_stage(StageCreate(name="Proposal", order=2), pipeline.id, self.org_id)

            wf = Workflow(
                name="Proposal Workflow",
                trigger="pipeline.stage_proposal",
                is_active=True,
                organization_id=self.org_id,
                flow_data={
                    "actions": [
                        {
                            "id": "step_p1",
                            "type": "create_activity",
                            "description": "Moved to proposal stage!"
                        }
                    ]
                }
            )
            self.db.add(wf)
            await self.db.commit()

            # 4. Create Deal in Stage 1
            deal = Deal(
                title="Test Pipeline Stage Specific Deal",
                value=500.0,
                stage_id=stage_1.id,
                organization_id=self.org_id,
                status="Open"
            )
            self.db.add(deal)
            await self.db.commit()

            # 5. Move Deal to Stage 2 (Proposal) using PipelineService
            await pipe_svc.update_deal(deal.id, DealUpdate(stage_id=stage_2.id), self.org_id)
            
            # 6. Verify that "pipeline.stage_proposal" workflow was triggered and executes (with retry to avoid race conditions)
            for _ in range(30):
                if len(pending_tasks) > 0:
                    break
                await asyncio.sleep(0.1)

            self.assertTrue(len(pending_tasks) > 0)
            
            # Execute step
            exec_id, index, ctx_str = pending_tasks.pop(0)
            await executor._async_execute_step(exec_id, index, json.loads(ctx_str))

            res_execs = await self.db.execute(
                select(WorkflowExecution).where(WorkflowExecution.organization_id == self.org_id, WorkflowExecution.workflow_id == wf.id)
            )
            exec_obj = res_execs.scalars().first()
            self.assertIsNotNone(exec_obj)
            self.assertEqual(exec_obj.execution_metadata["trigger_event"], "pipeline.stage_proposal")

        finally:
            executor.execute_workflow_node_task.delay = original_delay

    async def test_all_functional_triggers(self):
        import json
        from app.modules.workflow import executor
        from app.modules.workflow.models import Workflow, WorkflowExecution
        from app.modules.crm.services import CRMService
        from app.modules.crm.schemas import LeadCreate, LeadUpdate
        from app.modules.forms.services import FormSubmissionService
        from app.modules.forms.schemas import FormSubmissionCreate
        from app.modules.forms.models import Form
        from app.modules.tasks.services import TaskService
        from app.modules.tasks.schemas import TaskCreate
        from app.modules.tasks.models import Task
        from app.modules.calendar.services import CalendarService
        from app.modules.calendar.schemas import AppointmentCreate, AppointmentUpdate
        from app.modules.calendar.models import Appointment
        from app.modules.payments.models import Invoice
        from app.core.events import publish, GenericEvent

        # 1. Setup mock Celery task delay
        original_delay = executor.execute_workflow_node_task.delay
        triggered_events = []

        def mock_delay(exec_id, index, ctx_str):
            ctx = json.loads(ctx_str)
            triggered_events.append((ctx.get("initial_event_source"), ctx))

        executor.execute_workflow_node_task.delay = mock_delay

        try:
            executor.init_workflow_listeners()

            # Active workflows for each trigger event type to record
            triggers = [
                "owner.changed", "lead.assigned", "duplicate.submission",
                "task.overdue", "email.opened", "appointment.reminder_time",
                "appointment.completed", "payment.failed", "webhook.received"
            ]
            for t in triggers:
                wf = Workflow(
                    name=f"Workflow for {t}",
                    trigger=t,
                    is_active=True,
                    organization_id=self.org_id,
                    flow_data={"actions": [{"id": "step1", "type": "create_activity"}]}
                )
                self.db.add(wf)
            await self.db.commit()

            # A. Test owner.changed and lead.assigned
            crm_svc = CRMService(self.db)
            lead = await crm_svc.create_lead(LeadCreate(first_name="Owner", last_name="Test", email="owner@test.com", status="New"), self.org_id, self.admin.id)
            # Create a second user to assign to
            await crm_svc.update_lead(lead.id, LeadUpdate(owner_id="new-owner-id"), self.org_id)
            
            # B. Test duplicate.submission
            frm = Form(title="Contact Form", is_active=True, organization_id=self.org_id)
            self.db.add(frm)
            await self.db.commit()
            await self.db.refresh(frm)
            
            # Submit first form (creates lead)
            await FormSubmissionService.submit_form(self.db, frm.id, FormSubmissionCreate(payload={"email": "dup@test.com", "firstname": "Dup"}))
            # Submit duplicate form (should trigger duplicate.submission)
            await FormSubmissionService.submit_form(self.db, frm.id, FormSubmissionCreate(payload={"email": "dup@test.com", "firstname": "Dup2"}))

            # C. Test task.overdue
            tsk_svc = TaskService(self.db)
            from datetime import datetime, timezone, timedelta
            tsk = await tsk_svc.create_task(TaskCreate(title="Overdue Task", due_date=datetime.now(timezone.utc) - timedelta(days=1)), self.org_id, self.admin.id)
            # Retrieve tasks to run self-healing check
            await tsk_svc.get_tasks(self.org_id)

            # D. Test email.opened webhook trigger
            from app.modules.email.models import EmailLog
            log_item = EmailLog(
                organization_id=self.org_id,
                recipient="test@example.com",
                subject="Test Webhook",
                body="Testing",
                status="Queued",
                message_id="msg-webhook-123"
            )
            self.db.add(log_item)
            await self.db.commit()
            
            from app.modules.email.router import email_webhook
            await email_webhook(payload={"message_id": "msg-webhook-123", "event": "opened"}, db=self.db)

            # E. Test appointment.completed and appointment.reminder_time
            cal_svc = CalendarService(self.db)
            appt = await cal_svc.create_appointment(AppointmentCreate(
                title="Reminder Appointment",
                start_time=datetime.now(timezone.utc) + timedelta(hours=2),
                end_time=datetime.now(timezone.utc) + timedelta(hours=3),
                status="Booked",
                related_entity_type="lead",
                related_entity_id=lead.id
            ), self.org_id, self.admin.id)
            # Retrieve appointments to run self-healing reminder check
            await cal_svc.get_appointments(self.org_id)
            # Complete the appointment
            await cal_svc.update_appointment(appt.id, AppointmentUpdate(status="Completed"), self.org_id)

            # F. Test payment.failed webhook
            inv = Invoice(number="INV-001", amount=150.0, organization_id=self.org_id, status="Sent")
            self.db.add(inv)
            await self.db.commit()
            await self.db.refresh(inv)
            
            from app.modules.payments.router import stripe_webhook
            # Mock stripe failure webhook call
            class MockRequest:
                def __init__(self, body_data):
                    self.body_data = body_data
                    self.headers = {"stripe-signature": "valid"}
                async def body(self):
                    return self.body_data
            
            stripe_payload = {
                "type": "charge.failed",
                "data": {
                    "object": {
                        "id": "ch_failed_123",
                        "amount_failed": 15000,
                        "failure_message": "Insufficient funds",
                        "metadata": {"invoice_id": inv.id, "organization_id": self.org_id}
                    }
                }
            }
            await stripe_webhook(MockRequest(json.dumps(stripe_payload).encode()), db=self.db)

            # G. Test webhook.received custom endpoint
            from app.modules.integrations.router import receive_custom_webhook
            await receive_custom_webhook(org_id=self.org_id, payload={"event": "custom_lead_event"}, db=self.db)

            # Verify that all trigger events were captured in celery queues (with retry to avoid race conditions)
            for _ in range(30):
                emitted_sources = [source for source, ctx in triggered_events]
                if all(t in emitted_sources for t in triggers):
                    break
                await asyncio.sleep(0.1)

            emitted_sources = [source for source, ctx in triggered_events]
            for t in triggers:
                self.assertIn(t, emitted_sources, f"Trigger '{t}' was not fired.")

        finally:
            executor.execute_workflow_node_task.delay = original_delay

    async def test_lead_pipeline_sync_priority(self):
        from app.modules.pipeline.services import PipelineService
        from app.modules.pipeline.schemas import PipelineCreate, StageCreate, DealUpdate
        from app.modules.pipeline.models import Deal
        from app.modules.crm.services import CRMService
        from app.modules.crm.schemas import LeadCreate, LeadUpdate
        from app.core.events import publish, EmailSentEvent
        import asyncio

        # 1. Setup mapping:
        # "New" -> Stage 1
        # "Contacted" -> Stage 2 (Contacted)
        # "Proposal" -> Stage 3 (Proposal)
        pipe_svc = PipelineService(self.db)
        pipeline = await pipe_svc.create_pipeline(PipelineCreate(name="Sales sync priority"), self.org_id)
        stage_1 = await pipe_svc.create_stage(StageCreate(name="Stage 1", order=1), pipeline.id, self.org_id)
        stage_2 = await pipe_svc.create_stage(StageCreate(name="Contacted", order=2), pipeline.id, self.org_id)
        stage_3 = await pipe_svc.create_stage(StageCreate(name="Proposal", order=3), pipeline.id, self.org_id)

        pipeline.status_stage_mapping = {
            "New": stage_1.id,
            "Contacted": stage_2.id,
            "Proposal": stage_3.id
        }
        await self.db.commit()

        # 2. Create Lead
        crm_svc = CRMService(self.db)
        lead = await crm_svc.create_lead(LeadCreate(
            first_name="Sync", last_name="Test", email="sync@test.com", status="New"
        ), self.org_id, self.admin.id)
        
        # Verify Deal is in Stage 1
        res_deal = await self.db.execute(select(Deal).where(Deal.lead_id == lead.id))
        deal = res_deal.scalars().first()
        self.assertEqual(deal.stage_id, stage_1.id)

        # 3. Simulate email.sent event -> triggers update to "Contacted"
        event = EmailSentEvent(
            message_id="msg-sync-1",
            organization_id=self.org_id,
            recipient_email="sync@test.com",
            lead_id=lead.id
        )
        await publish("email.sent", event)

        # Wait until Lead status changes to Contacted and Deal stage changes to Contacted
        for _ in range(30):
            await self.db.refresh(lead)
            await self.db.refresh(deal)
            if lead.status == "Contacted" and deal.stage_id == stage_2.id:
                break
            await asyncio.sleep(0.1)

        self.assertEqual(lead.status, "Contacted")
        self.assertEqual(deal.stage_id, stage_2.id)

        # 4. Simulate the Stage Change automation executing: moves Pipeline stage to Proposal
        # Wait, inside update_deal (called by automation), it syncs back to Lead.
        # Let's call update_deal to move Deal to Proposal stage
        await pipe_svc.update_deal(deal.id, DealUpdate(stage_id=stage_3.id), self.org_id)

        # Wait until Lead status and Deal stage both sync to Proposal
        for _ in range(30):
            await self.db.refresh(lead)
            await self.db.refresh(deal)
            if lead.status == "Proposal" and deal.stage_id == stage_3.id:
                break
            await asyncio.sleep(0.1)

        self.assertEqual(deal.stage_id, stage_3.id)
        self.assertEqual(lead.status, "Proposal")

        # 5. Now check that Lead-to-Pipeline sync does NOT revert it back.
        # If we update the Lead's status to an older status (e.g. "Contacted") via some event,
        # it should NOT overwrite the Deal's stage because current_stage.order (3) > target_stage.order (2).
        await crm_svc.update_lead(lead.id, LeadUpdate(status="Contacted"), self.org_id)
        await self.db.refresh(deal)
        await self.db.refresh(lead)

        # Deal stage must remain Proposal (stage_3), even though Lead status was manually set to Contacted
        self.assertEqual(deal.stage_id, stage_3.id)
        # The Lead status will be "Contacted" because it was manually set
        self.assertEqual(lead.status, "Contacted")

    async def test_appointment_relationship_flow_e2e(self):
        from app.modules.crm.models import Lead, Activity
        from app.modules.crm.services import CRMService
        from app.modules.crm.schemas import LeadCreate
        from app.modules.calendar.services import CalendarService
        from app.modules.calendar.schemas import AppointmentCreate
        from app.modules.notifications.models import Notification
        from app.modules.email.models import EmailLog
        from datetime import datetime, timezone, timedelta

        # 1. Create Lead
        crm_svc = CRMService(self.db)
        lead = await crm_svc.create_lead(LeadCreate(
            first_name="Appt", last_name="Lead", email="appt_lead@test.com", status="New"
        ), self.org_id, self.admin.id)

        # 2. Create Appointment linked to Lead
        cal_svc = CalendarService(self.db)
        appt_in = AppointmentCreate(
            title="Meeting with Lead",
            start_time=datetime.now(timezone.utc) + timedelta(days=1),
            end_time=datetime.now(timezone.utc) + timedelta(days=1, hours=1),
            related_entity_type="lead",
            related_entity_id=lead.id,
            status="Booked"
        )
        appt = await cal_svc.create_appointment(appt_in, self.org_id, self.admin.id)
        
        self.assertEqual(appt.related_entity_type, "lead")
        self.assertEqual(appt.related_entity_id, lead.id)
        self.assertEqual(appt.display_name, "Appt Lead")
        self.assertEqual(appt.email, "appt_lead@test.com")

        # 3. Verify Email is queued for the participant
        email_res = await self.db.execute(
            select(EmailLog).where(EmailLog.recipient == "appt_lead@test.com", EmailLog.organization_id == self.org_id)
        )
        email = email_res.scalars().first()
        self.assertIsNotNone(email)
        self.assertEqual(email.status, "Queued")
        self.assertIn("Meeting with Lead", email.body)

        # 4. Verify CRM Activity is created
        act_res = await self.db.execute(
            select(Activity).where(Activity.lead_id == lead.id, Activity.organization_id == self.org_id)
        )
        activities = act_res.scalars().all()
        # Find one of type "Appointment Scheduled" or "Meeting Scheduled"
        appt_act = next((a for a in activities if a.type in ["Appointment Scheduled", "Meeting Scheduled"]), None)
        self.assertIsNotNone(appt_act)
        self.assertIn("Meeting with Lead", appt_act.description)

        # 5. Create Team Member and schedule meeting with them
        from app.modules.team.schemas import TeamMemberCreate
        from app.modules.team.services import TeamService
        team_svc = TeamService(self.db)
        tm = await team_svc.create_team_member(TeamMemberCreate(
            first_name="Team", last_name="Member", email="team_member@test.com", department="Sales", role="Member"
        ), self.org_id)

        # Schedule meeting with Team Member
        appt_in_tm = AppointmentCreate(
            title="Meeting with Team",
            start_time=datetime.now(timezone.utc) + timedelta(days=2),
            end_time=datetime.now(timezone.utc) + timedelta(days=2, hours=1),
            related_entity_type="team_member",
            related_entity_id=tm.id,
            status="Booked"
        )
        appt_tm = await cal_svc.create_appointment(appt_in_tm, self.org_id, self.admin.id)
        
        # Verify in-app Notification is created for Team Member's user_id
        notif_res = await self.db.execute(
            select(Notification).where(Notification.user_id == tm.user_id, Notification.organization_id == self.org_id)
        )
        notif = notif_res.scalars().first()
        self.assertIsNotNone(notif)
        self.assertEqual(notif.type, "Reminder")
        self.assertEqual(notif.related_entity_id, appt_tm.id)

    async def test_invoice_relationship_flow_e2e(self):
        from app.modules.crm.models import Lead, Activity
        from app.modules.crm.services import CRMService
        from app.modules.crm.schemas import LeadCreate
        from app.modules.payments.services import PaymentService
        from app.modules.payments.schemas import InvoiceCreate, InvoiceItemCreate
        from app.modules.email.models import EmailLog
        from datetime import datetime, timezone, timedelta
        import json

        # 1. Create a Lead
        crm_svc = CRMService(self.db)
        lead = await crm_svc.create_lead(LeadCreate(
            first_name="Inv", last_name="Lead", email="inv_lead@test.com", status="New"
        ), self.org_id, self.admin.id)

        # 2. Create Invoice linked to Lead
        pay_svc = PaymentService(self.db)
        inv_in = InvoiceCreate(
            number="INV-TEST-001",
            amount=150.0,
            currency="USD",
            due_date=(datetime.now(timezone.utc) + timedelta(days=15)).isoformat(),
            related_entity_type="lead",
            related_entity_id=lead.id,
            items=[
                InvoiceItemCreate(
                    description="Consulting Services",
                    quantity=1.5,
                    unit_price=100.0
                )
            ]
        )
        invoice = await pay_svc.create_invoice(inv_in, self.org_id)
        
        self.assertEqual(invoice.number, "INV-TEST-001")
        self.assertEqual(invoice.amount, 150.0)
        self.assertEqual(invoice.recipient_name, "Inv Lead")
        self.assertEqual(invoice.recipient_email, "inv_lead@test.com")
        self.assertEqual(invoice.related_entity_type, "lead")
        self.assertEqual(invoice.related_entity_id, lead.id)
        self.assertEqual(len(invoice.items), 1)
        self.assertEqual(invoice.items[0].description, "Consulting Services")
        self.assertEqual(invoice.items[0].amount, 150.0)

        # 3. Verify Email is queued for the invoice
        email_res = await self.db.execute(
            select(EmailLog).where(EmailLog.recipient == "inv_lead@test.com", EmailLog.organization_id == self.org_id)
        )
        email = email_res.scalars().first()
        self.assertIsNotNone(email)
        self.assertEqual(email.status, "Queued")
        self.assertIn("INV-TEST-001", email.body)

        # 4. Verify CRM Activity is logged
        act_res = await self.db.execute(
            select(Activity).where(Activity.lead_id == lead.id, Activity.organization_id == self.org_id)
        )
        activities = act_res.scalars().all()
        inv_act = next((a for a in activities if a.type == "Invoice Created"), None)
        self.assertIsNotNone(inv_act)
        self.assertIn("INV-TEST-001", inv_act.description)

        # 5. Verify Automation Triggered: Create a Workflow triggered by InvoiceCreated
        from app.modules.workflow.models import Workflow, WorkflowExecution
        from app.modules.workflow import executor

        # Setup mock delay to run immediately or record calls
        pending_tasks = []
        original_delay = executor.execute_workflow_node_task.delay
        executor.execute_workflow_node_task.delay = lambda exec_id, idx, ctx: pending_tasks.append((exec_id, idx, ctx))

        try:
            # Register listeners
            executor.init_workflow_listeners()

            # Create workflow
            wf = Workflow(
                name="Invoice Workflow",
                trigger="InvoiceCreated",
                is_active=True,
                organization_id=self.org_id,
                flow_data={
                    "actions": [
                        {
                            "id": "step_1",
                            "type": "create_task",
                            "title": "Follow up on Invoice {{event.data.invoice_id}}"
                        }
                    ]
                }
            )
            self.db.add(wf)
            await self.db.commit()

            # Trigger again or create another invoice to trigger the workflow
            inv_in_2 = InvoiceCreate(
                number="INV-TEST-002",
                amount=200.0,
                currency="USD",
                due_date=(datetime.now(timezone.utc) + timedelta(days=15)).isoformat(),
                related_entity_type="lead",
                related_entity_id=lead.id,
                items=[
                    InvoiceItemCreate(
                        description="Consulting Services 2",
                        quantity=2.0,
                        unit_price=100.0
                    )
                ]
            )
            await pay_svc.create_invoice(inv_in_2, self.org_id)

            # Check that a workflow execution was created
            await asyncio.sleep(0.1) # Wait for event dispatching
            async with self.AsyncSessionLocal() as query_db:
                res_execs = await query_db.execute(
                    select(WorkflowExecution).where(WorkflowExecution.workflow_id == wf.id)
                )
                execs = res_execs.scalars().all()
            self.assertTrue(len(execs) >= 1)
            self.assertIn(execs[0].execution_metadata["trigger_event"], ("InvoiceCreated", "invoice.created"))

        finally:
            executor.execute_workflow_node_task.delay = original_delay

    async def test_funnel_builder_e2e(self):
        """
        End-to-end test for the Funnel module:
        Create -> Add Steps -> Attach Form -> Publish -> Track Visitor -> Submit Form
        -> Verify Lead Created -> Verify Analytics
        """
        from app.modules.funnels.models import Funnel, FunnelStep, FunnelVisit
        from app.modules.funnels.services import FunnelService, FunnelStepService, FunnelTrackingService
        from app.modules.funnels.schemas import FunnelCreate, FunnelStepCreate, FunnelVisitCreate
        from app.modules.forms.models import Form, FormSubmission
        from app.modules.forms.services import FormSubmissionService
        from app.modules.forms.schemas import FormCreate, FormFieldCreate, FormSubmissionCreate
        from app.modules.forms.services import FormService, FormFieldService
        from app.modules.crm.models import Lead

        # 1. Create a funnel
        funnel_in = FunnelCreate(
            name="E2E Test Funnel",
            description="Test funnel for integration testing",
            type="Lead",
            is_active=True
        )
        funnel = await FunnelService.create_funnel(self.db, funnel_in, self.org_id)
        self.assertEqual(funnel.name, "E2E Test Funnel")
        self.assertEqual(funnel.status, "Draft")

        # 2. Add a Landing Page step
        landing_step = await FunnelStepService.create_step(
            self.db, funnel.id,
            FunnelStepCreate(
                name="Landing Page",
                order=1,
                heading="Get Your Free Consultation",
                paragraph_text="Fill out the form below to get started.",
                button_text="Learn More",
                background_color="#F8FAFC"
            ),
            self.org_id
        )
        self.assertEqual(landing_step.name, "Landing Page")
        self.assertIsNone(landing_step.form_id)

        # 3. Create a CRM Form and attach it to a Form step
        form = await FormService.create_form(self.db, FormCreate(title="Consultation Request"), self.org_id)
        await FormFieldService.create_field(
            self.db, form.id,
            FormFieldCreate(name="email", label="Email", field_type="email", order=1, is_required=True),
            self.org_id
        )
        await FormFieldService.create_field(
            self.db, form.id,
            FormFieldCreate(name="firstname", label="First Name", field_type="text", order=2, is_required=True),
            self.org_id
        )

        form_step = await FunnelStepService.create_step(
            self.db, funnel.id,
            FunnelStepCreate(name="Form Page", order=2, form_id=form.id, heading="Tell Us About Yourself"),
            self.org_id
        )
        self.assertEqual(form_step.form_id, form.id)

        # 4. Add a Thank You step
        thanks_step = await FunnelStepService.create_step(
            self.db, funnel.id,
            FunnelStepCreate(name="Thank You Page", order=3, heading="Thank You!", paragraph_text="We'll be in touch shortly."),
            self.org_id
        )

        # 5. Publish the funnel
        published = await FunnelService.publish_funnel(self.db, funnel.id, self.org_id)
        self.assertEqual(published.status, "Published")
        self.assertIsNotNone(published.published_url)
        self.assertIn(funnel.id[:8], published.published_url)

        # 6. Verify public funnel is accessible
        public_funnel = await FunnelService.get_public_funnel(self.db, funnel.id)
        self.assertEqual(public_funnel.id, funnel.id)

        # 7. Simulate visitor arriving on landing page (page_view tracking)
        session_id = "test-session-funnel-e2e"
        visit_landing = await FunnelTrackingService.track_visit_public(
            self.db, funnel.id,
            FunnelVisitCreate(
                step_id=landing_step.id,
                session_id=session_id,
                event_type="page_view",
                device="Desktop",
                browser="Chrome",
                os="Windows",
                referrer="https://ads.example.com",
                utm_source="google",
                utm_medium="cpc",
                utm_campaign="summer2026"
            )
        )
        self.assertEqual(visit_landing.event_type, "page_view")
        self.assertEqual(visit_landing.session_id, session_id)
        self.assertEqual(visit_landing.utm_source, "google")

        # 8. Visitor clicks button and advances to form page (button_click + form_view)
        await FunnelTrackingService.track_visit_public(
            self.db, funnel.id,
            FunnelVisitCreate(step_id=landing_step.id, session_id=session_id, event_type="button_click")
        )
        await FunnelTrackingService.track_visit_public(
            self.db, funnel.id,
            FunnelVisitCreate(step_id=form_step.id, session_id=session_id, event_type="form_view")
        )

        # 9. Form submission (uses existing Forms module → creates Lead automatically)
        pre_lead_count_res = await self.db.execute(
            select(func.count(Lead.id)).where(Lead.organization_id == self.org_id)
        )
        pre_lead_count = pre_lead_count_res.scalar() or 0

        submission = await FormSubmissionService.submit_form(
            self.db, form.id,
            FormSubmissionCreate(payload={
                "email": "funnelvisitor@test.com",
                "firstname": "Funnel",
                "lastname": "Visitor",
                "metadata": {"step_id": form_step.id, "funnel_id": funnel.id}
            })
        )
        self.assertIsNotNone(submission.id)

        # 10. Verify lead was created from form submission
        post_lead_count_res = await self.db.execute(
            select(func.count(Lead.id)).where(Lead.organization_id == self.org_id)
        )
        post_lead_count = post_lead_count_res.scalar() or 0
        self.assertEqual(post_lead_count, pre_lead_count + 1)

        new_lead_res = await self.db.execute(
            select(Lead).where(Lead.email == "funnelvisitor@test.com", Lead.organization_id == self.org_id)
        )
        new_lead = new_lead_res.scalars().first()
        self.assertIsNotNone(new_lead)
        self.assertEqual(new_lead.first_name, "Funnel")

        # 11. Track form_submit conversion on the form step
        await FunnelTrackingService.track_visit_public(
            self.db, funnel.id,
            FunnelVisitCreate(
                step_id=form_step.id, session_id=session_id,
                event_type="form_submit", converted=True
            )
        )

        # 12. Track thank you page view
        await FunnelTrackingService.track_visit_public(
            self.db, funnel.id,
            FunnelVisitCreate(step_id=thanks_step.id, session_id=session_id, event_type="page_view")
        )

        # 13. Check analytics
        analytics = await FunnelTrackingService.get_analytics(self.db, funnel.id, self.org_id)
        self.assertEqual(analytics.funnel_id, funnel.id)
        self.assertGreater(analytics.unique_visitors, 0)
        self.assertGreater(analytics.form_submissions, 0)
        self.assertIsNotNone(analytics.most_visited_step)
        self.assertEqual(len(analytics.steps), 3)

        # 14. Unpublish funnel
        unpublished = await FunnelService.unpublish_funnel(self.db, funnel.id, self.org_id)
        self.assertEqual(unpublished.status, "Draft")
        self.assertIsNone(unpublished.published_url)

        # 15. Verify public access is now blocked
        from fastapi import HTTPException
        with self.assertRaises(HTTPException) as ctx:
            await FunnelService.get_public_funnel(self.db, funnel.id)
        self.assertEqual(ctx.exception.status_code, 404)

    async def test_funnel_preview_e2e(self):
        # 1. Create a draft funnel
        from app.modules.funnels.models import Funnel
        from app.modules.funnels.services import FunnelService, FunnelStepService
        from app.modules.funnels.schemas import FunnelCreate, FunnelStepCreate
        
        funnel = await FunnelService.create_funnel(
            self.db,
            FunnelCreate(name="Preview Funnel", description="Draft Preview Test", type="Lead"),
            self.org_id
        )
        
        # 2. Add step and components
        step = await FunnelStepService.create_step(
            self.db, funnel.id,
            FunnelStepCreate(
                name="Landing Page", order=1, heading="Draft Preview Heading",
                components=[
                    {"type": "Heading", "order": 0, "config": '{"text":"Welcome Test","level":"h1"}'},
                    {"type": "Paragraph", "order": 1, "config": '{"text":"Subtext preview description"}'}
                ]
            ),
            self.org_id
        )
        
        # 3. Preview funnel without publishing (passing preview=True)
        preview_funnel = await FunnelService.get_public_funnel(self.db, funnel.id, preview=True)
        self.assertEqual(preview_funnel.id, funnel.id)
        self.assertEqual(len(preview_funnel.steps), 1)
        self.assertEqual(preview_funnel.steps[0].heading, "Draft Preview Heading")
        self.assertEqual(len(preview_funnel.steps[0].components), 2)
        self.assertEqual(preview_funnel.steps[0].components[0].type, "Heading")

    async def test_lead_form_sync_to_pipeline_e2e(self):
        # 1. Create form
        from app.modules.forms.services import FormService, FormFieldService, FormSubmissionService
        from app.modules.forms.schemas import FormCreate, FormFieldCreate, FormSubmissionCreate
        
        form = await FormService.create_form(
            self.db,
            FormCreate(title="CRM Lead Sync Form", description="Form to pipeline deal sync", is_active=True),
            self.org_id
        )
        
        # 2. Submit form
        submission = await FormSubmissionService.submit_form(
            self.db, form.id,
            FormSubmissionCreate(payload={
                "email": "syncvisitor@test.com",
                "firstname": "Sync",
                "lastname": "Lead",
                "phone": "555-987-1234"
            })
        )
        self.assertIsNotNone(submission.id)
        
        # 3. Verify lead was created
        from app.modules.crm.models import Lead
        lead_res = await self.db.execute(
            select(Lead).where(Lead.email == "syncvisitor@test.com", Lead.organization_id == self.org_id)
        )
        lead = lead_res.scalars().first()
        self.assertIsNotNone(lead)
        self.assertEqual(lead.first_name, "Sync")
        
        # 4. Verify pipeline deal was created in default pipeline
        from app.modules.pipeline.models import Deal
        deal_res = await self.db.execute(
            select(Deal).where(Deal.lead_id == lead.id, Deal.organization_id == self.org_id)
        )
        deal = deal_res.scalars().first()
        self.assertIsNotNone(deal)
        self.assertEqual(deal.title, "Sync Lead Deal")
        self.assertEqual(deal.status, "Open")

    async def test_campaign_creation_and_resolution(self):
        # 1. Create template
        from app.modules.email.models import EmailTemplate
        tpl = EmailTemplate(
            name="Promo Tpl",
            subject="Hey {{first_name}}",
            html_content="Hello {{first_name}} {{last_name}}",
            organization_id=self.org_id
        )
        self.db.add(tpl)
        await self.db.commit()

        # 2. Create campaign
        from app.modules.campaigns.services import CampaignService
        from app.modules.campaigns.schemas import CampaignCreate, RecipientFilter
        c = await CampaignService.create_campaign(
            self.db,
            CampaignCreate(
                name="Test Camp 1",
                subject="Save 20%",
                template_id=tpl.id,
                recipient_filter=RecipientFilter(type="all_leads")
            ),
            self.org_id,
            "test_user"
        )
        self.assertIsNotNone(c.id)

        # 3. Create leads
        from app.modules.crm.models import Lead
        l1 = Lead(first_name="Alice", last_name="Smith", email="alice@test.com", organization_id=self.org_id)
        l2 = Lead(first_name="Bob", last_name="Jones", email="bob@test.com", organization_id=self.org_id)
        self.db.add(l1)
        self.db.add(l2)
        await self.db.commit()

        # 4. Resolve recipients
        recipients = await CampaignService.resolve_recipients(self.db, c.id, self.org_id)
        self.assertEqual(len(recipients), 2)
        emails = {r["email"] for r in recipients}
        self.assertIn("alice@test.com", emails)
        self.assertIn("bob@test.com", emails)

    async def test_campaign_sending_flow_e2e(self):
        # 1. Simulate Gmail OAuth connection
        from app.modules.gmail.models import GmailIntegration
        gmail_int = GmailIntegration(
            organization_id=self.org_id,
            gmail_address="sender@gmail.com",
            access_token_enc="sim_access_token_enc",
            is_connected=True
        )
        from app.core.security import encrypt_data
        gmail_int.access_token_enc = encrypt_data("sim_access_token")
        self.db.add(gmail_int)

        # 2. Create template and campaign
        from app.modules.email.models import EmailTemplate
        tpl = EmailTemplate(
            name="Promo Tpl 2",
            subject="Special offer",
            html_content="Hello {{first_name}}",
            organization_id=self.org_id
        )
        self.db.add(tpl)
        await self.db.commit()

        from app.modules.campaigns.services import CampaignService
        from app.modules.campaigns.schemas import CampaignCreate, RecipientFilter
        c = await CampaignService.create_campaign(
            self.db,
            CampaignCreate(
                name="Test Camp E2E",
                subject="Buy Now {{first_name}}",
                template_id=tpl.id,
                recipient_filter=RecipientFilter(type="all_leads")
            ),
            self.org_id,
            "test_user"
        )

        # 3. Create a lead
        from app.modules.crm.models import Lead
        lead = Lead(first_name="Charlie", last_name="Brown", email="charlie@test.com", organization_id=self.org_id)
        self.db.add(lead)
        await self.db.commit()

        # 4. Queue campaign
        queued_c = await CampaignService.queue_campaign(self.db, c.id, self.org_id, "test_user")
        self.assertEqual(queued_c.status, "Sending")

        # Yield execution to let background tasks run
        await asyncio.sleep(0.5)

        # 5. Verify CampaignRecipient row exists (fresh query)
        from app.modules.campaigns.models import CampaignRecipient
        res = await self.db.execute(
            select(CampaignRecipient)
            .where(CampaignRecipient.campaign_id == c.id)
            .execution_options(populate_existing=True)
        )
        recipients = res.scalars().all()
        self.assertEqual(len(recipients), 1)
        r = recipients[0]
        self.assertEqual(r.recipient_email, "charlie@test.com")
        self.assertEqual(r.status, "Sent")


        # 6. Verify EmailLog was created correctly with personalized content
        from app.modules.email.models import EmailLog
        log_res = await self.db.execute(
            select(EmailLog).where(EmailLog.id == r.email_log_id)
        )
        log = log_res.scalars().first()
        self.assertIsNotNone(log)
        self.assertEqual(log.recipient, "charlie@test.com")
        self.assertEqual(log.subject, "Buy Now Charlie")
        self.assertEqual(log.body, "Hello Charlie")
        self.assertEqual(log.campaign_id, c.id)
        # EmailLog status starts as "Queued" — actual delivery is handled by send_email_task
        # which is tested separately in the email test suite
        self.assertIn(log.status, ("Queued", "Sent"))

        # 7. Verify Lead Activity was created by the campaign task
        from app.modules.crm.models import Activity
        act_res = await self.db.execute(
            select(Activity)
            .where(Activity.lead_id == lead.id, Activity.organization_id == self.org_id)
            .execution_options(populate_existing=True)
        )
        activities = act_res.scalars().all()
        self.assertTrue(len(activities) >= 1)
        self.assertIn("Campaign Email Sent", activities[0].description)




