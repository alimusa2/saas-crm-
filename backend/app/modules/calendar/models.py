from sqlalchemy import Column, String, ForeignKey, DateTime, Text, Index
from app.db.base_class import TenantAwareBase

class Appointment(TenantAwareBase):
    __table_args__ = (
        Index("ix_appt_org_start", "organization_id", "start_time"),
        Index("ix_appt_org_assigned", "organization_id", "assigned_to_id"),
    )
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    start_time = Column(DateTime(timezone=True), nullable=False)
    end_time = Column(DateTime(timezone=True), nullable=False)
    status = Column(String, default="Booked")  # Booked, Confirmed, Cancelled, Completed, No Show
    location = Column(String, nullable=True)  # Could be a Zoom link

    organizer_id = Column(String, ForeignKey("user.id"), nullable=False)
    lead_id = Column(String, ForeignKey("lead.id"), nullable=True)
    contact_id = Column(String, ForeignKey("contact.id"), nullable=True)
    assigned_to_id = Column(String, ForeignKey("teammember.id"), nullable=True)

    related_entity_type = Column(String, nullable=True)
    related_entity_id = Column(String, nullable=True)
    display_name = Column(String, nullable=True)
    email = Column(String, nullable=True)
    phone = Column(String, nullable=True)

