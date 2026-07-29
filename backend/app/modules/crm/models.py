from sqlalchemy import Column, String, Integer, Float, ForeignKey, Text, DateTime, Boolean
from sqlalchemy.orm import relationship
from app.db.base_class import TenantAwareBase

class Lead(TenantAwareBase):
    first_name = Column(String, nullable=False)
    last_name = Column(String, nullable=False)
    email = Column(String, index=True, nullable=True)
    phone = Column(String, index=True, nullable=True)
    status = Column(String, default="New")  # New, Contacted, Interested, etc.
    priority = Column(String, default="Normal")  # Low, Normal, High
    lead_source = Column(String, nullable=True)
    owner_id = Column(String, ForeignKey("user.id"), nullable=True)
    company_id = Column(String, ForeignKey("company.id"), nullable=True)

    # Extended properties
    industry = Column(String, nullable=True)
    budget = Column(Float, nullable=True)
    expected_revenue = Column(Float, nullable=True)
    lead_score = Column(Integer, default=0)
    billing_address = Column(String, nullable=True)
    tax_information = Column(String, nullable=True)

    # Production Lead Scoring fields
    automatic_score = Column(Integer, default=0)
    manual_score = Column(Integer, nullable=True)
    is_score_manual = Column(Boolean, default=False)
    score_source = Column(String, nullable=True)
    score_history = Column(Text, nullable=True)
    score_last_updated = Column(DateTime(timezone=True), nullable=True)

class Contact(TenantAwareBase):
    first_name = Column(String, nullable=False)
    last_name = Column(String, nullable=False)
    email = Column(String, index=True, nullable=True)
    phone = Column(String, index=True, nullable=True)
    company_id = Column(String, ForeignKey("company.id"), nullable=True)
    billing_address = Column(String, nullable=True)
    tax_information = Column(String, nullable=True)

class Company(TenantAwareBase):
    name = Column(String, nullable=False, index=True)
    website = Column(String, nullable=True)
    industry = Column(String, nullable=True)
    address = Column(String, nullable=True)
    tax_information = Column(String, nullable=True)

class Note(TenantAwareBase):
    content = Column(Text, nullable=False)
    lead_id = Column(String, ForeignKey("lead.id"), nullable=True)
    contact_id = Column(String, ForeignKey("contact.id"), nullable=True)
    author_id = Column(String, ForeignKey("user.id"), nullable=False)

class Activity(TenantAwareBase):
    type = Column(String, nullable=False)  # Call, Email, Meeting, System
    description = Column(Text, nullable=True)
    lead_id = Column(String, ForeignKey("lead.id"), nullable=True)
    contact_id = Column(String, ForeignKey("contact.id"), nullable=True)
    author_id = Column(String, ForeignKey("user.id"), nullable=False)
    timestamp = Column(DateTime(timezone=True), nullable=False)
    task_id = Column(String, ForeignKey("task.id", ondelete="SET NULL"), nullable=True)
    appointment_id = Column(String, ForeignKey("appointment.id", ondelete="SET NULL"), nullable=True)

class ImportJob(TenantAwareBase):
    filename = Column(String, nullable=False)
    status = Column(String, default="Queued")  # Queued, Importing, Completed, Failed
    imported_count = Column(Integer, default=0)
    updated_count = Column(Integer, default=0)
    skipped_count = Column(Integer, default=0)
    invalid_count = Column(Integer, default=0)
    error_message = Column(Text, nullable=True)
    created_by = Column(String, ForeignKey("user.id"), nullable=False)

class ExportJob(TenantAwareBase):
    status = Column(String, default="Queued")  # Queued, Exporting, Completed, Failed
    filename = Column(String, nullable=True)
    file_path = Column(String, nullable=True)
    filters = Column(Text, nullable=True)
    record_count = Column(Integer, default=0)
    created_by = Column(String, ForeignKey("user.id"), nullable=False)

