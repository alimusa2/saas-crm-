from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional

from app.db.session import get_db
from app.core.security import get_current_user
from app.modules.crm.schemas import (
    LeadCreate, LeadUpdate, LeadResponse, ContactCreate, ContactUpdate, ContactResponse,
    CompanyCreate, CompanyResponse, ImportRequest, ValidateRequest, ExportRequest,
    ImportJobResponse, ExportJobResponse
)
from app.modules.crm.services import CRMService
from app.modules.crm.models import ImportJob, ExportJob
from sqlalchemy.future import select
import json

router = APIRouter()

def get_crm_service(db: AsyncSession = Depends(get_db)) -> CRMService:
    return CRMService(db)

@router.get("/leads/sources", response_model=List[str])
async def list_lead_sources(
    crm_service: CRMService = Depends(get_crm_service),
    current_user: dict = Depends(get_current_user)
):
    """Retrieve all unique lead sources present in CRM leads for the organization."""
    return await crm_service.get_lead_sources(current_user["org"])

@router.get("/leads/statuses", response_model=List[str])
async def list_lead_statuses(
    crm_service: CRMService = Depends(get_crm_service),
    current_user: dict = Depends(get_current_user)
):
    """Retrieve all unique lead statuses present in CRM leads for the organization."""
    return await crm_service.get_lead_statuses(current_user["org"])

@router.get("/leads", response_model=List[LeadResponse])
async def list_leads(
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
    crm_service: CRMService = Depends(get_crm_service),
    current_user: dict = Depends(get_current_user)
):
    """
    Retrieve all leads for the current organization.
    """
    from app.core.redis_cache import cache_get, cache_set
    user_id = current_user.get("user_id") or current_user.get("sub") or "user"
    cache_key = f"leads_list:{current_user['org']}:{user_id}:{skip}:{limit}:{search}:{status}:{pipeline_stage}"
    cached_leads = await cache_get(cache_key)
    if cached_leads is not None:
        return cached_leads

    leads = await crm_service.get_leads(
        current_user["org"],
        skip=skip,
        limit=limit,
        search=search,
        pipeline_stage=pipeline_stage,
        lead_score_min=lead_score_min,
        lead_score_max=lead_score_max,
        lead_source=lead_source,
        assigned_salesperson_id=assigned_salesperson_id,
        status=status,
        recently_created=recently_created,
        last_activity_days=last_activity_days,
        company_name=company_name,
        current_user=current_user
    )
    # Convert Pydantic / ORM models to dict for JSON caching
    try:
        leads_dict = [l.model_dump() if hasattr(l, 'model_dump') else dict(l) for l in leads]
        await cache_set(cache_key, leads_dict, expire_seconds=60)
    except Exception:
        pass
    return leads

@router.post("/leads", response_model=LeadResponse, status_code=status.HTTP_201_CREATED)
async def create_lead(
    lead_in: LeadCreate,
    ignore_duplicates: bool = Query(default=False),
    crm_service: CRMService = Depends(get_crm_service),
    current_user: dict = Depends(get_current_user)
):
    """
    Create a new lead.
    """
    from app.core.redis_cache import cache_delete_pattern
    await cache_delete_pattern("leads_list:*")
    return await crm_service.create_lead(lead_in, current_user["org"], current_user["sub"], ignore_duplicates=ignore_duplicates)

@router.get("/leads/{lead_id}", response_model=LeadResponse)
async def get_lead(
    lead_id: str,
    crm_service: CRMService = Depends(get_crm_service),
    current_user: dict = Depends(get_current_user)
):
    """
    Get a specific lead by id.
    """
    lead = await crm_service.get_lead(lead_id, current_user["org"], current_user=current_user)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    return lead

@router.patch("/leads/{lead_id}", response_model=LeadResponse)
async def update_lead(
    lead_id: str,
    lead_in: LeadUpdate,
    crm_service: CRMService = Depends(get_crm_service),
    current_user: dict = Depends(get_current_user)
):
    """
    Update a specific lead.
    """
    lead = await crm_service.update_lead(lead_id, lead_in, current_user["org"])
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    return lead

