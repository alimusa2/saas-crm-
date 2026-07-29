import os
import io
import csv
import base64
import json
import logging
import asyncio
from io import BytesIO
from datetime import datetime, timezone
from sqlalchemy.future import select

from app.core.celery_app import celery_app
from app.db.session import AsyncSessionLocal
from app.modules.crm.models import Lead, Contact, Company, Activity, ImportJob, ExportJob
from app.modules.organization.models import Organization
from app.modules.auth.models import User
from app.modules.crm.scoring import calculate_and_update_score, get_org_settings
from app.core.events import publish, LeadCreatedEvent, GenericEvent

logger = logging.getLogger("crm.tasks")

# Helper to run async code inside synchronous Celery worker
def run_async(coro):
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop is None or not loop.is_running():
        try:
            loop = asyncio.get_event_loop()
            if loop.is_closed():
                raise RuntimeError("closed")
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
        return loop.run_until_complete(coro)
    else:
        import concurrent.futures
        result_holder = {}

        def _run_in_thread():
            new_loop = asyncio.new_event_loop()
            asyncio.set_event_loop(new_loop)
            try:
                result_holder["result"] = new_loop.run_until_complete(coro)
            except Exception as e:
                result_holder["error"] = e
            finally:
                new_loop.close()

        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(_run_in_thread)
            future.result()

        if "error" in result_holder:
            raise result_holder["error"]
        return result_holder.get("result")

def _is_valid_email(email: str) -> bool:
    if not email:
        return False
    email = str(email).strip()
    return "@" in email and "." in email

@celery_app.task(bind=True, name="crm.import_leads")
def import_leads_task(self, job_id: str, file_content_base64: str, field_mapping_json: str, duplicate_handling: str, run_automations: bool):
    """
    Background worker task to parse uploaded CSV or XLSX, map columns, detect duplicates,
    perform automatic sync, run scoring rules, and update job progress logs.
    """
    logger.info(f"Starting import job {job_id}...")
    run_async(_import_leads_async(job_id, file_content_base64, field_mapping_json, duplicate_handling, run_automations))

