from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.modules.auth.schemas import UserCreate, UserResponse, Token
from app.modules.auth.services import AuthService
from app.core.security import get_current_user

router = APIRouter()

def get_auth_service(db: AsyncSession = Depends(get_db)) -> AuthService:
    return AuthService(db)

@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def register(user_in: UserCreate, auth_service: AuthService = Depends(get_auth_service)):
    """
    Register a new user and create a new organization for them.
    """
    user = await auth_service.create_user_with_organization(user_in)
    return user

@router.post("/login", response_model=Token)
async def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    auth_service: AuthService = Depends(get_auth_service)
):
    """
    OAuth2 compatible token login, get an access token for future requests.
    """
    user = await auth_service.authenticate_user(form_data.username, form_data.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    await auth_service.record_login_log(user, status="Success")
    return auth_service.create_tokens(user)

@router.get("/me", response_model=UserResponse)
async def get_me(
    current_user: dict = Depends(get_current_user),
    auth_service: AuthService = Depends(get_auth_service)
):
    """
    Get current logged in user profile.
    """
    user = await auth_service.get_user_by_id(current_user["sub"])
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user

@router.get("/audit-logs")
async def get_audit_logs(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Retrieve login audit logs for the organization."""
    from app.modules.auth.models import UserLoginLog
    from sqlalchemy import select
    res = await db.execute(
        select(UserLoginLog)
        .where(UserLoginLog.organization_id == current_user["org"])
        .order_by(UserLoginLog.created_at.desc())
        .limit(100)
    )
    logs = res.scalars().all()
    return logs
