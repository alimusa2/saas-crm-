import unittest
import asyncio
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy import select, text, func
from fastapi import HTTPException
from datetime import datetime, timezone

from app.db.base import Base
from app.modules.auth.models import User
from app.modules.crm.models import Lead, Contact, Company, Activity
from app.modules.crm.schemas import LeadCreate, ContactCreate
from app.modules.crm.services import CRMService
from app.modules.forms.models import Form, FormSubmission
from app.modules.forms.schemas import FormSubmissionCreate
from app.modules.forms.services import FormSubmissionService
from app.modules.inbox.models import Message
from app.modules.campaigns.models import Campaign
from app.modules.campaigns.services import CampaignService

DATABASE_URL = "sqlite+aiosqlite:///test_duplicates.db"

class TestDuplicatesSystem(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        import os
        for suffix in ["", "-wal", "-shm"]:
            fpath = f"test_duplicates.db{suffix}"
            if os.path.exists(fpath):
                try:
                    os.remove(fpath)
                except Exception:
                    pass

        self.engine = create_async_engine(DATABASE_URL, echo=False)
        async with self.engine.begin() as conn:
            await conn.execute(text("PRAGMA journal_mode=WAL"))
            await conn.run_sync(Base.metadata.create_all)

            # Alter message table to ensure columns exist (mirror lifespan startup)
            res_msg = await conn.execute(text("PRAGMA table_info(message)"))
            cols_msg = [r[1] for r in res_msg.fetchall()]
            if "is_ambiguous" not in cols_msg:
                await conn.execute(text("ALTER TABLE message ADD COLUMN is_ambiguous BOOLEAN DEFAULT 0"))

        self.AsyncSessionLocal = async_sessionmaker(
            self.engine, class_=AsyncSession, expire_on_commit=False
        )
        self.db = self.AsyncSessionLocal()
        self.crm_service = CRMService(self.db)

    async def asyncTearDown(self):
        await self.db.close()
        await self.engine.dispose()

    async def test_lead_uniqueness_and_override(self):
        org_id = "org_a"
        other_org_id = "org_b"

        # Create Admin and User
        admin = User(id="usr_admin", email="admin@test.com", hashed_password="pw", is_active=True, is_superuser=True, organization_id=org_id)
        user = User(id="usr_user", email="user@test.com", hashed_password="pw", is_active=True, is_superuser=False, organization_id=org_id)
        self.db.add_all([admin, user])
        await self.db.commit()

        # 1. Create first lead
        l_in1 = LeadCreate(first_name="John", last_name="Doe", email="john@gmail.com", status="New", priority="Normal")
        lead1 = await self.crm_service.create_lead(l_in1, org_id, owner_id=user.id)
        self.assertIsNotNone(lead1.id)

        # 2. Attempt duplicate lead in same org -> expect 409
        l_dup = LeadCreate(first_name="Johnny", last_name="Doe", email="  JOHN@gmail.com  ", status="Contacted", priority="High")
        with self.assertRaises(HTTPException) as context:
            await self.crm_service.create_lead(l_dup, org_id, owner_id=user.id)
        self.assertEqual(context.exception.status_code, 409)

        # 3. Create duplicate in different org -> expect success
        lead_other_org = await self.crm_service.create_lead(l_dup, other_org_id, owner_id=user.id)
        self.assertIsNotNone(lead_other_org.id)

        # 4. Non-admin override duplicate -> expect 403
        with self.assertRaises(HTTPException) as context:
            await self.crm_service.create_lead(l_dup, org_id, owner_id=user.id, ignore_duplicates=True)
        self.assertEqual(context.exception.status_code, 403)

        # 5. Admin override duplicate -> expect success
        lead_dup_admin = await self.crm_service.create_lead(l_dup, org_id, owner_id=admin.id, ignore_duplicates=True)
        self.assertIsNotNone(lead_dup_admin.id)

        # 6. Archive lead -> expect duplicate creation to succeed without override
        lead1.status = "Archived"
        await self.db.commit()
        lead_after_arch = await self.crm_service.create_lead(l_dup, org_id, owner_id=user.id)
        self.assertIsNotNone(lead_after_arch.id)

    async def test_contact_uniqueness_and_override(self):
        org_id = "org_a"
        admin = User(id="usr_admin_c", email="admin_c@test.com", hashed_password="pw", is_active=True, is_superuser=True, organization_id=org_id)
        user = User(id="usr_user_c", email="user_c@test.com", hashed_password="pw", is_active=True, is_superuser=False, organization_id=org_id)
        self.db.add_all([admin, user])
        await self.db.commit()

        # 1. Create first Contact
        c_in = ContactCreate(first_name="Alice", last_name="Smith", email="alice@smith.com")
        c1 = await self.crm_service.create_contact(c_in, org_id)
        self.assertIsNotNone(c1.id)

        # 2. Duplicate Contact -> 409
        c_dup = ContactCreate(first_name="Alicia", last_name="Smith", email="alice@smith.com")
        with self.assertRaises(HTTPException) as context:
            await self.crm_service.create_contact(c_dup, org_id)
        self.assertEqual(context.exception.status_code, 409)

        # 3. Non-admin override -> 403
        with self.assertRaises(HTTPException) as context:
            await self.crm_service.create_contact(c_dup, org_id, ignore_duplicates=True, current_user_id=user.id)
        self.assertEqual(context.exception.status_code, 403)

        # 4. Admin override -> success
        c_dup_admin = await self.crm_service.create_contact(c_dup, org_id, ignore_duplicates=True, current_user_id=admin.id)
        self.assertIsNotNone(c_dup_admin.id)

    async def test_form_submission_duplicate_updates(self):
        org_id = "org_form"
        # Seed user/owner
        owner = User(id="usr_owner", email="owner@test.com", hashed_password="pw", is_active=True, organization_id=org_id)
        self.db.add(owner)
        await self.db.commit()

        # Seed lead with owner
        lead = Lead(id="existing_lead_form", first_name="Jane", last_name="Form", email="jane@form.com", phone="111-222", status="New", owner_id=owner.id, organization_id=org_id)
        form = Form(id="test_form_id", title="Contact Us Form", organization_id=org_id, is_active=True)
        self.db.add_all([lead, form])
        await self.db.commit()

        # Submit form with duplicate email
        payload = {
            "email": "jane@form.com",
            "phone": "555-666",
            "first_name": "Jane Updated",
            "last_name": "Form Updated",
            "metadata": {"step_id": "step_1"} # Funnel Submission indicator
        }
        submission = await FormSubmissionService.submit_form(self.db, "test_form_id", FormSubmissionCreate(payload=payload))
        self.assertIsNotNone(submission)
        
        # Verify Lead is updated, not duplicated
        await self.db.refresh(lead)
        self.assertEqual(lead.first_name, "Jane Updated")
        self.assertEqual(lead.last_name, "Form Updated")
        self.assertEqual(lead.phone, "555-666")

        # Verify CRM Activity is logged with correct desc
        res_act = await self.db.execute(select(Activity).where(Activity.lead_id == lead.id))
        activities = res_act.scalars().all()
        self.assertTrue(any(a.description == "Lead updated via Funnel" for a in activities))

    async def test_inbox_ambiguous_matching_and_manual_linking(self):
        org_id = "org_inbox"
        
        # Seed multiple leads with same email
        lead1 = Lead(id="l1", first_name="Dup1", last_name="Test", email="dup@test.com", status="New", organization_id=org_id)
        lead2 = Lead(id="l2", first_name="Dup2", last_name="Test", email="dup@test.com", status="Contacted", organization_id=org_id)
        self.db.add_all([lead1, lead2])
        await self.db.commit()

        # Simulate Gmail api sync duplicate check
        from sqlalchemy import func
        sender_email = "dup@test.com"
        r_lds = await self.db.execute(
            select(Lead).where(
                Lead.organization_id == org_id,
                func.lower(Lead.email) == sender_email.strip().lower(),
                func.lower(Lead.status) != "archived"
            )
        )
        leads = r_lds.scalars().all()
        self.assertEqual(len(leads), 2)

        # It is ambiguous, so lead_id is None, is_ambiguous is True
        msg = Message(
            subject="Inquiry",
            body="Is this still available?",
            sender_id="system",
            lead_id=None,
            contact_id=None,
            is_read=False,
            message_type="Email",
            direction="Incoming",
            delivery_status="Delivered",
            sender_email=sender_email,
            recipient_email="info@crm.com",
            organization_id=org_id,
            is_ambiguous=True
        )
        self.db.add(msg)
        await self.db.commit()
        await self.db.refresh(msg)
        self.assertTrue(msg.is_ambiguous)

        # Manually link message to lead2
        msg.lead_id = lead2.id
        msg.is_ambiguous = False
        await self.db.commit()
        await self.db.refresh(msg)

        self.assertFalse(msg.is_ambiguous)
        self.assertEqual(msg.lead_id, "l2")

    async def test_campaign_recipient_pre_send_deduplication(self):
        org_id = "org_campaign"
        
        # Seed campaign
        campaign = Campaign(
            id="camp_1",
            name="Promo 1",
            subject="Check out our deals",
            recipient_filter={"type": "all_leads", "value": None},
            status="Draft",
            organization_id=org_id
        )
        # Seed duplicate leads (same email)
        l1 = Lead(id="c_l1", first_name="A", last_name="Dup", email="dup_camp@test.com", status="New", organization_id=org_id)
        l2 = Lead(id="c_l2", first_name="B", last_name="Dup", email="dup_camp@test.com", status="New", organization_id=org_id)
        l3 = Lead(id="c_l3", first_name="C", last_name="Unique", email="unique_camp@test.com", status="New", organization_id=org_id)
        self.db.add_all([campaign, l1, l2, l3])
        await self.db.commit()

        # Call resolve_recipients
        recipients, duplicate_count = await CampaignService.resolve_recipients(
            self.db, campaign.id, org_id, return_duplicates=True
        )
        
        # We expect 2 unique recipients, 1 duplicate count
        self.assertEqual(len(recipients), 2)
        self.assertEqual(duplicate_count, 1)
        self.assertEqual(recipients[0]["email"], "dup_camp@test.com")
        self.assertEqual(recipients[1]["email"], "unique_camp@test.com")
