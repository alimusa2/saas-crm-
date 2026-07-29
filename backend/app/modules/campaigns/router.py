from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional

from app.db.session import get_db
from app.modules.auth.dependencies import get_current_active_user
from app.modules.auth.models import User
from app.modules.campaigns.schemas import (
    CampaignCreate, CampaignUpdate, CampaignResponse,
    CampaignRecipientResponse, CampaignReviewResponse,
    CampaignQueueRequest, CampaignAnalyticsResponse, RecipientPreview
)
from app.modules.campaigns.services import CampaignService

router = APIRouter()


# ─── Campaign CRUD ────────────────────────────────────────────────────────────

@router.get("", response_model=List[CampaignResponse])
async def list_campaigns(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    return await CampaignService.get_campaigns(db, current_user.organization_id)


@router.post("", response_model=CampaignResponse, status_code=201)
async def create_campaign(
    obj_in: CampaignCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    return await CampaignService.create_campaign(db, obj_in, current_user.organization_id, current_user.id)


@router.get("/{campaign_id}", response_model=CampaignResponse)
async def get_campaign(
    campaign_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    return await CampaignService.get_campaign(db, campaign_id, current_user.organization_id)


@router.put("/{campaign_id}", response_model=CampaignResponse)
async def update_campaign(
    campaign_id: str,
    obj_in: CampaignUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    return await CampaignService.update_campaign(db, campaign_id, obj_in, current_user.organization_id)


@router.delete("/{campaign_id}", status_code=204)
async def delete_campaign(
    campaign_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    await CampaignService.delete_campaign(db, campaign_id, current_user.organization_id)


# ─── Review (pre-send validation) ────────────────────────────────────────────

@router.get("/{campaign_id}/review", response_model=CampaignReviewResponse)
async def get_campaign_review(
    campaign_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Returns a full pre-send review: recipient count, warnings, Gmail status."""
    return await CampaignService.get_review(db, campaign_id, current_user.organization_id)


# ─── Queue (send) ─────────────────────────────────────────────────────────────

@router.post("/{campaign_id}/queue", response_model=CampaignResponse)
async def queue_campaign(
    campaign_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Transitions the campaign from Draft/Scheduled → Sending.
    Creates one CampaignRecipient per unique email, then dispatches
    send_campaign_recipient_task for each. Never sends synchronously.
    """
    return await CampaignService.queue_campaign(
        db, campaign_id, current_user.organization_id, current_user.id
    )


# ─── Cancel ──────────────────────────────────────────────────────────────────

@router.post("/{campaign_id}/cancel", response_model=CampaignResponse)
async def cancel_campaign(
    campaign_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    return await CampaignService.cancel_campaign(db, campaign_id, current_user.organization_id)


# ─── Resume ───────────────────────────────────────────────────────────────────

@router.post("/{campaign_id}/resume")
async def resume_campaign(
    campaign_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Resume a Sending campaign after a server crash or worker restart.
    Re-dispatches tasks for all recipients still in Queued/Processing status.
    Already-sent recipients are never re-sent (idempotency guard inside the task).
    Returns the count of re-queued recipients.
    """
    return await CampaignService.resume_campaign(
        db, campaign_id, current_user.organization_id
    )


# ─── Retry Failed ─────────────────────────────────────────────────────────────

@router.post("/{campaign_id}/retry")
async def retry_campaign(
    campaign_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Retry all failed/invalid recipients in a terminal campaign.
    Re-dispatches tasks for only those recipients.
    Returns the count of retried recipients.
    """
    return await CampaignService.retry_campaign(
        db, campaign_id, current_user.organization_id
    )


# ─── Recipients ───────────────────────────────────────────────────────────────

@router.get("/{campaign_id}/recipients", response_model=List[CampaignRecipientResponse])
async def list_recipients(
    campaign_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Delivery status per recipient."""
    return await CampaignService.get_recipients(db, campaign_id, current_user.organization_id)


# ─── Analytics ───────────────────────────────────────────────────────────────

@router.get("/{campaign_id}/analytics", response_model=CampaignAnalyticsResponse)
async def get_campaign_analytics(
    campaign_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    return await CampaignService.get_analytics(db, campaign_id, current_user.organization_id)


# ─── Filter Preview (wizard step 3 live preview) ──────────────────────────────

@router.get("/leads/filter", response_model=List[RecipientPreview])
async def preview_recipient_filter(
    filter_type: str = Query(default="all_leads"),
    filter_value: Optional[str] = Query(default=None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Live preview of who will receive the campaign given a filter.
    Used by the Campaign Wizard Step 3 before saving the campaign.
    """
    return await CampaignService.preview_filter(
        db, current_user.organization_id, filter_type, filter_value
    )
