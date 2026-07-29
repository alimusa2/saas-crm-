from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from fastapi import HTTPException, status
from typing import List, Optional

from app.modules.team.models import TeamMember
from app.modules.team.schemas import TeamMemberCreate, TeamMemberUpdate
from app.modules.auth.models import User
from app.core.security import get_password_hash

class TeamService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_team_members(self, organization_id: str) -> List[TeamMember]:
        result = await self.db.execute(
            select(TeamMember).where(
                TeamMember.organization_id == organization_id,
                TeamMember.is_deleted == False
            )
        )
        return result.scalars().all()

    async def get_departments(self, organization_id: str) -> List[str]:
        from sqlalchemy import distinct
        result = await self.db.execute(
            select(distinct(TeamMember.department)).where(
                TeamMember.organization_id == organization_id,
                TeamMember.is_deleted == False
            )
        )
        return [row for row in result.scalars().all() if row]

    async def get_team_member(self, member_id: str, organization_id: str) -> Optional[TeamMember]:
        result = await self.db.execute(
            select(TeamMember).where(
                TeamMember.id == member_id,
                TeamMember.organization_id == organization_id,
                TeamMember.is_deleted == False
            )
        )
        return result.scalars().first()

    async def create_team_member(self, member_in: TeamMemberCreate, organization_id: str) -> TeamMember:
        # Validate duplicate email in the organization
        email_check = await self.db.execute(
            select(TeamMember).where(
                TeamMember.email == member_in.email,
                TeamMember.organization_id == organization_id,
                TeamMember.is_deleted == False
            )
        )
        if email_check.scalars().first():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This email already exists in your organization."
            )

        # Check if user already exists globally
        user_check = await self.db.execute(
            select(User).where(User.email == member_in.email)
        )
        existing_user = user_check.scalars().first()

        raw_pwd = member_in.password or "Password123"

        user_id = None
        if existing_user:
            if existing_user.organization_id != organization_id:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="This email is registered with another organization."
                )
            user_id = existing_user.id
            existing_user.is_active = (member_in.status == "Active")
            existing_user.first_name = member_in.first_name
            existing_user.last_name = member_in.last_name
            if member_in.password:
                existing_user.hashed_password = get_password_hash(member_in.password)
            if member_in.role == "Admin":
                existing_user.is_superuser = True
        else:
            # Auto-create User account
            new_user = User(
                email=member_in.email,
                hashed_password=get_password_hash(raw_pwd),
                first_name=member_in.first_name,
                last_name=member_in.last_name,
                organization_id=organization_id,
                is_active=(member_in.status == "Active"),
                is_superuser=(member_in.role == "Admin")
            )
            self.db.add(new_user)
            await self.db.flush()  # populate new_user.id
            user_id = new_user.id

        data_dict = member_in.model_dump()
        data_dict.pop("password", None)

        member = TeamMember(
            **data_dict,
            organization_id=organization_id,
            user_id=user_id
        )
        self.db.add(member)
        await self.db.commit()
        await self.db.refresh(member)
        return member

    async def update_team_member(self, member_id: str, member_in: TeamMemberUpdate, organization_id: str) -> Optional[TeamMember]:
        member = await self.get_team_member(member_id, organization_id)
        if not member:
            return None

        update_data = member_in.model_dump(exclude_unset=True)
        pwd_to_update = update_data.pop("password", None)

        if "email" in update_data and update_data["email"] != member.email:
            email_check = await self.db.execute(
                select(TeamMember).where(
                    TeamMember.email == update_data["email"],
                    TeamMember.organization_id == organization_id,
                    TeamMember.is_deleted == False,
                    TeamMember.id != member_id
                )
            )
            if email_check.scalars().first():
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="This email already exists in your organization."
                )
            
            user_check = await self.db.execute(
                select(User).where(User.email == update_data["email"])
            )
            existing_user = user_check.scalars().first()
            if existing_user and existing_user.organization_id != organization_id:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="This email is registered with another organization."
                )

        # Update member fields
        for key, val in update_data.items():
            setattr(member, key, val)

        # Sync with User model if user_id exists
        if member.user_id:
            res_u = await self.db.execute(select(User).where(User.id == member.user_id))
            user = res_u.scalars().first()
            if user:
                user.first_name = member.first_name
                user.last_name = member.last_name
                user.email = member.email
                if "status" in update_data:
                    user.is_active = (member.status == "Active")
                if "role" in update_data:
                    user.is_superuser = (member.role == "Admin")
                if pwd_to_update:
                    user.hashed_password = get_password_hash(pwd_to_update)

        await self.db.commit()
        await self.db.refresh(member)
        return member

    async def delete_team_member(self, member_id: str, organization_id: str) -> bool:
        member = await self.get_team_member(member_id, organization_id)
        if not member:
            return False

        member.is_deleted = True
        member.status = "Inactive"

        # Deactivate corresponding user
        if member.user_id:
            res_u = await self.db.execute(select(User).where(User.id == member.user_id))
            user = res_u.scalars().first()
            if user:
                user.is_active = False

        await self.db.commit()
        return True
