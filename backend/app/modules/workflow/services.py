from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from typing import List, Optional

from app.modules.workflow.models import Workflow, WorkflowExecution
from app.modules.workflow.schemas import WorkflowCreate, WorkflowUpdate

class WorkflowService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_workflow(self, workflow_id: str, organization_id: str) -> Optional[Workflow]:
        result = await self.db.execute(
            select(Workflow).where(
                Workflow.id == workflow_id, 
                Workflow.organization_id == organization_id
            )
        )
        return result.scalars().first()

    async def get_workflows(self, organization_id: str) -> List[Workflow]:
        result = await self.db.execute(
            select(Workflow).where(Workflow.organization_id == organization_id)
        )
        return result.scalars().all()

    async def create_workflow(self, workflow_in: WorkflowCreate, organization_id: str) -> Workflow:
        workflow = Workflow(**workflow_in.model_dump(), organization_id=organization_id)
        self.db.add(workflow)
        await self.db.commit()
        await self.db.refresh(workflow)
        return workflow

    async def update_workflow(self, workflow_id: str, workflow_in: WorkflowUpdate, organization_id: str) -> Optional[Workflow]:
        workflow = await self.get_workflow(workflow_id, organization_id)
        if not workflow:
            return None
        
        update_data = workflow_in.model_dump(exclude_unset=True)
        for key, value in update_data.items():
            setattr(workflow, key, value)
            
        await self.db.commit()
        await self.db.refresh(workflow)
        return workflow

    async def delete_workflow(self, workflow_id: str, organization_id: str) -> bool:
        workflow = await self.get_workflow(workflow_id, organization_id)
        if not workflow:
            return False
        await self.db.delete(workflow)
        await self.db.commit()
        return True
