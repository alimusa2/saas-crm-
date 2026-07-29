from sqlalchemy import Column, String, ForeignKey, Boolean, Integer, Text, DateTime
from sqlalchemy.orm import relationship
from app.db.base_class import TenantAwareBase
from datetime import datetime, timezone

class Funnel(TenantAwareBase):
    name = Column(String, nullable=False)
    description = Column(String, nullable=True)
    type = Column(String, default="Lead")  # Lead, Appointment, Sales
    is_active = Column(Boolean, default=True)
    status = Column(String, default="Draft")  # Draft, Published
    published_url = Column(String, nullable=True)
    published_at = Column(DateTime(timezone=True), nullable=True)

    steps = relationship("FunnelStep", back_populates="funnel", cascade="all, delete-orphan")


class FunnelStep(TenantAwareBase):
    funnel_id = Column(String, ForeignKey("funnel.id"), nullable=False)
    name = Column(String, nullable=False)  # e.g., "Landing Page", "Thank You Page"
    order = Column(Integer, default=0)
    page_content = Column(Text, nullable=True)  # HTML or JSON for page builder
    form_id = Column(String, ForeignKey("form.id"), nullable=True)  # If step contains a form
    
    # Visual details for simple section editor
    title = Column(String, nullable=True)
    heading = Column(String, nullable=True)
    paragraph_text = Column(String, nullable=True)
    image_url = Column(String, nullable=True)
    button_text = Column(String, nullable=True)
    background_color = Column(String, nullable=True)

    # Production upgrades for sequential navigation & Actions
    next_step_id = Column(String, ForeignKey("funnelstep.id"), nullable=True)
    status = Column(String, default="Active")  # Active, Inactive
    action_type = Column(String, default="go_to_next_step")  # go_to_next_step, go_to_specific_step, submit_form_and_continue, schedule_meeting_and_continue, open_external_url, end_funnel
    action_value = Column(String, nullable=True)  # URL, step_id, calendar_id, etc.

    funnel = relationship("Funnel", back_populates="steps", foreign_keys=[funnel_id])
    components = relationship("FunnelComponent", back_populates="step", cascade="all, delete-orphan")


class FunnelComponent(TenantAwareBase):
    step_id = Column(String, ForeignKey("funnelstep.id"), nullable=False)
    type = Column(String, nullable=False)  # Heading, Paragraph, Button, Image, Video, Form, Divider, Spacer, Calendar, Testimonial, FAQ, CallToAction
    order = Column(Integer, default=0)
    config = Column(Text, nullable=True)  # JSON string of component settings (text, style, link_url, form_id, etc.)

    step = relationship("FunnelStep", back_populates="components")


class MediaAsset(TenantAwareBase):
    filename = Column(String, nullable=False)
    url = Column(String, nullable=False)  # Local static serving path /static/uploads/...
    size = Column(Integer, nullable=True)
    content_type = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class FunnelVisit(TenantAwareBase):
    """Tracks visitor hits on steps to compile analytics."""
    funnel_id = Column(String, ForeignKey("funnel.id"), nullable=False)
    step_id = Column(String, ForeignKey("funnelstep.id"), nullable=False)
    session_id = Column(String, nullable=False, index=True)
    ip_address = Column(String, nullable=True)
    utm_source = Column(String, nullable=True)
    utm_medium = Column(String, nullable=True)
    utm_campaign = Column(String, nullable=True)
    utm_term = Column(String, nullable=True)
    utm_content = Column(String, nullable=True)
    converted = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    
    # Detailed tracking parameters
    event_type = Column(String, default="page_view")  # page_view, button_click, form_view, form_submit, calendar_open, appointment_scheduled, etc.
    referrer = Column(String, nullable=True)
    device = Column(String, nullable=True)
    browser = Column(String, nullable=True)
    os = Column(String, nullable=True)
