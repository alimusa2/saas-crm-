from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List

from app.db.session import get_db
from app.core.security import get_current_user
from app.modules.pipeline.schemas import PipelineCreate, PipelineResponse, StageCreate, StageResponse, DealCreate, DealResponse, DealUpdate, PipelineUpdate
from app.modules.pipeline.services import PipelineService

router = APIRouter()

def get_pipeline_service(db: AsyncSession = Depends(get_db)) -> PipelineService:
    return PipelineService(db)

@router.get("/", response_model=List[PipelineResponse])
async def list_pipelines(
    pipeline_service: PipelineService = Depends(get_pipeline_service),
    current_user: dict = Depends(get_current_user)
):
    """List pipelines for the organization"""
    return await pipeline_service.get_pipelines(current_user["org"])

@router.get("/all-stages", response_model=List[StageResponse])
async def list_all_stages(
    pipeline_service: PipelineService = Depends(get_pipeline_service),
    current_user: dict = Depends(get_current_user)
):
    """Retrieve all pipeline stages in the organization."""
    return await pipeline_service.get_all_stages(current_user["org"])

@router.post("/", response_model=PipelineResponse, status_code=status.HTTP_201_CREATED)
async def create_pipeline(
    pipeline_in: PipelineCreate,
    pipeline_service: PipelineService = Depends(get_pipeline_service),
    current_user: dict = Depends(get_current_user)
):
    """Create a pipeline"""
    return await pipeline_service.create_pipeline(pipeline_in, current_user["org"])

@router.patch("/{pipeline_id}", response_model=PipelineResponse)
async def update_pipeline(
    pipeline_id: str,
    pipeline_in: PipelineUpdate,
    pipeline_service: PipelineService = Depends(get_pipeline_service),
    current_user: dict = Depends(get_current_user)
):
    """Update a pipeline (e.g. status-to-stage mapping)"""
    pipeline = await pipeline_service.update_pipeline(pipeline_id, pipeline_in, current_user["org"])
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")
    return pipeline

@router.post("/{pipeline_id}/stages", response_model=StageResponse, status_code=status.HTTP_201_CREATED)
async def create_stage(
    pipeline_id: str,
    stage_in: StageCreate,
    pipeline_service: PipelineService = Depends(get_pipeline_service),
    current_user: dict = Depends(get_current_user)
):
    """Create a stage within a pipeline"""
    return await pipeline_service.create_stage(stage_in, pipeline_id, current_user["org"])

@router.get("/{pipeline_id}/stages", response_model=List[StageResponse])
async def list_stages(
    pipeline_id: str,
    pipeline_service: PipelineService = Depends(get_pipeline_service),
    current_user: dict = Depends(get_current_user)
):
    """List stages for a pipeline"""
    return await pipeline_service.get_stages(pipeline_id, current_user["org"])

@router.post("/deals", response_model=DealResponse, status_code=status.HTTP_201_CREATED)
async def create_deal(
    deal_in: DealCreate,
    pipeline_service: PipelineService = Depends(get_pipeline_service),
    current_user: dict = Depends(get_current_user)
):
    """Create a new deal"""
    return await pipeline_service.create_deal(deal_in, current_user["org"], current_user["sub"])

@router.get("/deals", response_model=List[DealResponse])
async def list_deals(
    pipeline_service: PipelineService = Depends(get_pipeline_service),
    current_user: dict = Depends(get_current_user)
):
    """List deals for the organization"""
    return await pipeline_service.get_deals(current_user["org"], current_user=current_user)

@router.get("/deals/{deal_id}", response_model=DealResponse)
async def get_deal(
    deal_id: str,
    pipeline_service: PipelineService = Depends(get_pipeline_service),
    current_user: dict = Depends(get_current_user)
):
    """Get a specific deal by ID"""
    deal = await pipeline_service.get_deal(deal_id, current_user["org"], current_user=current_user)
    if not deal:
        raise HTTPException(status_code=404, detail="Deal not found")
    return deal

@router.patch("/deals/{deal_id}", response_model=DealResponse)
async def update_deal(
    deal_id: str,
    deal_in: DealUpdate,
    pipeline_service: PipelineService = Depends(get_pipeline_service),
    current_user: dict = Depends(get_current_user)
):
    """Update a deal"""
    deal = await pipeline_service.update_deal(deal_id, deal_in, current_user["org"])
    if not deal:
        raise HTTPException(status_code=404, detail="Deal not found")
    return deal

@router.delete("/deals/{deal_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_deal(
    deal_id: str,
    pipeline_service: PipelineService = Depends(get_pipeline_service),
    current_user: dict = Depends(get_current_user)
):
    """Delete a deal"""
    success = await pipeline_service.delete_deal(deal_id, current_user["org"])
    if not success:
        raise HTTPException(status_code=404, detail="Deal not found")

