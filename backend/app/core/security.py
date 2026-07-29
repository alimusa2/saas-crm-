"""
JWT Security Utilities
"""
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from passlib.context import CryptContext

from app.core.config import settings

security = HTTPBearer(auto_error=False)
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def create_refresh_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(days=30)
    to_encode.update({"exp": expire, "type": "refresh"})
    return jwt.encode(to_encode, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def verify_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token has expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> dict:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    payload = verify_token(credentials.credentials)
    
    user_id = payload.get("sub") or payload.get("user_id") or "system"
    org_id = payload.get("org") or payload.get("organization_id")
    
    is_superuser = payload.get("is_superuser", False)
    role = payload.get("role", "Member")
    
    # Dynamically resolve organization_id and role from database
    from app.db.session import AsyncSessionLocal
    from app.modules.auth.models import User
    from app.modules.team.models import TeamMember
    from sqlalchemy import select
    
    if user_id and user_id != "system":
        try:
            async with AsyncSessionLocal() as db:
                res = await db.execute(select(User).where(User.id == user_id))
                user = res.scalars().first()
                if user:
                    if user.organization_id:
                        org_id = user.organization_id
                    is_superuser = user.is_superuser
                    
                    res_tm = await db.execute(select(TeamMember).where(TeamMember.user_id == user_id, TeamMember.is_deleted == False))
                    tm = res_tm.scalars().first()
                    if tm:
                        role = tm.role
                    elif is_superuser:
                        role = "Admin"
        except Exception:
            pass

    if not org_id:
        org_id = "default_org"

    payload["sub"] = user_id
    payload["user_id"] = user_id
    payload["org"] = org_id
    payload["organization_id"] = org_id
    payload["is_superuser"] = is_superuser
    payload["role"] = role
    return payload


def get_fernet():
    from cryptography.fernet import Fernet
    key = settings.GMAIL_ENCRYPTION_KEY
    if not key:
        key = Fernet.generate_key().decode()
    if isinstance(key, str):
        key = key.encode()
    return Fernet(key)


def encrypt_data(text: str) -> str:
    """Encrypt sensitive string at rest."""
    if not text:
        return ""
    f = get_fernet()
    return f.encrypt(text.encode()).decode()


def decrypt_data(ciphertext: str) -> str:
    """Decrypt sensitive string."""
    if not ciphertext:
        return ""
    f = get_fernet()
    return f.decrypt(ciphertext.encode()).decode()

