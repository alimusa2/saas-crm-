from pydantic import BaseModel, ConfigDict
from typing import Optional, List
from datetime import datetime

class EmailTemplateBase(BaseModel):
    name: str
    subject: str
    html_content: str
    design_json: Optional[str] = None
    is_active: bool = True

class EmailTemplateCreate(EmailTemplateBase):
    pass

class EmailTemplateResponse(EmailTemplateBase):
    id: str
    organization_id: str
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)

class EmailCampaignBase(BaseModel):
    name: str
    template_id: str
    status: str = "Draft"
    scheduled_for: Optional[datetime] = None

class EmailCampaignCreate(EmailCampaignBase):
    pass

class EmailCampaignResponse(EmailCampaignBase):
    id: str
    organization_id: str
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)

class EmailSendRequest(BaseModel):
    template_id: str
    recipient_email: str
    lead_id: Optional[str] = None
    variables: Optional[dict] = None


class EmailConfigBase(BaseModel):
    provider: str
    is_active: bool = True


class EmailConfigCreate(EmailConfigBase):
    settings: dict  # Plain settings dictionary, will be encrypted in service


class EmailConfigUpdate(BaseModel):
    provider: Optional[str] = None
    settings: Optional[dict] = None
    is_active: Optional[bool] = None


class EmailConfigResponse(EmailConfigBase):
    id: str
    organization_id: str
    # Settings dictionary is returned decrypted (masking sensitive fields like password/API keys)
    settings: dict

    class Config:
        from_attributes = True

