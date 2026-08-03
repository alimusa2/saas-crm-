from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from fastapi import HTTPException, status

from app.modules.auth.models import User, Role
from app.modules.organization.models import Organization
from app.modules.auth.schemas import UserCreate
from app.core.security import get_password_hash, verify_password, get_password_hash_async, verify_password_async, create_access_token, create_refresh_token

async def seed_org_in_background(org_id: str, user_id: str):
    from app.db.session import AsyncSessionLocal
    from app.db.seeds import seed_organization_data
    async with AsyncSessionLocal() as session:
        try:
            await seed_organization_data(session, org_id, user_id)
            await session.commit()
        except Exception:
            await session.rollback()

class AuthService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_user_by_email(self, email: str) -> User:
        result = await self.db.execute(select(User).where(User.email == email))
        return result.scalars().first()

    async def get_user_by_id(self, user_id: str) -> User:
        result = await self.db.execute(select(User).where(User.id == user_id))
        return result.scalars().first()

    async def create_user_with_organization(self, user_in: UserCreate, background_tasks = None) -> User:
        # Check if user exists
        existing_user = await self.get_user_by_email(user_in.email)
        if existing_user:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="User with this email already exists"
            )

        # Create Organization
        org = Organization(name=user_in.organization_name)
        self.db.add(org)
        await self.db.flush() # flush to get org.id

        # Create User
        hashed_pwd = await get_password_hash_async(user_in.password)
        user = User(
            email=user_in.email,
            hashed_password=hashed_pwd,
            first_name=user_in.first_name,
            last_name=user_in.last_name,
            organization_id=org.id,
            is_superuser=True # The first user of an organization is an admin
        )
        self.db.add(user)
        await self.db.flush() # flush to get user.id

        await self.db.commit()
        await self.db.refresh(user)
        return user

    async def authenticate_user(self, email: str, password: str) -> User:
        user = await self.get_user_by_email(email)
        if not user:
            return None
        if not await verify_password_async(password, user.hashed_password):
            return None
        return user

    def create_tokens(self, user: User, role: Optional[str] = None) -> dict:
        user_role = role or ("Admin" if user.is_superuser else "Member")
        payload = {
            "sub": user.id,
            "org": user.organization_id,
            "is_superuser": bool(user.is_superuser),
            "role": user_role
        }
        access_token = create_access_token(payload)
        refresh_token = create_refresh_token(payload)
        return {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "token_type": "bearer"
        }

    async def record_login_log(self, user: User, status: str = "Success", ip_address: str = "127.0.0.1", user_agent: str = "Web Browser"):
        """Optional login audit logging helper."""
        pass

