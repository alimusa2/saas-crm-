"""
Settings module - allows updating organization and user profile settings.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from pydantic import BaseModel
from typing import Optional

from app.db.session import get_db
from app.core.security import get_current_user
from app.modules.auth.models import User
from app.modules.organization.models import Organization

router = APIRouter()

class UserProfileUpdate(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None

class OrgUpdate(BaseModel):
    name: Optional[str] = None
    domain: Optional[str] = None
    settings_json: Optional[str] = None

class UserProfileResponse(BaseModel):
    id: str
    email: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    is_active: bool
    organization_id: str
    is_superuser: bool

    class Config:
        from_attributes = True

class OrgResponse(BaseModel):
    id: str
    name: str
    domain: Optional[str] = None
    settings_json: Optional[str] = None

    class Config:
        from_attributes = True

@router.get("/profile", response_model=UserProfileResponse)
async def get_profile(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Get current user's profile."""
    result = await db.execute(select(User).where(User.id == current_user["sub"]))
    user = result.scalars().first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user

@router.patch("/profile", response_model=UserProfileResponse)
async def update_profile(
    profile_in: UserProfileUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Update current user's profile."""
    result = await db.execute(select(User).where(User.id == current_user["sub"]))
    user = result.scalars().first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    update_data = profile_in.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(user, key, value)
    
    await db.commit()
    await db.refresh(user)
    return user

@router.get("/organization", response_model=OrgResponse)
async def get_organization(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Get current organization info."""
    result = await db.execute(select(Organization).where(Organization.id == current_user["org"]))
    org = result.scalars().first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    return org

@router.patch("/organization", response_model=OrgResponse)
async def update_organization(
    org_in: OrgUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Update current organization info."""
    result = await db.execute(select(Organization).where(Organization.id == current_user["org"]))
    org = result.scalars().first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    
    update_data = org_in.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(org, key, value)
    
    await db.commit()
    await db.refresh(org)
    return org
