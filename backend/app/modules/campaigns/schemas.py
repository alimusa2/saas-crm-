from pydantic import BaseModel, ConfigDict, field_validator
from typing import Optional, List, Dict, Any
from datetime import datetime


# ─── Recipient Filter ────────────────────────────────────────────────────────

class RecipientFilter(BaseModel):
    """
    Defines how the campaign resolves its recipient list from CRM data.
    type: all_leads | all_contacts | pipeline_stage | tag | owner | manual
    value: stage name / tag string / owner_id / comma-separated emails
    """
    type: str = "all_leads"
    value: Optional[str] = None


# ─── Campaign CRUD ────────────────────────────────────────────────────────────

class CampaignCreate(BaseModel):
    name: str
    subject: str
    description: Optional[str] = None
    template_id: Optional[str] = None
    reply_to: Optional[str] = None
    recipient_filter: Optional[RecipientFilter] = None
    scheduled_for: Optional[datetime] = None
    status: str = "Draft"


class CampaignUpdate(BaseModel):
    name: Optional[str] = None
    subject: Optional[str] = None
    description: Optional[str] = None
    template_id: Optional[str] = None
    reply_to: Optional[str] = None
    recipient_filter: Optional[RecipientFilter] = None
    scheduled_for: Optional[datetime] = None
    status: Optional[str] = None


class CampaignResponse(BaseModel):
    id: str
    name: str
    subject: str
    description: Optional[str] = None
    status: str
    template_id: Optional[str] = None
    sender_gmail_account: Optional[str] = None
    reply_to: Optional[str] = None
    recipient_filter: Optional[Dict[str, Any]] = None
    scheduled_for: Optional[datetime] = None
    sent_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    recipient_count: int = 0
    sent_count: int = 0
    failed_count: int = 0
    reply_count: int = 0
    created_by_id: Optional[str] = None
    organization_id: str
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)


# ─── Recipient ────────────────────────────────────────────────────────────────

class CampaignRecipientResponse(BaseModel):
    id: str
    campaign_id: str
    recipient_email: str
    lead_id: Optional[str] = None
    contact_id: Optional[str] = None
    email_log_id: Optional[str] = None
    status: str
    error_message: Optional[str] = None
    skipped_reason: Optional[str] = None
    sent_at: Optional[datetime] = None
    attempt_count: int = 0
    last_attempt_at: Optional[datetime] = None
    gmail_message_id: Optional[str] = None
    organization_id: str
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


# ─── Review / Pre-send Preview ────────────────────────────────────────────────

class RecipientPreview(BaseModel):
    email: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    lead_id: Optional[str] = None
    contact_id: Optional[str] = None


class CampaignReviewResponse(BaseModel):
    campaign_id: str
    campaign_name: str
    subject: str
    template_name: Optional[str] = None
    gmail_account: Optional[str] = None
    gmail_connected: bool
    recipient_count: int
    duplicate_count: int = 0
    recipients_preview: List[RecipientPreview]   # first 10 for display
    warnings: List[str]
    can_send: bool


# ─── Queue Request ────────────────────────────────────────────────────────────

class CampaignQueueRequest(BaseModel):
    """Optional override parameters when queuing a campaign."""
    send_now: bool = True          # If False, uses scheduled_for
    scheduled_for: Optional[datetime] = None


# ─── Analytics ───────────────────────────────────────────────────────────────

class CampaignAnalyticsResponse(BaseModel):
    campaign_id: str
    recipient_count: int
    queued_count: int
    processing_count: int = 0
    sent_count: int
    failed_count: int
    skipped_count: int
    invalid_count: int = 0
    cancelled_count: int = 0
    reply_count: int
    success_rate: float            # sent / recipient_count * 100
    progress_pct: float = 0.0      # (terminal / total) * 100
    duration_seconds: Optional[float] = None
