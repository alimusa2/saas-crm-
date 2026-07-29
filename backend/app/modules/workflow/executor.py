import json
import logging
import asyncio
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List, Optional
from sqlalchemy.future import select

from app.core.celery_app import celery_app
from app.db.session import AsyncSessionLocal
from app.modules.workflow.models import Workflow, WorkflowExecution, ExecutionLog
from app.modules.email.services import EmailLogService
from app.modules.email.schemas import EmailSendRequest
from app.modules.tasks.models import Task

logger = logging.getLogger(__name__)

# Helper to run async methods within sync Celery tasks
def run_async_coro(coro):
    import asyncio
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        return loop.create_task(coro)
    else:
        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
        return loop.run_until_complete(coro)


def safe_json_dumps(data: Any) -> str:
    from datetime import datetime
    def default_encoder(o):
        if isinstance(o, datetime):
            return o.isoformat()
        return str(o)
    return json.dumps(data, default=default_encoder)


@celery_app.task(bind=True, max_retries=3)
def execute_workflow_node_task(self, execution_id: str, step_index: int, context_data_str: str):
    """Celery background task to resume workflow execution at a specific step after a delay."""
    context_data = json.loads(context_data_str)
    return run_async_coro(
        _async_execute_step(execution_id, step_index, context_data)
    )


async def _async_execute_step(execution_id: str, step_index: int, context_data: Dict[str, Any]):
    from app.core.events import workflow_context_var
    
    # Establish tracing context for this execution thread
    wf_ctx = {
        "correlation_id": context_data.get("correlation_id") or execution_id,
        "chain_depth": context_data.get("chain_depth", 0),
        "visited_workflows": context_data.get("visited_workflows", []),
        "visited_events": context_data.get("visited_events", []),
        "initial_event_source": context_data.get("initial_event_source"),
        "workflow_execution_id": execution_id,
        "triggered_by": "Workflow"
    }
    token = workflow_context_var.set(wf_ctx)
    try:
        await _async_execute_step_impl(execution_id, step_index, context_data)
    except Exception as e:
        logger.exception(f"Error in _async_execute_step for execution {execution_id}: {e}")
        try:
            async with AsyncSessionLocal() as db:
                res = await db.execute(select(WorkflowExecution).where(WorkflowExecution.id == execution_id))
                exec_obj = res.scalars().first()
                if exec_obj:
                    exec_obj.status = "Failed"
                    exec_obj.error_message = str(e)
                    
                    # Record the error details in execution_metadata JSON
                    metadata = exec_obj.execution_metadata or {}
                    errors_list = list(metadata.get("errors", []))
                    errors_list.append(str(e))
                    metadata["errors"] = errors_list
                    exec_obj.execution_metadata = metadata
                    
                    log = ExecutionLog(
                        execution_id=execution_id,
                        node_id=f"step_{step_index}",
                        action="Workflow Execution Error",
                        status="Failed",
                        log_data={"error": str(e)},
                        organization_id=exec_obj.organization_id
                    )
                    db.add(log)
                    await db.commit()
                    
                    # Emit workflow.failed event
                    from app.core.events import publish, GenericEvent
                    await publish("workflow.failed", GenericEvent(
                        event_name="workflow.failed",
                        organization_id=exec_obj.organization_id,
                        entity_id=execution_id,
                        trigger_name="workflow.failed",
                        data={
                            "workflow_id": exec_obj.workflow_id,
                            "execution_id": execution_id,
                            "error": str(e)
                        }
                    ))
        except Exception as db_err:
            logger.exception(f"Failed to record execution error in DB: {db_err}")
        raise e
    finally:
        workflow_context_var.reset(token)