@router.post("/leads/{lead_id}/merge", response_model=LeadResponse)
async def merge_lead(
    lead_id: str,
    lead_in: LeadUpdate,
    crm_service: CRMService = Depends(get_crm_service),
    current_user: dict = Depends(get_current_user)
):
    """
    Merge new information into an existing lead (only fill empty fields).
    """
    lead = await crm_service.get_lead(lead_id, current_user["org"])
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    
    update_data = lead_in.model_dump(exclude_unset=True)
    changed_fields = []
    for key, value in update_data.items():
        if value is not None and value != "":
            existing_val = getattr(lead, key, None)
            if existing_val is None or existing_val == "":
                setattr(lead, key, value)
                changed_fields.append(key)
                
    if changed_fields:
        await crm_service.db.commit()
        await crm_service.db.refresh(lead)
        
        # Add Activity
        from app.modules.crm.models import Activity
        from datetime import datetime, timezone
        activity = Activity(
            type="System",
            description="Lead updated via Merge",
            lead_id=lead.id,
            author_id=current_user["sub"],
            timestamp=datetime.now(timezone.utc),
            organization_id=current_user["org"]
        )
        crm_service.db.add(activity)
        await crm_service.db.commit()
        
        # Emit event
        from app.core.events import publish, LeadUpdatedEvent
        await publish("lead.updated", LeadUpdatedEvent(
            lead_id=lead.id,
            organization_id=current_user["org"],
            changed_fields=changed_fields
        ))
        
    return lead

@router.delete("/leads/{lead_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_lead(
    lead_id: str,
    crm_service: CRMService = Depends(get_crm_service),
    current_user: dict = Depends(get_current_user)
):
    """
    Delete a specific lead.
    """
    success = await crm_service.delete_lead(lead_id, current_user["org"])
    if not success:
        raise HTTPException(status_code=404, detail="Lead not found")

# ─── Contacts ────────────────────────────────────────────────────────────────

@router.get("/contacts", response_model=List[ContactResponse])
async def list_contacts(
    skip: int = 0,
    limit: int = 100,
    crm_service: CRMService = Depends(get_crm_service),
    current_user: dict = Depends(get_current_user)
):
    """List all contacts for the organization."""
    return await crm_service.get_contacts(current_user["org"], skip=skip, limit=limit)

@router.post("/contacts", response_model=ContactResponse, status_code=status.HTTP_201_CREATED)
async def create_contact(
    contact_in: ContactCreate,
    ignore_duplicates: bool = Query(default=False),
    crm_service: CRMService = Depends(get_crm_service),
    current_user: dict = Depends(get_current_user)
):
    """Create a new contact."""
    return await crm_service.create_contact(contact_in, current_user["org"], ignore_duplicates=ignore_duplicates, current_user_id=current_user["sub"])

@router.patch("/contacts/{contact_id}", response_model=ContactResponse)
async def update_contact(
    contact_id: str,
    contact_in: ContactUpdate,
    crm_service: CRMService = Depends(get_crm_service),
    current_user: dict = Depends(get_current_user)
):
    """Update a contact."""
    contact = await crm_service.update_contact(contact_id, contact_in, current_user["org"])
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    return contact

@router.post("/contacts/{contact_id}/merge", response_model=ContactResponse)
async def merge_contact(
    contact_id: str,
    contact_in: ContactUpdate,
    crm_service: CRMService = Depends(get_crm_service),
    current_user: dict = Depends(get_current_user)
):
    """
    Merge new information into an existing contact (only fill empty fields).
    """
    contact = await crm_service.get_contact(contact_id, current_user["org"])
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    
    update_data = contact_in.model_dump(exclude_unset=True)
    changed_fields = []
    for key, value in update_data.items():
        if value is not None and value != "":
            existing_val = getattr(contact, key, None)
            if existing_val is None or existing_val == "":
                setattr(contact, key, value)
                changed_fields.append(key)
                
    if changed_fields:
        await crm_service.db.commit()
        await crm_service.db.refresh(contact)
        
        # Emit event
        from app.core.events import publish, GenericEvent
        await publish("contact.updated", GenericEvent(
            event_name="contact.updated",
            organization_id=current_user["org"],
            data={"contact_id": contact.id, "email": contact.email, "first_name": contact.first_name, "last_name": contact.last_name}
        ))
        
    return contact

