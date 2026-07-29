from fastapi import Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from typing import AsyncGenerator

from app.db.session import get_db
from app.core.security import get_current_user
from app.modules.auth.models import User
from app.modules.auth.services import AuthService

async def get_auth_service(db: AsyncSession = Depends(get_db)) -> AuthService:
    return AuthService(db)

async def get_current_active_user(
    current_user: dict = Depends(get_current_user),
    auth_service: AuthService = Depends(get_auth_service)
) -> User:
    """Resolve the current authenticated user; raises 404/400 if absent or inactive."""
    user = await auth_service.get_user_by_id(current_user["sub"])
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Inactive user")
    return user

async def get_current_org_id(
    current_user: dict = Depends(get_current_user)
) -> str:
    """Return the organization_id for the authenticated user (fast path, no DB hit)."""
    org_id = current_user.get("org")
    if not org_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No organization context")
    return org_id

from sqlalchemy.future import select

async def get_employee_context(
    user: User,
    db: AsyncSession
) -> dict:
    """Helper to return role context and team member assignment context for an authenticated user."""
    from app.modules.team.models import TeamMember
    
    if user.is_superuser:
        return {
            "is_admin": True,
            "team_member_id": None,
            "team_member": None,
            "role": "Admin"
        }
        
    stmt_tm = select(TeamMember).where(
        TeamMember.organization_id == user.organization_id,
        (TeamMember.user_id == user.id) | (TeamMember.email == user.email),
        TeamMember.is_deleted == False
    )
    res_tm = await db.execute(stmt_tm)
    tm = res_tm.scalars().first()
    
    is_admin = bool(user.is_superuser or (tm and tm.role in ["Admin", "Owner"]))
    role = "Admin" if is_admin else (tm.role if tm else "Employee")
    
    return {
        "is_admin": is_admin,
        "team_member_id": tm.id if tm else None,
        "team_member": tm,
        "role": role
    }

async def require_org_admin(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_active_user)
) -> User:
    """Ensure the current user is a superuser/admin of their organization."""
    ctx = await get_employee_context(user, db)
    if not ctx["is_admin"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required for this action"
        )
    return user
