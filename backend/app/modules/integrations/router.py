from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List

from app.db.session import get_db
from app.core.security import get_current_user
from app.modules.integrations.schemas import IntegrationResponse, IntegrationToggle
from app.modules.integrations.services import IntegrationService

router = APIRouter()

def get_integration_service(db: AsyncSession = Depends(get_db)) -> IntegrationService:
    return IntegrationService(db)

@router.get("/", response_model=List[IntegrationResponse])
async def list_integrations(
    integration_service: IntegrationService = Depends(get_integration_service),
    current_user: dict = Depends(get_current_user)
):
    """List all available integrations for the organization."""
    return await integration_service.get_integrations(current_user["org"])

@router.patch("/{integration_id}/toggle", response_model=IntegrationResponse)
async def toggle_integration(
    integration_id: str,
    toggle: IntegrationToggle,
    integration_service: IntegrationService = Depends(get_integration_service),
    current_user: dict = Depends(get_current_user)
):
    """Toggle an integration on or off."""
    integration = await integration_service.toggle_integration(integration_id, toggle, current_user["org"])
    if not integration:
        raise HTTPException(status_code=404, detail="Integration not found")
    return integration

@router.post("/webhook/{org_id}")
async def receive_custom_webhook(
    org_id: str,
    payload: dict,
    db: AsyncSession = Depends(get_db)
):
    """Receive custom incoming webhooks to trigger workflow automations."""
    from app.core.events import publish, GenericEvent
    await publish("webhook.received", GenericEvent(
        event_name="webhook.received",
        organization_id=org_id,
        trigger_name="webhook.received",
        data=payload
    ))
    return {"status": "success"}
