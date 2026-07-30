import uuid
from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import func, delete
from sqlalchemy.orm import selectinload
from fastapi import HTTPException
from typing import Sequence, List, Optional

from app.modules.funnels.models import Funnel, FunnelStep, FunnelVisit, FunnelComponent, MediaAsset
from app.modules.funnels.schemas import (
    FunnelCreate, FunnelStepCreate, FunnelVisitCreate,
    FunnelAnalyticsReport, FunnelStepAnalytics
)


def migrate_legacy_step_components(step: FunnelStep) -> list:
    if step.components:
        return step.components
        
    components = []
    order = 0
    import json
    
    base_kwargs = {
        "step_id": step.id,
        "organization_id": step.organization_id,
        "created_at": step.created_at or datetime.now(timezone.utc),
        "updated_at": step.updated_at or datetime.now(timezone.utc)
    }

    if step.title:
        components.append(FunnelComponent(
            id=f"migrated_{step.id}_{order}",
            type="Heading",
            order=order,
            config=json.dumps({"text": step.title, "level": "h3", "color": "#6366F1"}),
            **base_kwargs
        ))
        order += 1

    if step.heading:
        components.append(FunnelComponent(
            id=f"migrated_{step.id}_{order}",
            type="Heading",
            order=order,
            config=json.dumps({"text": step.heading, "level": "h1"}),
            **base_kwargs
        ))
        order += 1

    if step.image_url:
        components.append(FunnelComponent(
            id=f"migrated_{step.id}_{order}",
            type="Image",
            order=order,
            config=json.dumps({"url": step.image_url, "alt": step.heading or "Image", "width": "100%"}),
            **base_kwargs
        ))
        order += 1

    if step.paragraph_text:
        components.append(FunnelComponent(
            id=f"migrated_{step.id}_{order}",
            type="Paragraph",
            order=order,
            config=json.dumps({"text": step.paragraph_text}),
            **base_kwargs
        ))
        order += 1

    if step.form_id:
        components.append(FunnelComponent(
            id=f"migrated_{step.id}_{order}",
            type="Form",
            order=order,
            config=json.dumps({"form_id": step.form_id}),
            **base_kwargs
        ))
        order += 1

    if step.button_text and not step.form_id:
        components.append(FunnelComponent(
            id=f"migrated_{step.id}_{order}",
            type="Button",
            order=order,
            config=json.dumps({
                "text": step.button_text,
                "action_type": step.action_type or "go_to_next_step",
                "action_value": step.action_value
            }),
            **base_kwargs
        ))
        order += 1

    return components


def ensure_page_content_layout(step: FunnelStep) -> None:
    import json
    import uuid

    if step.page_content:
        try:
            layout = json.loads(step.page_content)
            if "sections" in layout and len(layout["sections"]) > 0:
                return
        except Exception:
            pass

    # Build default Sections -> Rows -> Columns -> Components layout
    components = migrate_legacy_step_components(step)
    layout_comps = []
    for c in components:
        layout_comps.append({
            "id": c.id or f"comp_{uuid.uuid4()}",
            "type": c.type,
            "config": c.config or "{}"
        })
        
    layout = {
        "sections": [
            {
                "id": f"sec_default_{step.id}",
                "name": "Default Section",
                "type": "Blank Section",
                "settings": {
                    "padding": "40px 0",
                    "margin": "0",
                    "container_width": "container",
                    "visibility": "both"
                },
                "rows": [
                    {
                        "id": f"row_default_{step.id}",
                        "settings": {},
                        "columns": [
                            {
                                "id": f"col_default_{step.id}",
                                "width": "100%",
                                "settings": {},
                                "components": layout_comps
                            }
                        ]
                    }
                ]
            }
        ],
        "globalSettings": {
            "seo_title": step.name,
            "meta_description": "",
            "og_image": "",
            "custom_css": "",
            "custom_js": "",
            "body_width": "100%",
            "theme_colors": {
                "primary": "#4F46E5",
                "secondary": "#10B981",
                "accent": "#F59E0B"
            }
        },
        "designSystem": {
            "primary_color": "#4F46E5",
            "secondary_color": "#10B981",
            "accent_color": "#F59E0B",
            "fonts": "Inter",
            "button_style": "solid",
            "border_radius": "8px"
        }
    }
    
    step.page_content = json.dumps(layout)


