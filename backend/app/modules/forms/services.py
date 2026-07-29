from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from fastapi import HTTPException
from typing import List, Sequence

from app.modules.forms.models import Form, FormField, FormSubmission
from app.modules.forms.schemas import FormCreate, FormFieldCreate, FormSubmissionCreate

class FormService:
    @staticmethod
    async def get_forms(db: AsyncSession, organization_id: str) -> Sequence[Form]:
        stmt = select(Form).where(Form.organization_id == organization_id)
        result = await db.execute(stmt)
        return result.scalars().all()

    @staticmethod
    async def create_form(db: AsyncSession, obj_in: FormCreate, organization_id: str) -> Form:
        db_obj = Form(**obj_in.model_dump(), organization_id=organization_id)
        db.add(db_obj)
        await db.commit()
        await db.refresh(db_obj)
        return db_obj

    @staticmethod
    async def get_form(db: AsyncSession, form_id: str, organization_id: str) -> Form:
        stmt = select(Form).where(Form.id == form_id, Form.organization_id == organization_id)
        result = await db.execute(stmt)
        form = result.scalar_one_or_none()
        if not form:
            raise HTTPException(status_code=404, detail="Form not found")
        return form

    @staticmethod
    async def delete_form(db: AsyncSession, form_id: str, organization_id: str) -> None:
        form = await FormService.get_form(db, form_id, organization_id)
        await db.delete(form)
        await db.commit()

class FormFieldService:
    @staticmethod
    async def get_fields(db: AsyncSession, form_id: str, organization_id: str) -> Sequence[FormField]:
        # ensure form exists and belongs to org
        await FormService.get_form(db, form_id, organization_id)
        stmt = select(FormField).where(FormField.form_id == form_id).order_by(FormField.order)
        result = await db.execute(stmt)
        return result.scalars().all()

    @staticmethod
    async def create_field(db: AsyncSession, form_id: str, obj_in: FormFieldCreate, organization_id: str) -> FormField:
        await FormService.get_form(db, form_id, organization_id)
        db_obj = FormField(**obj_in.model_dump(), form_id=form_id, organization_id=organization_id)
        db.add(db_obj)
        await db.commit()
        await db.refresh(db_obj)
        return db_obj

    @staticmethod
    async def delete_field(db: AsyncSession, form_id: str, field_id: str, organization_id: str) -> None:
        await FormService.get_form(db, form_id, organization_id)
        stmt = select(FormField).where(FormField.id == field_id, FormField.form_id == form_id)
        result = await db.execute(stmt)
        field = result.scalar_one_or_none()
        if not field:
            raise HTTPException(status_code=404, detail="Form field not found")
        await db.delete(field)
        await db.commit()

