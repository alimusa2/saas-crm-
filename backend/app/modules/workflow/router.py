from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List

from app.db.session import get_db
from app.core.security import get_current_user
from app.modules.workflow.schemas import WorkflowCreate, WorkflowUpdate, WorkflowResponse
from app.modules.workflow.services import WorkflowService

from app.modules.auth.dependencies import require_org_admin
from app.modules.auth.models import User

router = APIRouter()

def get_workflow_service(db: AsyncSession = Depends(get_db)) -> WorkflowService:
    return WorkflowService(db)

@router.get("/", response_model=List[WorkflowResponse])
async def list_workflows(
    workflow_service: WorkflowService = Depends(get_workflow_service),
    current_user: dict = Depends(get_current_user),
    admin_user: User = Depends(require_org_admin)
):
    """List workflows for the organization"""
    return await workflow_service.get_workflows(current_user["org"])

@router.post("/", response_model=WorkflowResponse, status_code=status.HTTP_201_CREATED)
async def create_workflow(
    workflow_in: WorkflowCreate,
    workflow_service: WorkflowService = Depends(get_workflow_service),
    current_user: dict = Depends(get_current_user),
    admin_user: User = Depends(require_org_admin)
):
    """Create a new workflow"""
    return await workflow_service.create_workflow(workflow_in, current_user["org"])

@router.get("/executions", response_model=List[dict])
async def list_executions(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
    admin_user: User = Depends(require_org_admin)
):
    """List workflow executions for the organization with logs"""
    from app.modules.workflow.models import WorkflowExecution, Workflow, ExecutionLog
    from sqlalchemy.future import select
    
    stmt = select(WorkflowExecution, Workflow).outerjoin(
        Workflow, WorkflowExecution.workflow_id == Workflow.id
    ).where(WorkflowExecution.organization_id == current_user["org"]).order_by(
        WorkflowExecution.started_at.desc()
    )
    result = await db.execute(stmt)
    
    executions = []
    for exec_obj, wf in result.all():
        # Get logs for this execution
        logs_stmt = select(ExecutionLog).where(
            ExecutionLog.execution_id == exec_obj.id
        ).order_by(ExecutionLog.timestamp.asc())
        logs_result = await db.execute(logs_stmt)
        logs = [
            {
                "id": log.id,
                "node_id": log.node_id,
                "action": log.action,
                "status": log.status,
                "log_data": log.log_data,
                "timestamp": log.timestamp.isoformat() if log.timestamp else None
            }
            for log in logs_result.scalars().all()
        ]
        
        meta = exec_obj.execution_metadata or {}
        executions.append({
            "id": exec_obj.id,
            "workflow_id": exec_obj.workflow_id,
            "workflow_name": wf.name if wf else "Deleted Automation",
            "status": exec_obj.status,
            "started_at": exec_obj.started_at.isoformat() if exec_obj.started_at else None,
            "completed_at": exec_obj.completed_at.isoformat() if exec_obj.completed_at else None,
            "execution_duration": exec_obj.execution_duration,
            "error_message": exec_obj.error_message,
            "trigger_event": meta.get("trigger_event"),
            "entity": meta.get("entity"),
            "previous_status": meta.get("previous_status"),
            "new_status": meta.get("new_status"),
            "actions_executed": meta.get("actions_executed", []),
            "retry_count": meta.get("retry_count", 0),
            "errors": meta.get("errors", []),
            "logs": logs
        })
    return executions


@router.get("/{workflow_id}", response_model=WorkflowResponse)
async def get_workflow(
    workflow_id: str,
    workflow_service: WorkflowService = Depends(get_workflow_service),
    current_user: dict = Depends(get_current_user),
    admin_user: User = Depends(require_org_admin)
):
    """Get a specific workflow"""
    workflow = await workflow_service.get_workflow(workflow_id, current_user["org"])
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return workflow


@router.patch("/{workflow_id}", response_model=WorkflowResponse)
async def update_workflow(
    workflow_id: str,
    workflow_in: WorkflowUpdate,
    workflow_service: WorkflowService = Depends(get_workflow_service),
    current_user: dict = Depends(get_current_user),
    admin_user: User = Depends(require_org_admin)
):
    """Update a workflow"""
    workflow = await workflow_service.update_workflow(workflow_id, workflow_in, current_user["org"])
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return workflow


@router.delete("/{workflow_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_workflow(
    workflow_id: str,
    workflow_service: WorkflowService = Depends(get_workflow_service),
    current_user: dict = Depends(get_current_user),
    admin_user: User = Depends(require_org_admin)
):
    """Delete a workflow"""
    deleted = await workflow_service.delete_workflow(workflow_id, current_user["org"])
    if not deleted:
        raise HTTPException(status_code=404, detail="Workflow not found")


@router.post("/{workflow_id}/test", status_code=status.HTTP_200_OK)
async def test_workflow(
    workflow_id: str,
    payload: dict,
    workflow_service: WorkflowService = Depends(get_workflow_service),
    current_user: dict = Depends(get_current_user),
    admin_user: User = Depends(require_org_admin)
):
    """Manually test/execute a workflow with a test payload"""
    workflow = await workflow_service.get_workflow(workflow_id, current_user["org"])
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")
        
    from app.modules.workflow.models import WorkflowExecution
    from app.modules.workflow.executor import execute_workflow_node_task, _async_execute_step
    import json
    import asyncio
    
    db = workflow_service.db
    exec_obj = WorkflowExecution(
        workflow_id=workflow.id,
        status="Running",
        organization_id=current_user["org"]
    )
    db.add(exec_obj)
    await db.commit()
    await db.refresh(exec_obj)
    
    if workflow.flow_data and "actions" in workflow.flow_data:
        try:
            execute_workflow_node_task.delay(
                exec_obj.id,
                0,
                json.dumps(payload)
            )
        except Exception:
            asyncio.create_task(_async_execute_step(exec_obj.id, 0, payload))
    return {"message": "Workflow test execution started", "execution_id": exec_obj.id}