class FunnelService:
    @staticmethod
    async def get_funnels(db: AsyncSession, organization_id: str) -> Sequence[Funnel]:
        stmt = select(Funnel).where(Funnel.organization_id == organization_id)
        result = await db.execute(stmt)
        return result.scalars().all()

    @staticmethod
    async def create_funnel(db: AsyncSession, obj_in: FunnelCreate, organization_id: str) -> Funnel:
        db_obj = Funnel(**obj_in.model_dump(), organization_id=organization_id)
        db.add(db_obj)
        await db.commit()
        await db.refresh(db_obj)
        return db_obj

    @staticmethod
    async def get_funnel(db: AsyncSession, funnel_id: str, organization_id: str) -> Funnel:
        stmt = (
            select(Funnel)
            .where(Funnel.id == funnel_id, Funnel.organization_id == organization_id)
            .options(selectinload(Funnel.steps).selectinload(FunnelStep.components))
            .execution_options(populate_existing=True)
        )
        result = await db.execute(stmt)
        funnel = result.scalar_one_or_none()
        if not funnel:
            raise HTTPException(status_code=404, detail="Funnel not found")
        for step in funnel.steps:
            step.components = migrate_legacy_step_components(step)
            ensure_page_content_layout(step)
        if funnel.steps:
            funnel.steps.sort(key=lambda s: s.order if s.order is not None else 999)
        return funnel

    @staticmethod
    async def update_funnel(db: AsyncSession, funnel_id: str, data: dict, organization_id: str) -> Funnel:
        funnel = await FunnelService.get_funnel(db, funnel_id, organization_id)
        for key, value in data.items():
            if hasattr(funnel, key):
                setattr(funnel, key, value)
        await db.commit()
        await db.refresh(funnel)
        return funnel

    @staticmethod
    async def delete_funnel(db: AsyncSession, funnel_id: str, organization_id: str) -> None:
        funnel = await FunnelService.get_funnel(db, funnel_id, organization_id)
        await db.delete(funnel)
        await db.commit()

    @staticmethod
    async def publish_funnel(db: AsyncSession, funnel_id: str, organization_id: str) -> Funnel:
        funnel = await FunnelService.get_funnel(db, funnel_id, organization_id)
        
        # Fetch steps for validation
        stmt = select(FunnelStep).where(
            FunnelStep.funnel_id == funnel_id,
            FunnelStep.organization_id == organization_id
        ).options(selectinload(FunnelStep.components)).order_by(FunnelStep.order)
        res = await db.execute(stmt)
        steps = res.scalars().all()
        
        if not steps:
            raise HTTPException(status_code=400, detail="Cannot publish a funnel with no steps. Add at least one step.")
        
        # Validate configurations
        for step in steps:
            if not step.name or not step.name.strip():
                raise HTTPException(status_code=400, detail="Step configuration is invalid: Name/Type is missing.")
            
            # Reusable component checks or fallback checks
            has_form = any(c.type == "Form" for c in step.components) or step.form_id is not None
            has_calendar = any(c.type == "Calendar" for c in step.components)
            
            if (step.name == "Form Page" or has_form) and not step.form_id:
                # Check if a form ID is specified in the config of any Form component
                config_form_id = None
                for c in step.components:
                    if c.type == "Form" and c.config:
                        import json
                        try:
                            cfg = json.loads(c.config)
                            config_form_id = cfg.get("form_id")
                        except Exception:
                            pass
                if not config_form_id:
                    raise HTTPException(status_code=400, detail=f"Step '{step.name}' is missing a linked CRM form.")
                else:
                    step.form_id = config_form_id
            
            if step.form_id:
                from app.modules.forms.models import Form
                form_res = await db.execute(
                    select(Form).where(Form.id == step.form_id, Form.organization_id == organization_id)
                )
                if not form_res.scalars().first():
                    raise HTTPException(status_code=400, detail=f"Step '{step.name}' has a linked form that does not exist.")

        # Generate a short unique slug for the public URL
        slug = funnel_id[:8]
        funnel.status = "Published"
        funnel.is_active = True
        funnel.published_url = f"/funnel/{slug}"
        funnel.published_at = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(funnel)
        return funnel

    @staticmethod
    async def unpublish_funnel(db: AsyncSession, funnel_id: str, organization_id: str) -> Funnel:
        funnel = await FunnelService.get_funnel(db, funnel_id, organization_id)
        funnel.status = "Draft"
        funnel.published_url = None
        funnel.published_at = None
        await db.commit()
        await db.refresh(funnel)
        return funnel

    @staticmethod
    async def get_public_funnel(db: AsyncSession, funnel_id: str, preview: bool = False) -> Funnel:
        """Return funnel for unauthenticated public visitor. Only published funnels unless preview is True."""
        import logging
        from sqlalchemy import or_, func
        logger = logging.getLogger("funnel_preview")

        clean_id = (funnel_id or '').split('?')[0].strip()
        where_clause = or_(
            Funnel.id == clean_id,
            Funnel.id.like(f"{clean_id}%"),
            func.lower(Funnel.name) == clean_id.lower(),
            Funnel.name.ilike(f"%{clean_id}%"),
            Funnel.published_url.ilike(f"%{clean_id}%")
        )

        try:
            if preview:
                stmt = (
                    select(Funnel)
                    .where(where_clause)
                    .options(selectinload(Funnel.steps).selectinload(FunnelStep.components))
                    .execution_options(populate_existing=True)
                )
            else:
                stmt = (
                    select(Funnel)
                    .where(where_clause, Funnel.status == "Published")
                    .options(selectinload(Funnel.steps).selectinload(FunnelStep.components))
                    .execution_options(populate_existing=True)
                )

            result = await db.execute(stmt)
            funnel = result.scalars().first()
            if not funnel:
                logger.error(f"Preview failed: Funnel {funnel_id} not found")
                if preview:
                    raise HTTPException(status_code=404, detail="Draft not found")
                else:
                    raise HTTPException(status_code=404, detail="Funnel not found")

            for step in funnel.steps:
                step.components = migrate_legacy_step_components(step)
                ensure_page_content_layout(step)

            if funnel.steps:
                funnel.steps.sort(key=lambda s: s.order if s.order is not None else 999)

            # Log successful load details
            for step in funnel.steps:
                logger.info(
                    f"Preview Loaded - Funnel ID: {funnel.id}, Step ID: {step.id}, "
                    f"Components Loaded: {len(step.components or [])}, "
                    f"Rendering Status: Ready"
                )
            return funnel
        except Exception as e:
            logger.error(f"Preview Error - Funnel ID: {funnel_id}, Error: {str(e)}")
            raise



