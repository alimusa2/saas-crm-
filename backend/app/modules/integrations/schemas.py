from pydantic import BaseModel
from typing import Optional
from datetime import datetime

class IntegrationCreate(BaseModel):
    name: str
    slug: str
    description: Optional[str] = None
    icon_url: Optional[str] = None

class IntegrationToggle(BaseModel):
    is_connected: bool

class IntegrationResponse(BaseModel):
    id: str
    name: str
    slug: str
    is_connected: bool
    description: Optional[str] = None
    icon_url: Optional[str] = None
    organization_id: str
    created_at: datetime

    class Config:
        from_attributes = True
