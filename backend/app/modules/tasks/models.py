from sqlalchemy import Column, String, ForeignKey, DateTime, Boolean, Text
from app.db.base_class import TenantAwareBase

class Task(TenantAwareBase):
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    due_date = Column(DateTime(timezone=True), nullable=True)
    status = Column(String, default="Pending")  # Pending, Completed, Cancelled
    priority = Column(String, default="Normal")  # Low, Normal, High
    owner_id = Column(String, ForeignKey("user.id"), nullable=True)
    lead_id = Column(String, ForeignKey("lead.id"), nullable=True)
    is_completed = Column(Boolean, default=False)
    
    assigned_to_id = Column(String, ForeignKey("teammember.id"), nullable=True)
    assigned_by_id = Column(String, ForeignKey("user.id"), nullable=True)
    assigned_at = Column(DateTime(timezone=True), nullable=True)
    
    department = Column(String, nullable=True)


class TaskLead(TenantAwareBase):
    task_id = Column(String, ForeignKey("task.id", ondelete="CASCADE"), nullable=False)
    lead_id = Column(String, ForeignKey("lead.id", ondelete="CASCADE"), nullable=False)
