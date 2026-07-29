from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from typing import List, Optional, Any, Dict

from app.db.session import get_db
from app.modules.auth.dependencies import get_current_active_user
from app.modules.auth.models import User
from app.modules.forms.schemas import (
    FormResponse, FormCreate, FormWithFieldsResponse,
    FormFieldResponse, FormFieldCreate,
    FormSubmissionCreate, FormSubmissionResponse
)
from app.modules.forms.services import FormService, FormFieldService, FormSubmissionService
from pydantic import BaseModel

router = APIRouter()

@router.get("/", response_model=List[FormResponse])
async def read_forms(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    return await FormService.get_forms(db, current_user.organization_id)

@router.post("/", response_model=FormResponse)
async def create_form(
    obj_in: FormCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    return await FormService.create_form(db, obj_in, current_user.organization_id)

@router.get("/public/{form_id}", response_model=FormResponse)
async def read_form_public(
    form_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Public (unauthenticated) endpoint to get form metadata by ID."""
    from app.modules.forms.models import Form
    res = await db.execute(select(Form).where(Form.id == form_id, Form.is_active == True))
    form = res.scalars().first()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")
    return form

@router.get("/public/{form_id}/fields", response_model=List[FormFieldResponse])
async def read_form_fields_public(
    form_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Public (unauthenticated) endpoint to get fields for a form."""
    from app.modules.forms.models import Form, FormField
    res = await db.execute(select(Form).where(Form.id == form_id))
    form = res.scalars().first()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")
    fields_res = await db.execute(
        select(FormField).where(FormField.form_id == form_id).order_by(FormField.order)
    )
    return fields_res.scalars().all()

@router.get("/{form_id}", response_model=FormResponse)
async def read_form(
    form_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    return await FormService.get_form(db, form_id, current_user.organization_id)

@router.delete("/{form_id}")
async def delete_form(
    form_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    await FormService.delete_form(db, form_id, current_user.organization_id)
    return {"message": "Form deleted successfully"}

@router.get("/{form_id}/fields", response_model=List[FormFieldResponse])
async def read_form_fields(
    form_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    return await FormFieldService.get_fields(db, form_id, current_user.organization_id)

@router.post("/{form_id}/fields", response_model=FormFieldResponse)
async def create_form_field(
    form_id: str,
    obj_in: FormFieldCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    return await FormFieldService.create_field(db, form_id, obj_in, current_user.organization_id)

@router.delete("/{form_id}/fields/{field_id}")
async def delete_form_field(
    form_id: str,
    field_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    await FormFieldService.delete_field(db, form_id, field_id, current_user.organization_id)
    return {"message": "Field deleted successfully"}


class PublicFormSubmit(BaseModel):
    responses: List[Dict[str, Any]]
    visitor_id: Optional[str] = None
    utm_source: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


@router.post("/{form_id}/submit", response_model=FormSubmissionResponse)
async def submit_form(
    form_id: str,
    obj_in: PublicFormSubmit,
    db: AsyncSession = Depends(get_db)
):
    """Public unauthenticated form submission endpoint."""
    from app.modules.forms.models import Form, FormField
    # Resolve form
    res = await db.execute(select(Form).where(Form.id == form_id))
    form = res.scalars().first()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")

    # Build payload dict from responses
    payload: Dict[str, Any] = {}
    for resp in obj_in.responses:
        field_id = resp.get("form_field_id")
        value = resp.get("value", "")
        if field_id:
            # Get field name for better readability
            fr = await db.execute(select(FormField).where(FormField.id == field_id))
            field = fr.scalars().first()
            key = field.name if field else field_id
            payload[key] = value

    # Include tracking metadata
    if obj_in.visitor_id:
        payload["visitor_id"] = obj_in.visitor_id
    if obj_in.utm_source:
        payload["utm_source"] = obj_in.utm_source
    if obj_in.metadata:
        payload["metadata"] = obj_in.metadata

    submission_in = FormSubmissionCreate(payload=payload)
    return await FormSubmissionService.submit_form(db, form_id, submission_in)
