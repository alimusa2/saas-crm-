import uuid
import os
import shutil
from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional

from app.db.session import get_db
from app.modules.auth.dependencies import get_current_active_user
from app.modules.auth.models import User
from app.modules.funnels.models import MediaAsset
from app.modules.funnels.schemas import (
    FunnelResponse, FunnelCreate, FunnelWithStepsResponse,
    FunnelStepResponse, FunnelStepCreate,
    FunnelVisitCreate, FunnelAnalyticsReport, MediaAssetResponse
)
from app.modules.funnels.services import FunnelService, FunnelStepService, FunnelTrackingService, MediaAssetService

router = APIRouter()

# ─── Authenticated Funnel Endpoints ─────────────────────────────────────────

@router.get("/", response_model=List[FunnelResponse])
async def read_funnels(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    return await FunnelService.get_funnels(db, current_user.organization_id)


@router.post("/", response_model=FunnelResponse)
async def create_funnel(
    obj_in: FunnelCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    return await FunnelService.create_funnel(db, obj_in, current_user.organization_id)


@router.get("/{funnel_id}", response_model=FunnelWithStepsResponse)
async def read_funnel(
    funnel_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    return await FunnelService.get_funnel(db, funnel_id, current_user.organization_id)


@router.patch("/{funnel_id}", response_model=FunnelResponse)
async def update_funnel(
    funnel_id: str,
    data: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    return await FunnelService.update_funnel(db, funnel_id, data, current_user.organization_id)


@router.delete("/{funnel_id}")
async def delete_funnel(
    funnel_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    await FunnelService.delete_funnel(db, funnel_id, current_user.organization_id)
    return {"message": "Funnel deleted successfully"}


@router.post("/{funnel_id}/publish", response_model=FunnelResponse)
async def publish_funnel(
    funnel_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Publish the funnel and generate its public URL."""
    return await FunnelService.publish_funnel(db, funnel_id, current_user.organization_id)


@router.post("/{funnel_id}/unpublish", response_model=FunnelResponse)
async def unpublish_funnel(
    funnel_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Unpublish the funnel, revoking public access."""
    return await FunnelService.unpublish_funnel(db, funnel_id, current_user.organization_id)


# ─── Media Library Endpoints ────────────────────────────────────────────────

@router.post("/media/upload", response_model=MediaAssetResponse)
async def upload_media_file(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    from app.utils.storage import StorageManager
    
    # Calculate file size
    file.file.seek(0, 2)
    size = file.file.tell()
    file.file.seek(0)
    
    # Check for duplicates (same name and size under same organization)
    stmt = select(MediaAsset).where(
        MediaAsset.filename == file.filename,
        MediaAsset.size == size,
        MediaAsset.organization_id == current_user.organization_id
    )
    result = await db.execute(stmt)
    existing = result.scalars().first()
    if existing:
        return existing
        
    url = await StorageManager.upload_file(file)
    
    asset = await MediaAssetService.save_asset(
        db,
        filename=file.filename,
        url=url,
        size=size,
        content_type=file.content_type,
        organization_id=current_user.organization_id
    )
    return asset


@router.get("/media/library", response_model=List[MediaAssetResponse])
async def get_media_library(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    return await MediaAssetService.get_assets(db, current_user.organization_id)


@router.delete("/media/{asset_id}")
async def delete_media_asset(
    asset_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    success = await MediaAssetService.delete_asset(db, asset_id, current_user.organization_id)
    if not success:
        raise HTTPException(status_code=404, detail="Media asset not found")
    return {"status": "success"}


# ─── Funnel Steps Endpoints ───────────────────────────────────────────────────

@router.get("/{funnel_id}/steps", response_model=List[FunnelStepResponse])
async def read_funnel_steps(
    funnel_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    return await FunnelStepService.get_steps(db, funnel_id, current_user.organization_id)


@router.post("/{funnel_id}/steps", response_model=FunnelStepResponse)
async def create_funnel_step(
    funnel_id: str,
    obj_in: FunnelStepCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    return await FunnelStepService.create_step(db, funnel_id, obj_in, current_user.organization_id)


@router.patch("/{funnel_id}/steps/{step_id}", response_model=FunnelStepResponse)
async def update_funnel_step(
    funnel_id: str,
    step_id: str,
    data: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    return await FunnelStepService.update_step(db, funnel_id, step_id, data, current_user.organization_id)


@router.post("/{funnel_id}/steps/{step_id}/duplicate", response_model=FunnelStepResponse)
async def duplicate_funnel_step(
    funnel_id: str,
    step_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    return await FunnelStepService.duplicate_step(db, funnel_id, step_id, current_user.organization_id)


@router.delete("/{funnel_id}/steps/{step_id}")
async def delete_funnel_step(
    funnel_id: str,
    step_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    await FunnelStepService.delete_step(db, funnel_id, step_id, current_user.organization_id)
    return {"message": "Step deleted successfully"}


# ─── Authenticated Tracking & Analytics ──────────────────────────────────────

@router.post("/{funnel_id}/visit")
async def track_funnel_visit(
    funnel_id: str,
    visit_in: FunnelVisitCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Track a visit/event to a funnel step (authenticated)."""
    visit = await FunnelTrackingService.track_visit(db, funnel_id, visit_in, current_user.organization_id)
    return {"message": "Visit tracked successfully", "visit_id": visit.id}


@router.get("/{funnel_id}/analytics", response_model=FunnelAnalyticsReport)
async def get_funnel_analytics(
    funnel_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """Return drop-off and conversion rates per step."""
    return await FunnelTrackingService.get_analytics(db, funnel_id, current_user.organization_id)


# ─── Public (Unauthenticated) Funnel Endpoints ───────────────────────────────

@router.get("/public/{funnel_id}", response_model=FunnelWithStepsResponse)
async def get_public_funnel(
    funnel_id: str,
    preview: bool = False,
    db: AsyncSession = Depends(get_db)
):
    """Public endpoint: returns a published funnel with its steps for unauthenticated visitors."""
    return await FunnelService.get_public_funnel(db, funnel_id, preview=preview)


@router.post("/public/{funnel_id}/visit")
async def track_public_funnel_visit(
    funnel_id: str,
    visit_in: FunnelVisitCreate,
    db: AsyncSession = Depends(get_db)
):
    """Public endpoint: track a step view/event without authentication."""
    visit = await FunnelTrackingService.track_visit_public(db, funnel_id, visit_in)
    return {"message": "Visit tracked", "visit_id": visit.id}


# ─── Public Calendar Booking Endpoint ──────────────────────────────────────────

from pydantic import BaseModel
from datetime import datetime
from sqlalchemy import select

class PublicBookAppointment(BaseModel):
    title: str
    start_time: datetime
    end_time: datetime
    assigned_to_id: str
    display_name: str
    email: str
    phone: Optional[str] = None

@router.get("/public/booked-slots")
async def get_public_booked_slots(
    db: AsyncSession = Depends(get_db)
):
    from app.modules.calendar.models import Appointment
    stmt = select(Appointment.start_time).where(Appointment.status != "Cancelled")
    res = await db.execute(stmt)
    booked_times = [st.isoformat() for st in res.scalars().all() if st]
    return {"booked_slots": booked_times}

@router.post("/public/book")
async def public_book_appointment(
    appt_in: PublicBookAppointment,
    db: AsyncSession = Depends(get_db)
):
    from app.modules.team.models import TeamMember
    from app.modules.calendar.models import Appointment
    from app.modules.crm.models import Lead
    
    # Verify assigned team member exists or fallback to first team member / admin user
    member = None
    if appt_in.assigned_to_id and appt_in.assigned_to_id != "default_calendar":
        stmt_tm = select(TeamMember).where(TeamMember.id == appt_in.assigned_to_id, TeamMember.is_deleted == False)
        res_tm = await db.execute(stmt_tm)
        member = res_tm.scalars().first()
        
    if not member:
        from app.modules.gmail.models import GmailIntegration
        stmt_g = select(GmailIntegration).where(GmailIntegration.is_connected == True)
        res_g = await db.execute(stmt_g)
        g_rec = res_g.scalars().first()
        if g_rec:
            stmt_tm = select(TeamMember).where(TeamMember.organization_id == g_rec.organization_id, TeamMember.is_deleted == False)
            res_tm = await db.execute(stmt_tm)
            member = res_tm.scalars().first()

    if not member:
        stmt_tm = select(TeamMember).where(TeamMember.is_deleted == False)
        res_tm = await db.execute(stmt_tm)
        member = res_tm.scalars().first()

    if not member:
        stmt_user = select(User)
        res_user = await db.execute(stmt_user)
        user_obj = res_user.scalars().first()
        if user_obj:
            stmt_tm = select(TeamMember).where(TeamMember.user_id == user_obj.id)
            res_tm = await db.execute(stmt_tm)
            member = res_tm.scalars().first()
            if not member:
                member = TeamMember(
                    first_name=user_obj.first_name or "Admin",
                    last_name=user_obj.last_name or "",
                    email=user_obj.email,
                    role="Owner",
                    user_id=user_obj.id,
                    organization_id=user_obj.organization_id
                )
                db.add(member)
                await db.flush()

    if not member:
        raise HTTPException(status_code=400, detail="No active organization calendar found")
        
    # Get organizer user ID
    stmt_user = select(User).where(User.organization_id == member.organization_id)
    res_user = await db.execute(stmt_user)
    user_obj = res_user.scalars().first()
    organizer_id = member.user_id or (user_obj.id if user_obj else None)
        
    # Check for double booking
    stmt_dup = select(Appointment).where(
        Appointment.organization_id == member.organization_id,
        Appointment.start_time == appt_in.start_time,
        Appointment.status != "Cancelled"
    )
    res_dup = await db.execute(stmt_dup)
    if res_dup.scalars().first():
        raise HTTPException(status_code=400, detail="This time slot is already booked by another customer. Please select another slot.")

    # Create lead if doesn't exist
    stmt_lead = select(Lead).where(Lead.email == appt_in.email, Lead.organization_id == member.organization_id)
    res_lead = await db.execute(stmt_lead)
    lead = res_lead.scalars().first()
    if not lead:
        name_parts = appt_in.display_name.split(" ", 1)
        first_name = name_parts[0]
        last_name = name_parts[1] if len(name_parts) > 1 else ""
        lead = Lead(
            first_name=first_name,
            last_name=last_name,
            email=appt_in.email,
            phone=appt_in.phone,
            organization_id=member.organization_id,
            status="New"
        )
        db.add(lead)
        await db.flush()

    # Fetch valid Google OAuth access token if organization connected Google Calendar
    from app.modules.gmail.services import GmailService
    gmail_svc = GmailService(db)
    access_token = await gmail_svc.get_valid_access_token(member.organization_id)
    if not access_token:
        from app.modules.gmail.models import GmailIntegration
        stmt_g_any = select(GmailIntegration).where(GmailIntegration.is_connected == True)
        res_g_any = await db.execute(stmt_g_any)
        g_any_rec = res_g_any.scalars().first()
        if g_any_rec:
            access_token = await gmail_svc.get_valid_access_token(g_any_rec.organization_id)

    # Generate Google Meet video link via Google Calendar API
    from app.modules.calendar.google_meet_service import generate_google_meet_link
    meet_url = await generate_google_meet_link(
        title=appt_in.title,
        start_time=appt_in.start_time,
        end_time=appt_in.end_time,
        attendee_email=appt_in.email,
        access_token=access_token
    )

    # Create appointment
    appt = Appointment(
        title=appt_in.title,
        start_time=appt_in.start_time,
        end_time=appt_in.end_time,
        assigned_to_id=member.id,
        display_name=appt_in.display_name,
        email=appt_in.email,
        phone=appt_in.phone,
        status="Scheduled",
        organization_id=member.organization_id,
        organizer_id=organizer_id,
        lead_id=lead.id,
        location=meet_url,
        related_entity_type="lead",
        related_entity_id=lead.id
    )
    db.add(appt)
    await db.commit()
    await db.refresh(appt)

    # Trigger workflow engine & lifecycle engine for scheduled appointment
    try:
        from app.modules.calendar.lifecycle import MeetingLifecycleEngine
        await MeetingLifecycleEngine.transition_status(
            db, appt.id, "Scheduled", member.organization_id, organizer_id or "system"
        )
    except Exception as e:
        print(f"Warning: Lifecycle transition error: {e}")

    return {
        "status": "success",
        "appointment_id": appt.id,
        "location": appt.location,
        "meet_link": appt.location,
        "message": f"Appointment successfully scheduled for {appt_in.display_name}!"
    }
