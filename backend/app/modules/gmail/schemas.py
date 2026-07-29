from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class GmailIntegrationResponse(BaseModel):
    """Public-facing Gmail integration status. Never exposes tokens."""
    id: Optional[str] = None
    organization_id: Optional[str] = None
    gmail_address: Optional[str] = None
    is_connected: bool = False
    connected_at: Optional[datetime] = None
    provider: str = "gmail"
    error_message: Optional[str] = None
    last_synced_at: Optional[datetime] = None
    sync_status: str = "Idle"
    last_sync_message: Optional[str] = None

    class Config:
        from_attributes = True



class GmailOAuthUrlResponse(BaseModel):
    """The Google OAuth authorization URL to redirect the user to."""
    url: str


class GmailSendEmailRequest(BaseModel):
    """Request body to send an email via Gmail API."""
    to_email: str
    subject: str
    body: str
    lead_id: Optional[str] = None
    contact_id: Optional[str] = None
    parent_id: Optional[str] = None  # For threading replies


class GmailTestResponse(BaseModel):
    success: bool
    message: str
    gmail_address: Optional[str] = None
