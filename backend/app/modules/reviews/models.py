from sqlalchemy import Column, String, Integer, Float, ForeignKey, Boolean, Text
from app.db.base_class import TenantAwareBase

class Review(TenantAwareBase):
    """Represents a customer review or testimonial."""
    reviewer_name = Column(String, nullable=False)
    reviewer_email = Column(String, nullable=True)
    rating = Column(Integer, nullable=False, default=5)  # 1-5 stars
    title = Column(String, nullable=True)
    content = Column(Text, nullable=True)
    source = Column(String, default="Manual")  # Manual, Google, Trustpilot, etc.
    status = Column(String, default="Pending")  # Pending, Approved, Rejected
    lead_id = Column(String, ForeignKey("lead.id"), nullable=True)
    contact_id = Column(String, ForeignKey("contact.id"), nullable=True)
    is_featured = Column(Boolean, default=False)
