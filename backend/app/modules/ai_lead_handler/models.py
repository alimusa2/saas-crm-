from sqlalchemy import Column, String, Text, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from app.db.base_class import TenantAwareBase, Base


class LeadAIThread(TenantAwareBase):
    """One AI Assist thread per lead. Created lazily on first message."""
    __tablename__ = "lead_ai_threads"
    __table_args__ = (
        # One thread per lead per org — prevents duplicate/racy thread
        # creation from concurrent "first message" requests.
        UniqueConstraint("lead_id", "organization_id", name="uq_lead_ai_thread_per_lead"),
    )

    lead_id = Column(String, ForeignKey("lead.id", ondelete="CASCADE"), index=True, nullable=False)
    user_id = Column(String, index=True, nullable=False)

    messages = relationship(
        "LeadAIMessage",
        back_populates="thread",
        cascade="all, delete-orphan",
        order_by="LeadAIMessage.created_at",
        lazy="selectin",
    )


class LeadAIMessage(Base):
    __tablename__ = "lead_ai_messages"

    thread_id = Column(String, ForeignKey("lead_ai_threads.id", ondelete="CASCADE"), index=True, nullable=False)
    role = Column(String, nullable=False)  # "user" or "assistant"
    content = Column(Text, nullable=False)

    thread = relationship("LeadAIThread", back_populates="messages")
