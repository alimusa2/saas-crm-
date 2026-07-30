from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from typing import List, Optional

from app.db.session import get_db
from app.core.security import get_current_user
from app.modules.inbox.schemas import MessageCreate, MessageResponse, EmailSendRequest, LinkMessageRequest
from app.modules.inbox.services import InboxService
from app.modules.auth.models import User

router = APIRouter()


def get_inbox_service(db: AsyncSession = Depends(get_db)) -> InboxService:
    return InboxService(db)


@router.get("/", response_model=List[MessageResponse])
async def list_messages(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    include_full_body: bool = Query(False),
    lead_id: Optional[str] = Query(None),
    contact_id: Optional[str] = Query(None),
    thread_id: Optional[str] = Query(None),
    inbox_service: InboxService = Depends(get_inbox_service),
    current_user: dict = Depends(get_current_user),
):
    """List messages for the organization with pagination, body truncation, and thread filtering."""
    return await inbox_service.get_messages(
        organization_id=current_user["org"],
        user_id=current_user["sub"],
        skip=skip,
        limit=limit,
        include_full_body=include_full_body,
        lead_id=lead_id,
        contact_id=contact_id,
        thread_id=thread_id,
    )


@router.get("/{message_id}", response_model=MessageResponse)
async def get_message(
    message_id: str,
    inbox_service: InboxService = Depends(get_inbox_service),
    current_user: dict = Depends(get_current_user),
):
    """Retrieve full message detail by ID including full raw HTML body."""
    msg = await inbox_service.get_message_by_id(message_id, current_user["org"])
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    return msg


@router.post("/", response_model=MessageResponse, status_code=status.HTTP_201_CREATED)
async def send_message(
    msg_in: MessageCreate,
    inbox_service: InboxService = Depends(get_inbox_service),
    current_user: dict = Depends(get_current_user),
):
    """Send a new internal message or log an SMS."""
    msg = await inbox_service.send_message(msg_in, current_user["org"], current_user["sub"])
    try:
        from app.core.websocket_manager import broadcast_event
        await broadcast_event(current_user["org"], "inbox.new_message", {"id": msg.id, "subject": msg.subject})
    except Exception:
        pass
    return msg


@router.post("/send-email", response_model=MessageResponse, status_code=status.HTTP_201_CREATED)
async def send_email(
    req: EmailSendRequest,
    db: AsyncSession = Depends(get_db),
    inbox_service: InboxService = Depends(get_inbox_service),
    current_user: dict = Depends(get_current_user),
):
    """
    Send an email via Gmail OAuth API.
    Requires a Gmail account connected in Settings → Email Integration.
    The message is always recorded in the inbox with delivery status.
    """
    # Fetch sender's CRM email for fallback
    result = await db.execute(select(User).where(User.id == current_user["sub"]))
    sender_user = result.scalars().first()
    sender_crm_email = sender_user.email if sender_user else "unknown@crm.local"

    msg = await inbox_service.send_email_via_gmail(
        req=req,
        organization_id=current_user["org"],
        sender_id=current_user["sub"],
        sender_crm_email=sender_crm_email,
    )
    try:
        from app.core.websocket_manager import broadcast_event
        await broadcast_event(current_user["org"], "inbox.new_message", {"id": msg.id, "subject": msg.subject})
    except Exception:
        pass
    return msg


@router.patch("/{message_id}/read", response_model=MessageResponse)
async def mark_read(
    message_id: str,
    inbox_service: InboxService = Depends(get_inbox_service),
    current_user: dict = Depends(get_current_user),
):
    """Mark a message as read."""
    msg = await inbox_service.mark_as_read(message_id, current_user["org"])
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    return msg

@router.patch("/{message_id}/link", response_model=MessageResponse)
async def link_message(
    message_id: str,
    req: LinkMessageRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Link a message manually to a lead or contact."""
    result = await db.execute(
        select(Message).where(
            Message.id == message_id,
            Message.organization_id == current_user["org"]
        )
    )
    msg = result.scalars().first()
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    
    msg.lead_id = req.lead_id
    msg.contact_id = req.contact_id
    msg.is_ambiguous = False
    msg.is_unknown_contact = False
    await db.commit()
    await db.refresh(msg)
    return msg


@router.patch("/{message_id}/star", response_model=MessageResponse)
async def toggle_star(
    message_id: str,
    inbox_service: InboxService = Depends(get_inbox_service),
    current_user: dict = Depends(get_current_user),
):
    """Toggle star status for a message."""
    msg = await inbox_service.toggle_star(message_id, current_user["org"])
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    return msg


@router.patch("/{message_id}/archive", response_model=MessageResponse)
async def toggle_archive(
    message_id: str,
    inbox_service: InboxService = Depends(get_inbox_service),
    current_user: dict = Depends(get_current_user),
):
    """Toggle archive status for a message."""
    msg = await inbox_service.toggle_archive(message_id, current_user["org"])
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    return msg


