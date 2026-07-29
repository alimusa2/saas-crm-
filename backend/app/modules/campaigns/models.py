"""
Email Campaign Module – Production Models
=========================================
Provides Campaign (orchestrator) and CampaignRecipient (per-recipient delivery tracking).
Deliberately separate from the existing EmailCampaign model in email/models.py so that
existing /email/campaigns API routes remain 100% backward compatible.
"""
from sqlalchemy import Column, String, ForeignKey, Integer, Text, DateTime, JSON
from sqlalchemy.orm import relationship
from app.db.base_class import TenantAwareBase


class Campaign(TenantAwareBase):
    """
    A production email campaign.
    Acts as an orchestrator: it resolves recipients from CRM data, creates one
    EmailLog per recipient, and dispatches existing send_email_task Celery jobs.
    """
    name = Column(String, nullable=False)
    subject = Column(String, nullable=False)
    description = Column(Text, nullable=True)

    # Status lifecycle: Draft → Scheduled → Sending → Completed | Paused | Cancelled | Failed
    status = Column(String, default="Draft", nullable=False)

    # Email content — reuse existing EmailTemplate
    template_id = Column(String, ForeignKey("emailtemplate.id"), nullable=True)

    # Gmail account used for sending (display only — actual token lives in GmailIntegration)
    sender_gmail_account = Column(String, nullable=True)
    reply_to = Column(String, nullable=True)

    # Recipient selection filter (serialized JSON)
    # Schema: {"type": "all_leads"|"pipeline_stage"|"tag"|"owner"|"manual", "value": "..."}
    recipient_filter = Column(JSON, nullable=True)

    # Schedule
    scheduled_for = Column(DateTime(timezone=True), nullable=True)
    sent_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)

    # Counters (denormalized for fast read — authoritative data is in CampaignRecipient)
    recipient_count = Column(Integer, default=0)
    sent_count = Column(Integer, default=0)
    failed_count = Column(Integer, default=0)
    reply_count = Column(Integer, default=0)

    # Audit
    created_by_id = Column(String, ForeignKey("user.id"), nullable=True)

    # Relationships
    template = relationship("EmailTemplate", foreign_keys=[template_id])
    recipients = relationship("CampaignRecipient", back_populates="campaign", cascade="all, delete-orphan")


class CampaignRecipient(TenantAwareBase):
    """
    Per-recipient delivery record for a Campaign.
    One row per unique email address. Status tracks the full delivery lifecycle:
    Queued, Sending, Sent, Delivered, Opened, Clicked, Failed, Skipped, Cancelled.
    """
    campaign_id = Column(String, ForeignKey("campaign.id"), nullable=False)

    # Resolved email address (deduplicated before insert)
    recipient_email = Column(String, nullable=False, index=True)

    # CRM source references (nullable — recipients may be contacts or manual)
    lead_id = Column(String, ForeignKey("lead.id"), nullable=True)
    contact_id = Column(String, ForeignKey("contact.id"), nullable=True)

    # Once dispatched, links to the EmailLog row that carries the actual send state
    email_log_id = Column(String, ForeignKey("emaillog.id"), nullable=True)

    # Delivery status: Queued | Sending | Sent | Delivered | Failed | Skipped | Cancelled
    status = Column(String, default="Queued", nullable=False)

    error_message = Column(Text, nullable=True)
    skipped_reason = Column(Text, nullable=True)

    sent_at = Column(DateTime(timezone=True), nullable=True)
    
    # Retry and tracking
    attempt_count = Column(Integer, default=0)
    last_attempt_at = Column(DateTime(timezone=True), nullable=True)
    gmail_message_id = Column(String, nullable=True)

    # Relationships
    campaign = relationship("Campaign", back_populates="recipients")