@router.delete("/contacts/{contact_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_contact(
    contact_id: str,
    crm_service: CRMService = Depends(get_crm_service),
    current_user: dict = Depends(get_current_user)
):
    """Delete a contact."""
    success = await crm_service.delete_contact(contact_id, current_user["org"])
    if not success:
        raise HTTPException(status_code=404, detail="Contact not found")

# ─── Companies ────────────────────────────────────────────────────────────

@router.get("/companies", response_model=List[CompanyResponse])
async def list_companies(
    skip: int = 0,
    limit: int = 100,
    crm_service: CRMService = Depends(get_crm_service),
    current_user: dict = Depends(get_current_user)
):
    """List all companies for the organization."""
    return await crm_service.get_companies(current_user["org"], skip=skip, limit=limit)

@router.post("/companies", response_model=CompanyResponse, status_code=status.HTTP_201_CREATED)
async def create_company(
    company_in: CompanyCreate,
    crm_service: CRMService = Depends(get_crm_service),
    current_user: dict = Depends(get_current_user)
):
    """Create a new company."""
    return await crm_service.create_company(company_in, current_user["org"])


@router.post("/leads/import/validate")
async def validate_import(
    req: ValidateRequest,
    current_user: dict = Depends(get_current_user)
):
    import base64
    import csv
    import io
    from io import BytesIO
    
    try:
        file_bytes = base64.b64decode(req.file_content_base64)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 payload.")
        
    rows = []
    try:
        if req.filename.endswith(".xlsx"):
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
            csv_str = file_bytes.decode("utf-8", errors="ignore")
            reader = csv.DictReader(io.StringIO(csv_str))
            for r in reader:
                rows.append(dict(r))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to parse file: {e}")

    total = len(rows)
    valid = 0
    invalid = 0
    warnings = []
    
    first_name_map = req.field_mapping.get("First Name")
    email_map = req.field_mapping.get("Email")
    
    for idx, r in enumerate(rows):
        fn = str(r.get(first_name_map, "")).strip() if first_name_map else ""
        em = str(r.get(email_map, "")).strip() if email_map else ""
        
        row_warn = []
        if not fn:
            row_warn.append("First Name is missing")
        if em and ("@" not in em or "." not in em):
            row_warn.append(f"Invalid email: '{em}'")
            
        if row_warn:
            invalid += 1
            warnings.append(f"Row {idx + 1}: " + ", ".join(row_warn))
        else:
            valid += 1
            
    return {
        "total_records": total,
        "valid_records": valid,
        "invalid_records": invalid,
        "warnings": warnings[:50]
    }


