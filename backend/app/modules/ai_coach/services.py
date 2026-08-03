from typing import List, Optional
from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload
from fastapi import HTTPException, status
from app.modules.ai_coach.models import CoachSession, CoachMessage

class CoachSessionService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def create_session(self, user_id: str, org_id: str, title: Optional[str] = None) -> CoachSession:
        session_title = title.strip() if title and title.strip() else "Sales Practice Session"
        session = CoachSession(
            user_id=user_id,
            organization_id=org_id,
            title=session_title,
            is_archived=False
        )
        self.db.add(session)
        await self.db.commit()
        await self.db.refresh(session)
        return session

    async def list_user_sessions(self, user_id: str, org_id: str) -> List[dict]:
        stmt = (
            select(CoachSession)
            .where(
                CoachSession.user_id == user_id,
                CoachSession.organization_id == org_id,
                CoachSession.is_archived == False
            )
            .order_by(CoachSession.updated_at.desc())
        )
        res = await self.db.execute(stmt)
        sessions = list(res.scalars().all())

        result = []
        for s in sessions:
            msg_count_stmt = select(func.count(CoachMessage.id)).where(CoachMessage.session_id == s.id)
            count_res = await self.db.execute(msg_count_stmt)
            msg_count = count_res.scalar() or 0

            result.append({
                "id": s.id,
                "organization_id": s.organization_id,
                "user_id": s.user_id,
                "title": s.title or "Sales Practice Session",
                "is_archived": s.is_archived,
                "created_at": s.created_at,
                "updated_at": s.updated_at,
                "message_count": msg_count,
                "messages": []
            })
        return result

    async def get_session_by_id(self, session_id: str, user_id: str, org_id: str) -> CoachSession:
        stmt = (
            select(CoachSession)
            .options(selectinload(CoachSession.messages))
            .where(CoachSession.id == session_id)
            .execution_options(populate_existing=True)
        )
        res = await self.db.execute(stmt)
        session = res.scalars().first()

        if not session or session.is_archived:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Coach session not found."
            )

        # Multi-tenant and strict User-level privacy enforcement
        if session.user_id != user_id or session.organization_id != org_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Forbidden: You do not have access to this coach session."
            )

        return session

    async def add_message(self, session: CoachSession, role: str, content: str) -> CoachMessage:
        message = CoachMessage(
            session_id=session.id,
            role=role,
            content=content
        )
        self.db.add(message)
        session.updated_at = datetime.now(timezone.utc)

        # Auto-update default title from first user message if needed
        if role == "user" and (not session.title or session.title == "Sales Practice Session"):
            clean_text = content.strip().replace("\n", " ")
            if clean_text:
                session.title = clean_text[:45] + ("..." if len(clean_text) > 45 else "")

        await self.db.commit()
        await self.db.refresh(message)
        return message

    async def archive_session(self, session: CoachSession):
        session.is_archived = True
        session.updated_at = datetime.now(timezone.utc)
        await self.db.commit()

    async def update_session(self, session: CoachSession, title: Optional[str] = None, is_archived: Optional[bool] = None) -> CoachSession:
        if title is not None:
            session.title = title.strip()
        if is_archived is not None:
            session.is_archived = is_archived
        session.updated_at = datetime.now(timezone.utc)
        await self.db.commit()
        await self.db.refresh(session)
        return session
