"""
Gmail OAuth Router
Exposes endpoints for:
  - Checking Gmail connection status
  - Getting the OAuth authorization URL
  - Handling the OAuth callback (Google redirects here)
  - Disconnecting Gmail
  - Testing the connection
"""
import json
import base64

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.core.security import get_current_user
from app.modules.gmail.schemas import (
    GmailIntegrationResponse,
    GmailOAuthUrlResponse,
    GmailTestResponse,
)
from app.modules.gmail.services import GmailService, build_oauth_url
from app.core.config import settings

router = APIRouter()


def get_gmail_service(db: AsyncSession = Depends(get_db)) -> GmailService:
    return GmailService(db)


@router.get("/status", response_model=GmailIntegrationResponse)
async def get_gmail_status(
    current_user: dict = Depends(get_current_user),
    gmail_service: GmailService = Depends(get_gmail_service),
):
    """Return the Gmail connection status for the current organization."""
    record = await gmail_service.get_status(current_user["org"])
    return record


@router.get("/oauth-url", response_model=GmailOAuthUrlResponse)
async def get_oauth_url(
    current_user: dict = Depends(get_current_user),
):
    """Return the Google OAuth 2.0 authorization URL to redirect the user to."""
    url = build_oauth_url(current_user["org"])
    return {"url": url}


@router.get("/callback")
@router.get("/oauth/callback")
async def oauth_callback(
    code: str = Query(None),
    state: str = Query(None),
    error: str = Query(None),
    sim: str = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """
    Google redirects here after the user grants (or denies) permission.
    We exchange the code for tokens, then redirect back to the frontend.
    Note: This endpoint is NOT protected by JWT — Google drives the redirect.
    The organization is identified via the `state` parameter.
    """
    frontend_base = settings.FRONTEND_URL

    if error:
        return RedirectResponse(
            url=f"{frontend_base}/integrations?oauth=google&status=error&message={error}"
        )

    if not code or not state:
        return RedirectResponse(
            url=f"{frontend_base}/integrations?oauth=google&status=error&message=missing_params"
        )

    # Decode state to get organization_id
    try:
        state_data = json.loads(base64.urlsafe_b64decode(state.encode()).decode())
        organization_id = state_data["org_id"]
    except Exception:
        return RedirectResponse(
            url=f"{frontend_base}/integrations?oauth=google&status=error&message=invalid_state"
        )

    gmail_service = GmailService(db)
    record = await gmail_service.handle_oauth_callback(
        code=code,
        state=state,
        organization_id=organization_id,
    )

    if record.is_connected:
        return RedirectResponse(
            url=f"{frontend_base}/integrations?oauth=google&status=success&email={record.gmail_address or ''}"
        )
    else:
        msg = (record.error_message or "unknown_error").replace(" ", "+")
        return RedirectResponse(
            url=f"{frontend_base}/integrations?oauth=google&status=error&message={msg}"
        )


@router.post("/disconnect", response_model=GmailIntegrationResponse)
async def disconnect_gmail(
    current_user: dict = Depends(get_current_user),
    gmail_service: GmailService = Depends(get_gmail_service),
):
    """Disconnect the Gmail account for the current organization."""
    record = await gmail_service.disconnect(current_user["org"])
    return record


@router.post("/test", response_model=GmailTestResponse)
async def test_gmail_connection(
    current_user: dict = Depends(get_current_user),
    gmail_service: GmailService = Depends(get_gmail_service),
):
    """Test whether the stored Gmail credentials are still valid."""
    result = await gmail_service.test_connection(current_user["org"])
    return result


@router.post("/sync-now")
async def trigger_manual_sync(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Trigger an immediate manual synchronization of incoming Gmail messages."""
    from app.modules.gmail.sync_service import GmailSyncService
    gmail_service = GmailService(db)
    record = await gmail_service.get_status(current_user["org"])

    if not record.is_connected:
        raise HTTPException(status_code=400, detail="Gmail is not connected for this organization.")

    sync_svc = GmailSyncService(db)
    summary = await sync_svc.sync_mailbox(record)
    return {"success": True, "message": summary, "last_synced_at": record.last_synced_at}


@router.get("/sync-logs")
async def get_sync_logs(
    current_user: dict = Depends(get_current_user),
    gmail_service: GmailService = Depends(get_gmail_service),
):
    """Fetch history of synchronization runs for Settings display."""
    logs = await gmail_service.get_sync_logs(current_user["org"])
    return logs


@router.get("/attachments/{message_id}/{attachment_id}")
async def download_gmail_attachment(
    message_id: str,
    attachment_id: str,
    current_user: dict = Depends(get_current_user),
    gmail_service: GmailService = Depends(get_gmail_service),
):
    """
    Proxy endpoint to download an attachment directly via Gmail API.
    Returns base64 data to client.
    """
    res = await gmail_service.get_attachment_data(
        organization_id=current_user["org"],
        message_id=message_id,
        attachment_id=attachment_id,
    )
    if not res.get("success"):
        raise HTTPException(status_code=400, detail=res.get("error", "Failed to fetch attachment"))
    return res