async def _import_leads_async(job_id: str, file_content_base64: str, field_mapping_json: str, duplicate_handling: str, run_automations: bool):
    async with AsyncSessionLocal() as db:
        # Load Job
        res_job = await db.execute(select(ImportJob).where(ImportJob.id == job_id))
        job = res_job.scalars().first()
        if not job:
            logger.error(f"ImportJob {job_id} not found in database.")
            return

        job.status = "Importing"
        await db.commit()

        try:
            # Decode file contents
            file_bytes = base64.b64decode(file_content_base64)
            field_mapping = json.loads(field_mapping_json)
            org_id = job.organization_id

            # Load Organization settings
            res_org = await db.execute(select(Organization).where(Organization.id == org_id))
            org = res_org.scalars().first()
            org_settings = get_org_settings(org.settings_json if org else None)
            contact_sync_enabled = org_settings.get("contact_auto_creation", True)

            # Determine file type & parse
            rows = []
            if job.filename.endswith(".xlsx"):
                import openpyxl
                wb = openpyxl.load_workbook(BytesIO(file_bytes), data_only=True)
                sheet = wb.active
                headers = []
                for idx, r in enumerate(sheet.iter_rows(values_only=True)):
                    if idx == 0:
                        headers = [str(c).strip() if c is not None else f"Col{i}" for i, c in enumerate(r)]
                    else:
                        if any(c is not None for c in r):
                            row_dict = {headers[i]: r[i] for i in range(min(len(headers), len(r)))}
                            rows.append(row_dict)
            else:
                # Fallback to CSV
                csv_str = file_bytes.decode("utf-8", errors="ignore")
                reader = csv.DictReader(io.StringIO(csv_str))
                for r in reader:
                    rows.append(dict(r))

            imported = 0
            updated = 0
            skipped = 0
            invalid = 0
            validation_errors = []

            for row_idx, r in enumerate(rows):
                # Map raw headers to CRM fields
                first_name = str(r.get(field_mapping.get("First Name"), "")).strip()
                last_name = str(r.get(field_mapping.get("Last Name"), "")).strip()
                email = str(r.get(field_mapping.get("Email"), "")).strip() or None
                phone = str(r.get(field_mapping.get("Phone"), "")).strip() or None
                company_name = str(r.get(field_mapping.get("Company"), "")).strip() or None
                status = str(r.get(field_mapping.get("Lead Status"), "")).strip() or "New"
                priority = str(r.get(field_mapping.get("Priority"), "")).strip() or "Normal"
                lead_source = "Import"

                # Validation checks
                if not first_name:
                    invalid += 1
                    validation_errors.append(f"Row {row_idx + 1}: First Name is required.")
                    continue
                if email and not _is_valid_email(email):
                    invalid += 1
                    validation_errors.append(f"Row {row_idx + 1}: Email address '{email}' is invalid.")
                    continue

                # Handle company lookup/creation
                company_id = None
                if company_name:
                    res_comp = await db.execute(select(Company).where(Company.name == company_name, Company.organization_id == org_id))
                    comp = res_comp.scalars().first()
                    if not comp:
                        comp = Company(name=company_name, organization_id=org_id)
                        db.add(comp)
                        await db.flush()
                    company_id = comp.id

                # Duplicate detection
                existing_lead = None
                if email:
                    from sqlalchemy import func
                    res_dup = await db.execute(
                        select(Lead).where(
                            func.lower(Lead.email) == email.strip().lower(),
                            Lead.organization_id == org_id,
                            func.lower(Lead.status) != "archived"
                        )
                    )
                    existing_lead = res_dup.scalars().first()

                if existing_lead:
                    if duplicate_handling == "Skip":
                        skipped += 1
                        continue
                    elif duplicate_handling == "Update":
                        existing_lead.first_name = first_name
                        existing_lead.last_name = last_name
                        existing_lead.phone = phone
                        existing_lead.company_id = company_id
                        existing_lead.status = status
                        existing_lead.priority = priority
                        updated += 1
                        await db.flush()
                        
                        if contact_sync_enabled:
                            res_con = await db.execute(select(Contact).where(func.lower(Contact.email) == email.strip().lower(), Contact.organization_id == org_id))
                            con = res_con.scalars().first()
                            if con:
                                con.first_name = first_name
                                con.last_name = last_name
                                con.phone = phone
                                con.company_id = company_id
                                await db.flush()
                        
                        # Sync pipeline stage
                        await _sync_pipeline_deal(db, existing_lead, org_id)
                        
                        # Log CRM Activity
                        activity = Activity(
                            type="System",
                            description="Lead updated via Import",
                            lead_id=existing_lead.id,
                            author_id="system",
                            timestamp=datetime.now(timezone.utc),
                            organization_id=org_id
                        )
                        db.add(activity)
                        
                        # Emit event
                        from app.core.events import publish, LeadUpdatedEvent
                        contact_id = None
                        if contact_sync_enabled:
                            res_c = await db.execute(select(Contact).where(func.lower(Contact.email) == email.strip().lower(), Contact.organization_id == org_id))
                            c = res_c.scalars().first()
                            if c:
                                contact_id = c.id
                                
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
                            
                        await publish("lead.updated", LeadUpdatedEvent(
                            lead_id=existing_lead.id,
                            organization_id=org_id,
                            contact_id=contact_id,
                            pipeline_id=pipeline_id,
                            current_stage=current_stage,
                            changed_fields=["first_name", "last_name", "phone", "company_id", "status", "priority", "updated_at"]
                        ))
                        continue
                    elif duplicate_handling == "Merge":
                        changed = False
                        if not existing_lead.first_name:
                            existing_lead.first_name = first_name
                            changed = True
                        if not existing_lead.last_name:
                            existing_lead.last_name = last_name
                            changed = True
                        if not existing_lead.phone:
                            existing_lead.phone = phone
                            changed = True
                        if not existing_lead.company_id:
                            existing_lead.company_id = company_id
                            changed = True
                        updated += 1
                        await db.flush()
                        
                        if contact_sync_enabled:
                            res_con = await db.execute(select(Contact).where(func.lower(Contact.email) == email.strip().lower(), Contact.organization_id == org_id))
                            con = res_con.scalars().first()
                            if con:
                                if not con.first_name: con.first_name = first_name
                                if not con.last_name: con.last_name = last_name
                                if not con.phone: con.phone = phone
                                if not con.company_id: con.company_id = company_id
                                await db.flush()
                                
                        # Log CRM Activity
                        activity = Activity(
                            type="System",
                            description="Lead updated via Import (Merge)",
                            lead_id=existing_lead.id,
                            author_id="system",
                            timestamp=datetime.now(timezone.utc),
                            organization_id=org_id
                        )
                        db.add(activity)
                        
                        # Emit event
                        from app.core.events import publish, LeadUpdatedEvent
                        contact_id = None
                        if contact_sync_enabled:
                            res_c = await db.execute(select(Contact).where(func.lower(Contact.email) == email.strip().lower(), Contact.organization_id == org_id))
                            c = res_c.scalars().first()
                            if c:
                                contact_id = c.id
                                
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
                            
                        await publish("lead.updated", LeadUpdatedEvent(
                            lead_id=existing_lead.id,
                            organization_id=org_id,
                            contact_id=contact_id,
                            pipeline_id=pipeline_id,
                            current_stage=current_stage,
                            changed_fields=["merged", "updated_at"]
                        ))
                        continue

                # Create New Lead
                new_lead = Lead(
                    first_name=first_name,
                    last_name=last_name,
                    email=email,
                    phone=phone,
                    status=status,
                    priority=priority,
                    lead_source=lead_source,
                    company_id=company_id,
                    organization_id=org_id
                )
                db.add(new_lead)
                await db.flush()
                imported += 1

                # Contact Synchronization
                if contact_sync_enabled:
                    res_contact = await db.execute(select(Contact).where(Contact.email == email, Contact.organization_id == org_id))
                    existing_contact = res_contact.scalars().first()
                    if not existing_contact:
                        contact = Contact(
                            first_name=first_name,
                            last_name=last_name,
                            email=email,
                            phone=phone,
                            company_id=company_id,
                            organization_id=org_id
                        )
                        db.add(contact)
                        await db.flush()

                # Pipeline Deal Synchronization
                await _sync_pipeline_deal(db, new_lead, org_id)

                # scoring rule +10 on manual created lead:
                # If automations are disabled, run scoring immediately to ensure score is calculated
                if not run_automations:
                    await calculate_and_update_score(
                        db, new_lead.id, org_id,
                        "Lead Created", 10, "Manual Lead Created (via Import)"
                    )
                else:
                    # Publish event to trigger scoring listener and workflows
                    await publish("lead.created", LeadCreatedEvent(
                        lead_id=new_lead.id,
                        organization_id=org_id,
                        email=new_lead.email
                    ))

            job.status = "Completed"
            job.imported_count = imported
            job.updated_count = updated
            job.skipped_count = skipped
            job.invalid_count = invalid
            if validation_errors:
                job.error_message = "\n".join(validation_errors[:15]) # store first 15 validation warnings
            await db.commit()
            logger.info(f"Completed import job {job_id}: imported={imported}, updated={updated}, skipped={skipped}")

        except Exception as e:
            await db.rollback()
            job.status = "Failed"
            job.error_message = f"Process Error: {str(e)}"
            await db.commit()
            logger.error(f"Failed import job {job_id}: {e}", exc_info=True)

