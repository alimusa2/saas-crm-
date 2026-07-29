"""
GrowthOS Core Configuration
"""
from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    APP_NAME: str = "GrowthOS"
    APP_VERSION: str = "0.1.0"
    DEBUG: bool = True
    API_V1_PREFIX: str = "/api/v1"
    
    # CORS
    FRONTEND_URL: str = "http://localhost:5173"
    
    # JWT (placeholder for future Supabase integration)
    JWT_SECRET: str = "growthOS-dev-secret-key-change-in-production"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 43200  # 30 days

    # Database
    DATABASE_URL: str = "sqlite+aiosqlite:///./growthos.db"
    REDIS_URL: str = "redis://localhost:6379/0"
    CELERY_ALWAYS_EAGER: bool = True

    # ─── SMTP Email ───────────────────────────────────────────────────────────
    # Leave blank to run in simulation/logging mode (no real emails sent).
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM_EMAIL: str = ""
    SMTP_FROM_NAME: str = "GrowthOS"
    SMTP_USE_TLS: bool = True

    # ─── Stripe ───────────────────────────────────────────────────────────────
    # Obtain from https://dashboard.stripe.com/apikeys
    STRIPE_API_KEY: str = ""
    STRIPE_WEBHOOK_SECRET: str = ""

    # ─── PayPal ───────────────────────────────────────────────────────────────
    # Obtain from https://developer.paypal.com/dashboard/applications
    PAYPAL_CLIENT_ID: str = ""
    PAYPAL_CLIENT_SECRET: str = ""
    PAYPAL_WEBHOOK_ID: str = ""
    PAYPAL_MODE: str = "sandbox"  # "sandbox" or "live"

    # ─── Google / Gmail OAuth ─────────────────────────────────────────────────
    # Set these in your .env file to enable real Gmail OAuth.
    # Leave as defaults to run in simulation mode.
    GOOGLE_CLIENT_ID: str = "YOUR_GOOGLE_CLIENT_ID"
    GOOGLE_CLIENT_SECRET: str = "YOUR_GOOGLE_CLIENT_SECRET"
    # This must match the authorized redirect URI in your Google Cloud Console
    GOOGLE_REDIRECT_URI: str = "http://localhost:8000/api/v1/gmail/callback"

    # Fernet symmetric encryption key for storing OAuth tokens at rest.
    # Generate one with: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    # If left empty, a new key is generated per process start (dev only — tokens won't survive restarts).
    GMAIL_ENCRYPTION_KEY: Optional[str] = None

    # Storage settings
    STORAGE_TYPE: str = "local"  # local, s3, cloudinary
    S3_BUCKET: str = ""
    S3_ACCESS_KEY: str = ""
    S3_SECRET_KEY: str = ""
    S3_REGION: str = ""
    CLOUDINARY_URL: str = ""  # e.g. cloudinary://API_KEY:API_SECRET@CLOUD_NAME

    @property
    def SQLALCHEMY_DATABASE_URI(self) -> str:
        import os
        return os.getenv("DATABASE_URL", self.DATABASE_URL)


    class Config:
        env_file = ".env"


settings = Settings()
