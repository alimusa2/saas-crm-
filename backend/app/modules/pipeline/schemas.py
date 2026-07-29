from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

class StageBase(BaseModel):
    name: str
    order: int

class StageCreate(StageBase):
    pass

class StageResponse(StageBase):
    id: str
    pipeline_id: str
    organization_id: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class PipelineBase(BaseModel):
    name: str
    description: Optional[str] = None
    status_stage_mapping: Optional[dict] = None

class PipelineCreate(PipelineBase):
    pass

class PipelineUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    status_stage_mapping: Optional[dict] = None

class PipelineResponse(PipelineBase):
    id: str
    organization_id: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class DealBase(BaseModel):
    title: str
    value: float
    status: Optional[str] = "Open"
    stage_id: str
    lead_id: Optional[str] = None

class DealCreate(DealBase):
    pass

class DealUpdate(BaseModel):
    title: Optional[str] = None
    value: Optional[float] = None
    status: Optional[str] = None
    stage_id: Optional[str] = None
    lead_id: Optional[str] = None

class DealResponse(DealBase):
    id: str
    organization_id: str
    owner_id: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
