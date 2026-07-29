from pydantic import BaseModel, ConfigDict
from typing import Optional, List
from datetime import datetime

class FunnelComponentBase(BaseModel):
    type: str
    order: int = 0
    config: Optional[str] = None

class FunnelComponentCreate(FunnelComponentBase):
    pass

class FunnelComponentResponse(FunnelComponentBase):
    id: str
    step_id: str
    organization_id: str
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)

class FunnelStepBase(BaseModel):
    name: str
    order: int = 0
    page_content: Optional[str] = None
    form_id: Optional[str] = None
    title: Optional[str] = None
    heading: Optional[str] = None
    paragraph_text: Optional[str] = None
    image_url: Optional[str] = None
    button_text: Optional[str] = None
    background_color: Optional[str] = None
    
    # Sequential upgrades
    next_step_id: Optional[str] = None
    status: str = "Active"
    action_type: str = "go_to_next_step"
    action_value: Optional[str] = None

class FunnelStepCreate(FunnelStepBase):
    components: Optional[List[FunnelComponentCreate]] = None

class FunnelStepResponse(FunnelStepBase):
    id: str
    funnel_id: str
    organization_id: str
    created_at: datetime
    updated_at: datetime
    components: Optional[List[FunnelComponentResponse]] = None
    model_config = ConfigDict(from_attributes=True)

class FunnelBase(BaseModel):
    name: str
    description: Optional[str] = None
    type: str = "Lead"
    is_active: bool = True
    status: str = "Draft"
    published_url: Optional[str] = None
    published_at: Optional[datetime] = None

class FunnelCreate(FunnelBase):
    pass

class FunnelResponse(FunnelBase):
    id: str
    organization_id: str
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)

class FunnelWithStepsResponse(FunnelResponse):
    steps: List[FunnelStepResponse]


class FunnelVisitCreate(BaseModel):
    step_id: str
    session_id: str
    ip_address: Optional[str] = None
    utm_source: Optional[str] = None
    utm_medium: Optional[str] = None
    utm_campaign: Optional[str] = None
    utm_term: Optional[str] = None
    utm_content: Optional[str] = None
    converted: bool = False
    event_type: str = "page_view"
    referrer: Optional[str] = None
    device: Optional[str] = None
    browser: Optional[str] = None
    os: Optional[str] = None


class FunnelStepAnalytics(BaseModel):
    step_id: str
    name: str
    order: int
    visits: int
    conversions: int
    conversion_rate: float
    drop_off_rate: float


class FunnelAnalyticsReport(BaseModel):
    funnel_id: str
    total_visits: int
    total_conversions: int
    completion_rate: float
    total_visitors: int = 0
    unique_visitors: int = 0
    form_submissions: int = 0
    conversion_rate: float = 0.0
    most_visited_step: Optional[str] = None
    steps: List[FunnelStepAnalytics]


class MediaAssetResponse(BaseModel):
    id: str
    filename: str
    url: str
    size: Optional[int] = None
    content_type: Optional[str] = None
    organization_id: str
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)
