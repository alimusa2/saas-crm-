from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List

from app.db.session import get_db
from app.modules.auth.dependencies import get_current_active_user
from app.modules.auth.models import User
from app.modules.notifications.schemas import NotificationResponse
from app.modules.notifications.services import NotificationService

router = APIRouter()

@router.get("/", response_model=List[NotificationResponse])
async def read_notifications(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    return await NotificationService.get_user_notifications(db, current_user.id, current_user.organization_id)

@router.patch("/{notification_id}/read", response_model=NotificationResponse)
async def mark_notification_read(
    notification_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    return await NotificationService.mark_as_read(db, notification_id, current_user.id, current_user.organization_id)

@router.post("/mark-all-read")
async def mark_all_notifications_read(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    await NotificationService.mark_all_as_read(db, current_user.id, current_user.organization_id)
    return {"message": "All notifications marked as read"}
