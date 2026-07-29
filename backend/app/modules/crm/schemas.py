from pydantic import BaseModel, EmailStr
from typing import Optional, List
from datetime import datetime

class LeadBase(BaseModel):
    first_name: str
    last_name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    status: Optional[str] = "New"
    priority: Optional[str] = "Normal"
    lead_source: Optional[str] = None
    company_id: Optional[str] = None
    industry: Optional[str] = None
    budget: Optional[float] = None
    expected_revenue: Optional[float] = None
    lead_score: Optional[int] = 0
    billing_address: Optional[str] = None
    tax_information: Optional[str] = None
    automatic_score: Optional[int] = 0
    manual_score: Optional[int] = None
    is_score_manual: Optional[bool] = False
    score_source: Optional[str] = None
    score_history: Optional[str] = None
    score_last_updated: Optional[datetime] = None

class LeadCreate(LeadBase):
    pass

class LeadUpdate(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    lead_source: Optional[str] = None
    industry: Optional[str] = None
    budget: Optional[float] = None
    expected_revenue: Optional[float] = None
    lead_score: Optional[int] = None
    owner_id: Optional[str] = None
    billing_address: Optional[str] = None
    tax_information: Optional[str] = None

class LeadResponse(LeadBase):
    id: str
    organization_id: str
    owner_id: Optional[str] = None
    lead_score: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

# ─── Contact Schemas ─────────────────────────────────────────────────────────

class ContactBase(BaseModel):
    first_name: str
    last_name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    company_id: Optional[str] = None
    billing_address: Optional[str] = None
    tax_information: Optional[str] = None

class ContactCreate(ContactBase):
    pass

class ContactUpdate(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    company_id: Optional[str] = None
    billing_address: Optional[str] = None
    tax_information: Optional[str] = None

class ContactResponse(ContactBase):
    id: str
    organization_id: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

# ─── Company Schemas ─────────────────────────────────────────────────────────

class CompanyBase(BaseModel):
    name: str
    website: Optional[str] = None
    industry: Optional[str] = None
    address: Optional[str] = None
    tax_information: Optional[str] = None

class CompanyCreate(CompanyBase):
    pass

class CompanyResponse(CompanyBase):
    id: str
    organization_id: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class ImportRequest(BaseModel):
    filename: str
    file_content_base64: str
    field_mapping: dict # e.g. {"First Name": "Name", "Email": "Email", ...}
    duplicate_handling: str # Skip, Update, Merge, Create
    run_automations: bool

class ValidateRequest(BaseModel):
    filename: str
    file_content_base64: str
    field_mapping: dict

class ExportRequest(BaseModel):
    filters: Optional[dict] = None
    format: Optional[str] = "csv" # csv or xlsx

class ImportJobResponse(BaseModel):
    id: str
    filename: str
    status: str
    imported_count: int
    updated_count: int
    skipped_count: int
    invalid_count: int
    error_message: Optional[str] = None
    created_by: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class ExportJobResponse(BaseModel):
    id: str
    status: str
    filename: Optional[str] = None
    file_path: Optional[str] = None
    filters: Optional[str] = None
    record_count: int
    created_by: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

