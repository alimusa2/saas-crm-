from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime


class LeadAIMessageCreate(BaseModel):
    content: str = Field(..., min_length=1, max_length=4000)


class LeadAIMessageResponse(BaseModel):
    id: str
    thread_id: str
    role: str  # "user" or "assistant"
    content: str
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class LeadAIThreadResponse(BaseModel):
    id: str
    lead_id: str
    organization_id: str
    user_id: str
    message_count: int = 0
    messages: Optional[List[LeadAIMessageResponse]] = []

    class Config:
        from_attributes = True


class LeadContext(BaseModel):
    """
    Structured snapshot of a lead's CRM record, built fresh on every request
    from your actual Lead model (see services.py: build_lead_context).
    This is what replaces "RAG" here — you already know exactly which
    record is relevant, so you just serialize it into the prompt instead of
    retrieving it from a vector store.
    """
    lead_id: str
    name: Optional[str] = None
    company: Optional[str] = None
    industry: Optional[str] = None
    stage: Optional[str] = None
    deal_value: Optional[float] = None
    last_activity_at: Optional[datetime] = None
    last_activity_summary: Optional[str] = None
    notes: Optional[str] = None
    stated_objection: Optional[str] = None
