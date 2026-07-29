from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from typing import List, Optional
from app.modules.integrations.models import Integration
from app.modules.integrations.schemas import IntegrationCreate, IntegrationToggle

# Default integrations to seed when org requests them
CATALOG = [
    {"name": "Stripe", "slug": "stripe", "description": "Payment processing & subscriptions", "icon_url": "https://cdn.simpleicons.org/stripe/635BFF"},
    {"name": "Slack", "slug": "slack", "description": "Real-time team notifications", "icon_url": "https://cdn.simpleicons.org/slack/4A154B"},
    {"name": "Google Calendar", "slug": "google-calendar", "description": "Sync appointments to Google Calendar", "icon_url": "https://cdn.simpleicons.org/googlecalendar/4285F4"},
    {"name": "HubSpot", "slug": "hubspot", "description": "Sync contacts from HubSpot CRM", "icon_url": "https://cdn.simpleicons.org/hubspot/FF7A59"},
    {"name": "Mailchimp", "slug": "mailchimp", "description": "Email marketing and audiences", "icon_url": "https://cdn.simpleicons.org/mailchimp/FFE01B"},
    {"name": "Twilio", "slug": "twilio", "description": "SMS and voice communications", "icon_url": "https://cdn.simpleicons.org/twilio/F22F46"},
    {"name": "Zapier", "slug": "zapier", "description": "Connect 5000+ apps with automations", "icon_url": "https://cdn.simpleicons.org/zapier/FF4A00"},
    {"name": "Shopify", "slug": "shopify", "description": "Sync e-commerce orders and customers", "icon_url": "https://cdn.simpleicons.org/shopify/96BF48"},
]

class IntegrationService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_integrations(self, organization_id: str) -> List[Integration]:
        result = await self.db.execute(
            select(Integration).where(Integration.organization_id == organization_id)
        )
        existing = result.scalars().all()
        
        # Seed catalog if first time
        if not existing:
            for item in CATALOG:
                integration = Integration(
                    name=item["name"],
                    slug=item["slug"],
                    description=item["description"],
                    icon_url=item["icon_url"],
                    is_connected=False,
                    organization_id=organization_id
                )
                self.db.add(integration)
            await self.db.commit()
            result = await self.db.execute(
                select(Integration).where(Integration.organization_id == organization_id)
            )
            existing = result.scalars().all()
        
        # Check GmailAccount status and sync Google integration status
        try:
            from app.modules.gmail.models import GmailAccount
            res_gm = await self.db.execute(select(GmailAccount).where(GmailAccount.organization_id == organization_id))
            gm_rec = res_gm.scalars().first()
            is_google_connected = bool(gm_rec and gm_rec.is_connected)

            updated_any = False
            for item in existing:
                if item.slug in ("google-calendar", "gmail") or "google" in item.name.lower():
                    if item.is_connected != is_google_connected:
                        item.is_connected = is_google_connected
                        updated_any = True
            
            if updated_any:
                await self.db.commit()
        except Exception:
            pass

        return existing

    async def toggle_integration(self, integration_id: str, toggle: IntegrationToggle, organization_id: str) -> Optional[Integration]:
        result = await self.db.execute(
            select(Integration).where(Integration.id == integration_id, Integration.organization_id == organization_id)
        )
        integration = result.scalars().first()
        if not integration:
            return None
        integration.is_connected = toggle.is_connected
        await self.db.commit()
        await self.db.refresh(integration)
        return integration