class FunnelStepService:
    @staticmethod
    async def get_steps(db: AsyncSession, funnel_id: str, organization_id: str) -> Sequence[FunnelStep]:
        await FunnelService.get_funnel(db, funnel_id, organization_id)
        stmt = select(FunnelStep).where(FunnelStep.funnel_id == funnel_id).options(
            selectinload(FunnelStep.components)
        ).order_by(FunnelStep.order)
        result = await db.execute(stmt)
        steps = result.scalars().all()
        for step in steps:
            step.components = migrate_legacy_step_components(step)
            ensure_page_content_layout(step)
        return steps

    @staticmethod
    async def update_navigation_links(db: AsyncSession, funnel_id: str, organization_id: str) -> None:
        """Automatically links steps sequentially based on their active order to prevent broken links."""
        stmt = select(FunnelStep).where(
            FunnelStep.funnel_id == funnel_id,
            FunnelStep.organization_id == organization_id
        ).order_by(FunnelStep.order)
        res = await db.execute(stmt)
        steps = res.scalars().all()
        
        for i in range(len(steps)):
            step = steps[i]
            if i < len(steps) - 1:
                step.next_step_id = steps[i+1].id
            else:
                step.next_step_id = None
        await db.commit()

    @staticmethod
    async def create_step(db: AsyncSession, funnel_id: str, obj_in: FunnelStepCreate, organization_id: str) -> FunnelStep:
        await FunnelService.get_funnel(db, funnel_id, organization_id)
        
        # Validate step name/type
        if not obj_in.name or not obj_in.name.strip():
            raise HTTPException(status_code=400, detail="Step name/type is required")
            
        data = obj_in.model_dump()
        
        # Extract components — they are a relationship, not a column
        components_in = data.pop("components", None) or []
        
        # Convert empty string form_id to None
        if data.get("form_id") == "":
            data["form_id"] = None
            
        # Validate linked form exists if selected
        if data.get("form_id"):
            from app.modules.forms.models import Form
            form_stmt = select(Form).where(Form.id == data["form_id"], Form.organization_id == organization_id)
            form_res = await db.execute(form_stmt)
            if not form_res.scalars().first():
                raise HTTPException(status_code=400, detail="Linked CRM form does not exist")
                
        db_obj = FunnelStep(**data, funnel_id=funnel_id, organization_id=organization_id)
        db.add(db_obj)
        await db.flush()  # get db_obj.id without committing

        # Persist components if supplied at creation time
        for idx, c in enumerate(components_in):
            if isinstance(c, dict):
                comp_type = c.get("type")
                comp_order = c.get("order", idx)
                comp_config = c.get("config")
            else:
                comp_type = c.type
                comp_order = getattr(c, "order", idx)
                comp_config = getattr(c, "config", None)
            new_c = FunnelComponent(
                step_id=db_obj.id,
                type=comp_type,
                order=comp_order,
                config=comp_config,
                organization_id=organization_id
            )
            db.add(new_c)
        
        await db.commit()
        
        # Automatically update next_step_id sequencing
        await FunnelStepService.update_navigation_links(db, funnel_id, organization_id)
        
        # Reload to include components list
        stmt = select(FunnelStep).where(FunnelStep.id == db_obj.id).options(selectinload(FunnelStep.components))
        res = await db.execute(stmt)
        return res.scalars().first()


    @staticmethod
    async def update_step(
        db: AsyncSession, funnel_id: str, step_id: str, data: dict, organization_id: str
    ) -> FunnelStep:
        stmt = select(FunnelStep).where(
            FunnelStep.id == step_id,
            FunnelStep.funnel_id == funnel_id,
            FunnelStep.organization_id == organization_id
        ).options(selectinload(FunnelStep.components))
        res = await db.execute(stmt)
        step = res.scalars().first()
        if not step:
            raise HTTPException(status_code=404, detail="Funnel step not found")
            
        # Filter data to only update allowed fields
        allowed_fields = {
            "name", "order", "page_content", "form_id",
            "title", "heading", "paragraph_text", "image_url",
            "button_text", "background_color",
            "next_step_id", "status", "action_type", "action_value", "components"
        }
        filtered_data = {k: v for k, v in data.items() if k in allowed_fields}
        
        # Validate name if it is being updated
        if "name" in filtered_data:
            val = filtered_data["name"]
            if not val or not val.strip():
                raise HTTPException(status_code=400, detail="Step name/type cannot be empty")
                
        # Convert empty string form_id to None
        if "form_id" in filtered_data and filtered_data["form_id"] == "":
            filtered_data["form_id"] = None
            
        # Validate linked form exists if selected
        if filtered_data.get("form_id"):
            from app.modules.forms.models import Form
            form_stmt = select(Form).where(Form.id == filtered_data["form_id"], Form.organization_id == organization_id)
            form_res = await db.execute(form_stmt)
            if not form_res.scalars().first():
                raise HTTPException(status_code=400, detail="Linked CRM form does not exist")

        # Extract components from page_content if it is in the payload to keep DB tables synchronized
        if "page_content" in filtered_data and filtered_data["page_content"]:
            import json
            try:
                layout = json.loads(filtered_data["page_content"])
                flat_components = []
                for section in layout.get("sections", []):
                    for row in section.get("rows", []):
                        for column in row.get("columns", []):
                            for comp in column.get("components", []):
                                config_str = comp.get("config")
                                if not isinstance(config_str, str):
                                    config_str = json.dumps(config_str or {})
                                flat_components.append({
                                    "type": comp.get("type"),
                                    "config": config_str
                                })
                filtered_data["components"] = flat_components
                
                # Check for form_id in dynamic components config to set step-level form_id
                form_id = None
                for fc in flat_components:
                    try:
                        cfg = json.loads(fc["config"])
                        if cfg.get("form_id"):
                            form_id = cfg["form_id"]
                            break
                    except Exception:
                        pass
                if form_id:
                    filtered_data["form_id"] = form_id
            except Exception as e:
                print(f"Error parsing page_content during components sync: {str(e)}")

        # Sync components if provided
        if "components" in filtered_data:
            comps_in = filtered_data.pop("components")
            # Delete old components
            await db.execute(delete(FunnelComponent).where(FunnelComponent.step_id == step_id))
            # Insert new components
            for idx, c in enumerate(comps_in or []):
                new_c = FunnelComponent(
                    step_id=step_id,
                    type=c.get("type"),
                    order=c.get("order", idx),
                    config=c.get("config"),
                    organization_id=organization_id
                )
                db.add(new_c)
                
        for key, value in filtered_data.items():
            setattr(step, key, value)
            
        await db.commit()
        await db.refresh(step)

        # Update links if order is modified
        if "order" in filtered_data:
            await FunnelStepService.update_navigation_links(db, funnel_id, organization_id)
            
        # Reload with components
        stmt = select(FunnelStep).where(FunnelStep.id == step_id).options(selectinload(FunnelStep.components))
        res = await db.execute(stmt)
        return res.scalars().first()

    @staticmethod
    async def duplicate_step(db: AsyncSession, funnel_id: str, step_id: str, organization_id: str) -> FunnelStep:
        # Get source step
        stmt = select(FunnelStep).where(
            FunnelStep.id == step_id,
            FunnelStep.funnel_id == funnel_id,
            FunnelStep.organization_id == organization_id
        ).options(selectinload(FunnelStep.components))
        res = await db.execute(stmt)
        src_step = res.scalars().first()
        if not src_step:
            raise HTTPException(status_code=404, detail="Step not found")

        # Set new order at the end of the step chain
        all_steps = await FunnelStepService.get_steps(db, funnel_id, organization_id)
        new_order = len(all_steps) + 1

        new_step = FunnelStep(
            funnel_id=funnel_id,
            name=f"{src_step.name} (Copy)",
            order=new_order,
            page_content=src_step.page_content,
            form_id=src_step.form_id,
            title=src_step.title,
            heading=src_step.heading,
            paragraph_text=src_step.paragraph_text,
            image_url=src_step.image_url,
            button_text=src_step.button_text,
            background_color=src_step.background_color,
            status=src_step.status,
            action_type=src_step.action_type,
            action_value=src_step.action_value,
            organization_id=organization_id
        )
        db.add(new_step)
        await db.flush() # Allocate ID

        # Duplicate child components
        for comp in src_step.components:
            new_comp = FunnelComponent(
                step_id=new_step.id,
                type=comp.type,
                order=comp.order,
                config=comp.config,
                organization_id=organization_id
            )
            db.add(new_comp)

        await db.commit()
        await FunnelStepService.update_navigation_links(db, funnel_id, organization_id)
        
        # Reload fully with components loaded
        stmt = select(FunnelStep).where(FunnelStep.id == new_step.id).options(selectinload(FunnelStep.components))
        res = await db.execute(stmt)
        return res.scalars().first()

    @staticmethod
    async def delete_step(db: AsyncSession, funnel_id: str, step_id: str, organization_id: str) -> None:
        stmt = select(FunnelStep).where(
            FunnelStep.id == step_id,
            FunnelStep.funnel_id == funnel_id,
            FunnelStep.organization_id == organization_id
        )
        res = await db.execute(stmt)
        step = res.scalars().first()
        if not step:
            raise HTTPException(status_code=404, detail="Funnel step not found")
        await db.delete(step)
        await db.commit()
        
        # Repair broken links
        await FunnelStepService.update_navigation_links(db, funnel_id, organization_id)

    @staticmethod
    async def get_public_steps(db: AsyncSession, funnel_id: str) -> Sequence[FunnelStep]:
        """Returns ordered steps for a public funnel visitor (no auth required)."""
        stmt = select(FunnelStep).where(FunnelStep.funnel_id == funnel_id).options(
            selectinload(FunnelStep.components)
        ).order_by(FunnelStep.order)
        result = await db.execute(stmt)
        steps = result.scalars().all()
        for step in steps:
            step.components = migrate_legacy_step_components(step)
            ensure_page_content_layout(step)
        return steps


