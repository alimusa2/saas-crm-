from pydantic import BaseModel, EmailStr
from typing import Optional, List, Dict, Any
from datetime import datetime

class TeamMemberBase(BaseModel):
    first_name: str
    last_name: str
    email: EmailStr
    phone: Optional[str] = None
    job_title: Optional[str] = None
    department: str
    designation: Optional[str] = None
    status: Optional[str] = "Active"
    role: str = "Member"
    avatar: Optional[str] = None
    notes: Optional[str] = None
    joining_date: Optional[str] = None
    assigned_pipelines: Optional[List[str]] = None
    assigned_contacts: Optional[List[str]] = None
    assigned_deals: Optional[List[str]] = None
    assigned_funnels: Optional[List[str]] = None
    assigned_forms: Optional[List[str]] = None
    assigned_calendars: Optional[List[str]] = None
    assigned_workflows: Optional[List[str]] = None
    permissions: Optional[Dict[str, Any]] = None

class TeamMemberCreate(TeamMemberBase):
    password: Optional[str] = None

class TeamMemberUpdate(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    job_title: Optional[str] = None
    department: Optional[str] = None
    designation: Optional[str] = None
    status: Optional[str] = None
    role: Optional[str] = None
    avatar: Optional[str] = None
    notes: Optional[str] = None
    joining_date: Optional[str] = None
    password: Optional[str] = None
    assigned_pipelines: Optional[List[str]] = None
    assigned_contacts: Optional[List[str]] = None
    assigned_deals: Optional[List[str]] = None
    assigned_funnels: Optional[List[str]] = None
    assigned_forms: Optional[List[str]] = None
    assigned_calendars: Optional[List[str]] = None
    assigned_workflows: Optional[List[str]] = None
    permissions: Optional[Dict[str, Any]] = None

class TeamMemberResponse(TeamMemberBase):
    id: str
    organization_id: str
    user_id: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

