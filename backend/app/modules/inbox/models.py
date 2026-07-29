from sqlalchemy import Column, String, ForeignKey, Text, Boolean
from app.db.base_class import TenantAwareBase

class Message(TenantAwareBase):
    """Represents an internal message, email, or SMS in a CRM conversation thread."""
    subject = Column(String, nullable=True)
    body = Column(Text, nullable=False)
    sender_id = Column(String, ForeignKey("user.id"), nullable=False)
    recipient_id = Column(String, ForeignKey("user.id"), nullable=True)
    lead_id = Column(String, ForeignKey("lead.id"), nullable=True)
    contact_id = Column(String, ForeignKey("contact.id"), nullable=True)
    is_read = Column(Boolean, default=False)
    message_type = Column(String, default="Internal")  # Internal, Email, SMS

    # Threading support
    parent_id = Column(String, ForeignKey("message.id"), nullable=True)

    # CRM-style tracking fields
    direction = Column(String, default="Outgoing")          # Outgoing | Incoming
    delivery_status = Column(String, default="Sent")        # Sending | Sent | Delivered | Failed | Draft
    sender_email = Column(String, nullable=True)            # actual from address
    recipient_email = Column(String, nullable=True)         # actual to address
    gmail_message_id = Column(String, nullable=True)        # Gmail API message ID
    error_message = Column(Text, nullable=True)             # error detail on failure

    # Integration links & logging requirements
    task_id = Column(String, nullable=True)
    appointment_id = Column(String, nullable=True)
    invoice_id = Column(String, nullable=True)
    automation_source = Column(String, nullable=True)
    is_ambiguous = Column(Boolean, default=False, nullable=True)

    # Extended Phase 1 Gmail Sync fields
    gmail_thread_id = Column(String, index=True, nullable=True)
    company_id = Column(String, ForeignKey("company.id"), nullable=True)
    is_starred = Column(Boolean, default=False, nullable=True)
    is_archived = Column(Boolean, default=False, nullable=True)
    is_unknown_contact = Column(Boolean, default=False, nullable=True)
    attachments_metadata = Column(Text, nullable=True)  # JSON metadata: [{id, filename, mime_type, size}]

