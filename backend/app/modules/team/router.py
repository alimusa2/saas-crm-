from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List

from app.db.session import get_db
from app.core.security import get_current_user
from app.modules.team.schemas import TeamMemberCreate, TeamMemberUpdate, TeamMemberResponse
from app.modules.team.services import TeamService

router = APIRouter()

def get_team_service(db: AsyncSession = Depends(get_db)) -> TeamService:
    return TeamService(db)

@router.get("/", response_model=List[TeamMemberResponse])
async def list_team_members(
    team_service: TeamService = Depends(get_team_service),
    current_user: dict = Depends(get_current_user)
):
    """Retrieve all team members for the organization."""
    return await team_service.get_team_members(current_user["org"])

@router.get("/departments", response_model=List[str])
async def list_departments(
    team_service: TeamService = Depends(get_team_service),
    current_user: dict = Depends(get_current_user)
):
    """Retrieve all unique departments configured in Team Management for the organization."""
    return await team_service.get_departments(current_user["org"])

@router.get("/{member_id}", response_model=TeamMemberResponse)
async def get_team_member(
    member_id: str,
    team_service: TeamService = Depends(get_team_service),
    current_user: dict = Depends(get_current_user)
):
    """Get a specific team member by ID."""
    member = await team_service.get_team_member(member_id, current_user["org"])
    if not member:
        raise HTTPException(status_code=404, detail="Team member not found")
    return member

from app.modules.auth.dependencies import require_org_admin
from app.modules.auth.models import User

@router.post("/", response_model=TeamMemberResponse, status_code=status.HTTP_201_CREATED)
async def create_team_member(
    member_in: TeamMemberCreate,
    team_service: TeamService = Depends(get_team_service),
    current_user: dict = Depends(get_current_user),
    admin_user: User = Depends(require_org_admin)
):
    """Create a new team member and link or create their user account."""
    return await team_service.create_team_member(member_in, current_user["org"])

@router.patch("/{member_id}", response_model=TeamMemberResponse)
async def update_team_member(
    member_id: str,
    member_in: TeamMemberUpdate,
    team_service: TeamService = Depends(get_team_service),
    current_user: dict = Depends(get_current_user),
    admin_user: User = Depends(require_org_admin)
):
    """Update team member details."""
    member = await team_service.update_team_member(member_id, member_in, current_user["org"])
    if not member:
        raise HTTPException(status_code=404, detail="Team member not found")
    return member

@router.delete("/{member_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_team_member(
    member_id: str,
    team_service: TeamService = Depends(get_team_service),
    current_user: dict = Depends(get_current_user),
    admin_user: User = Depends(require_org_admin)
):
    """Soft delete a team member and deactivate their user account."""
    success = await team_service.delete_team_member(member_id, current_user["org"])
    if not success:
        raise HTTPException(status_code=404, detail="Team member not found")
