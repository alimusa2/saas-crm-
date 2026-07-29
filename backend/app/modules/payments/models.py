from sqlalchemy import Column, String, Float, ForeignKey, Integer, Text, DateTime
from sqlalchemy.orm import relationship
from app.db.base_class import TenantAwareBase

class Invoice(TenantAwareBase):
    """Represents a payment invoice issued to a lead/contact/company."""
    number = Column(String, nullable=False)
    amount = Column(Float, nullable=False)
    currency = Column(String, default="USD")
    status = Column(String, default="Draft")  # Draft, Sent, Paid, Overdue, Cancelled
    due_date = Column(DateTime(timezone=True), nullable=True)
    paid_at = Column(DateTime(timezone=True), nullable=True)
    lead_id = Column(String, ForeignKey("lead.id"), nullable=True)
    contact_id = Column(String, ForeignKey("contact.id"), nullable=True)
    description = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)

    related_entity_type = Column(String, nullable=True)
    related_entity_id = Column(String, nullable=True)
    recipient_name = Column(String, nullable=True)
    recipient_email = Column(String, nullable=True)
    recipient_phone = Column(String, nullable=True)
    recipient_company = Column(String, nullable=True)
    billing_address = Column(String, nullable=True)
    tax_information = Column(String, nullable=True)

    items = relationship("InvoiceItem", backref="invoice", cascade="all, delete-orphan", lazy="selectin")

class InvoiceItem(TenantAwareBase):
    """Represents an individual line item inside an invoice."""
    invoice_id = Column(String, ForeignKey("invoice.id"), nullable=False)
    description = Column(String, nullable=False)
    quantity = Column(Float, nullable=False, default=1.0)
    unit_price = Column(Float, nullable=False)
    amount = Column(Float, nullable=False)

class Payment(TenantAwareBase):
    """Represents a payment transaction linked to an invoice."""
    invoice_id = Column(String, ForeignKey("invoice.id"), nullable=False)
    amount = Column(Float, nullable=False)
    method = Column(String, default="Card")  # Card, Bank, Cash, etc.
    reference = Column(String, nullable=True)  # external txn ID
    status = Column(String, default="Completed")

