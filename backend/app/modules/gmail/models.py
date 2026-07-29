"""
Gmail OAuth 2.0 Integration Model
Stores per-organization Gmail connection with encrypted tokens.
"""
from sqlalchemy import Column, String, Boolean, DateTime, Text, Integer
from app.db.base_class import TenantAwareBase


class GmailIntegration(TenantAwareBase):
    """
    Represents a Gmail OAuth connection for a single organization.
    Each organization can connect exactly one Gmail account.
    Tokens are stored AES-encrypted (Fernet) — never in plaintext.
    """
    # The verified Gmail address that was connected
    gmail_address = Column(String, nullable=True)

    # Encrypted OAuth tokens (Fernet AES-128 CBC)
    access_token_enc = Column(Text, nullable=True)
    refresh_token_enc = Column(Text, nullable=True)

    # Token expiry (UTC) — used to auto-refresh before sending
    token_expiry = Column(DateTime(timezone=True), nullable=True)

    # Connection state
    is_connected = Column(Boolean, default=False, nullable=False)
    connected_at = Column(DateTime(timezone=True), nullable=True)

    # Provider name (extensible: gmail, outlook, etc.)
    provider = Column(String, default="gmail", nullable=False)

    # Last error message (for display in UI)
    error_message = Column(Text, nullable=True)

    # Sync Tracking
    last_synced_at = Column(DateTime(timezone=True), nullable=True)
    sync_status = Column(String, default="Idle", nullable=False) # Idle | Syncing | Success | Failed
    last_sync_message = Column(Text, nullable=True)


class GmailSyncLog(TenantAwareBase):
    """
    Log history for incoming Gmail synchronization jobs.
    """
    gmail_address = Column(String, nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=False)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    status = Column(String, default="In Progress", nullable=False) # In Progress | Success | Failed
    imported_count = Column(Integer, default=0, nullable=False)
    skipped_count = Column(Integer, default=0, nullable=False)
    error_message = Column(Text, nullable=True)

