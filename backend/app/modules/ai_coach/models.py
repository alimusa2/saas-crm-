import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Boolean, Text, ForeignKey, DateTime
from sqlalchemy.orm import relationship
from app.db.base_class import TenantAwareBase, Base

class CoachSession(TenantAwareBase):
    __tablename__ = "coach_sessions"

    user_id = Column(String, index=True, nullable=False)
    title = Column(String, nullable=True)
    is_archived = Column(Boolean, default=False, nullable=False)

    messages = relationship(
        "CoachMessage",
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="CoachMessage.created_at",
        lazy="selectin"
    )

class CoachMessage(Base):
    __tablename__ = "coach_messages"

    session_id = Column(String, ForeignKey("coach_sessions.id", ondelete="CASCADE"), index=True, nullable=False)
    role = Column(String, nullable=False)  # "user" or "assistant"
    content = Column(Text, nullable=False)

    session = relationship("CoachSession", back_populates="messages")
