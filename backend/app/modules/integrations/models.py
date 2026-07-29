from sqlalchemy import Column, String, Boolean, JSON
from app.db.base_class import TenantAwareBase

class Integration(TenantAwareBase):
    """Represents a third-party integration connection for an organization."""
    name = Column(String, nullable=False)  # e.g., Stripe, Slack, Google
    slug = Column(String, nullable=False)  # e.g., stripe, slack, google
    is_connected = Column(Boolean, default=False)
    config = Column(JSON, nullable=True)   # Stores non-secret config values
    icon_url = Column(String, nullable=True)
    description = Column(String, nullable=True)
