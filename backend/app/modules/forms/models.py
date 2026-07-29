from sqlalchemy import Column, String, ForeignKey, Boolean, Integer, JSON, Text
from sqlalchemy.orm import relationship
from app.db.base_class import TenantAwareBase

class Form(TenantAwareBase):
    title = Column(String, nullable=False)
    description = Column(String, nullable=True)
    embed_code = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True)
    
    fields = relationship("FormField", back_populates="form", cascade="all, delete-orphan")
    submissions = relationship("FormSubmission", back_populates="form", cascade="all, delete-orphan")

class FormField(TenantAwareBase):
    form_id = Column(String, ForeignKey("form.id"), nullable=False)
    name = Column(String, nullable=False) # e.g., "first_name"
    label = Column(String, nullable=False) # e.g., "First Name"
    field_type = Column(String, nullable=False) # text, email, phone, dropdown
    is_required = Column(Boolean, default=False)
    order = Column(Integer, default=0)
    options = Column(JSON, nullable=True) # For dropdowns/radios

    form = relationship("Form", back_populates="fields")

class FormSubmission(TenantAwareBase):
    form_id = Column(String, ForeignKey("form.id"), nullable=False)
    payload = Column(JSON, nullable=False) # The submitted data
    lead_id = Column(String, ForeignKey("lead.id"), nullable=True) # Linked lead if created

    form = relationship("Form", back_populates="submissions")