async def _async_execute_step_impl(execution_id: str, step_index: int, context_data: Dict[str, Any]):
    async with AsyncSessionLocal() as db:
        res = await db.execute(select(WorkflowExecution).where(WorkflowExecution.id == execution_id))
        exec_obj = res.scalars().first()
        if not exec_obj or exec_obj.status != "Running":
            return

        res_wf = await db.execute(select(Workflow).where(Workflow.id == exec_obj.workflow_id))
        wf = res_wf.scalars().first()
        if not wf or not wf.flow_data:
            return

        # Safely parse flow_data if stored as a JSON string
        flow = wf.flow_data
        if isinstance(flow, str):
            try:
                flow = json.loads(flow)
            except Exception:
                flow = {}

        # Fetch and hydrate latest Deal data if deal_id is present
        deal_id = context_data.get("deal_id")
        if deal_id:
            from app.modules.pipeline.models import Deal
            res_deal = await db.execute(select(Deal).where(Deal.id == deal_id))
            deal_obj = res_deal.scalars().first()
            if deal_obj:
                deal_dict = {
                    "id": deal_obj.id,
                    "title": deal_obj.title,
                    "value": deal_obj.value,
                    "stage_id": deal_obj.stage_id,
                    "lead_id": deal_obj.lead_id,
                    "owner_id": deal_obj.owner_id,
                    "status": deal_obj.status,
                }
                context_data["deal"] = deal_dict
                if "entity" not in context_data or not context_data["entity"]:
                    context_data["entity"] = deal_dict
                else:
                    context_data["entity"] = {**deal_dict, **context_data["entity"]}
                
                # If deal has a lead_id, make sure lead_id is set in context
                if not context_data.get("lead_id") and deal_obj.lead_id:
                    context_data["lead_id"] = deal_obj.lead_id

        # Fetch and hydrate latest Lead data if lead_id is present
        lead_id = context_data.get("lead_id")
        if lead_id:
            from app.modules.crm.models import Lead
            res_lead = await db.execute(select(Lead).where(Lead.id == lead_id))
            lead_obj = res_lead.scalars().first()
            if lead_obj:
                lead_dict = {
                    "id": lead_obj.id,
                    "first_name": lead_obj.first_name,
                    "last_name": lead_obj.last_name,
                    "email": lead_obj.email,
                    "phone": lead_obj.phone,
                    "status": lead_obj.status,
                    "priority": lead_obj.priority,
                    "lead_source": lead_obj.lead_source,
                    "owner_id": lead_obj.owner_id,
                    "company_id": lead_obj.company_id,
                    "industry": lead_obj.industry,
                    "budget": lead_obj.budget,
                    "expected_revenue": lead_obj.expected_revenue,
                    "lead_score": lead_obj.lead_score,
                }
                context_data["lead"] = lead_dict
                if lead_obj.email:
                    context_data["email"] = lead_obj.email
                if "entity" not in context_data or not context_data["entity"]:
                    context_data["entity"] = lead_dict
                else:
                    context_data["entity"] = {**lead_dict, **context_data["entity"]}

        actions = flow.get("actions", [])
        if step_index >= len(actions):
            exec_obj.status = "Completed"
            exec_obj.completed_at = datetime.now(timezone.utc)
            if exec_obj.started_at:
                delta = exec_obj.completed_at - exec_obj.started_at.replace(tzinfo=timezone.utc)
                exec_obj.execution_duration = delta.total_seconds()
            await db.commit()
            
            # Emit workflow.completed event
            from app.core.events import publish, WorkflowCompletedEvent
            await publish("workflow.completed", WorkflowCompletedEvent(
                execution_id=execution_id,
                workflow_id=exec_obj.workflow_id,
                organization_id=exec_obj.organization_id,
                entity_id=execution_id,
                trigger_name="workflow.completed"
            ))
            return

        action = actions[step_index]
        action_type = action.get("type")
        node_id = action.get("id", f"step_{step_index}")

        # Update execution logs metadata
        metadata = exec_obj.execution_metadata or {}
        actions_list = list(metadata.get("actions_executed", []))
        if action_type and action_type not in actions_list:
            actions_list.append(action_type)
        metadata["actions_executed"] = actions_list
        
        # Track lead status transition if action is update_lead
        if action_type == "update_lead":
            status_val = action.get("status")
            if status_val:
                metadata["new_status"] = status_val
        
        exec_obj.execution_metadata = metadata
        await db.commit()

        # Check conditions
        if action_type == "condition":
            field = action.get("field")
            value = action.get("value")
            op = action.get("operator", "==")

            entity_data = context_data.get("entity", {})
            actual_val = entity_data.get(field)
            
            # Simple condition matching
            matched = False
            if op == "==" and str(actual_val) == str(value):
                matched = True
            elif op == "!=" and str(actual_val) != str(value):
                matched = True

            # Log condition evaluation
            log = ExecutionLog(
                execution_id=execution_id,
                node_id=node_id,
                action="Condition Check",
                status="Success" if matched else "Failed",
                log_data={"field": field, "actual": actual_val, "expected": value, "matched": matched},
                organization_id=exec_obj.organization_id
            )
            db.add(log)
            await db.commit()

            if not matched:
                # Terminate workflow execution since condition failed
                exec_obj.status = "Completed"
                exec_obj.completed_at = datetime.now(timezone.utc)
                await db.commit()
                return
            
            # Condition passed, move to next step immediately
            await _async_execute_step(execution_id, step_index + 1, context_data)
            return

        # Template helper
        from jinja2 import Template

        def render_text(text: str) -> str:
            if not text:
                return ""
            try:
                return Template(str(text)).render(**context_data)
            except Exception:
                return str(text)

        # Handle Action: Send Email / Send Template Email / Queue Email / Send Appointment Reminder / Send Receipt
        if action_type in ["send_email", "send_template_email", "queue_email", "send_appointment_reminder", "send_receipt"]:
            template_id = action.get("template_id")
            recipient_email = context_data.get("email") or context_data.get("entity", {}).get("email")
            
            # For send_receipt, we can generate a simple content if no template_id is specified
            if action_type == "send_receipt" and not template_id:
                # Mock a template ID or create a basic receipt email log
                template_id = "receipt_template" # placeholder
                
            log_data = {"recipient": recipient_email, "template_id": template_id}
            if recipient_email and template_id:
                try:
                    from app.modules.email.schemas import EmailSendRequest
                    from app.modules.email.services import EmailLogService
                    
                    # For safety, check if template exists. If it doesn't and this is send_receipt or internal notification, create a default template or send text
                    req = EmailSendRequest(
                        template_id=template_id,
                        recipient_email=recipient_email,
                        lead_id=context_data.get("lead_id"),
                        variables=context_data
                    )
                    log_obj = await EmailLogService.send_email(db, req, exec_obj.organization_id)
                    status = "Success"
                except Exception as e:
                    status = "Failed"
                    log_data["error"] = str(e)
            else:
                status = "Failed"
                log_data["error"] = "Missing template_id or recipient email"

            log = ExecutionLog(
                execution_id=execution_id,
                node_id=node_id,
                action=action_type.replace("_", " ").title(),
                status=status,
                log_data=log_data,
                organization_id=exec_obj.organization_id
            )
            db.add(log)
            await db.commit()

        # Handle Action: Send Internal Notification
        elif action_type == "send_internal_notification":
            recipient = render_text(action.get("recipient_email"))
            subject = render_text(action.get("subject", "Internal Notification"))
            body = render_text(action.get("body", ""))
            
            log_data = {"recipient": recipient, "subject": subject}
            if recipient:
                try:
                    from app.modules.email.models import EmailLog
                    from app.modules.email.tasks import send_email_task
                    
                    log_obj = EmailLog(
                        organization_id=exec_obj.organization_id,
                        recipient=recipient,
                        subject=subject,
                        body=body,
                        status="Queued"
                    )
                    db.add(log_obj)
                    await db.commit()
                    await db.refresh(log_obj)
                    
                    send_email_task.delay(log_obj.id)
                    status = "Success"
                except Exception as e:
                    status = "Failed"
                    log_data["error"] = str(e)
            else:
                status = "Failed"
                log_data["error"] = "Missing recipient_email"
                
            log = ExecutionLog(
                execution_id=execution_id,
                node_id=node_id,
                action="Send Internal Notification",
                status=status,
                log_data=log_data,
                organization_id=exec_obj.organization_id
            )
            db.add(log)
            await db.commit()

        # Handle Action: Create Lead
        elif action_type == "create_lead":
            try:
                from app.modules.crm.services import CRMService
                from app.modules.crm.schemas import LeadCreate
                
                crm_svc = CRMService(db)
                lead_in = LeadCreate(
                    first_name=render_text(action.get("first_name", "New")),
                    last_name=render_text(action.get("last_name", "Lead")),
                    email=render_text(action.get("email")),
                    phone=render_text(action.get("phone")),
                    status=render_text(action.get("status", "New")),
                    priority=render_text(action.get("priority", "Normal")),
                    lead_score=int(action.get("lead_score", 0))
                )
                new_lead = await crm_svc.create_lead(lead_in, exec_obj.organization_id, owner_id=context_data.get("owner_id"))
                context_data["lead_id"] = new_lead.id
                status = "Success"
                log_data = {"lead_id": new_lead.id}
            except Exception as e:
                status = "Failed"
                log_data = {"error": str(e)}
                
            log = ExecutionLog(
                execution_id=execution_id,
                node_id=node_id,
                action="Create Lead",
                status=status,
                log_data=log_data,
                organization_id=exec_obj.organization_id
            )
            db.add(log)
            await db.commit()

        # Handle Action: Update Lead / Update Custom Field
        elif action_type in ["update_lead", "update_custom_field"]:
            lead_id = context_data.get("lead_id")
            status_result = "Success"
            log_data = {"lead_id": lead_id}
            
            if lead_id:
                try:
                    from app.modules.crm.services import CRMService
                    from app.modules.crm.schemas import LeadUpdate
                    crm_svc = CRMService(db)
                    
                    up_fields = {}
                    if action_type == "update_custom_field":
                        field_name = action.get("field_name")
                        field_val = render_text(action.get("field_value"))
                        if field_name:
                            up_fields[field_name] = field_val
                            context_data[field_name] = field_val
                    else:
                        for f in ["status", "priority", "lead_score"]:
                            if action.get(f) is not None and action.get(f) != "":
                                up_fields[f] = action.get(f)
                    
                    if up_fields:
                        # Clean/convert types
                        if "lead_score" in up_fields:
                            up_fields["lead_score"] = int(up_fields["lead_score"])
                        # update via service
                        await crm_svc.update_lead(lead_id, LeadUpdate(**up_fields), exec_obj.organization_id)
                        log_data["updated_fields"] = list(up_fields.keys())
                except Exception as e:
                    status_result = "Failed"
                    log_data["error"] = str(e)
            else:
                status_result = "Failed"
                log_data["error"] = "Missing lead_id"

            log = ExecutionLog(
                execution_id=execution_id,
                node_id=node_id,
                action="Update Lead",
                status=status_result,
                log_data=log_data,
                organization_id=exec_obj.organization_id
            )
            db.add(log)
            await db.commit()

        # Handle Action: Create Contact
        elif action_type == "create_contact":
            try:
                from app.modules.crm.services import CRMService
                from app.modules.crm.schemas import ContactCreate
                crm_svc = CRMService(db)
                contact_in = ContactCreate(
                    first_name=render_text(action.get("first_name", "New")),
                    last_name=render_text(action.get("last_name", "Contact")),
                    email=render_text(action.get("email")),
                    phone=render_text(action.get("phone"))
                )
                contact = await crm_svc.create_contact(contact_in, exec_obj.organization_id)
                context_data["contact_id"] = contact.id
                status = "Success"
                log_data = {"contact_id": contact.id}
            except Exception as e:
                status = "Failed"
                log_data = {"error": str(e)}
                
            log = ExecutionLog(
                execution_id=execution_id,
                node_id=node_id,
                action="Create Contact",
                status=status,
                log_data=log_data,
                organization_id=exec_obj.organization_id
            )
            db.add(log)
            await db.commit()

        # Handle Action: Update Contact
        elif action_type == "update_contact":
            contact_id = context_data.get("contact_id")
            status = "Success"
            log_data = {"contact_id": contact_id}
            if contact_id:
                try:
                    from app.modules.crm.services import CRMService
                    from app.modules.crm.schemas import ContactUpdate
                    crm_svc = CRMService(db)
                    up_fields = {}
                    for f in ["first_name", "last_name", "email", "phone"]:
                        if action.get(f) is not None and action.get(f) != "":
                            up_fields[f] = render_text(action.get(f))
                    if up_fields:
                        await crm_svc.update_contact(contact_id, ContactUpdate(**up_fields), exec_obj.organization_id)
                except Exception as e:
                    status = "Failed"
                    log_data["error"] = str(e)
            else:
                status = "Failed"
                log_data["error"] = "Missing contact_id"
                
            log = ExecutionLog(
                execution_id=execution_id,
                node_id=node_id,
                action="Update Contact",
                status=status,
                log_data=log_data,
                organization_id=exec_obj.organization_id
            )
            db.add(log)
            await db.commit()

        # Handle Action: Create Company
        elif action_type == "create_company":
            try:
                from app.modules.crm.models import Company
                company = Company(
                    name=render_text(action.get("name", "New Company")),
                    website=render_text(action.get("website")),
                    industry=render_text(action.get("industry")),
                    address=render_text(action.get("address")),
                    organization_id=exec_obj.organization_id
                )
                db.add(company)
                await db.commit()
                await db.refresh(company)
                context_data["company_id"] = company.id
                status = "Success"
                log_data = {"company_id": company.id}
                
                # Emit company.created event
                from app.core.events import publish, GenericEvent
                await publish("company.created", GenericEvent(
                    event_name="company.created",
                    organization_id=exec_obj.organization_id,
                    entity_id=company.id,
                    trigger_name="company.created",
                    current_value=company.name,
                    data={"company_id": company.id, "name": company.name, "industry": company.industry}
                ))
            except Exception as e:
                status = "Failed"
                log_data = {"error": str(e)}
                
            log = ExecutionLog(
                execution_id=execution_id,
                node_id=node_id,
                action="Create Company",
                status=status,
                log_data=log_data,
                organization_id=exec_obj.organization_id
            )
            db.add(log)
            await db.commit()

        # Handle Action: Update Company
        elif action_type == "update_company":
            company_id = context_data.get("company_id")
            status = "Success"
            log_data = {"company_id": company_id}
            if company_id:
                try:
                    from app.modules.crm.models import Company
                    res_c = await db.execute(select(Company).where(Company.id == company_id, Company.organization_id == exec_obj.organization_id))
                    company = res_c.scalars().first()
                    if company:
                        old_name = company.name
                        for f in ["name", "website", "industry", "address"]:
                            if action.get(f) is not None and action.get(f) != "":
                                setattr(company, f, render_text(action.get(f)))
                        await db.commit()
                        
                        # Emit company.updated event
                        from app.core.events import publish, GenericEvent
                        await publish("company.updated", GenericEvent(
                            event_name="company.updated",
                            organization_id=exec_obj.organization_id,
                            entity_id=company.id,
                            trigger_name="company.updated",
                            previous_value=old_name,
                            current_value=company.name,
                            data={"company_id": company.id, "name": company.name, "industry": company.industry}
                        ))
                    else:
                        status = "Failed"
                        log_data["error"] = "Company not found"
                except Exception as e:
                    status = "Failed"
                    log_data["error"] = str(e)
            else:
                status = "Failed"
                log_data["error"] = "Missing company_id"
                
            log = ExecutionLog(
                execution_id=execution_id,
                node_id=node_id,
                action="Update Company",
                status=status,
                log_data=log_data,
                organization_id=exec_obj.organization_id
            )
            db.add(log)
            await db.commit()

        # Handle Action: Create Deal
        elif action_type == "create_deal":
            try:
                from app.modules.pipeline.services import PipelineService
                from app.modules.pipeline.schemas import DealCreate
                pipe_svc = PipelineService(db)
                deal_in = DealCreate(
                    title=render_text(action.get("title", "New Deal")),
                    value=float(action.get("value", 0.0) or 0.0),
                    stage_id=render_text(action.get("stage_id")),
                    lead_id=context_data.get("lead_id"),
                    status="Active"
                )
                deal = await pipe_svc.create_deal(deal_in, exec_obj.organization_id, owner_id=context_data.get("owner_id"))
                context_data["deal_id"] = deal.id
                status = "Success"
                log_data = {"deal_id": deal.id}
            except Exception as e:
                status = "Failed"
                log_data = {"error": str(e)}
                
            log = ExecutionLog(
                execution_id=execution_id,
                node_id=node_id,
                action="Create Deal",
                status=status,
                log_data=log_data,
                organization_id=exec_obj.organization_id
            )
            db.add(log)
            await db.commit()

        # Handle Action: Update Deal / Move Pipeline Stage
        elif action_type in ["update_deal", "move_pipeline_stage"]:
            deal_id = context_data.get("deal_id")
            status = "Success"
            log_data = {"deal_id": deal_id}
            if deal_id:
                try:
                    from app.modules.pipeline.services import PipelineService
                    from app.modules.pipeline.schemas import DealUpdate
                    pipe_svc = PipelineService(db)
                    up_fields = {}
                    if action_type == "move_pipeline_stage":
                        up_fields["stage_id"] = action.get("stage_id")
                    else:
                        for f in ["title", "value", "status", "stage_id"]:
                            if action.get(f) is not None and action.get(f) != "":
                                val = action.get(f)
                                if f == "value":
                                    val = float(val)
                                up_fields[f] = val
                    if up_fields:
                        await pipe_svc.update_deal(deal_id, DealUpdate(**up_fields), exec_obj.organization_id)
                except Exception as e:
                    status = "Failed"
                    log_data["error"] = str(e)
            else:
                status = "Failed"
                log_data["error"] = "Missing deal_id"
                
            log = ExecutionLog(
                execution_id=execution_id,
                node_id=node_id,
                action="Update Deal",
                status=status,
                log_data=log_data,
                organization_id=exec_obj.organization_id
            )
            db.add(log)
            await db.commit()

        # Handle Action: Assign Owner
        elif action_type == "assign_owner":
            lead_id = context_data.get("lead_id")
            owner_id = action.get("owner_id")
            status = "Success"
            log_data = {"lead_id": lead_id, "owner_id": owner_id}
            if lead_id and owner_id:
                try:
                    from app.modules.crm.models import Lead
                    res_l = await db.execute(select(Lead).where(Lead.id == lead_id, Lead.organization_id == exec_obj.organization_id))
                    lead = res_l.scalars().first()
                    if lead:
                        lead.owner_id = owner_id
                        await db.commit()

                        from app.core.events import publish, OwnerAssignedEvent
                        event = OwnerAssignedEvent(
                            lead_id=lead.id,
                            organization_id=exec_obj.organization_id,
                            owner_id=owner_id
                        )
                        await publish("owner.changed", event)
                        await publish("lead.assigned", event)
                    else:
                        status = "Failed"
                        log_data["error"] = "Lead not found"
                except Exception as e:
                    status = "Failed"
                    log_data["error"] = str(e)
            else:
                status = "Failed"
                log_data["error"] = "Missing lead_id or owner_id"
                
            log = ExecutionLog(
                execution_id=execution_id,
                node_id=node_id,
                action="Assign Owner",
                status=status,
                log_data=log_data,
                organization_id=exec_obj.organization_id
            )
            db.add(log)
            await db.commit()

        # Handle Action: Add Tag / Remove Tag
        elif action_type in ["add_tag", "remove_tag"]:
            tag = render_text(action.get("tag"))
            # Since no tags table exists, log tag to activity history
            from app.modules.crm.models import Activity
            status = "Success"
            log_data = {"tag": tag}
            try:
                act = Activity(
                    type="Tag Added" if action_type == "add_tag" else "Tag Removed",
                    description=f"Tag '{tag}' " + ("added to" if action_type == "add_tag" else "removed from") + " lead via workflow",
                    lead_id=context_data.get("lead_id"),
                    author_id="system",
                    timestamp=datetime.now(timezone.utc),
                    organization_id=exec_obj.organization_id
                )
                db.add(act)
                await db.commit()

                from app.core.events import publish, TagAddedEvent, TagRemovedEvent
                if action_type == "add_tag":
                    await publish("tag.added", TagAddedEvent(
                        lead_id=context_data.get("lead_id"),
                        organization_id=exec_obj.organization_id,
                        tag=tag
                    ))
                else:
                    await publish("tag.removed", TagRemovedEvent(
                        lead_id=context_data.get("lead_id"),
                        organization_id=exec_obj.organization_id,
                        tag=tag
                    ))
            except Exception as e:
                status = "Failed"
                log_data["error"] = str(e)
                
            log = ExecutionLog(
                execution_id=execution_id,
                node_id=node_id,
                action=action_type.replace("_", " ").title(),
                status=status,
                log_data=log_data,
                organization_id=exec_obj.organization_id
            )
            db.add(log)
            await db.commit()

        # Handle Action: Create Note
        elif action_type == "create_note":
            content = render_text(action.get("content", ""))
            status = "Success"
            log_data = {}
            try:
                from app.modules.crm.models import Note
                note = Note(
                    content=content,
                    lead_id=context_data.get("lead_id"),
                    contact_id=context_data.get("contact_id"),
                    author_id=context_data.get("owner_id") or "system",
                    organization_id=exec_obj.organization_id
                )
                db.add(note)
                await db.commit()
            except Exception as e:
                status = "Failed"
                log_data["error"] = str(e)
                
            log = ExecutionLog(
                execution_id=execution_id,
                node_id=node_id,
                action="Create Note",
                status=status,
                log_data=log_data,
                organization_id=exec_obj.organization_id
            )
            db.add(log)
            await db.commit()

        # Handle Action: Create Activity
        elif action_type == "create_activity":
            act_type = render_text(action.get("type", "Note"))
            desc = render_text(action.get("description", ""))
            status = "Success"
            log_data = {}
            try:
                from app.modules.crm.models import Activity
                act = Activity(
                    type=act_type,
                    description=desc,
                    lead_id=context_data.get("lead_id"),
                    author_id=context_data.get("owner_id") or "system",
                    timestamp=datetime.now(timezone.utc),
                    organization_id=exec_obj.organization_id
                )
                db.add(act)
                await db.commit()
            except Exception as e:
                status = "Failed"
                log_data["error"] = str(e)
                
            log = ExecutionLog(
                execution_id=execution_id,
                node_id=node_id,
                action="Create Activity",
                status=status,
                log_data=log_data,
                organization_id=exec_obj.organization_id
            )
            db.add(log)
            await db.commit()

        # Handle Action: Create Task
        elif action_type == "create_task":
            title = render_text(action.get("title", "Workflow Generated Task"))
            desc = render_text(action.get("description", ""))
            due_days = int(action.get("due_days", 1))

            task = Task(
                title=title,
                description=desc,
                due_date=datetime.now(timezone.utc) + timedelta(days=due_days),
                status="Pending",
                priority="Normal",
                organization_id=exec_obj.organization_id,
                lead_id=context_data.get("lead_id")
            )
            db.add(task)
            await db.flush()

            log = ExecutionLog(
                execution_id=execution_id,
                node_id=node_id,
                action="Create Task",
                status="Success",
                log_data={"task_id": task.id, "title": title},
                organization_id=exec_obj.organization_id
            )
            db.add(log)
            await db.commit()

        # Handle Action: Complete Task / Assign Task / Update Due Date
        elif action_type in ["complete_task", "assign_task", "update_due_date"]:
            task_id = context_data.get("task_id") or action.get("task_id")
            status = "Success"
            log_data = {"task_id": task_id}
            if task_id:
                try:
                    res_t = await db.execute(select(Task).where(Task.id == task_id, Task.organization_id == exec_obj.organization_id))
                    task = res_t.scalars().first()
                    if task:
                        if action_type == "complete_task":
                            task.status = "Completed"
                        elif action_type == "assign_task":
                            assigned_to_id = action.get("assigned_to_id") or action.get("team_member_id") or action.get("owner_id")
                            from app.modules.tasks.services import TaskService
                            ts = TaskService(db)
                            await ts.handle_task_assignment(task, assigned_to_id, None, exec_obj.organization_id)
                        elif action_type == "update_due_date":
                            due = int(action.get("due_days", 1))
                            task.due_date = datetime.now(timezone.utc) + timedelta(days=due)
                        await db.commit()
                    else:
                        status = "Failed"
                        log_data["error"] = "Task not found"
                except Exception as e:
                    status = "Failed"
                    log_data["error"] = str(e)
            else:
                status = "Failed"
                log_data["error"] = "Missing task_id"
                
            log = ExecutionLog(
                execution_id=execution_id,
                node_id=node_id,
                action=action_type.replace("_", " ").title(),
                status=status,
                log_data=log_data,
                organization_id=exec_obj.organization_id
            )
            db.add(log)
            await db.commit()

        # Handle Action: Notify Assigned User
        elif action_type == "notify_assigned_user":
            task_id = context_data.get("task_id") or action.get("task_id")
            status = "Success"
            log_data = {"task_id": task_id}
            if task_id:
                try:
                    res_t = await db.execute(select(Task).where(Task.id == task_id, Task.organization_id == exec_obj.organization_id))
                    task = res_t.scalars().first()
                    if task and task.assigned_to_id:
                        from app.modules.team.models import TeamMember
                        tm_check = await db.execute(select(TeamMember).where(TeamMember.id == task.assigned_to_id))
                        member = tm_check.scalars().first()
                        if member and member.user_id:
                            from app.modules.notifications.models import Notification
                            notif = Notification(
                                user_id=member.user_id,
                                type="Task",
                                title="New Task Notification",
                                content=render_text(action.get("content", f"You have an update for task '{task.title}'.")),
                                is_read=False,
                                related_entity_type="Task",
                                related_entity_id=task.id,
                                organization_id=exec_obj.organization_id
                            )
                            db.add(notif)
                            log_data["user_id"] = member.user_id
                        else:
                            status = "Failed"
                            log_data["error"] = "Assigned team member has no linked user account"
                    else:
                        status = "Failed"
                        log_data["error"] = "Task has no assigned member"
                except Exception as e:
                    status = "Failed"
                    log_data["error"] = str(e)
            else:
                status = "Failed"
                log_data["error"] = "Missing task_id"
                
            log = ExecutionLog(
                execution_id=execution_id,
                node_id=node_id,
                action="Notify Assigned User",
                status=status,
                log_data=log_data,
                organization_id=exec_obj.organization_id
            )
            db.add(log)
            await db.commit()

        # Handle Action: Email Assigned User
        elif action_type == "email_assigned_user":
            task_id = context_data.get("task_id") or action.get("task_id")
            status = "Success"
            log_data = {"task_id": task_id}
            if task_id:
                try:
                    res_t = await db.execute(select(Task).where(Task.id == task_id, Task.organization_id == exec_obj.organization_id))
                    task = res_t.scalars().first()
                    if task and task.assigned_to_id:
                        from app.modules.team.models import TeamMember
                        tm_check = await db.execute(select(TeamMember).where(TeamMember.id == task.assigned_to_id))
                        member = tm_check.scalars().first()
                        if member and member.email and member.status == "Active":
                            from app.modules.email.models import EmailTemplate
                            from app.modules.email.services import EmailLogService
                            from app.modules.email.schemas import EmailSendRequest
                            
                            tmpl_check = await db.execute(
                                select(EmailTemplate).where(
                                    EmailTemplate.name == "Task Assignment",
                                    EmailTemplate.organization_id == exec_obj.organization_id
                                )
                            )
                            tmpl = tmpl_check.scalars().first()
                            if not tmpl:
                                tmpl = EmailTemplate(
                                    name="Task Assignment",
                                    subject="New Task Assigned",
                                    html_content="""
                                    <p>Hello {{FirstName}},</p>
                                    <p>A new task has been assigned to you.</p>
                                    <p><strong>Task:</strong> {{task_title}}<br/>
                                    <strong>Due Date:</strong> {{due_date}}<br/>
                                    <strong>Priority:</strong> {{priority}}<br/>
                                    <strong>Assigned By:</strong> {{assigned_by}}</p>
                                    <p>Please log into GrowthOS to view details.</p>
                                    """,
                                    organization_id=exec_obj.organization_id
                                )
                                db.add(tmpl)
                                await db.flush()
                                
                            req = EmailSendRequest(
                                template_id=tmpl.id,
                                recipient_email=member.email,
                                lead_id=task.lead_id,
                                variables={
                                    "FirstName": member.first_name,
                                    "task_title": task.title,
                                    "due_date": task.due_date.strftime("%Y-%m-%d") if task.due_date else "No due date",
                                    "priority": task.priority or "Normal",
                                    "assigned_by": "Workflow"
                                }
                            )
                            await EmailLogService.send_email(db, req, exec_obj.organization_id)
                            log_data["recipient"] = member.email
                        else:
                            status = "Failed"
                            log_data["error"] = "Assigned member is inactive or has no email"
                    else:
                        status = "Failed"
                        log_data["error"] = "Task has no assigned member"
                except Exception as e:
                    status = "Failed"
                    log_data["error"] = str(e)
            else:
                status = "Failed"
                log_data["error"] = "Missing task_id"
                
            log = ExecutionLog(
                execution_id=execution_id,
                node_id=node_id,
                action="Email Assigned User",
                status=status,
                log_data=log_data,
                organization_id=exec_obj.organization_id
            )
            db.add(log)
            await db.commit()

        # Handle Action: Create Appointment
        elif action_type == "create_appointment":
            title = render_text(action.get("title", "Workflow Appointment"))
            description = render_text(action.get("description", ""))
            start_str = render_text(action.get("date") or action.get("start_time"))
            status = "Success"
            log_data = {}
            try:
                from app.modules.calendar.models import Appointment
                
                # Parse start time, default to tomorrow if missing
                if start_str:
                    try:
                        start_time = datetime.fromisoformat(start_str.replace("Z", "+00:00"))
                    except ValueError:
                        start_time = datetime.now(timezone.utc) + timedelta(days=1)
                else:
                    start_time = datetime.now(timezone.utc) + timedelta(days=1)
                    
                end_time = start_time + timedelta(minutes=30)
                
                appt = Appointment(
                    title=title,
                    description=description,
                    start_time=start_time,
                    end_time=end_time,
                    status="Booked",
                    organizer_id="system",
                    lead_id=context_data.get("lead_id"),
                    contact_id=context_data.get("contact_id"),
                    organization_id=exec_obj.organization_id
                )
                db.add(appt)
                await db.commit()
                log_data["appointment_id"] = appt.id
            except Exception as e:
                status = "Failed"
                log_data["error"] = str(e)
                
            log = ExecutionLog(
                execution_id=execution_id,
                node_id=node_id,
                action="Create Appointment",
                status=status,
                log_data=log_data,
                organization_id=exec_obj.organization_id
            )
            db.add(log)
            await db.commit()

        # Handle Action: Update Lead
        elif action_type == "update_lead":
            lead_id = context_data.get("lead_id")
            new_status = action.get("status")
            status_result = "Success"
            log_data = {"lead_id": lead_id, "new_status": new_status}

            if lead_id and new_status:
                try:
                    from app.modules.crm.models import Lead
                    lead_res = await db.execute(select(Lead).where(Lead.id == lead_id, Lead.organization_id == exec_obj.organization_id))
                    lead = lead_res.scalars().first()
                    if lead:
                        if lead.status != new_status:
                            lead.status = new_status
                            await db.commit()
                            from app.core.events import publish, LeadUpdatedEvent
                            await publish("lead.status_changed", LeadUpdatedEvent(
                                lead_id=lead.id,
                                organization_id=exec_obj.organization_id,
                                changed_fields=["status"]
                            ))
                        else:
                            await db.commit()
                    else:
                        status_result = "Failed"
                        log_data["error"] = "Lead not found"
                except Exception as e:
                    status_result = "Failed"
                    log_data["error"] = str(e)
            else:
                status_result = "Failed"
                log_data["error"] = "Missing lead_id or new_status"

            log = ExecutionLog(
                execution_id=execution_id,
                node_id=node_id,
                action="Update Lead",
                status=status_result,
                log_data=log_data,
                organization_id=exec_obj.organization_id
            )
            db.add(log)
            await db.commit()

        # Handle Action: Delay
        elif action_type == "delay":
            delay_seconds = int(action.get("delay_seconds", 60))
            
            log = ExecutionLog(
                execution_id=execution_id,
                node_id=node_id,
                action="Delay Start",
                status="Success",
                log_data={"delay_seconds": delay_seconds},
                organization_id=exec_obj.organization_id
            )
            db.add(log)
            await db.commit()

            # Schedule resume via non-blocking asyncio background task
            async def run_delayed_task():
                await asyncio.sleep(delay_seconds)
                await _async_execute_step(execution_id, step_index + 1, context_data)

            asyncio.create_task(run_delayed_task())
            return

        # Handle Action: Delay Until Date
        elif action_type == "delay_until_date":
            target_str = render_text(action.get("date"))
            status = "Success"
            log_data = {"date": target_str}
            if target_str:
                try:
                    # parse date
                    target_date = datetime.fromisoformat(target_str.replace("Z", "+00:00"))
                    now = datetime.now(timezone.utc)
                    delay_seconds = int((target_date - now).total_seconds())
                    if delay_seconds > 0:
                        log = ExecutionLog(
                            execution_id=execution_id,
                            node_id=node_id,
                            action="Delay Until Date",
                            status="Success",
                            log_data={"delay_seconds": delay_seconds, "target_date": target_str},
                            organization_id=exec_obj.organization_id
                        )
                        db.add(log)
                        await db.commit()
                        
                        # Schedule resume via non-blocking asyncio background task
                        async def run_delayed_task():
                            await asyncio.sleep(delay_seconds)
                            await _async_execute_step(execution_id, step_index + 1, context_data)

                        asyncio.create_task(run_delayed_task())
                        return
                    else:
                        log_data["warning"] = "Target date is in the past, continuing immediately"
                except Exception as e:
                    status = "Failed"
                    log_data["error"] = str(e)
            else:
                status = "Failed"
                log_data["error"] = "Missing target date"
                
            log = ExecutionLog(
                execution_id=execution_id,
                node_id=node_id,
                action="Delay Until Date",
                status=status,
                log_data=log_data,
                organization_id=exec_obj.organization_id
            )
            db.add(log)
            await db.commit()

        # Handle Action: Trigger Another Workflow
        elif action_type == "trigger_another_workflow":
            target_wf_id = action.get("target_workflow_id")
            status = "Success"
            log_data = {"target_workflow_id": target_wf_id}
            if target_wf_id:
                try:
                    res_wf = await db.execute(select(Workflow).where(Workflow.id == target_wf_id, Workflow.organization_id == exec_obj.organization_id))
                    target_wf = res_wf.scalars().first()
                    if target_wf and target_wf.is_active:
                        exec_target = WorkflowExecution(
                            workflow_id=target_wf.id,
                            status="Running",
                            organization_id=exec_obj.organization_id
                        )
                        db.add(exec_target)
                        await db.commit()
                        await db.refresh(exec_target)
                        execute_workflow_node_task.delay(
                            exec_target.id,
                            0,
                            safe_json_dumps(context_data)
                        )
                    else:
                        status = "Failed"
                        log_data["error"] = "Target workflow not found or inactive"
                except Exception as e:
                    status = "Failed"
                    log_data["error"] = str(e)
            else:
                status = "Failed"
                log_data["error"] = "Missing target_workflow_id"
                
            log = ExecutionLog(
                execution_id=execution_id,
                node_id=node_id,
                action="Trigger Another Workflow",
                status=status,
                log_data=log_data,
                organization_id=exec_obj.organization_id
            )
            db.add(log)
            await db.commit()

        # Handle Action: Send SMS / Send WhatsApp (future-ready mock)
        elif action_type in ["send_sms", "send_whatsapp"]:
            phone = render_text(action.get("phone"))
            msg_body = render_text(action.get("message"))
            log_data = {"phone": phone, "message": msg_body}
            
            # Simple activity log to represent mock delivery
            from app.modules.crm.models import Activity
            act = Activity(
                type="SMS Sent" if action_type == "send_sms" else "WhatsApp Sent",
                description=f"[{action_type.replace('_', ' ').upper()}] Sent to {phone}: {msg_body}",
                lead_id=context_data.get("lead_id"),
                author_id="system",
                timestamp=datetime.now(timezone.utc),
                organization_id=exec_obj.organization_id
            )
            db.add(act)
            await db.commit()
            
            log = ExecutionLog(
                execution_id=execution_id,
                node_id=node_id,
                action=action_type.replace("_", " ").title(),
                status="Success",
                log_data=log_data,
                organization_id=exec_obj.organization_id
            )
            db.add(log)
            await db.commit()

        # Handle Action: Create Inbox Conversation
        elif action_type == "create_inbox_conversation":
            try:
                from app.modules.inbox.models import Message
                msg = Message(
                    subject=render_text(action.get("subject", "New Conversation")),
                    body=render_text(action.get("body", "")),
                    message_type="Email",
                    direction="Incoming",
                    delivery_status="Received",
                    organization_id=exec_obj.organization_id,
                    lead_id=context_data.get("lead_id")
                )
                db.add(msg)
                await db.commit()
                status = "Success"
                log_data = {"message_id": msg.id}
            except Exception as e:
                status = "Failed"
                log_data = {"error": str(e)}
                
            log = ExecutionLog(
                execution_id=execution_id,
                node_id=node_id,
                action="Create Inbox Conversation",
                status=status,
                log_data=log_data,
                organization_id=exec_obj.organization_id
            )
            db.add(log)
            await db.commit()

        # Handle Action: Notify User
        elif action_type == "notify_user":
            user_id = action.get("user_id") or context_data.get("owner_id")
            title = render_text(action.get("title", "New Notification"))
            content = render_text(action.get("content", ""))
            status = "Success"
            log_data = {"user_id": user_id, "title": title}
            if user_id:
                try:
                    from app.modules.notifications.models import Notification
                    notif = Notification(
                        user_id=user_id,
                        type="Info",
                        title=title,
                        content=content,
                        is_read=False,
                        organization_id=exec_obj.organization_id
                    )
                    db.add(notif)
                    await db.commit()
                except Exception as e:
                    status = "Failed"
                    log_data["error"] = str(e)
            else:
                status = "Failed"
                log_data["error"] = "Missing user_id"
                
            log = ExecutionLog(
                execution_id=execution_id,
                node_id=node_id,
                action="Notify User",
                status=status,
                log_data=log_data,
                organization_id=exec_obj.organization_id
            )
            db.add(log)
            await db.commit()

        # Handle Action: Create Invoice
        elif action_type == "create_invoice":
            amount = float(action.get("amount", 0.0) or 0.0)
            due_days = int(action.get("due_days", 7))
            status = "Success"
            log_data = {"amount": amount}
            try:
                from app.modules.payments.models import Invoice
                import uuid
                invoice = Invoice(
                    number=f"INV-{uuid.uuid4().hex[:6].upper()}",
                    amount=amount,
                    status="Draft",
                    lead_id=context_data.get("lead_id"),
                    contact_id=context_data.get("contact_id"),
                    due_date=datetime.now(timezone.utc) + timedelta(days=due_days),
                    organization_id=exec_obj.organization_id
                )
                db.add(invoice)
                await db.commit()
                log_data["invoice_id"] = invoice.id
            except Exception as e:
                status = "Failed"
                log_data["error"] = str(e)
                
            log = ExecutionLog(
                execution_id=execution_id,
                node_id=node_id,
                action="Create Invoice",
                status=status,
                log_data=log_data,
                organization_id=exec_obj.organization_id
            )
            db.add(log)
            await db.commit()

        # Handle Action: Mark Invoice Paid
        elif action_type == "mark_invoice_paid":
            invoice_id = context_data.get("invoice_id") or action.get("invoice_id")
            status = "Success"
            log_data = {"invoice_id": invoice_id}
            if invoice_id:
                try:
                    from app.modules.payments.models import Invoice
                    res_i = await db.execute(select(Invoice).where(Invoice.id == invoice_id, Invoice.organization_id == exec_obj.organization_id))
                    invoice = res_i.scalars().first()
                    if invoice:
                        invoice.status = "Paid"
                        invoice.paid_at = datetime.now(timezone.utc)
                        await db.commit()
                    else:
                        status = "Failed"
                        log_data["error"] = "Invoice not found"
                except Exception as e:
                    status = "Failed"
                    log_data["error"] = str(e)
            else:
                status = "Failed"
                log_data["error"] = "Missing invoice_id"
                
            log = ExecutionLog(
                execution_id=execution_id,
                node_id=node_id,
                action="Mark Invoice Paid",
                status=status,
                log_data=log_data,
                organization_id=exec_obj.organization_id
            )
            db.add(log)
            await db.commit()

        # Handle Action: Send Webhook / Call API Endpoint
        elif action_type in ["send_webhook", "call_api_endpoint"]:
            url = render_text(action.get("url"))
            status = "Success"
            log_data = {"url": url}
            if url:
                try:
                    import httpx
                    async with httpx.AsyncClient() as client:
                        resp = await client.post(url, json=context_data, timeout=10)
                        log_data["response_code"] = resp.status_code
                        if resp.status_code >= 400:
                            status = "Failed"
                            log_data["error"] = f"HTTP Error status: {resp.status_code}"
                except Exception as e:
                    status = "Failed"
                    log_data["error"] = str(e)
            else:
                status = "Failed"
                log_data["error"] = "Missing URL"
                
            log = ExecutionLog(
                execution_id=execution_id,
                node_id=node_id,
                action=action_type.replace("_", " ").title(),
                status=status,
                log_data=log_data,
                organization_id=exec_obj.organization_id
            )
            db.add(log)
            await db.commit()

        # Handle Action: Stop Email Sequence
        elif action_type == "stop_email_sequence":
            lead_id = context_data.get("lead_id")
            status = "Success"
            log_data = {"lead_id": lead_id}
            if lead_id:
                try:
                    # Cancel workflow executions for this lead
                    stmt_ex = select(WorkflowExecution).where(
                        WorkflowExecution.organization_id == exec_obj.organization_id,
                        WorkflowExecution.status == "Running",
                        WorkflowExecution.id != execution_id
                    )
                    res_ex = await db.execute(stmt_ex)
                    running_execs = res_ex.scalars().all()
                    cancelled_count = 0
                    for rx in running_execs:
                        rx.status = "Cancelled"
                        cancelled_count += 1
                    await db.commit()
                    log_data["cancelled_count"] = cancelled_count
                except Exception as e:
                    status = "Failed"
                    log_data["error"] = str(e)
            else:
                status = "Failed"
                log_data["error"] = "Missing lead_id"
                
            log = ExecutionLog(
                execution_id=execution_id,
                node_id=node_id,
                action="Stop Email Sequence",
                status=status,
                log_data=log_data,
                organization_id=exec_obj.organization_id
            )
            db.add(log)
            await db.commit()

        # Handle Action: End Workflow
        elif action_type == "end_workflow":
            exec_obj.status = "Completed"
            exec_obj.completed_at = datetime.now(timezone.utc)
            if exec_obj.started_at:
                delta = exec_obj.completed_at - exec_obj.started_at.replace(tzinfo=timezone.utc)
                exec_obj.execution_duration = delta.total_seconds()
                
            log = ExecutionLog(
                execution_id=execution_id,
                node_id=node_id,
                action="End Workflow",
                status="Success",
                log_data={},
                organization_id=exec_obj.organization_id
            )
            db.add(log)
            await db.commit()
            return

        # Move to next step
        await _async_execute_step(execution_id, step_index + 1, context_data)


