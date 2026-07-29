from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Dict, Any

from app.db.session import get_db
from app.core.security import get_current_user
from app.modules.employee.services import EmployeeService
from app.modules.crm.schemas import LeadResponse
from app.modules.pipeline.schemas import DealResponse
from app.modules.tasks.schemas import TaskResponse
from app.modules.funnels.schemas import FunnelResponse
from app.modules.forms.schemas import FormResponse

router = APIRouter()

def get_employee_service(db: AsyncSession = Depends(get_db)) -> EmployeeService:
    return EmployeeService(db)

@router.get("/dashboard")
async def get_employee_dashboard(
    svc: EmployeeService = Depends(get_employee_service),
    current_user: dict = Depends(get_current_user)
):
    """Retrieve scoped dashboard metrics for the logged-in employee."""
    return await svc.get_employee_dashboard(current_user["sub"], current_user["org"])

@router.get("/leads", response_model=List[LeadResponse])
async def get_employee_leads(
    svc: EmployeeService = Depends(get_employee_service),
    current_user: dict = Depends(get_current_user)
):
    """Retrieve scoped leads assigned to the logged-in employee."""
    return await svc.get_employee_leads(current_user["sub"], current_user["org"])

@router.get("/opportunities", response_model=List[DealResponse])
async def get_employee_opportunities(
    svc: EmployeeService = Depends(get_employee_service),
    current_user: dict = Depends(get_current_user)
):
    """Retrieve scoped deals/opportunities assigned to the logged-in employee."""
    return await svc.get_employee_opportunities(current_user["sub"], current_user["org"])

@router.get("/tasks", response_model=List[TaskResponse])
async def get_employee_tasks(
    svc: EmployeeService = Depends(get_employee_service),
    current_user: dict = Depends(get_current_user)
):
    """Retrieve scoped tasks assigned to the logged-in employee."""
    return await svc.get_employee_tasks(current_user["sub"], current_user["org"])

@router.get("/funnels", response_model=List[FunnelResponse])
async def get_employee_funnels(
    svc: EmployeeService = Depends(get_employee_service),
    current_user: dict = Depends(get_current_user)
):
    """Retrieve funnels assigned to the logged-in employee."""
    return await svc.get_employee_funnels(current_user["sub"], current_user["org"])

@router.get("/forms", response_model=List[FormResponse])
async def get_employee_forms(
    svc: EmployeeService = Depends(get_employee_service),
    current_user: dict = Depends(get_current_user)
):
    """Retrieve forms assigned to the logged-in employee."""
    return await svc.get_employee_forms(current_user["sub"], current_user["org"])
