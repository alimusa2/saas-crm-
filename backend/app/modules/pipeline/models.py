from sqlalchemy import Column, String, Integer, ForeignKey, Float, JSON, Index
from sqlalchemy.orm import relationship
from app.db.base_class import TenantAwareBase

class Pipeline(TenantAwareBase):
    name = Column(String, nullable=False)
    description = Column(String, nullable=True)
    status_stage_mapping = Column(JSON, nullable=True)

class Stage(TenantAwareBase):
    __table_args__ = (
        Index("ix_stage_org_pipeline", "organization_id", "pipeline_id"),
    )
    name = Column(String, nullable=False)
    pipeline_id = Column(String, ForeignKey("pipeline.id"), nullable=False)
    order = Column(Integer, default=0)

class Deal(TenantAwareBase):
    __table_args__ = (
        Index("ix_deal_org_stage", "organization_id", "stage_id"),
        Index("ix_deal_org_status", "organization_id", "status"),
    )
    title = Column(String, nullable=False)
    value = Column(Float, default=0)
    stage_id = Column(String, ForeignKey("stage.id"), nullable=False)
    lead_id = Column(String, ForeignKey("lead.id"), nullable=True)
    owner_id = Column(String, ForeignKey("user.id"), nullable=True)
    status = Column(String, default="Open")  # Open, Won, Lost