class WorkflowEngine:
    @staticmethod
    async def handle_trigger(trigger_name: str, org_id: str, context_data: Dict[str, Any]):
        """Evaluates and initiates all active workflows matching a trigger."""
        async with AsyncSessionLocal() as db:
            stmt = select(Workflow).where(
                Workflow.is_active == True,
                Workflow.organization_id == org_id
            )
            result = await db.execute(stmt)
            active_workflows = result.scalars().all()

            for wf in active_workflows:
                # Support single trigger matching or multiple triggers
                triggers = []
                if wf.trigger:
                    triggers = [t.strip() for t in wf.trigger.split(",") if t.strip()]
                
                # Check triggers inside flow_data
                flow = wf.flow_data or {}
                if isinstance(flow, str):
                    try: flow = json.loads(flow)
                    except: flow = {}
                if "triggers" in flow and isinstance(flow["triggers"], list):
                    triggers.extend(flow["triggers"])
                
                alias = {
                    "InvoiceCreated": "invoice.created",
                    "invoice.created": "InvoiceCreated",
                    "AppointmentCreated": "meeting.created",
                    "meeting.created": "AppointmentCreated",
                    "LeadCreated": "lead.created",
                    "lead.created": "LeadCreated",
                    "DealCreated": "deal.created",
                    "deal.created": "DealCreated",
                }.get(trigger_name)

                if trigger_name in triggers or wf.trigger == trigger_name or (alias and (alias in triggers or wf.trigger == alias)):
                    # 1. Loop protection checks
                    visited_workflows = context_data.get("visited_workflows", [])
                    if wf.id in visited_workflows:
                        logger.warning(f"Cyclic execution aborted for workflow '{wf.name}' ({wf.id}) on event '{trigger_name}' in chain.")
                        continue
                        
                    chain_depth = context_data.get("chain_depth", 0)
                    if chain_depth >= 10:
                        logger.warning(f"Max chain depth (10) reached for workflow '{wf.name}' ({wf.id}). Aborting chain.")
                        continue

                    logger.info(f"Triggering workflow '{wf.name}' for organization {org_id}")
                    
                    # 2. Track trigger and initial status in execution_metadata
                    prev_status = None
                    if "entity" in context_data and isinstance(context_data["entity"], dict):
                        prev_status = context_data["entity"].get("status")
                        
                    exec_obj = WorkflowExecution(
                        workflow_id=wf.id,
                        status="Running",
                        organization_id=org_id,
                        execution_metadata={
                            "trigger_event": trigger_name,
                            "entity": context_data.get("lead_id") or context_data.get("deal_id") or context_data.get("contact_id") or "Generic",
                            "previous_status": prev_status,
                            "new_status": None,
                            "actions_executed": [],
                            "retry_count": 0,
                            "errors": [],
                            "parent_execution_id": context_data.get("workflow_execution_id"),
                            "correlation_id": context_data.get("correlation_id") or "initial",
                            "max_depth_exceeded": False
                        }
                    )
                    db.add(exec_obj)
                    await db.commit()
                    await db.refresh(exec_obj)

                    # Emit workflow.started event
                    from app.core.events import publish, GenericEvent
                    await publish("workflow.started", GenericEvent(
                        event_name="workflow.started",
                        organization_id=org_id,
                        entity_id=exec_obj.id,
                        trigger_name="workflow.started",
                        data={
                            "workflow_id": wf.id,
                            "workflow_name": wf.name,
                            "execution_id": exec_obj.id,
                            "trigger_event": trigger_name
                        }
                    ))

                    # 3. Propagate updated chain context
                    new_depth = chain_depth + 1
                    new_visited = list(visited_workflows) + [wf.id]
                    new_visited_events = list(context_data.get("visited_events", []))
                    if trigger_name not in new_visited_events:
                        new_visited_events.append(trigger_name)

                    # Update context data copy for this execution task
                    task_context = dict(context_data)
                    task_context["correlation_id"] = context_data.get("correlation_id") or exec_obj.id
                    task_context["chain_depth"] = new_depth
                    task_context["visited_workflows"] = new_visited
                    task_context["visited_events"] = new_visited_events
                    task_context["initial_event_source"] = context_data.get("initial_event_source") or trigger_name

                    # Initialize sequential execution
                    if wf.flow_data and "actions" in wf.flow_data:
                        try:
                            execute_workflow_node_task.delay(
                                exec_obj.id,
                                0,
                                safe_json_dumps(task_context)
                            )
                        except Exception as e:
                            logger.warning(f"Celery task dispatch failed, executing workflow inline: {e}")
                            asyncio.create_task(_async_execute_step(exec_obj.id, 0, task_context))