async def _sync_pipeline_deal(db, lead: Lead, org_id: str):
    from app.modules.pipeline.models import Pipeline, Stage, Deal
    
    res_pipe = await db.execute(select(Pipeline).where(Pipeline.organization_id == org_id))
    pipeline = res_pipe.scalars().first()
    if not pipeline:
        pipeline = Pipeline(name="Default Pipeline", organization_id=org_id)
        db.add(pipeline)
        await db.flush()

    res_stages = await db.execute(select(Stage).where(Stage.pipeline_id == pipeline.id).order_by(Stage.order))
    stages = list(res_stages.scalars().all())
    if not stages:
        stage_names = ["New", "Contacted", "Qualified", "Proposal", "Negotiation", "Won", "Lost"]
        stages = []
        for i, name in enumerate(stage_names):
            stage = Stage(name=name, pipeline_id=pipeline.id, order=i, organization_id=org_id)
            db.add(stage)
            stages.append(stage)
        await db.flush()

    target_stage = stages[0]
    lead_status_lower = (lead.status or "new").lower()
    for stage in stages:
        if lead_status_lower in stage.name.lower() or stage.name.lower() in lead_status_lower:
            target_stage = stage
            break

    res_deal = await db.execute(select(Deal).where(Deal.lead_id == lead.id))
    deal = res_deal.scalars().first()
    if deal:
        deal.stage_id = target_stage.id
    else:
        deal = Deal(
            title=f"{lead.first_name} {lead.last_name} Deal",
            value=lead.budget or 0.0,
            stage_id=target_stage.id,
            lead_id=lead.id,
            organization_id=org_id,
            status="Open"
        )
        db.add(deal)
    await db.flush()


