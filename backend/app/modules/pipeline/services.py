from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from typing import List, Optional

from app.modules.pipeline.models import Pipeline, Stage, Deal
from app.modules.pipeline.schemas import PipelineCreate, StageCreate, DealCreate, DealUpdate, PipelineUpdate

class PipelineService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_pipelines(self, organization_id: str) -> List[Pipeline]:
        result = await self.db.execute(
            select(Pipeline).where(Pipeline.organization_id == organization_id)
        )
        return result.scalars().all()

    async def create_pipeline(self, pipeline_in: PipelineCreate, organization_id: str) -> Pipeline:
        pipeline = Pipeline(**pipeline_in.model_dump(), organization_id=organization_id)
        self.db.add(pipeline)
        await self.db.commit()
        await self.db.refresh(pipeline)
        return pipeline

    async def create_stage(self, stage_in: StageCreate, pipeline_id: str, organization_id: str) -> Stage:
        stage = Stage(**stage_in.model_dump(), pipeline_id=pipeline_id, organization_id=organization_id)
        self.db.add(stage)
        await self.db.commit()
        await self.db.refresh(stage)
        return stage

    async def get_stages(self, pipeline_id: str, organization_id: str) -> List[Stage]:
        result = await self.db.execute(
            select(Stage).where(
                Stage.pipeline_id == pipeline_id, 
                Stage.organization_id == organization_id
            ).order_by(Stage.order)
        )
        return result.scalars().all()

    async def get_all_stages(self, organization_id: str) -> List[Stage]:
        result = await self.db.execute(
            select(Stage).where(Stage.organization_id == organization_id).order_by(Stage.order)
        )
        return list(result.scalars().all())

    async def create_deal(self, deal_in: DealCreate, organization_id: str, owner_id: str) -> Deal:
        deal = Deal(**deal_in.model_dump(), organization_id=organization_id, owner_id=owner_id)
        self.db.add(deal)
        await self.db.commit()
        await self.db.refresh(deal)
        from app.core.events import publish, GenericEvent
        await publish("deal.created", GenericEvent(
            event_name="deal.created",
            organization_id=organization_id,
            data={"deal_id": deal.id, "title": deal.title, "value": deal.value, "stage_id": deal.stage_id, "lead_id": deal.lead_id}
        ))
        return deal

    async def get_deals(self, organization_id: str, current_user: Optional[dict] = None) -> List[Deal]:
        stmt = select(Deal).where(Deal.organization_id == organization_id)
        
        # Non-admin Employee Data Isolation Filter
        if current_user and not current_user.get("is_superuser") and current_user.get("role") != "Admin":
            from app.core.permissions import get_employee_permissions_context
            from sqlalchemy import or_
            perm_ctx = await get_employee_permissions_context(self.db, current_user)
            if not perm_ctx["is_admin"]:
                u_id = perm_ctx["user_id"]
                m_id = perm_ctx["member_id"]
                assigned = perm_ctx["assigned_deals"]
                
                conds = []
                if u_id: conds.append(Deal.owner_id == u_id)
                if m_id: conds.append(Deal.owner_id == m_id)
                if assigned and len(assigned) > 0: conds.append(Deal.id.in_(assigned))
                
                if conds:
                    stmt = stmt.where(or_(*conds))

        result = await self.db.execute(stmt)
        return list(result.scalars().all())

    async def get_deal(self, deal_id: str, organization_id: str, current_user: Optional[dict] = None) -> Optional[Deal]:
        result = await self.db.execute(
            select(Deal).where(Deal.id == deal_id, Deal.organization_id == organization_id)
        )
        deal = result.scalars().first()
        if not deal:
            return None

        if current_user and not current_user.get("is_superuser") and current_user.get("role") != "Admin":
            from app.core.permissions import get_employee_permissions_context
            perm_ctx = await get_employee_permissions_context(self.db, current_user)
            if not perm_ctx["is_admin"]:
                u_id = perm_ctx["user_id"]
                m_id = perm_ctx["member_id"]
                assigned = perm_ctx["assigned_deals"]
                is_authorized = (deal.owner_id in [u_id, m_id]) or (deal.id in assigned)
                if not is_authorized:
                    from fastapi import HTTPException
                    raise HTTPException(status_code=403, detail="Forbidden: Access to this deal is denied.")
        return deal

    async def update_deal(self, deal_id: str, deal_in: DealUpdate, organization_id: str) -> Optional[Deal]:
        result = await self.db.execute(
            select(Deal).where(Deal.id == deal_id, Deal.organization_id == organization_id)
        )
        deal = result.scalars().first()
        if not deal:
            return None
        
        old_status = deal.status
        old_stage_id = deal.stage_id
        update_data = deal_in.model_dump(exclude_unset=True)
        for key, value in update_data.items():
            setattr(deal, key, value)
            
        await self.db.commit()
        await self.db.refresh(deal)

        from app.core.events import publish, PipelineStageChangedEvent, _sync_in_progress
        
        # Look up Stage details
        stage = None
        stages = []
        try:
            res_stage = await self.db.execute(select(Stage).where(Stage.id == deal.stage_id))
            stage = res_stage.scalars().first()
            if stage:
                res_all_stages = await self.db.execute(
                    select(Stage).where(Stage.pipeline_id == stage.pipeline_id).order_by(Stage.order)
                )
                stages = list(res_all_stages.scalars().all())
        except Exception:
            pass

        # Look up Contact ID
        contact_id = None
        if deal.lead_id:
            try:
                from app.modules.crm.models import Lead, Contact
                res_lead = await self.db.execute(select(Lead).where(Lead.id == deal.lead_id))
                lead_obj = res_lead.scalars().first()
                if lead_obj:
                    res_c = await self.db.execute(select(Contact).where(Contact.email == lead_obj.email, Contact.organization_id == organization_id))
                    c = res_c.scalars().first()
                    if c:
                        contact_id = c.id
            except Exception:
                pass

        events_to_publish = []

        # Emit PipelineStageChanged event if stage_id is updated and different
        if "stage_id" in update_data and old_stage_id != deal.stage_id:
            old_stage = next((s for s in stages if s.id == old_stage_id), None)
            
            events_to_publish.append(("pipeline.stage_changed", PipelineStageChangedEvent(
                deal_id=deal.id,
                old_stage_id=old_stage_id,
                new_stage_id=deal.stage_id,
                organization_id=organization_id,
                lead_id=deal.lead_id,
                contact_id=contact_id,
                pipeline_id=stage.pipeline_id if stage else None,
                current_stage=stage.name if stage else None,
                previous_stage=old_stage.name if old_stage else None
            )))

            # Sync back to Lead — Pipeline stage is authoritative; mirror Lead status = stage name
            if deal.lead_id and not _sync_in_progress.get() and stage:
                token = _sync_in_progress.set(True)
                try:
                    # 1. Try custom mapping reverse lookup (status_stage_mapping)
                    mapped_status = None
                    try:
                        res_pipe = await self.db.execute(select(Pipeline).where(Pipeline.id == stage.pipeline_id))
                        pipeline_obj = res_pipe.scalars().first()
                        if pipeline_obj:
                            mapping = getattr(pipeline_obj, "status_stage_mapping", None) or {}
                            for status_key, stage_val in mapping.items():
                                if stage.id == stage_val or stage.name.lower() == str(stage_val).lower():
                                    mapped_status = status_key
                                    break
                    except Exception:
                        pass

                    # 2. Fall back to exact stage name (no substring guessing)
                    if not mapped_status:
                        mapped_status = stage.name

                    if mapped_status:
                        from app.modules.crm.services import CRMService
                        from app.modules.crm.schemas import LeadUpdate
                        crm_svc = CRMService(self.db)
                        await crm_svc.update_lead(deal.lead_id, LeadUpdate(status=mapped_status), organization_id)
                except Exception as e:
                    import logging
                    logging.getLogger(__name__).warning(f"Failed to synchronize pipeline stage change to lead: {e}")
                finally:
                    _sync_in_progress.reset(token)

        # Emit events based on deal status change
        if old_status != deal.status:
            from app.core.events import BaseEvent
            
            class DealStatusEvent(BaseEvent):
                deal_id: str
                organization_id: str
                title: str
                value: float

            event = DealStatusEvent(
                deal_id=deal.id,
                organization_id=organization_id,
                lead_id=deal.lead_id,
                contact_id=contact_id,
                pipeline_id=stage.pipeline_id if stage else None,
                current_stage=stage.name if stage else None,
                title=deal.title,
                value=deal.value or 0.0
            )

            if deal.status == "Won":
                events_to_publish.append(("deal.won", event))
            elif deal.status == "Lost":
                events_to_publish.append(("deal.lost", event))
            else:
                events_to_publish.append(("deal.updated", event))

        # Publish all collected events outside sync ContextVar scope
        for ev_name, ev_data in events_to_publish:
            await publish(ev_name, ev_data)

        return deal


    async def update_pipeline(self, pipeline_id: str, pipeline_in: PipelineUpdate, organization_id: str) -> Optional[Pipeline]:
        result = await self.db.execute(
            select(Pipeline).where(Pipeline.id == pipeline_id, Pipeline.organization_id == organization_id)
        )
        pipeline = result.scalars().first()
        if not pipeline:
            return None
        
        update_data = pipeline_in.model_dump(exclude_unset=True)
        for key, value in update_data.items():
            setattr(pipeline, key, value)
            
        await self.db.commit()
        await self.db.refresh(pipeline)
        return pipeline

    async def delete_deal(self, deal_id: str, organization_id: str) -> bool:
        result = await self.db.execute(
            select(Deal).where(Deal.id == deal_id, Deal.organization_id == organization_id)
        )
        deal = result.scalars().first()
        if not deal:
            return False
        
        await self.db.delete(deal)
        await self.db.commit()
        return True
