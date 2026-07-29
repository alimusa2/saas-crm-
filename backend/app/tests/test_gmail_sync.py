"""
Unit & Integration Tests for Phase 1 Gmail Incoming Synchronization
"""
import unittest
import asyncio
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy import select, text

from app.db.base import Base
from app.modules.auth.models import User
from app.modules.crm.models import Lead, Contact, Company, Activity
from app.modules.gmail.models import GmailIntegration, GmailSyncLog
from app.modules.gmail.sync_service import GmailSyncService
from app.modules.inbox.models import Message
from app.modules.notifications.models import Notification

DATABASE_URL = "sqlite+aiosqlite:///test_gmail_sync.db"


class TestGmailSyncPhase1(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        import os
        for suffix in ["", "-wal", "-shm"]:
            fpath = f"test_gmail_sync.db{suffix}"
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
        self.org_id = "test-gmail-org-123"

    async def asyncTearDown(self):
        await self.db.close()
        await self.engine.dispose()

    async def test_email_matching_hierarchy(self):
        """Verify matching hierarchy: Contact -> Lead -> Company -> Unknown (No auto Lead creation)"""
        # Create test Contact, Lead, Company
        contact = Contact(
            first_name="Jane",
            last_name="Contact",
            email="contact@example.com",
            organization_id=self.org_id
        )
        lead = Lead(
            first_name="John",
            last_name="Lead",
            email="lead@example.com",
            organization_id=self.org_id
        )
        company = Company(
            name="Acme Corp",
            website="https://acme-inc-corp.com",
            organization_id=self.org_id
        )
        self.db.add_all([contact, lead, company])
        await self.db.commit()

        sync_svc = GmailSyncService(self.db)

        # 1. Match Contact
        l_id, c_id, comp_id, is_unk, is_amb, owner = await sync_svc.match_email_address(self.org_id, "contact@example.com")
        self.assertEqual(c_id, contact.id)
        self.assertIsNone(l_id)
        self.assertFalse(is_unk)

        # 2. Match Lead
        l_id, c_id, comp_id, is_unk, is_amb, owner = await sync_svc.match_email_address(self.org_id, "lead@example.com")
        self.assertEqual(l_id, lead.id)
        self.assertIsNone(c_id)
        self.assertFalse(is_unk)

        # 3. Match Company
        l_id, c_id, comp_id, is_unk, is_amb, owner = await sync_svc.match_email_address(self.org_id, "info@acme-inc-corp.com")
        self.assertEqual(comp_id, company.id)
        self.assertIsNone(l_id)
        self.assertIsNone(c_id)
        self.assertFalse(is_unk)

        # 4. Unknown Sender (Should NOT auto-create lead)
        l_id, c_id, comp_id, is_unk, is_amb, owner = await sync_svc.match_email_address(self.org_id, "stranger@unknown-domain.com")
        self.assertIsNone(l_id)
        self.assertIsNone(c_id)
        self.assertTrue(is_unk)

        # Verify no Lead was auto created for stranger
        check_lead = await self.db.execute(select(Lead).where(Lead.email == "stranger@unknown-domain.com"))
        self.assertIsNone(check_lead.scalars().first())

    async def test_simulation_sync_and_deduplication(self):
        """Verify incremental sync, deduplication, and status log recording"""
        from app.modules.gmail.services import _encrypt
        integration = GmailIntegration(
            organization_id=self.org_id,
            gmail_address="user@demo-growthos.com",
            is_connected=True,
            access_token_enc=_encrypt("sim_access_token"),
        )
        self.db.add(integration)
        await self.db.commit()


        sync_svc = GmailSyncService(self.db)
        
        # Initial sync
        summary1 = await sync_svc.sync_mailbox(integration)
        self.assertIn("1 sample incoming email created", summary1)
        self.assertEqual(integration.sync_status, "Success")
        self.assertIsNotNone(integration.last_synced_at)

        # Verify Inbox message created with unknown contact flag
        res_msg = await self.db.execute(select(Message).where(Message.organization_id == self.org_id))
        messages = list(res_msg.scalars().all())
        self.assertGreaterEqual(len(messages), 1)
        inc_msg = messages[0]
        self.assertEqual(inc_msg.direction, "Incoming")
        self.assertEqual(inc_msg.gmail_thread_id, "sim_thread_1001")
        self.assertIsNotNone(inc_msg.attachments_metadata)

        # Second sync (Should skip previously imported messages)
        summary2 = await sync_svc.sync_mailbox(integration)
        self.assertIn("Up to date", summary2)

        # Check sync logs recorded
        res_logs = await self.db.execute(select(GmailSyncLog).where(GmailSyncLog.organization_id == self.org_id))
        logs = list(res_logs.scalars().all())
        self.assertEqual(len(logs), 2)
        self.assertEqual(logs[0].status, "Success")
