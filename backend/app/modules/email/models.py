from sqlalchemy import Column, String, ForeignKey, Boolean, Text, DateTime, Integer
from sqlalchemy.orm import relationship
from app.db.base_class import TenantAwareBase

class EmailConfig(TenantAwareBase):
    provider = Column(String, nullable=False, default="smtp")  # smtp, gmail, sendgrid, ses
    settings_enc = Column(Text, nullable=True)  # Encrypted JSON containing passwords/API keys
    is_active = Column(Boolean, default=True)

class EmailTemplate(TenantAwareBase):
    name = Column(String, nullable=False)
    subject = Column(String, nullable=False)
    html_content = Column(Text, nullable=False)
    design_json = Column(Text, nullable=True)  # If using a visual builder
    is_active = Column(Boolean, default=True)

class EmailCampaign(TenantAwareBase):
    name = Column(String, nullable=False)
    template_id = Column(String, ForeignKey("emailtemplate.id"), nullable=False)
    status = Column(String, default="Draft")  # Draft, Scheduled, Sending, Completed
    scheduled_for = Column(DateTime(timezone=True), nullable=True)

    template = relationship("EmailTemplate")

class EmailLog(TenantAwareBase):
    recipient = Column(String, nullable=False)
    cc = Column(String, nullable=True)
    bcc = Column(String, nullable=True)
    reply_to = Column(String, nullable=True)
    subject = Column(String, nullable=False)
    body = Column(Text, nullable=True)
    status = Column(String, default="Queued")  # Queued, Sent, Delivered, Failed, Opened
    message_id = Column(String, nullable=True)  # SMTP Message-ID header
    parent_id = Column(String, nullable=True)   # Threading support
    retry_count = Column(Integer, default=0)
    lead_id = Column(String, ForeignKey("lead.id"), nullable=True)
    campaign_id = Column(String, nullable=True)  # references campaign.id (no FK to preserve backward compat)
    error_message = Column(Text, nullable=True)
