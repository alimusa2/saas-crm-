from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List

from app.db.session import get_db
from app.core.security import get_current_user
from app.modules.reviews.schemas import ReviewCreate, ReviewUpdate, ReviewResponse
from app.modules.reviews.services import ReviewService

router = APIRouter()

def get_review_service(db: AsyncSession = Depends(get_db)) -> ReviewService:
    return ReviewService(db)

@router.get("/", response_model=List[ReviewResponse])
async def list_reviews(
    review_service: ReviewService = Depends(get_review_service),
    current_user: dict = Depends(get_current_user)
):
    """List all reviews for the organization."""
    return await review_service.get_reviews(current_user["org"])

@router.post("/", response_model=ReviewResponse, status_code=status.HTTP_201_CREATED)
async def create_review(
    review_in: ReviewCreate,
    review_service: ReviewService = Depends(get_review_service),
    current_user: dict = Depends(get_current_user)
):
    """Create a new review."""
    return await review_service.create_review(review_in, current_user["org"])

@router.patch("/{review_id}", response_model=ReviewResponse)
async def update_review(
    review_id: str,
    review_in: ReviewUpdate,
    review_service: ReviewService = Depends(get_review_service),
    current_user: dict = Depends(get_current_user)
):
    """Update a review's status or featured flag."""
    review = await review_service.update_review(review_id, review_in, current_user["org"])
    if not review:
        raise HTTPException(status_code=404, detail="Review not found")
    return review

@router.delete("/{review_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_review(
    review_id: str,
    review_service: ReviewService = Depends(get_review_service),
    current_user: dict = Depends(get_current_user)
):
    """Delete a review."""
    success = await review_service.delete_review(review_id, current_user["org"])
    if not success:
        raise HTTPException(status_code=404, detail="Review not found")
