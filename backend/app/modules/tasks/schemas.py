from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

class RelatedLeadSummary(BaseModel):
    id: str
    first_name: str
    last_name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    company_name: Optional[str] = None
    pipeline_stage: Optional[str] = None
    lead_score: Optional[int] = 0
    lead_source: Optional[str] = None
    assigned_salesperson: Optional[str] = None
    status: Optional[str] = None
    last_activity_date: Optional[datetime] = None

class TaskBase(BaseModel):
    title: str
    description: Optional[str] = None
    due_date: Optional[datetime] = None
    status: Optional[str] = "Pending"
    priority: Optional[str] = "Normal"
    lead_id: Optional[str] = None
    assigned_to_id: Optional[str] = None
    assigned_by_id: Optional[str] = None
    assigned_at: Optional[datetime] = None
    department: Optional[str] = None


class TaskCreate(TaskBase):
    lead_ids: Optional[List[str]] = None


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    due_date: Optional[datetime] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    is_completed: Optional[bool] = None
    assigned_to_id: Optional[str] = None
    assigned_by_id: Optional[str] = None
    assigned_at: Optional[datetime] = None
    lead_id: Optional[str] = None
    lead_ids: Optional[List[str]] = None
    department: Optional[str] = None


class TaskResponse(TaskBase):
    id: str
    organization_id: str
    owner_id: Optional[str] = None
    is_completed: bool
    created_at: datetime
    updated_at: datetime
    lead_ids: List[str] = []
    related_leads: List[RelatedLeadSummary] = []

    class Config:
        from_attributes = True