@celery_app.task(bind=True, name="crm.export_leads")
def export_leads_task(self, job_id: str, filters_json: str, format_type: str = "csv"):
    """
    Background worker task to compile organization-scoped lead entries matching filters
    to CSV or Excel and store the generated file.
    """
    logger.info(f"Starting export job {job_id}...")
    run_async(_export_leads_async(job_id, filters_json, format_type))

async def _export_leads_async(job_id: str, filters_json: str, format_type: str):
    async with AsyncSessionLocal() as db:
        res_job = await db.execute(select(ExportJob).where(ExportJob.id == job_id))
        job = res_job.scalars().first()
        if not job:
            logger.error(f"ExportJob {job_id} not found in database.")
            return

        job.status = "Exporting"
        await db.commit()

        try:
            org_id = job.organization_id
            filters = json.loads(filters_json) if filters_json else {}

            # Query leads
            stmt = select(Lead).where(Lead.organization_id == org_id)

            # Apply filters
            if filters.get("status") and filters.get("status") != "All":
                stmt = stmt.where(Lead.status == filters["status"])
            if filters.get("priority") and filters.get("priority") != "All":
                stmt = stmt.where(Lead.priority == filters["priority"])
            if filters.get("owner_id"):
                stmt = stmt.where(Lead.owner_id == filters["owner_id"])
            if filters.get("score_min") is not None:
                stmt = stmt.where(Lead.lead_score >= int(filters["score_min"]))
            if filters.get("score_max") is not None:
                stmt = stmt.where(Lead.lead_score <= int(filters["score_max"]))
            if filters.get("is_score_manual") is not None:
                stmt = stmt.where(Lead.is_score_manual == bool(filters["is_score_manual"]))

            stmt = stmt.order_by(Lead.lead_score.desc())
            res_leads = await db.execute(stmt)
            leads = res_leads.scalars().all()

            # Compile lines
            headers = [
                "ID", "First Name", "Last Name", "Email", "Phone", "Status", "Priority", 
                "Source", "Final Score", "Automatic Score", "Manual Score", 
                "Score Source", "Score Last Updated", "Budget", "Expected Revenue"
            ]

            os.makedirs("app/static/exports", exist_ok=True)
            export_filename = f"leads_export_{job_id}.{format_type}"
            relative_path = f"/static/exports/{export_filename}"
            output_filepath = os.path.join("app/static/exports", export_filename)

            if format_type == "xlsx":
                import openpyxl
                wb = openpyxl.Workbook()
                sheet = wb.active
                sheet.title = "Leads Export"
                sheet.append(headers)
                for l in leads:
                    sheet.append([
                        l.id, l.first_name, l.last_name, l.email or "", l.phone or "", 
                        l.status, l.priority, l.lead_source or "", l.lead_score, 
                        l.automatic_score or 0, l.manual_score or "", 
                        l.score_source or "Automatic", 
                        l.score_last_updated.isoformat() if l.score_last_updated else "",
                        l.budget or 0.0, l.expected_revenue or 0.0
                    ])
                wb.save(output_filepath)
            else:
                # CSV format
                with open(output_filepath, mode="w", newline="", encoding="utf-8") as f:
                    writer = csv.writer(f)
                    writer.writerow(headers)
                    for l in leads:
                        writer.writerow([
                            l.id, l.first_name, l.last_name, l.email or "", l.phone or "", 
                            l.status, l.priority, l.lead_source or "", l.lead_score, 
                            l.automatic_score or 0, l.manual_score or "", 
                            l.score_source or "Automatic", 
                            l.score_last_updated.isoformat() if l.score_last_updated else "",
                            l.budget or 0.0, l.expected_revenue or 0.0
                        ])

            job.status = "Completed"
            job.filename = export_filename
            job.file_path = relative_path
            job.record_count = len(leads)
            await db.commit()
            logger.info(f"Completed export job {job_id}: file={export_filename}, records={len(leads)}")

        except Exception as e:
            await db.rollback()
            job.status = "Failed"
            logger.error(f"Failed export job {job_id}: {e}", exc_info=True)
            await db.commit()
