from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from typing import List, Optional

from app.modules.crm.models import Lead, Contact, Company
from app.modules.crm.schemas import LeadCreate, LeadUpdate, ContactCreate, ContactUpdate, CompanyCreate


from app.core.permissions import get_employee_permissions_context
from sqlalchemy import or_


class CRMService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_lead(self, lead_id: str, organization_id: str, current_user: Optional[dict] = None) -> Optional[Lead]:
        result = await self.db.execute(
            select(Lead).where(Lead.id == lead_id, Lead.organization_id == organization_id)
        )
        lead = result.scalars().first()
        if not lead:
            return None

        if current_user and not current_user.get("is_superuser") and current_user.get("role") != "Admin":
            perm_ctx = await get_employee_permissions_context(self.db, current_user)
            if not perm_ctx["is_admin"]:
                u_id = perm_ctx["user_id"]
                m_id = perm_ctx["member_id"]
                assigned = perm_ctx["assigned_contacts"]
                is_authorized = (lead.owner_id in [u_id, m_id]) or (lead.id in assigned)
                if not is_authorized:
                    from fastapi import HTTPException
                    raise HTTPException(status_code=403, detail="Forbidden: Access to this lead is denied.")
        return lead

    async def get_lead_sources(self, organization_id: str) -> List[str]:
        from sqlalchemy import distinct
        result = await self.db.execute(
            select(distinct(Lead.lead_source)).where(
                Lead.organization_id == organization_id
            )
        )
        defaults = ["Website", "Landing Page", "Facebook Ads", "Google Ads", "Manual", "Import", "Referral", "Webhook", "API", "Form", "Funnel"]
        found = [r for r in result.scalars().all() if r]
        return sorted(list(set(defaults + found)))

    async def get_lead_statuses(self, organization_id: str) -> List[str]:
        from sqlalchemy import distinct
        result = await self.db.execute(
            select(distinct(Lead.status)).where(
                Lead.organization_id == organization_id
            )
        )
        defaults = ["New", "Contacted", "Interested", "Qualified", "Proposal", "Negotiation", "Won", "Lost"]
        found = [r for r in result.scalars().all() if r]
        return sorted(list(set(defaults + found)))

    async def get_leads(
        self,
        organization_id: str,
        skip: int = 0,
        limit: int = 100,
        search: Optional[str] = None,
        pipeline_stage: Optional[str] = None,
        lead_score_min: Optional[int] = None,
        lead_score_max: Optional[int] = None,
        lead_source: Optional[str] = None,
        assigned_salesperson_id: Optional[str] = None,
        status: Optional[str] = None,
        recently_created: Optional[bool] = None,
        last_activity_days: Optional[int] = None,
        company_name: Optional[str] = None,
        current_user: Optional[dict] = None
    ) -> List[Lead]:
        stmt = select(Lead).where(Lead.organization_id == organization_id)
        
        # Non-admin Employee Data Isolation Filter
        if current_user and not current_user.get("is_superuser") and current_user.get("role") != "Admin":
            perm_ctx = await get_employee_permissions_context(self.db, current_user)
            if not perm_ctx["is_admin"]:
                u_id = perm_ctx["user_id"]
                m_id = perm_ctx["member_id"]
                assigned = perm_ctx["assigned_contacts"]
                
                conds = []
                if u_id: conds.append(Lead.owner_id == u_id)
                if m_id: conds.append(Lead.owner_id == m_id)
                if assigned and len(assigned) > 0: conds.append(Lead.id.in_(assigned))
                
                if conds:
                    stmt = stmt.where(or_(*conds))
        
        # Search by first name, last name, email, phone, or company name
        if search:
            search_filter = f"%{search}%"
            from app.modules.crm.models import Company
            stmt = stmt.outerjoin(Company, Lead.company_id == Company.id).where(
                (Lead.first_name.like(search_filter)) |
                (Lead.last_name.like(search_filter)) |
                (Lead.email.like(search_filter)) |
                (Lead.phone.like(search_filter)) |
                (Company.name.like(search_filter))
            )
            
        if pipeline_stage:
            from app.modules.pipeline.models import Deal, Stage
            stmt = stmt.join(Deal, Deal.lead_id == Lead.id).join(Stage, Deal.stage_id == Stage.id).where(Stage.name == pipeline_stage)
            
        if lead_score_min is not None:
            stmt = stmt.where(Lead.lead_score >= lead_score_min)
            
        if lead_score_max is not None:
            stmt = stmt.where(Lead.lead_score <= lead_score_max)
            
        if lead_source:
            stmt = stmt.where(Lead.lead_source == lead_source)
            
        if assigned_salesperson_id:
            stmt = stmt.where(Lead.owner_id == assigned_salesperson_id)
            
        if status:
            stmt = stmt.where(Lead.status == status)
            
        if company_name:
            from app.modules.crm.models import Company
            stmt = stmt.join(Company, Lead.company_id == Company.id).where(Company.name == company_name)
            
        if last_activity_days is not None:
            from datetime import datetime, timezone, timedelta
            from app.modules.crm.models import Activity
            cutoff = datetime.now(timezone.utc) - timedelta(days=last_activity_days)
            stmt = stmt.join(Activity, Activity.lead_id == Lead.id).where(Activity.timestamp >= cutoff)

        if recently_created:
            stmt = stmt.order_by(Lead.created_at.desc())
        else:
            # maintain some default ordering
            stmt = stmt.order_by(Lead.created_at.desc())
            
        stmt = stmt.offset(skip).limit(limit)
        
        result = await self.db.execute(stmt)
        return list(result.scalars().all())

    async def create_lead(
        self,
        lead_in: LeadCreate,
        organization_id: str,
        owner_id: Optional[str] = None,
        ignore_duplicates: bool = False
    ) -> Lead:
        from fastapi import HTTPException
        from sqlalchemy import func
        import logging
        logger = logging.getLogger("lead_creation")
        
        email_clean = lead_in.email.strip().lower() if lead_in.email else None
        if email_clean and "@" in email_clean and "." in email_clean:
            res_dup = await self.db.execute(
                select(Lead).where(
                    Lead.organization_id == organization_id,
                    func.lower(Lead.email) == email_clean,
                    func.lower(Lead.status) != "archived"
                )
            )
            existing = res_dup.scalars().first()
            if existing:
                if not ignore_duplicates:
                    owner = None
                    if existing.owner_id:
                        from app.modules.auth.models import User
                        res_owner = await self.db.execute(select(User).where(User.id == existing.owner_id))
                        owner = res_owner.scalars().first()
                    
                    stage_name = None
                    try:
                        from app.modules.pipeline.models import Deal, Stage
                        res_deal = await self.db.execute(select(Deal).where(Deal.lead_id == existing.id))
                        deal = res_deal.scalars().first()
                        if deal:
                            res_stage = await self.db.execute(select(Stage).where(Stage.id == deal.stage_id))
                            stage = res_stage.scalars().first()
                            if stage:
                                stage_name = stage.name
                    except Exception:
                        pass

                    raise HTTPException(
                        status_code=409,
                        detail={
                            "message": "A Lead with this email already exists.",
                            "existing_lead": {
                                "id": existing.id,
                                "first_name": existing.first_name,
                                "last_name": existing.last_name,
                                "email": existing.email,
                                "owner": {
                                    "id": owner.id,
                                    "first_name": owner.first_name,
                                    "last_name": owner.last_name
                                } if owner else None,
                                "pipeline_stage": stage_name,
                                "created_at": existing.created_at.isoformat() if existing.created_at else None
                            }
                        }
                    )
                else:
                    if owner_id:
                        from app.modules.auth.models import User
                        res_user = await self.db.execute(select(User).where(User.id == owner_id))
                        user = res_user.scalars().first()
                        if not user or not user.is_superuser:
                            raise HTTPException(
                                status_code=403,
                                detail="Admin privileges required to create duplicate lead"
                            )

        try:
            lead = Lead(
                **lead_in.model_dump(),
                organization_id=organization_id,
                owner_id=owner_id
            )
            self.db.add(lead)
            await self.db.flush()
            
            # Automatically add as a contact too
            contact = Contact(
                first_name=lead.first_name,
                last_name=lead.last_name,
                email=lead.email,
                phone=lead.phone,
                company_id=lead.company_id,
                organization_id=organization_id
            )
            self.db.add(contact)
            await self.db.flush()

            # Find default pipeline or create one
            from app.modules.pipeline.models import Pipeline, Stage, Deal
            res_pipe = await self.db.execute(select(Pipeline).where(Pipeline.organization_id == organization_id))
            pipeline = res_pipe.scalars().first()
            if not pipeline:
                pipeline = Pipeline(name="Default Pipeline", organization_id=organization_id)
                self.db.add(pipeline)
                await self.db.flush()
                
            # Find stages or create them
            res_stages = await self.db.execute(
                select(Stage).where(Stage.pipeline_id == pipeline.id).order_by(Stage.order)
            )
            stages = list(res_stages.scalars().all())
            if not stages:
                stage_names = ["New", "Contacted", "Qualified", "Proposal", "Negotiation", "Won", "Lost"]
                stages = []
                for i, name in enumerate(stage_names):
                    stage = Stage(name=name, pipeline_id=pipeline.id, order=i, organization_id=organization_id)
                    self.db.add(stage)
                    stages.append(stage)
                await self.db.flush()
                
            target_stage = stages[0]
            lead_status_lower = (lead.status or "new").lower()
            for stage in stages:
                if lead_status_lower in stage.name.lower() or stage.name.lower() in lead_status_lower:
                    target_stage = stage
                    break
                    
            deal = Deal(
                title=f"{lead.first_name} {lead.last_name} Deal",
                value=lead.budget or 0.0,
                stage_id=target_stage.id,
                lead_id=lead.id,
                owner_id=owner_id,
                organization_id=organization_id,
                status="Open"
            )
            self.db.add(deal)
            await self.db.flush()

            await self.db.commit()
            await self.db.refresh(lead)
            await self.db.refresh(contact)
            
            logger.info(
                f"Lead Created - Lead ID: {lead.id}, Contact ID: {contact.id}, "
                f"Pipeline ID: {pipeline.id}, Stage ID: {target_stage.id}, "
                f"Events Emitted: ['lead.created', 'contact.created']"
            )
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Lead Creation Failed - Error: {str(e)}")
            raise

        # Emit domain events
        from app.core.events import publish, LeadCreatedEvent, GenericEvent
        await publish("lead.created", LeadCreatedEvent(
            lead_id=lead.id,
            organization_id=organization_id,
            owner_id=owner_id,
            email=lead.email
        ))
        await publish("contact.created", GenericEvent(
            event_name="contact.created",
            organization_id=organization_id,
            data={"contact_id": contact.id, "email": contact.email, "first_name": contact.first_name, "last_name": contact.last_name}
        ))

        return lead

    async def update_lead(self, lead_id: str, lead_in: LeadUpdate, organization_id: str) -> Optional[Lead]:
        lead = await self.get_lead(lead_id, organization_id)
        if not lead:
            return None
        
        old_status = lead.status
        old_owner_id = lead.owner_id
        update_data = lead_in.model_dump(exclude_unset=True)
        for key, value in update_data.items():
            setattr(lead, key, value)
            
        await self.db.commit()
        await self.db.refresh(lead)

        if old_owner_id != lead.owner_id and lead.owner_id:
            from app.core.events import publish, OwnerAssignedEvent
            owner_event = OwnerAssignedEvent(
                lead_id=lead.id,
                organization_id=organization_id,
                owner_id=lead.owner_id,
                previous_value=old_owner_id,
                current_value=lead.owner_id,
                entity_id=lead.id,
                trigger_name="owner.changed"
            )
            await publish("owner.changed", owner_event)
            await publish("lead.assigned", owner_event)

        # Emit domain events
        from app.core.events import publish, LeadUpdatedEvent, _sync_in_progress
        
        # Look up Contact ID
        contact_id = None
        try:
            from app.modules.crm.models import Contact
            res_c = await self.db.execute(select(Contact).where(Contact.email == lead.email, Contact.organization_id == organization_id))
            c = res_c.scalars().first()
            if c:
                contact_id = c.id
        except Exception:
            pass

        # Look up Pipeline & Stage info
        pipeline_id = None
        current_stage = None
        try:
            from app.modules.pipeline.models import Deal, Stage
            res_deal = await self.db.execute(select(Deal).where(Deal.lead_id == lead.id))
            deal = res_deal.scalars().first()
            if deal:
                res_stage = await self.db.execute(select(Stage).where(Stage.id == deal.stage_id))
                stage = res_stage.scalars().first()
                if stage:
                    pipeline_id = stage.pipeline_id
                    current_stage = stage.name
        except Exception:
            pass

        await publish("lead.updated", LeadUpdatedEvent(
            lead_id=lead.id,
            organization_id=organization_id,
            contact_id=contact_id,
            pipeline_id=pipeline_id,
            current_stage=current_stage,
            changed_fields=list(update_data.keys())
        ))
        
        if old_status != lead.status:
            # Sync to pipeline (only if sync not already in progress)
            if not _sync_in_progress.get():
                token = _sync_in_progress.set(True)
                events_to_publish = []
                try:
                    from app.modules.pipeline.models import Pipeline, Stage, Deal
                    res_deal = await self.db.execute(select(Deal).where(Deal.lead_id == lead.id))
                    deals = res_deal.scalars().all()
                    res_pipe = await self.db.execute(select(Pipeline).where(Pipeline.organization_id == organization_id))
                    pipeline = res_pipe.scalars().first()
                    if pipeline:
                        res_stages = await self.db.execute(
                            select(Stage).where(Stage.pipeline_id == pipeline.id).order_by(Stage.order)
                        )
                        stages = res_stages.scalars().all()
                        if stages:
                            target_stage = None
                            
                            # Custom mapping check
                            mapping = getattr(pipeline, "status_stage_mapping", None) or {}
                            mapped_stage_val = mapping.get(lead.status)
                            if mapped_stage_val:
                                for stage in stages:
                                    if stage.id == mapped_stage_val or stage.name.lower() == str(mapped_stage_val).lower():
                                        target_stage = stage
                                        break
                                        
                            if not target_stage:
                                # Exact stage name match against lead status
                                lead_status_lower = (lead.status or "").lower()
                                for stage in stages:
                                    if stage.name.lower() == lead_status_lower:
                                        target_stage = stage
                                        break
                                        
                            if not target_stage:
                                # Substring fallback for partial matches (e.g. "Contacted" in "Contacted Stage")
                                lead_status_lower = (lead.status or "").lower()
                                for stage in stages:
                                    if lead_status_lower in stage.name.lower() or stage.name.lower() in lead_status_lower:
                                        target_stage = stage
                                        break
                                        
                            # Only sync if a mapping was explicitly resolved (no fallback to stages[0] automatically)
                            if target_stage:
                                if deals:
                                    for deal in deals:
                                        # Resolve current stage for order comparison
                                        current_stage_obj = next((s for s in stages if s.id == deal.stage_id), None)
                                        current_order = current_stage_obj.order if current_stage_obj else 0
                                        target_order = target_stage.order

                                        # Only sync if stage changed AND we are not rolling back a more advanced stage
                                        if deal.stage_id != target_stage.id and current_order < target_order:
                                            old_stage_id = deal.stage_id
                                            deal.stage_id = target_stage.id
                                            
                                            # Queue pipeline stage changed event
                                            from app.core.events import PipelineStageChangedEvent
                                            events_to_publish.append(("pipeline.stage_changed", PipelineStageChangedEvent(
                                                deal_id=deal.id,
                                                old_stage_id=old_stage_id,
                                                new_stage_id=deal.stage_id,
                                                organization_id=organization_id,
                                                lead_id=lead.id,
                                                contact_id=contact_id,
                                                pipeline_id=pipeline.id,
                                                current_stage=target_stage.name,
                                                previous_stage=current_stage_obj.name if current_stage_obj else None
                                            )))
                                else:
                                    deal = Deal(
                                        title=f"{lead.first_name} {lead.last_name} Deal",
                                        value=lead.budget or 0.0,
                                        stage_id=target_stage.id,
                                        lead_id=lead.id,
                                        owner_id=lead.owner_id,
                                        organization_id=organization_id,
                                        status="Open"
                                    )
                                    self.db.add(deal)
                                
                    await self.db.commit()
                except Exception as e:
                    import logging
                    logging.getLogger(__name__).warning(f"Failed to automatically move/create pipeline deal: {e}")
                finally:
                    _sync_in_progress.reset(token)
                
                # Publish queued events after resetting sync guard context
                for ev_name, ev_data in events_to_publish:
                    await publish(ev_name, ev_data)
            
            # Emit lead.status_changed event
            await publish("lead.status_changed", LeadUpdatedEvent(
                lead_id=lead.id,
                organization_id=organization_id,
                contact_id=contact_id,
                pipeline_id=pipeline_id,
                current_stage=current_stage,
                changed_fields=["status"]
            ))
            
        return lead


    async def delete_lead(self, lead_id: str, organization_id: str) -> bool:
        lead = await self.get_lead(lead_id, organization_id)
        if not lead:
            return False
        
        await self.db.delete(lead)
        await self.db.commit()
        from app.core.events import publish, GenericEvent
        await publish("lead.deleted", GenericEvent(
            event_name="lead.deleted",
            organization_id=organization_id,
            data={"lead_id": lead_id}
        ))
        return True

    # ─── Contacts ─────────────────────────────────────────────────────────────

    async def get_contacts(self, organization_id: str, skip: int = 0, limit: int = 100, current_user: Optional[dict] = None) -> List[Contact]:
        stmt = select(Contact).where(Contact.organization_id == organization_id)
        
        # Non-admin Employee Data Isolation Filter
        if current_user and not current_user.get("is_superuser") and current_user.get("role") != "Admin":
            perm_ctx = await get_employee_permissions_context(self.db, current_user)
            if not perm_ctx["is_admin"]:
                u_id = perm_ctx["user_id"]
                m_id = perm_ctx["member_id"]
                assigned = perm_ctx["assigned_contacts"]
                
                conds = []
                if u_id: conds.append(Contact.owner_id == u_id)
                if m_id: conds.append(Contact.owner_id == m_id)
                if assigned and len(assigned) > 0: conds.append(Contact.id.in_(assigned))
                
                if conds:
                    stmt = stmt.where(or_(*conds))

        stmt = stmt.offset(skip).limit(limit)
        result = await self.db.execute(stmt)
        return list(result.scalars().all())

    async def get_contact(self, contact_id: str, organization_id: str, current_user: Optional[dict] = None) -> Optional[Contact]:
        result = await self.db.execute(
            select(Contact).where(Contact.id == contact_id, Contact.organization_id == organization_id)
        )
        contact = result.scalars().first()
        if not contact:
            return None

        if current_user and not current_user.get("is_superuser") and current_user.get("role") != "Admin":
            perm_ctx = await get_employee_permissions_context(self.db, current_user)
            if not perm_ctx["is_admin"]:
                u_id = perm_ctx["user_id"]
                m_id = perm_ctx["member_id"]
                assigned = perm_ctx["assigned_contacts"]
                owner_id = getattr(contact, "owner_id", None)
                is_authorized = (owner_id in [u_id, m_id]) or (contact.id in assigned)
                if not is_authorized:
                    from fastapi import HTTPException
                    raise HTTPException(status_code=403, detail="Forbidden: Access to this contact is denied.")
        return contact

    async def create_contact(
        self,
        contact_in: ContactCreate,
        organization_id: str,
        ignore_duplicates: bool = False,
        current_user_id: Optional[str] = None
    ) -> Contact:
        from fastapi import HTTPException
        from sqlalchemy import func
        
        email_clean = contact_in.email.strip().lower() if contact_in.email else None
        if email_clean and "@" in email_clean and "." in email_clean:
            res_dup = await self.db.execute(
                select(Contact).where(
                    Contact.organization_id == organization_id,
                    func.lower(Contact.email) == email_clean
                )
            )
            existing = res_dup.scalars().first()
            if existing:
                if not ignore_duplicates:
                    company_name = None
                    if existing.company_id:
                        from app.modules.crm.models import Company
                        res_comp = await self.db.execute(select(Company).where(Company.id == existing.company_id))
                        comp = res_comp.scalars().first()
                        if comp:
                            company_name = comp.name
                    
                    raise HTTPException(
                        status_code=409,
                        detail={
                            "message": "A Contact with this email already exists.",
                            "existing_contact": {
                                "id": existing.id,
                                "first_name": existing.first_name,
                                "last_name": existing.last_name,
                                "email": existing.email,
                                "company_name": company_name,
                                "created_at": existing.created_at.isoformat() if existing.created_at else None
                            }
                        }
                    )
                else:
                    if current_user_id:
                        from app.modules.auth.models import User
                        res_user = await self.db.execute(select(User).where(User.id == current_user_id))
                        user = res_user.scalars().first()
                        if not user or not user.is_superuser:
                            raise HTTPException(
                                status_code=403,
                                detail="Admin privileges required to create duplicate contact"
                            )

        contact = Contact(**contact_in.model_dump(), organization_id=organization_id)
        self.db.add(contact)
        await self.db.commit()
        await self.db.refresh(contact)
        from app.core.events import publish, GenericEvent
        await publish("contact.created", GenericEvent(
            event_name="contact.created",
            organization_id=organization_id,
            data={"contact_id": contact.id, "email": contact.email, "first_name": contact.first_name, "last_name": contact.last_name}
        ))
        return contact

    async def update_contact(self, contact_id: str, contact_in: ContactUpdate, organization_id: str) -> Optional[Contact]:
        contact = await self.get_contact(contact_id, organization_id)
        if not contact:
            return None
        update_data = contact_in.model_dump(exclude_unset=True)
        for key, value in update_data.items():
            setattr(contact, key, value)
        await self.db.commit()
        await self.db.refresh(contact)
        from app.core.events import publish, GenericEvent
        await publish("contact.updated", GenericEvent(
            event_name="contact.updated",
            organization_id=organization_id,
            data={"contact_id": contact.id, "email": contact.email, "first_name": contact.first_name, "last_name": contact.last_name}
        ))
        return contact

    async def delete_contact(self, contact_id: str, organization_id: str) -> bool:
        contact = await self.get_contact(contact_id, organization_id)
        if not contact:
            return False
        await self.db.delete(contact)
        await self.db.commit()
        return True

    # ─── Companies ────────────────────────────────────────────────────────────

    async def get_companies(self, organization_id: str, skip: int = 0, limit: int = 100) -> List[Company]:
        result = await self.db.execute(
            select(Company).where(Company.organization_id == organization_id).offset(skip).limit(limit)
        )
        return result.scalars().all()

    async def get_company(self, company_id: str, organization_id: str) -> Optional[Company]:
        result = await self.db.execute(
            select(Company).where(Company.id == company_id, Company.organization_id == organization_id)
        )
        return result.scalars().first()

    async def create_company(self, company_in: CompanyCreate, organization_id: str) -> Company:
        company = Company(**company_in.model_dump(), organization_id=organization_id)
        self.db.add(company)
        await self.db.commit()
        await self.db.refresh(company)
        from app.core.events import publish, GenericEvent
        await publish("company.created", GenericEvent(
            event_name="company.created",
            organization_id=organization_id,
            data={"company_id": company.id, "name": company.name}
        ))
        return company

