from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from typing import List, Optional
from app.modules.reviews.models import Review
from app.modules.reviews.schemas import ReviewCreate, ReviewUpdate

class ReviewService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_reviews(self, organization_id: str) -> List[Review]:
        result = await self.db.execute(
            select(Review).where(Review.organization_id == organization_id)
            .order_by(Review.created_at.desc())
        )
        return result.scalars().all()

    async def create_review(self, review_in: ReviewCreate, organization_id: str) -> Review:
        review = Review(**review_in.model_dump(), organization_id=organization_id)
        self.db.add(review)
        await self.db.commit()
        await self.db.refresh(review)
        return review

    async def update_review(self, review_id: str, review_in: ReviewUpdate, organization_id: str) -> Optional[Review]:
        result = await self.db.execute(
            select(Review).where(Review.id == review_id, Review.organization_id == organization_id)
        )
        review = result.scalars().first()
        if not review:
            return None
        update_data = review_in.model_dump(exclude_unset=True)
        for key, value in update_data.items():
            setattr(review, key, value)
        await self.db.commit()
        await self.db.refresh(review)
        return review

    async def delete_review(self, review_id: str, organization_id: str) -> bool:
        result = await self.db.execute(
            select(Review).where(Review.id == review_id, Review.organization_id == organization_id)
        )
        review = result.scalars().first()
        if not review:
            return False
        await self.db.delete(review)
        await self.db.commit()
        return True
