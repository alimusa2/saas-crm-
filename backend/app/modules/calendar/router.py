from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from typing import List

from app.db.session import get_db
from app.core.security import get_current_user
from app.modules.calendar.schemas import AppointmentCreate, AppointmentUpdate, AppointmentResponse, MeetingTemplateUpdate
from app.modules.calendar.services import CalendarService
from app.modules.email.models import EmailTemplate
from app.modules.email.schemas import EmailTemplateResponse

router = APIRouter()

def get_calendar_service(db: AsyncSession = Depends(get_db)) -> CalendarService:
    return CalendarService(db)

@router.get("/analytics")
async def get_meeting_analytics(
    calendar_service: CalendarService = Depends(get_calendar_service),
    current_user: dict = Depends(get_current_user)
):
    """Retrieve meeting lifecycle analytics."""
    return await calendar_service.get_meeting_analytics(current_user["org"])

@router.get("/templates", response_model=List[EmailTemplateResponse])
async def list_meeting_templates(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """List meeting status email templates."""
    meeting_names = [
        "Meeting Assigned", "Meeting Confirmed", "Meeting Cancelled",
        "Meeting Completed", "Meeting Rescheduled", "Meeting Reminder", "No Show"
    ]
    # Ensure they are seeded first
    await CalendarService.seed_meeting_templates(db, current_user["org"])
    
    result = await db.execute(
        select(EmailTemplate).where(
            EmailTemplate.organization_id == current_user["org"],
            EmailTemplate.name.in_(meeting_names)
        )
    )
    return list(result.scalars().all())

@router.patch("/templates/{template_id}", response_model=EmailTemplateResponse)
async def update_meeting_template(
    template_id: str,
    tmpl_in: MeetingTemplateUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Update a meeting email template."""
    result = await db.execute(
        select(EmailTemplate).where(
            EmailTemplate.id == template_id,
            EmailTemplate.organization_id == current_user["org"]
        )
    )
    tmpl = result.scalars().first()
    if not tmpl:
        raise HTTPException(status_code=404, detail="Template not found")
        
    tmpl.subject = tmpl_in.subject
    tmpl.html_content = tmpl_in.html_content
    
    await db.commit()
    await db.refresh(tmpl)
    return tmpl

@router.get("/", response_model=List[AppointmentResponse])
async def list_appointments(
    calendar_service: CalendarService = Depends(get_calendar_service),
    current_user: dict = Depends(get_current_user)
):
    """List appointments for the organization"""
    return await calendar_service.get_appointments(current_user["org"], current_user["sub"], current_user=current_user)

@router.post("/", response_model=AppointmentResponse, status_code=status.HTTP_201_CREATED)
async def create_appointment(
    appt_in: AppointmentCreate,
    calendar_service: CalendarService = Depends(get_calendar_service),
    current_user: dict = Depends(get_current_user)
):
    """Create a new appointment"""
    return await calendar_service.create_appointment(appt_in, current_user["org"], current_user["sub"])

@router.patch("/{appt_id}", response_model=AppointmentResponse)
async def update_appointment(
    appt_id: str,
    appt_in: AppointmentUpdate,
    calendar_service: CalendarService = Depends(get_calendar_service),
    current_user: dict = Depends(get_current_user)
):
    """Update an appointment"""
    appointment = await calendar_service.update_appointment(appt_id, appt_in, current_user["org"])
    if not appointment:
        raise HTTPException(status_code=404, detail="Appointment not found")
    return appointment
