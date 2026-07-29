from pydantic import BaseModel, ConfigDict
from typing import List, Optional, Any, Dict
from datetime import datetime

class FormFieldBase(BaseModel):
    name: str
    label: str
    field_type: str
    is_required: bool = False
    order: int = 0
    options: Optional[Dict[str, Any]] = None

class FormFieldCreate(FormFieldBase):
    pass

class FormFieldResponse(FormFieldBase):
    id: str
    form_id: str
    organization_id: str
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)

class FormBase(BaseModel):
    title: str
    description: Optional[str] = None
    embed_code: Optional[str] = None
    is_active: bool = True

class FormCreate(FormBase):
    pass

class FormResponse(FormBase):
    id: str
    organization_id: str
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)

class FormWithFieldsResponse(FormResponse):
    fields: List[FormFieldResponse]

class FormSubmissionCreate(BaseModel):
    payload: Dict[str, Any]

class FormSubmissionResponse(BaseModel):
    id: str
    form_id: str
    organization_id: str
    payload: Dict[str, Any]
    lead_id: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)
