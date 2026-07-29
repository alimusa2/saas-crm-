from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import datetime

class WorkflowBase(BaseModel):
    name: str
    description: Optional[str] = None
    is_active: bool = False
    trigger: Optional[str] = None
    flow_data: Optional[Dict[str, Any]] = None

class WorkflowCreate(WorkflowBase):
    pass

class WorkflowUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None
    trigger: Optional[str] = None
    flow_data: Optional[Dict[str, Any]] = None

class WorkflowResponse(WorkflowBase):
    id: str
    organization_id: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class WorkflowExecutionResponse(BaseModel):
    id: str
    workflow_id: str
    status: str
    started_at: datetime
    completed_at: Optional[datetime] = None
    execution_duration: Optional[float] = None
    error_message: Optional[str] = None

    class Config:
        from_attributes = True
