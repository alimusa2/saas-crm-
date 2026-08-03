from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

class CoachMessageCreate(BaseModel):
    content: str

class CoachMessageResponse(BaseModel):
    id: str
    session_id: str
    role: str  # "user" or "assistant"
    content: str
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class CoachSessionCreate(BaseModel):
    title: Optional[str] = None

class CoachSessionUpdate(BaseModel):
    title: Optional[str] = None
    is_archived: Optional[bool] = None

class CoachSessionResponse(BaseModel):
    id: str
    organization_id: str
    user_id: str
    title: Optional[str] = None
    is_archived: bool = False
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    message_count: int = 0
    messages: Optional[List[CoachMessageResponse]] = []

    class Config:
        from_attributes = True
