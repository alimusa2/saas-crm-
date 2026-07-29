from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from fastapi import HTTPException
from typing import Sequence

from app.modules.notifications.models import Notification
from app.modules.notifications.schemas import NotificationCreate

class NotificationService:
    @staticmethod
    async def get_user_notifications(db: AsyncSession, user_id: str, organization_id: str) -> Sequence[Notification]:
        stmt = select(Notification).where(
            Notification.user_id == user_id, 
            Notification.organization_id == organization_id
        ).order_by(Notification.created_at.desc())
        result = await db.execute(stmt)
        return result.scalars().all()

    @staticmethod
    async def create_notification(db: AsyncSession, obj_in: NotificationCreate, organization_id: str) -> Notification:
        db_obj = Notification(**obj_in.model_dump(), organization_id=organization_id)
        db.add(db_obj)
        await db.commit()
        await db.refresh(db_obj)
        return db_obj

    @staticmethod
    async def mark_as_read(db: AsyncSession, notification_id: str, user_id: str, organization_id: str) -> Notification:
        stmt = select(Notification).where(
            Notification.id == notification_id,
            Notification.user_id == user_id,
            Notification.organization_id == organization_id
        )
        result = await db.execute(stmt)
        notif = result.scalar_one_or_none()
        if not notif:
            raise HTTPException(status_code=404, detail="Notification not found")
        
        notif.is_read = True
        await db.commit()
        await db.refresh(notif)
        return notif

    @staticmethod
    async def mark_all_as_read(db: AsyncSession, user_id: str, organization_id: str) -> None:
        stmt = select(Notification).where(
            Notification.user_id == user_id,
            Notification.organization_id == organization_id,
            Notification.is_read == False
        )
        result = await db.execute(stmt)
        unread_notifs = result.scalars().all()
        for notif in unread_notifs:
            notif.is_read = True
        await db.commit()
