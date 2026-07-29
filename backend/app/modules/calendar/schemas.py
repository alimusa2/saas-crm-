from pydantic import BaseModel
from typing import Optional
from datetime import datetime

class AppointmentBase(BaseModel):
    title: str
    description: Optional[str] = None
    start_time: datetime
    end_time: datetime
    status: Optional[str] = "Booked"
    location: Optional[str] = None
    lead_id: Optional[str] = None
    contact_id: Optional[str] = None
    assigned_to_id: Optional[str] = None
    related_entity_type: Optional[str] = None
    related_entity_id: Optional[str] = None
    display_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None

class AppointmentCreate(AppointmentBase):
    assigned_to_id: Optional[str] = None
    related_entity_type: Optional[str] = None
    related_entity_id: Optional[str] = None


class AppointmentUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    status: Optional[str] = None
    location: Optional[str] = None
    assigned_to_id: Optional[str] = None
    lead_id: Optional[str] = None
    related_entity_type: Optional[str] = None
    related_entity_id: Optional[str] = None
    display_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    custom_message: Optional[str] = None


class AppointmentResponse(AppointmentBase):
    id: str
    organization_id: str
    organizer_id: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class MeetingTemplateUpdate(BaseModel):
    subject: str
    html_content: str

