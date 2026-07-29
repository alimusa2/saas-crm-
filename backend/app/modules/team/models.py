from sqlalchemy import Column, String, ForeignKey, Boolean, Text, JSON, DateTime
from app.db.base_class import TenantAwareBase
from datetime import datetime, timezone

class TeamMember(TenantAwareBase):
    first_name = Column(String, nullable=False)
    last_name = Column(String, nullable=False)
    email = Column(String, nullable=False)
    phone = Column(String, nullable=True)
    job_title = Column(String, nullable=True)
    department = Column(String, nullable=False)  # Category / Department (Required)
    designation = Column(String, nullable=True)
    status = Column(String, default="Active")  # Active / Inactive
    role = Column(String, nullable=False, default="Member")  # Admin / Manager / Employee / Member
    avatar = Column(String, nullable=True)
    notes = Column(Text, nullable=True)
    joining_date = Column(String, nullable=True)
    user_id = Column(String, ForeignKey("user.id"), nullable=True)
    is_deleted = Column(Boolean, default=False)

    # Granular assignments & permissions
    assigned_pipelines = Column(JSON, nullable=True)
    assigned_contacts = Column(JSON, nullable=True)
    assigned_deals = Column(JSON, nullable=True)
    assigned_funnels = Column(JSON, nullable=True)
    assigned_forms = Column(JSON, nullable=True)
    assigned_calendars = Column(JSON, nullable=True)
    assigned_workflows = Column(JSON, nullable=True)
    permissions = Column(JSON, nullable=True)

class EmployeeActivityLog(TenantAwareBase):
    team_member_id = Column(String, ForeignKey("teammember.id"), nullable=False)
    user_id = Column(String, ForeignKey("user.id"), nullable=True)
    action_type = Column(String, nullable=False)  # Login, Lead Update, Deal Won, Task Completed, Call, Email, Note
    title = Column(String, nullable=False)
    details = Column(Text, nullable=True)
    entity_type = Column(String, nullable=True)  # Lead, Deal, Task, Appointment, Form
    entity_id = Column(String, nullable=True)

