from sqlalchemy import Column, String, ForeignKey, JSON, Boolean, DateTime, Float
from sqlalchemy.orm import relationship
from app.db.base_class import TenantAwareBase
from datetime import datetime, timezone

class Workflow(TenantAwareBase):
    name = Column(String, nullable=False)
    description = Column(String, nullable=True)
    is_active = Column(Boolean, default=False)

    # Store workflow configuration as JSON (nodes and edges)
    # This allows flexible drag-and-drop builder storage
    trigger = Column(String, nullable=True)  # e.g., 'lead.created'
    flow_data = Column(JSON, nullable=True)

class WorkflowExecution(TenantAwareBase):
    workflow_id = Column(String, ForeignKey("workflow.id"), nullable=False)
    status = Column(String, default="Running")  # Running, Completed, Failed, Cancelled
    started_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    completed_at = Column(DateTime(timezone=True), nullable=True)
    execution_duration = Column(Float, nullable=True)
    error_message = Column(String, nullable=True)
    execution_metadata = Column(JSON, nullable=True)

class ExecutionLog(TenantAwareBase):
    execution_id = Column(String, ForeignKey("workflowexecution.id"), nullable=False)
    node_id = Column(String, nullable=False)
    action = Column(String, nullable=False)
    status = Column(String, default="Success")  # Success, Failed
    log_data = Column(JSON, nullable=True)
    timestamp = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