# Event listeners to wire events to the Workflow Engine dynamically
def make_generic_listener(event_name: str):
    async def listener(event):
        context_data = {}
        # Hydrate from event attributes
        if hasattr(event, "model_dump"):
            context_data.update(event.model_dump())
        elif isinstance(event, dict):
            context_data.update(event)

        # Handle GenericEvent data unpack
        if hasattr(event, "data") and isinstance(event.data, dict):
            context_data.update(event.data)
            if "entity" not in context_data:
                context_data["entity"] = event.data
            else:
                context_data["entity"] = {**context_data["entity"], **event.data}
        else:
            # Fallback to model dump as entity
            if hasattr(event, "model_dump"):
                context_data["entity"] = event.model_dump()
            elif isinstance(event, dict):
                context_data["entity"] = event

        # Pull key references if present
        for key in ["lead_id", "deal_id", "contact_id", "company_id", "task_id", "appointment_id", "email_log_id", "form_id", "submission_id", "invoice_id", "workflow_id", "execution_id"]:
            if hasattr(event, key):
                context_data[key] = getattr(event, key)
            elif isinstance(event, dict) and key in event:
                context_data[key] = event[key]
            elif isinstance(context_data.get("entity"), dict) and key in context_data["entity"]:
                context_data[key] = context_data["entity"][key]
                
        # Also handle email/recipient if present
        if hasattr(event, "email"):
            context_data["email"] = event.email
        elif isinstance(event, dict) and "email" in event:
            context_data["email"] = event["email"]
        elif hasattr(event, "recipient_email"):
            context_data["email"] = event.recipient_email
        elif isinstance(event, dict) and "recipient_email" in event:
            context_data["email"] = event["recipient_email"]
        elif isinstance(context_data.get("entity"), dict) and "email" in context_data["entity"]:
            context_data["email"] = context_data["entity"]["email"]

        org_id = getattr(event, "organization_id", None)
        if isinstance(event, dict):
            org_id = event.get("organization_id")
        if not org_id and isinstance(context_data.get("entity"), dict):
            org_id = context_data["entity"].get("organization_id")
            
        if org_id:
            await WorkflowEngine.handle_trigger(event_name, org_id, context_data)
    return listener


