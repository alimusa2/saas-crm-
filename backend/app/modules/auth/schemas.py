from pydantic import BaseModel, EmailStr
from typing import Optional

class UserBase(BaseModel):
    email: EmailStr
    first_name: Optional[str] = None
    last_name: Optional[str] = None

class UserCreate(UserBase):
    password: str
    organization_name: str

class UserResponse(UserBase):
    id: str
    is_active: bool
    is_superuser: bool
    organization_id: str
    role: Optional[str] = "Admin"
    team_member_id: Optional[str] = None
    
    class Config:
        from_attributes = True

class Token(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"

class TokenPayload(BaseModel):
    sub: str = None
    org: str = None
