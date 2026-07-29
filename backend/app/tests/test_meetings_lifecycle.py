import unittest
import asyncio
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy import select, text
from fastapi import HTTPException
from datetime import datetime, timezone, timedelta

from app.db.base import Base
from app.modules.auth.models import User
from app.modules.team.models import TeamMember
from app.modules.calendar.models import Appointment
from app.modules.calendar.schemas import AppointmentCreate, AppointmentUpdate
from app.modules.calendar.services import CalendarService
from app.modules.calendar.lifecycle import MeetingLifecycleEngine
from app.modules.crm.models import Lead, Activity, Company
from app.modules.pipeline.models import Deal, Stage
from app.modules.notifications.models import Notification
from app.modules.email.models import EmailTemplate, EmailLog
from app.modules.inbox.models import Message

DATABASE_URL = "sqlite+aiosqlite:///test_meetings_lifecycle.db"

class TestMeetingsLifecycle(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        import os
        for suffix in ["", "-wal", "-shm"]:
            fpath = f"test_meetings_lifecycle.db{suffix}"
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

    async def test_meeting_lifecycle_and_workflows(self):
        org_id = "org_test_1"
        other_org_id = "org_test_2"
        
        # 1. Setup seed data
        creator = User(id="user_creator", email="creator@example.com", hashed_password="mockedhash", is_active=True, organization_id=org_id)
        self.db.add(creator)
        
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
            department="Marketing",
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
        lead_other_org = Lead(
            id="lead_other",
            first_name="Dave",
            last_name="Foreign",
            email="foreign@example.com",
            lead_score=10,
            lead_source="Outbound",
            status="New",
            organization_id=other_org_id
        )
        self.db.add_all([lead1, lead_other_org])
        await self.db.commit()

        service = CalendarService(self.db)

        # 2. Seed Email templates
        await service.seed_meeting_templates(self.db, org_id)
        
        # Verify templates exist
        res_tmpl = await self.db.execute(select(EmailTemplate).where(EmailTemplate.organization_id == org_id))
        templates = res_tmpl.scalars().all()
        self.assertTrue(len(templates) >= 7)

        # 3. Test Validation Checks (Cross-Tenant & Active Assignee)
        # Inactive team member
        appt_err1 = AppointmentCreate(
            title="Meeting with Bob",
            start_time=datetime.now() + timedelta(days=1),
            end_time=datetime.now() + timedelta(days=1, hours=1),
            assigned_to_id="member_inactive"
        )
        with self.assertRaises(HTTPException) as cm:
            await service.create_appointment(appt_err1, org_id, "user_creator")
        self.assertEqual(cm.exception.status_code, 400)
        self.assertIn("inactive", str(cm.exception.detail).lower())

        # Cross-tenant team member
        appt_err2 = AppointmentCreate(
            title="Meeting with Charlie",
            start_time=datetime.now() + timedelta(days=1),
            end_time=datetime.now() + timedelta(days=1, hours=1),
            assigned_to_id="member_other"
        )
        with self.assertRaises(HTTPException) as cm:
            await service.create_appointment(appt_err2, org_id, "user_creator")
        self.assertEqual(cm.exception.status_code, 404)

        # Cross-tenant lead
        appt_err3 = AppointmentCreate(
            title="Meeting with Charlie",
            start_time=datetime.now() + timedelta(days=1),
            end_time=datetime.now() + timedelta(days=1, hours=1),
            assigned_to_id="member_sales",
            lead_id="lead_other"
        )
        with self.assertRaises(HTTPException) as cm:
            await service.create_appointment(appt_err3, org_id, "user_creator")
        self.assertEqual(cm.exception.status_code, 400)
        self.assertIn("lead", str(cm.exception.detail).lower())

        # 4. Successful Meeting Creation
        start_dt = datetime.now() + timedelta(days=2)
        end_dt = start_dt + timedelta(hours=1)
        appt_ok = AppointmentCreate(
            title="Sales Pitch Demo",
            description="Discuss GrowthOS pricing structures.",
            start_time=start_dt,
            end_time=end_dt,
            location="https://zoom.us/j/123",
            assigned_to_id="member_sales",
            lead_id="lead_1"
        )
        meeting = await service.create_appointment(appt_ok, org_id, "user_creator")
        self.assertEqual(meeting.status, "Scheduled")
        self.assertEqual(meeting.assigned_to_id, "member_sales")
        self.assertEqual(meeting.lead_id, "lead_1")

        # Verify Scheduled transition side effects:
        # A. Timeline activity is created
        res_act = await self.db.execute(
            select(Activity).where(Activity.appointment_id == meeting.id, Activity.type == "Meeting Scheduled")
        )
        activity = res_act.scalars().first()
        self.assertIsNotNone(activity)
        self.assertEqual(activity.lead_id, "lead_1")

        # B. Notification created for assigned member
        res_notif = await self.db.execute(
            select(Notification).where(Notification.related_entity_id == meeting.id, Notification.user_id == "user_alice")
        )
        notif = res_notif.scalars().first()
        self.assertIsNotNone(notif)
        self.assertEqual(notif.title, "New Meeting Assigned")

        # C. Outgoing Assignment email is queued to member and linked to internal inbox
        res_email = await self.db.execute(
            select(EmailLog).where(EmailLog.recipient == "alice@example.com", EmailLog.organization_id == org_id)
        )
        email_log = res_email.scalars().first()
        self.assertIsNotNone(email_log)
        self.assertIn("Sales Pitch Demo", email_log.subject)

        res_msg = await self.db.execute(
            select(Message).where(Message.appointment_id == meeting.id, Message.recipient_id == "user_alice")
        )
        msg = res_msg.scalars().first()
        self.assertIsNotNone(msg)
        self.assertEqual(msg.message_type, "Internal")
        self.assertEqual(msg.direction, "Outgoing")

        # 5. Transition to Confirmed with Custom Message
        await service.update_appointment(
            meeting.id,
            AppointmentUpdate(status="Confirmed", custom_message="Please join Zoom 5 minutes early!"),
            org_id
        )
        
        # Refresh from DB
        await self.db.refresh(meeting)
        self.assertEqual(meeting.status, "Confirmed")

        # A. Confirmation timeline activity is created
        res_act = await self.db.execute(
            select(Activity).where(Activity.appointment_id == meeting.id, Activity.type == "Meeting Confirmed")
        )
        self.assertIsNotNone(res_act.scalars().first())

        # B. Confirmation emails are sent to both assignee and lead
        res_email_sales = await self.db.execute(
            select(EmailLog).where(
                EmailLog.recipient == "alice@example.com",
                EmailLog.subject.like("%Confirmed%")
            )
        )
        self.assertIsNotNone(res_email_sales.scalars().first())

        res_email_lead = await self.db.execute(
            select(EmailLog).where(
                EmailLog.recipient == "john@example.com",
                EmailLog.subject.like("%Confirmed%")
            )
        )
        lead_email = res_email_lead.scalars().first()
        self.assertIsNotNone(lead_email)
        self.assertIn("Please join Zoom 5 minutes early!", lead_email.body)

        # 6. Automatic Reschedule Trigger
        new_start = datetime.now() + timedelta(days=3)
        new_end = new_start + timedelta(hours=1)
        await service.update_appointment(
            meeting.id,
            AppointmentUpdate(start_time=new_start, end_time=new_end, custom_message="Time shifted to accommodate timezone change."),
            org_id
        )

        await self.db.refresh(meeting)
        self.assertEqual(meeting.status, "Rescheduled")

        # Rescheduled emails sent
        res_email_resched = await self.db.execute(
            select(EmailLog).where(
                EmailLog.recipient == "john@example.com",
                EmailLog.subject.like("%Rescheduled%")
            )
        )
        resched_email = res_email_resched.scalars().first()
        self.assertIsNotNone(resched_email)
        self.assertIn("timezone change", resched_email.body)

        # 7. Transition to Completed
        await service.update_appointment(
            meeting.id,
            AppointmentUpdate(status="Completed", custom_message="Demo went well. Follow up scheduled next week."),
            org_id
        )
        await self.db.refresh(meeting)
        self.assertEqual(meeting.status, "Completed")

        # 8. Test Analytics calculations
        analytics = await service.get_meeting_analytics(org_id)
        self.assertEqual(analytics["completed_meetings"], 1)
        self.assertEqual(analytics["cancelled_meetings"], 0)
        self.assertEqual(analytics["average_completion_rate"], 1.0)
        self.assertEqual(analytics["by_department"].get("Sales"), 1)
        self.assertEqual(analytics["by_team_member"].get("Alice Sales"), 1)
        self.assertEqual(analytics["by_status"].get("Completed"), 1)
        self.assertEqual(analytics["by_lead_source"].get("Website"), 1)
