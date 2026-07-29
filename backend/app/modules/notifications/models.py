from sqlalchemy import Column, String, ForeignKey, Boolean
from app.db.base_class import TenantAwareBase

class Notification(TenantAwareBase):
    user_id = Column(String, ForeignKey("user.id"), nullable=False)
    type = Column(String, nullable=False) # Success, Warning, Error, Reminder, Task
    title = Column(String, nullable=False)
    content = Column(String, nullable=True)
    is_read = Column(Boolean, default=False)
    related_entity_type = Column(String, nullable=True) # e.g., 'Lead', 'Task'
    related_entity_id = Column(String, nullable=True)