@router.post("/leads/import", response_model=ImportJobResponse, status_code=201)
async def start_import(
    req: ImportRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    import uuid
    job = ImportJob(
        id=str(uuid.uuid4()),
        filename=req.filename,
        status="Queued",
        created_by=current_user["sub"],
        organization_id=current_user["org"]
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)
    
    from app.modules.crm.tasks import import_leads_task
    import_leads_task.delay(
        job.id,
        req.file_content_base64,
        json.dumps(req.field_mapping),
        req.duplicate_handling,
        req.run_automations
    )
    return job


@router.get("/leads/import/jobs", response_model=List[ImportJobResponse])
async def list_import_jobs(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    res = await db.execute(
        select(ImportJob).where(ImportJob.organization_id == current_user["org"]).order_by(ImportJob.created_at.desc())
    )
    return res.scalars().all()


@router.post("/leads/export", response_model=ExportJobResponse, status_code=201)
async def start_export(
    req: ExportRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    import uuid
    job = ExportJob(
        id=str(uuid.uuid4()),
        status="Queued",
        filters=json.dumps(req.filters) if req.filters else "{}",
        created_by=current_user["sub"],
        organization_id=current_user["org"]
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)
    
    from app.modules.crm.tasks import export_leads_task
    export_leads_task.delay(
        job.id,
        json.dumps(req.filters) if req.filters else "{}",
        req.format
    )
    return job


@router.get("/leads/export/jobs", response_model=List[ExportJobResponse])
async def list_export_jobs(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    res = await db.execute(
        select(ExportJob).where(ExportJob.organization_id == current_user["org"]).order_by(ExportJob.created_at.desc())
    )
    return res.scalars().all()


@router.post("/leads/{lead_id}/override-score", response_model=LeadResponse)
async def override_score(
    lead_id: str,
    manual_score: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    from app.modules.crm.models import Lead, Activity
    from datetime import datetime, timezone
    
    res = await db.execute(select(Lead).where(Lead.id == lead_id, Lead.organization_id == current_user["org"]))
    lead = res.scalars().first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
        
    old_score = lead.lead_score or 0
    lead.manual_score = manual_score
    lead.is_score_manual = True
    lead.lead_score = max(0, min(100, manual_score))
    lead.score_source = "Manual"
    lead.score_last_updated = datetime.now(timezone.utc)
    
    history = []
    if lead.score_history:
        try:
            history = json.loads(lead.score_history)
        except Exception:
            history = []
    history.append({
        "event": "Manual Override",
        "detail": f"Salesperson manual override to {manual_score}",
        "delta": manual_score - old_score,
        "automatic_score": lead.automatic_score,
        "manual_score": manual_score,
        "final_score": lead.lead_score,
        "source": "Manual",
        "timestamp": datetime.now(timezone.utc).isoformat()
    })
    lead.score_history = json.dumps(history)
    
    act = Activity(
        type="System",
        description=f"Lead Score manually overridden from {old_score} to {lead.lead_score}",
        lead_id=lead.id,
        author_id=current_user["sub"],
        timestamp=datetime.now(timezone.utc),
        organization_id=current_user["org"]
    )
    db.add(act)
    await db.commit()
    await db.refresh(lead)
    return lead


@router.post("/leads/{lead_id}/reset-score", response_model=LeadResponse)
async def reset_score(
    lead_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    from app.modules.crm.models import Lead, Activity
    from datetime import datetime, timezone
    
    res = await db.execute(select(Lead).where(Lead.id == lead_id, Lead.organization_id == current_user["org"]))
    lead = res.scalars().first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
        
    old_score = lead.lead_score or 0
    lead.is_score_manual = False
    lead.manual_score = None
    lead.lead_score = lead.automatic_score or 0
    lead.score_source = "Automatic"
    lead.score_last_updated = datetime.now(timezone.utc)
    
    history = []
    if lead.score_history:
        try:
            history = json.loads(lead.score_history)
        except Exception:
            history = []
    history.append({
        "event": "Automatic Reset",
        "detail": "Re-enabled automatic scoring",
        "delta": lead.lead_score - old_score,
        "automatic_score": lead.automatic_score,
        "manual_score": None,
        "final_score": lead.lead_score,
        "source": "Automatic",
        "timestamp": datetime.now(timezone.utc).isoformat()
    })
    lead.score_history = json.dumps(history)
    
    act = Activity(
        type="System",
        description=f"Lead Score reset to automatic scoring (final: {lead.lead_score})",
        lead_id=lead.id,
        author_id=current_user["sub"],
        timestamp=datetime.now(timezone.utc),
        organization_id=current_user["org"]
    )
    db.add(act)
    await db.commit()
    await db.refresh(lead)
    return lead