class MediaAssetService:
    @staticmethod
    async def save_asset(db: AsyncSession, filename: str, url: str, size: int, content_type: str, organization_id: str) -> MediaAsset:
        db_obj = MediaAsset(
            filename=filename,
            url=url,
            size=size,
            content_type=content_type,
            organization_id=organization_id
        )
        db.add(db_obj)
        await db.commit()
        await db.refresh(db_obj)
        return db_obj

    @staticmethod
    async def get_assets(db: AsyncSession, organization_id: str) -> Sequence[MediaAsset]:
        stmt = select(MediaAsset).where(MediaAsset.organization_id == organization_id).order_by(MediaAsset.created_at.desc())
        result = await db.execute(stmt)
        return result.scalars().all()

    @staticmethod
    async def delete_asset(db: AsyncSession, asset_id: str, organization_id: str) -> bool:
        stmt = select(MediaAsset).where(MediaAsset.id == asset_id, MediaAsset.organization_id == organization_id)
        result = await db.execute(stmt)
        asset = result.scalars().first()
        if not asset:
            return False

        # If it's a local file, remove it from disk
        if asset.url.startswith("/static/uploads/"):
            import os
            filename = asset.url.replace("/static/uploads/", "")
            file_path = os.path.join("static/uploads", filename)
            if os.path.exists(file_path):
                try:
                    os.remove(file_path)
                except Exception:
                    pass

        await db.delete(asset)
        await db.commit()
        return True


