from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List

from app.db.session import get_db
from app.core.security import get_current_user
from app.modules.tasks.schemas import TaskCreate, TaskUpdate, TaskResponse
from app.modules.tasks.services import TaskService

router = APIRouter()

def get_task_service(db: AsyncSession = Depends(get_db)) -> TaskService:
    return TaskService(db)

@router.get("/", response_model=List[TaskResponse])
async def list_tasks(
    task_service: TaskService = Depends(get_task_service),
    current_user: dict = Depends(get_current_user)
):
    """List tasks for the organization"""
    return await task_service.get_tasks(current_user["org"], current_user=current_user)

@router.post("/", response_model=TaskResponse, status_code=status.HTTP_201_CREATED)
async def create_task(
    task_in: TaskCreate,
    task_service: TaskService = Depends(get_task_service),
    current_user: dict = Depends(get_current_user)
):
    """Create a new task"""
    return await task_service.create_task(task_in, current_user["org"], current_user["sub"])

@router.patch("/{task_id}", response_model=TaskResponse)
async def update_task(
    task_id: str,
    task_in: TaskUpdate,
    task_service: TaskService = Depends(get_task_service),
    current_user: dict = Depends(get_current_user)
):
    """Update a task"""
    task = await task_service.update_task(task_id, task_in, current_user["org"], current_user["sub"])
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task

@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task(
    task_id: str,
    task_service: TaskService = Depends(get_task_service),
    current_user: dict = Depends(get_current_user)
):
    """Delete a task"""
    success = await task_service.delete_task(task_id, current_user["org"])
    if not success:
        raise HTTPException(status_code=404, detail="Task not found")
