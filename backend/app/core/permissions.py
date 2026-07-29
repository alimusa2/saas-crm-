"""
Role-Based Access Control (RBAC) & Data Isolation Helpers
"""
from typing import Optional, Dict, List, Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.modules.team.models import TeamMember

def is_admin_user(current_user: dict) -> bool:
    """Returns True if user is superuser or has Admin role."""
    if not current_user:
        return False
    if current_user.get("is_superuser") is True:
        return True
    role = (current_user.get("role") or "").lower()
    return role == "admin"

async def get_user_team_member_id(db: AsyncSession, user_id: str, organization_id: str) -> Optional[str]:
    """Resolves TeamMember ID corresponding to a given User ID."""
    if not user_id or user_id == "system":
        return None
    res = await db.execute(
        select(TeamMember.id).where(
            TeamMember.user_id == user_id,
            TeamMember.organization_id == organization_id,
            TeamMember.is_deleted == False
        )
    )
    return res.scalars().first()

async def get_employee_permissions_context(db: AsyncSession, current_user: dict) -> Dict[str, Any]:
    """
    Returns permission context for current request:
    {
       'is_admin': bool,
       'user_id': str,
       'org_id': str,
       'member_id': Optional[str],
       'assigned_contacts': List[str],
       'assigned_deals': List[str],
       'assigned_calendars': List[str],
       'assigned_funnels': List[str],
       'assigned_forms': List[str],
    }
    """
    user_id = current_user.get("sub") or current_user.get("user_id")
    org_id = current_user.get("org") or current_user.get("organization_id") or "default_org"
    is_admin = is_admin_user(current_user)

    context = {
        "is_admin": is_admin,
        "user_id": user_id,
        "org_id": org_id,
        "member_id": None,
        "assigned_contacts": [],
        "assigned_deals": [],
        "assigned_calendars": [],
        "assigned_funnels": [],
        "assigned_forms": [],
    }

    if is_admin or not user_id or user_id == "system":
        return context

    # Fetch TeamMember details for non-admin employee
    res = await db.execute(
        select(TeamMember).where(
            TeamMember.user_id == user_id,
            TeamMember.organization_id == org_id,
            TeamMember.is_deleted == False
        )
    )
    member = res.scalars().first()
    if member:
        context["member_id"] = member.id
        context["assigned_contacts"] = member.assigned_contacts or []
        context["assigned_deals"] = member.assigned_deals or []
        context["assigned_calendars"] = member.assigned_calendars or []
        context["assigned_funnels"] = member.assigned_funnels or []
        context["assigned_forms"] = member.assigned_forms or []

    return context
