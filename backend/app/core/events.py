import asyncio
import logging
import contextvars
from datetime import datetime, timezone
from typing import Callable, Dict, List, Type, Any, Optional
from pydantic import BaseModel

logger = logging.getLogger(__name__)

# ContextVar to pass tracing information down async task chains
workflow_context_var: contextvars.ContextVar = contextvars.ContextVar("workflow_context_var", default={})
_sync_in_progress: contextvars.ContextVar = contextvars.ContextVar("crm_pipeline_sync_in_progress", default=False)

# Base Event model with loop-protection and tracing metadata
class BaseEvent(BaseModel):
    # Loop Protection & Tracing
    correlation_id: Optional[str] = None
    chain_depth: Optional[int] = 0
    visited_workflows: List[str] = []
    visited_events: List[str] = []
    initial_event_source: Optional[str] = None

    # Correlation Context Details
    organization_id: Optional[str] = None
    lead_id: Optional[str] = None
    contact_id: Optional[str] = None
    pipeline_id: Optional[str] = None
    current_stage: Optional[str] = None
    previous_stage: Optional[str] = None
    workflow_execution_id: Optional[str] = None
    triggered_by: Optional[str] = None
    timestamp: Optional[datetime] = None

    # Additional Required Payload Fields
    entity_id: Optional[str] = None
    trigger_name: Optional[str] = None
    previous_value: Optional[Any] = None
    current_value: Optional[Any] = None
    user_id: Optional[str] = None


# Registry of events to their async handlers
_listeners: Dict[str, List[Callable[[Any], Any]]] = {}

def subscribe(event_name: str, handler: Callable[[Any], Any]):
    """Register a handler for a specific event name."""
    if event_name not in _listeners:
        _listeners[event_name] = []
    handler_name = getattr(handler, '__name__', str(handler))
    existing_names = [getattr(h, '__name__', str(h)) for h in _listeners[event_name]]
    if handler not in _listeners[event_name] and handler_name not in existing_names:
        _listeners[event_name].append(handler)
        logger.info(f"Subscribed handler {handler_name} to event '{event_name}'")

async def publish(event_name: str, event_data: Any):
    """Publish an event asynchronously to all registered subscribers."""
    # Auto-hydrate tracing metadata from the execution thread context if present
    wf_ctx = workflow_context_var.get()
    if wf_ctx:
        for key, val in wf_ctx.items():
            if hasattr(event_data, key) and getattr(event_data, key) is None:
                try:
                    setattr(event_data, key, val)
                except Exception as e:
                    logger.warning(f"Failed to set tracing parameter {key} on event: {e}")

    # Set standard defaults if missing
    if hasattr(event_data, "timestamp") and getattr(event_data, "timestamp") is None:
        try:
            setattr(event_data, "timestamp", datetime.now(timezone.utc))
        except Exception:
            pass

    if hasattr(event_data, "correlation_id") and getattr(event_data, "correlation_id") is None:
        import uuid
        try:
            setattr(event_data, "correlation_id", str(uuid.uuid4()))
        except Exception:
            pass

    if hasattr(event_data, "triggered_by") and getattr(event_data, "triggered_by") is None:
        try:
            setattr(event_data, "triggered_by", "Workflow" if wf_ctx else "User")
        except Exception:
            pass

    handlers = _listeners.get(event_name, [])
    if not handlers:
        logger.debug(f"No handlers registered for event '{event_name}'")
        return

    logger.info(f"Publishing event '{event_name}' to {len(handlers)} handlers")
    
    tasks = []
    for handler in handlers:
        try:
            if asyncio.iscoroutinefunction(handler):
                tasks.append(handler(event_data))
            else:
                loop = asyncio.get_event_loop()
                tasks.append(loop.run_in_executor(None, handler, event_data))
        except Exception as e:
            logger.error(f"Error staging handler {handler.__name__} for event '{event_name}': {e}")
            
    if tasks:
        # Fire-and-forget so event execution doesn't block the HTTP request
        async def run_handlers():
            results = await asyncio.gather(*tasks, return_exceptions=True)
            for handler, res in zip(handlers, results):
                if isinstance(res, Exception):
                    logger.error(f"Error executing handler {handler.__name__} for event '{event_name}': {res}", exc_info=True)
                
        asyncio.create_task(run_handlers())

# Define standard Event Payloads
class GenericEvent(BaseEvent):
    event_name: str
    organization_id: str
    data: Dict[str, Any] = {}

class LeadCreatedEvent(BaseEvent):
    lead_id: str
    organization_id: str
    owner_id: Optional[str] = None
    email: Optional[str] = None

class LeadUpdatedEvent(BaseEvent):
    lead_id: str
    organization_id: str
    changed_fields: List[str]

class FormSubmittedEvent(BaseEvent):
    form_id: str
    submission_id: str
    organization_id: str
    payload: Dict[str, Any]
    lead_id: Optional[str] = None

class EmailReceivedEvent(BaseEvent):
    message_id: str
    organization_id: str
    sender_email: str
    subject: str

class EmailSentEvent(BaseEvent):
    message_id: str
    organization_id: str
    recipient_email: str
    campaign_id: Optional[str] = None

class PaymentSucceededEvent(BaseEvent):
    invoice_id: str
    organization_id: str
    amount: float

class WorkflowCompletedEvent(BaseEvent):
    execution_id: str
    workflow_id: str
    organization_id: str

class TaskCompletedEvent(BaseEvent):
    task_id: str
    organization_id: str

class PipelineStageChangedEvent(BaseEvent):
    deal_id: str
    old_stage_id: Optional[str] = None
    new_stage_id: str
    organization_id: str

class TagAddedEvent(BaseEvent):
    lead_id: str
    organization_id: str
    tag: str

class TagRemovedEvent(BaseEvent):
    lead_id: str
    organization_id: str
    tag: str

class OwnerAssignedEvent(BaseEvent):
    lead_id: str
    organization_id: str
    owner_id: str

class DuplicateSubmissionEvent(BaseEvent):
    form_id: str
    submission_id: str
    organization_id: str
    payload: Dict[str, Any]
    lead_id: str

class PaymentFailedEvent(BaseEvent):
    invoice_id: str
    organization_id: str
    amount: float
    error_message: Optional[str] = None

class CampaignCreatedEvent(BaseEvent):
    campaign_id: str
    organization_id: str

class CampaignQueuedEvent(BaseEvent):
    campaign_id: str
    organization_id: str
    recipient_count: int

class CampaignStartedEvent(BaseEvent):
    campaign_id: str
    organization_id: str

class CampaignCompletedEvent(BaseEvent):
    campaign_id: str
    organization_id: str

class CampaignFailedEvent(BaseEvent):
    campaign_id: str
    organization_id: str
    error: str

