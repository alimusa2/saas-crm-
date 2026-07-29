from pydantic import BaseModel, ConfigDict
from typing import Optional
from datetime import datetime

class NotificationBase(BaseModel):
    type: str
    title: str
    content: Optional[str] = None
    related_entity_type: Optional[str] = None
    related_entity_id: Optional[str] = None

class NotificationCreate(NotificationBase):
    user_id: str

class NotificationResponse(NotificationBase):
    id: str
    user_id: str
    organization_id: str
    is_read: bool
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)