def init_workflow_listeners():
    """Subscribe workflow listeners to event bus dynamically."""
    from app.core.events import subscribe
    all_events = [
        # CRM
        "lead.created", "lead.updated", "lead.deleted", "lead.assigned", "lead.status_changed",
        "contact.created", "contact.updated", "company.created", "company.updated",
        "deal.created", "deal.updated", "deal.won", "deal.lost", "pipeline.stage_changed",
        "pipeline.stage_new", "pipeline.stage_contacted", "pipeline.stage_qualified", "pipeline.stage_proposal", "pipeline.stage_negotiation", "pipeline.stage_deal_lost", "pipeline.stage_deal_won",
        "owner.changed", "tag.added", "tag.removed",
        # Forms
        "form.submitted", "duplicate.submission", "file.uploaded", "form.abandoned",
        # Email
        "email.sent", "email.delivered", "email.failed", "email.opened", "email.clicked", "email.reply_received", "email.bounce_detected",
        # Inbox
        "message.incoming", "message.incoming_email", "message.conversation_started", "message.conversation_closed",
        # Calendar
        "appointment.booked", "appointment.cancelled", "appointment.completed", "appointment.reminder_time",
        "AppointmentCreated", "AppointmentUpdated", "AppointmentCancelled",
        # Tasks
        "task.created", "task.assigned", "task.completed", "task.overdue",
        # Payments
        "invoice.created", "invoice.paid", "payment.failed", "refund.issued",
        "InvoiceCreated", "InvoiceSent", "InvoicePaid", "InvoiceCancelled", "InvoiceUpdated",

        # Funnels
        "funnel.started", "funnel.step_completed", "funnel.completed",
        # Workflow
        "workflow.started", "workflow.completed", "workflow.failed",
        # Integrations
        "webhook.received", "stripe.webhook", "gmail.connected", "gmail.disconnected", "oauth.connected",
        # Campaigns
        "campaign.created", "campaign.queued", "campaign.started", "campaign.completed", "campaign.failed", "campaign.email_sent"
    ]
    for ev in all_events:
        subscribe(ev, make_generic_listener(ev))
    _workflow_listeners_initialized = True
    logger.info("Workflow listeners initialized successfully")