class FunnelTrackingService:
    @staticmethod
    async def track_visit(
        db: AsyncSession, funnel_id: str, visit_in: FunnelVisitCreate, organization_id: str
    ) -> FunnelVisit:
        # Verify step and funnel exist (works for both auth and public)
        stmt = select(FunnelStep).where(
            FunnelStep.id == visit_in.step_id,
            FunnelStep.funnel_id == funnel_id,
        )
        res = await db.execute(stmt)
        step = res.scalars().first()
        if not step:
            raise HTTPException(status_code=404, detail="Funnel step not found")

        db_obj = FunnelVisit(
            funnel_id=funnel_id,
            step_id=visit_in.step_id,
            session_id=visit_in.session_id,
            ip_address=visit_in.ip_address,
            utm_source=visit_in.utm_source,
            utm_medium=visit_in.utm_medium,
            utm_campaign=visit_in.utm_campaign,
            utm_term=visit_in.utm_term,
            utm_content=visit_in.utm_content,
            converted=visit_in.converted,
            event_type=visit_in.event_type,
            referrer=visit_in.referrer,
            device=visit_in.device,
            browser=visit_in.browser,
            os=visit_in.os,
            organization_id=organization_id,
        )
        db.add(db_obj)
        await db.commit()
        await db.refresh(db_obj)
        return db_obj

    @staticmethod
    async def track_visit_public(
        db: AsyncSession, funnel_id: str, visit_in: FunnelVisitCreate
    ) -> FunnelVisit:
        """Public (unauthenticated) tracking. Resolves org_id from the funnel record."""
        from sqlalchemy import or_, func
        clean_id = (funnel_id or '').strip()
        stmt = select(Funnel).where(
            or_(
                Funnel.id == clean_id,
                Funnel.id.like(f"{clean_id}%"),
                func.lower(Funnel.name) == clean_id.lower(),
                Funnel.published_url.ilike(f"%{clean_id}%")
            ),
            Funnel.status == "Published"
        )
        res = await db.execute(stmt)
        funnel = res.scalars().first()
        if not funnel:
            raise HTTPException(status_code=404, detail="Funnel not found or not published")

        return await FunnelTrackingService.track_visit(db, funnel.id, visit_in, funnel.organization_id)

    @staticmethod
    async def get_analytics(db: AsyncSession, funnel_id: str, organization_id: str) -> FunnelAnalyticsReport:
        # Get all steps ordered
        stmt = select(FunnelStep).where(
            FunnelStep.funnel_id == funnel_id,
            FunnelStep.organization_id == organization_id
        ).order_by(FunnelStep.order)
        res = await db.execute(stmt)
        steps = res.scalars().all()

        if not steps:
            return FunnelAnalyticsReport(
                funnel_id=funnel_id,
                total_visits=0,
                total_conversions=0,
                completion_rate=0.0,
                total_visitors=0,
                unique_visitors=0,
                form_submissions=0,
                conversion_rate=0.0,
                most_visited_step=None,
                steps=[]
            )

        step_analytics: List[FunnelStepAnalytics] = []
        total_visits = 0
        total_conversions = 0
        most_visited_step_name: Optional[str] = None
        most_visited_count = 0

        for i, step in enumerate(steps):
            # Unique sessions that hit this step
            v_res = await db.execute(
                select(func.count(func.distinct(FunnelVisit.session_id))).where(
                    FunnelVisit.step_id == step.id,
                    FunnelVisit.organization_id == organization_id
                )
            )
            visits = v_res.scalar() or 0

            if i == 0:
                total_visits = visits

            if visits > most_visited_count:
                most_visited_count = visits
                most_visited_step_name = step.name

            conversions = 0
            if i < len(steps) - 1:
                next_step = steps[i + 1]
                sub_stmt = (
                    select(FunnelVisit.session_id)
                    .where(
                        FunnelVisit.step_id == next_step.id,
                        FunnelVisit.organization_id == organization_id
                    )
                )
                c_res = await db.execute(
                    select(func.count(func.distinct(FunnelVisit.session_id))).where(
                        FunnelVisit.step_id == step.id,
                        FunnelVisit.organization_id == organization_id,
                        FunnelVisit.session_id.in_(sub_stmt)
                    )
                )
                conversions = c_res.scalar() or 0
            else:
                c_res = await db.execute(
                    select(func.count(func.distinct(FunnelVisit.session_id))).where(
                        FunnelVisit.step_id == step.id,
                        FunnelVisit.converted == True,
                        FunnelVisit.organization_id == organization_id
                    )
                )
                conversions = c_res.scalar() or 0
                total_conversions = conversions

            conv_rate = (conversions / visits * 100.0) if visits > 0 else 0.0
            drop_off_rate = 100.0 - conv_rate if visits > 0 else 0.0

            step_analytics.append(
                FunnelStepAnalytics(
                    step_id=step.id,
                    name=step.name,
                    order=step.order,
                    visits=visits,
                    conversions=conversions,
                    conversion_rate=round(conv_rate, 2),
                    drop_off_rate=round(drop_off_rate, 2)
                )
            )

        # Unique visitors across all steps
        uv_res = await db.execute(
            select(func.count(func.distinct(FunnelVisit.session_id))).where(
                FunnelVisit.funnel_id == funnel_id,
                FunnelVisit.organization_id == organization_id
            )
        )
        unique_visitors = uv_res.scalar() or 0

        # Form submission events across all steps
        fs_res = await db.execute(
            select(func.count(func.distinct(FunnelVisit.session_id))).where(
                FunnelVisit.funnel_id == funnel_id,
                FunnelVisit.organization_id == organization_id,
                FunnelVisit.event_type == "form_submit"
            )
        )
        form_submissions = fs_res.scalar() or 0

        overall_conversion_rate = round((total_conversions / total_visits * 100.0), 2) if total_visits > 0 else 0.0
        completion_rate = overall_conversion_rate

        return FunnelAnalyticsReport(
            funnel_id=funnel_id,
            total_visits=total_visits,
            total_conversions=total_conversions,
            completion_rate=completion_rate,
            total_visitors=total_visits,
            unique_visitors=unique_visitors,
            form_submissions=form_submissions,
            conversion_rate=overall_conversion_rate,
            most_visited_step=most_visited_step_name,
            steps=step_analytics
        )
