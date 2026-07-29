from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class MessageCreate(BaseModel):
    body: str
    subject: Optional[str] = None
    recipient_id: Optional[str] = None
    lead_id: Optional[str] = None
    contact_id: Optional[str] = None
    message_type: str = "Internal"
    parent_id: Optional[str] = None
    direction: str = "Outgoing"
    delivery_status: str = "Sent"
    sender_email: Optional[str] = None
    recipient_email: Optional[str] = None
    task_id: Optional[str] = None
    appointment_id: Optional[str] = None
    invoice_id: Optional[str] = None
    automation_source: Optional[str] = None


class EmailSendRequest(BaseModel):
    """Send an email via Gmail API (requires Gmail OAuth connection)."""
    to_email: str
    subject: str
    body: str
    lead_id: Optional[str] = None
    contact_id: Optional[str] = None
    parent_id: Optional[str] = None


class MessageResponse(BaseModel):
    id: str
    body: str
    subject: Optional[str] = None
    sender_id: str
    recipient_id: Optional[str] = None
    lead_id: Optional[str] = None
    contact_id: Optional[str] = None
    is_read: bool
    message_type: str
    parent_id: Optional[str] = None
    organization_id: str
    created_at: datetime

    # Extended tracking fields
    direction: str = "Outgoing"
    delivery_status: str = "Sent"
    sender_email: Optional[str] = None
    recipient_email: Optional[str] = None
    gmail_message_id: Optional[str] = None
    error_message: Optional[str] = None
    task_id: Optional[str] = None
    appointment_id: Optional[str] = None
    invoice_id: Optional[str] = None
    automation_source: Optional[str] = None
    is_ambiguous: Optional[bool] = False

    # Extended Phase 1 Gmail Sync fields
    gmail_thread_id: Optional[str] = None
    company_id: Optional[str] = None
    is_starred: Optional[bool] = False
    is_archived: Optional[bool] = False
    is_unknown_contact: Optional[bool] = False
    attachments_metadata: Optional[str] = None

    class Config:
        from_attributes = True


class LinkMessageRequest(BaseModel):
    lead_id: Optional[str] = None
    contact_id: Optional[str] = None