class FormSubmissionService:
    @staticmethod
    async def submit_form(db: AsyncSession, form_id: str, obj_in: FormSubmissionCreate) -> FormSubmission:
        # Public endpoint usually doesn't have an auth context organization, but we look up the form first
        stmt = select(Form).where(Form.id == form_id, Form.is_active == True)
        result = await db.execute(stmt)
        form = result.scalar_one_or_none()
        if not form:
            raise HTTPException(status_code=404, detail="Form not found or inactive")
            
        payload = obj_in.payload

        # Honeypot spam check
        if payload.get("honeypot") or payload.get("website_url"):
            raise HTTPException(status_code=400, detail="Spam submission detected")

        # Parse payload fields with smart key mapping matching common form slugs
        email = None
        first_name = None
        last_name = None
        phone = None

        for k, v in payload.items():
            if not v:
                continue
            k_lower = k.lower().replace("_", "").replace("-", "")
            if k_lower in ["email", "emailaddress", "youremail", "mail"]:
                email = str(v).strip()
            elif k_lower in ["firstname", "first", "fname"]:
                first_name = str(v).strip()
            elif k_lower in ["lastname", "last", "lname"]:
                last_name = str(v).strip()
            elif k_lower in ["phone", "phonenumber", "telephone", "mobile", "tel"]:
                phone = str(v).strip()

        # If name is provided instead of first/last name
        if not first_name:
            full_name = None
            for k, v in payload.items():
                k_lower = k.lower().replace("_", "").replace("-", "")
                if k_lower in ["name", "fullname", "yourname"]:
                    full_name = str(v).strip()
                    break
            if full_name:
                parts = full_name.split()
                first_name = parts[0] if parts else "New"
                last_name = " ".join(parts[1:]) if len(parts) > 1 else ""

        # Fallbacks for empty/None names
        if not first_name:
            first_name = "New"
        if not last_name:
            last_name = ""

        lead_id = None
        existing_lead = None
        if email:
            # Check duplicate lead only if email is provided
            from app.modules.crm.models import Lead
            from sqlalchemy import func
            dup_stmt = select(Lead).where(
                func.lower(Lead.email) == email.strip().lower(),
                Lead.organization_id == form.organization_id,
                func.lower(Lead.status) != "archived"
            )
            dup_res = await db.execute(dup_stmt)
            existing_lead = dup_res.scalars().first()

        is_funnel = False
        if payload.get("metadata", {}).get("funnel_id") or payload.get("metadata", {}).get("step_id"):
            is_funnel = True
        activity_desc = "Lead updated via Funnel" if is_funnel else "Lead updated via Form Submission"

        if existing_lead:
            lead_id = existing_lead.id
            if phone:
                existing_lead.phone = phone
            if first_name and first_name != "New":
                existing_lead.first_name = first_name
            if last_name:
                existing_lead.last_name = last_name
                
            # Update corresponding Contact
            try:
                from app.modules.crm.models import Contact
                res_contact = await db.execute(select(Contact).where(Contact.email == email, Contact.organization_id == form.organization_id))
                existing_contact = res_contact.scalars().first()
                if existing_contact:
                    if phone:
                        existing_contact.phone = phone
                    if first_name and first_name != "New":
                        existing_contact.first_name = first_name
                    if last_name:
                        existing_contact.last_name = last_name
            except Exception:
                pass
                
            await db.flush()
            
            # Emit lead.updated event
            from app.core.events import publish, LeadUpdatedEvent
            contact_id = None
            try:
                from app.modules.crm.models import Contact
                res_c = await db.execute(select(Contact).where(Contact.email == existing_lead.email, Contact.organization_id == form.organization_id))
                c = res_c.scalars().first()
                if c:
                    contact_id = c.id
            except Exception:
                pass

            pipeline_id = None
            current_stage = None
            try:
                from app.modules.pipeline.models import Deal, Stage
                res_deal = await db.execute(select(Deal).where(Deal.lead_id == existing_lead.id))
                deal = res_deal.scalars().first()
                if deal:
                    res_stage = await db.execute(select(Stage).where(Stage.id == deal.stage_id))
                    stage = res_stage.scalars().first()
                    if stage:
                        pipeline_id = stage.pipeline_id
                        current_stage = stage.name
            except Exception:
                pass

            changed_fields = ["updated_at"]
            if phone:
                changed_fields.append("phone")
            if first_name and first_name != "New":
                changed_fields.append("first_name")
            if last_name:
                changed_fields.append("last_name")

            await publish("lead.updated", LeadUpdatedEvent(
                lead_id=existing_lead.id,
                organization_id=form.organization_id,
                contact_id=contact_id,
                pipeline_id=pipeline_id,
                current_stage=current_stage,
                changed_fields=changed_fields
            ))
            
            # Notify Assigned User
            if existing_lead.owner_id:
                try:
                    from app.modules.notifications.models import Notification
                    notif = Notification(
                        type="Warning",
                        title="Duplicate Submission Alert",
                        content=f"Existing lead {existing_lead.first_name} {existing_lead.last_name} submitted form: '{form.title}'",
                        related_entity_type="lead",
                        related_entity_id=existing_lead.id,
                        user_id=existing_lead.owner_id,
                        organization_id=form.organization_id,
                        is_read=False
                    )
                    db.add(notif)
                except Exception:
                    pass
        else:
            # Create new Lead via CRMService (single source of truth for pipeline syncing)
            from app.modules.crm.services import CRMService
            from app.modules.crm.schemas import LeadCreate
            crm_svc = CRMService(db)
            lead_in = LeadCreate(
                first_name=first_name,
                last_name=last_name,
                email=email,
                phone=phone,
                status="New",
                priority="Normal",
                lead_source=f"Form: {form.title}"
            )
            new_lead = await crm_svc.create_lead(lead_in, form.organization_id)
            lead_id = new_lead.id

        db_obj = FormSubmission(
            form_id=form_id,
            organization_id=form.organization_id,
            payload=payload,
            lead_id=lead_id
        )
        db.add(db_obj)
        await db.commit()
        await db.refresh(db_obj)

        # Log structured details for Form Lead synchronization
        pipeline_id = None
        stage_id = None
        try:
            from app.modules.pipeline.models import Deal, Stage
            deal_res = await db.execute(select(Deal).where(Deal.lead_id == lead_id))
            deal = deal_res.scalars().first()
            if deal:
                stage_id = deal.stage_id
                stage_res = await db.execute(select(Stage).where(Stage.id == stage_id))
                stage = stage_res.scalars().first()
                if stage:
                    pipeline_id = stage.pipeline_id
        except Exception:
            pass

        import logging
        logging.getLogger("lead_creation").info(
            f"Lead Creation Flow - Form ID: {form_id}, Submission ID: {db_obj.id}, "
            f"Lead ID: {lead_id}, Pipeline ID: {pipeline_id}, Stage ID: {stage_id}, "
            f"Events Emitted: ['lead.created', 'contact.created', 'form.submitted']"
        )
        
        # Log CRM Activity
        if lead_id:
            from app.modules.crm.models import Activity
            from datetime import datetime, timezone
            activity = Activity(
                type="Form Submission" if not is_funnel else "Funnel Submission",
                description=activity_desc,
                lead_id=lead_id,
                author_id="system",
                timestamp=datetime.now(timezone.utc),
                organization_id=form.organization_id
            )
            db.add(activity)
            await db.commit()

        # Track Funnel Visit
        step_id = payload.get("metadata", {}).get("step_id")
        if step_id:
            try:
                from app.modules.funnels.services import FunnelTrackingService
                from app.modules.funnels.schemas import FunnelVisitCreate
                # We need funnel_id which we can get from FunnelStep
                from app.modules.funnels.models import FunnelStep
                step_res = await db.execute(select(FunnelStep).where(FunnelStep.id == step_id))
                step = step_res.scalars().first()
                if step:
                    visit_in = FunnelVisitCreate(
                        step_id=step_id,
                        session_id=payload.get("visitor_id", "anonymous"),
                        utm_source=payload.get("utm_source"),
                        utm_medium=None,
                        utm_campaign=None,
                        converted=True
                    )
                    await FunnelTrackingService.track_visit(db, step.funnel_id, visit_in, form.organization_id)
            except Exception as e:
                import logging
                logging.getLogger(__name__).warning(f"Funnel tracking failed for form submission: {e}")

        # Emit FormSubmitted event
        from app.core.events import publish, FormSubmittedEvent, DuplicateSubmissionEvent
        await publish("form.submitted", FormSubmittedEvent(
            form_id=form_id,
            submission_id=db_obj.id,
            organization_id=form.organization_id,
            payload=payload,
            lead_id=lead_id
        ))

        if existing_lead:
            await publish("duplicate.submission", DuplicateSubmissionEvent(
                form_id=form_id,
                submission_id=db_obj.id,
                organization_id=form.organization_id,
                payload=payload,
                lead_id=lead_id,
                entity_id=db_obj.id,
                trigger_name="duplicate.submission"
            ))
        
        return db_obj

