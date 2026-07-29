from pydantic import BaseModel
from typing import Optional
from datetime import datetime

class ReviewCreate(BaseModel):
    reviewer_name: str
    reviewer_email: Optional[str] = None
    rating: int = 5
    title: Optional[str] = None
    content: Optional[str] = None
    source: str = "Manual"
    lead_id: Optional[str] = None
    contact_id: Optional[str] = None

class ReviewUpdate(BaseModel):
    status: Optional[str] = None
    is_featured: Optional[bool] = None
    title: Optional[str] = None
    content: Optional[str] = None

class ReviewResponse(BaseModel):
    id: str
    reviewer_name: str
    reviewer_email: Optional[str] = None
    rating: int
    title: Optional[str] = None
    content: Optional[str] = None
    source: str
    status: str
    is_featured: bool
    lead_id: Optional[str] = None
    contact_id: Optional[str] = None
    organization_id: str
    created_at: datetime

    class Config:
        from_attributes = True
