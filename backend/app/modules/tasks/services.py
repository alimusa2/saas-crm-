from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import distinct, func
from fastapi import HTTPException, status
from typing import List, Optional
from datetime import datetime, timezone

from app.modules.tasks.models import Task, TaskLead
from app.modules.tasks.schemas import TaskCreate, TaskUpdate
from app.modules.crm.models import Lead, Activity, Company
from app.modules.pipeline.models import Deal, Stage
from app.modules.auth.models import User
from app.core.events import publish, GenericEvent

class TaskService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_tasks(self, organization_id: str, current_user: Optional[dict] = None) -> List[Task]:
        try:
            await self.check_overdue_tasks(organization_id)
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning(f"Failed checking overdue tasks: {e}")
            try:
                await self.db.rollback()
            except Exception:
                pass

        stmt = select(Task).where(Task.organization_id == organization_id)

        # Non-admin Employee Data Isolation Filter
        if current_user and not current_user.get("is_superuser") and current_user.get("role") != "Admin":
            from app.core.permissions import get_employee_permissions_context
            from sqlalchemy import or_
            perm_ctx = await get_employee_permissions_context(self.db, current_user)
            if not perm_ctx["is_admin"]:
                u_id = perm_ctx["user_id"]
                m_id = perm_ctx["member_id"]
                
                conds = []
                if u_id:
                    conds.extend([Task.assigned_to_id == u_id, Task.owner_id == u_id, Task.assigned_by_id == u_id])
                if m_id:
                    conds.append(Task.assigned_to_id == m_id)
                
                if conds:
                    stmt = stmt.where(or_(*conds))

        result = await self.db.execute(stmt)
        tasks = list(result.scalars().all())
        if not tasks:
            return []

        task_ids = [t.id for t in tasks]
        
        # Fetch TaskLead relations
        relations_res = await self.db.execute(
            select(TaskLead).where(
                TaskLead.task_id.in_(task_ids),
                TaskLead.organization_id == organization_id
            )
        )
        relations = list(relations_res.scalars().all())
        lead_ids = list(set([r.lead_id for r in relations]))
        
        lead_map = {}
        if lead_ids:
            # Fetch Leads
            leads_res = await self.db.execute(
                select(Lead).where(Lead.id.in_(lead_ids), Lead.organization_id == organization_id)
            )
            leads = list(leads_res.scalars().all())
            
            # Fetch Deals for these leads to get Stage name
            deals_res = await self.db.execute(
                select(Deal, Stage.name).join(Stage, Deal.stage_id == Stage.id).where(
                    Deal.lead_id.in_(lead_ids),
                    Deal.organization_id == organization_id
                )
            )
            lead_stages = {deal.lead_id: stage_name for deal, stage_name in deals_res.all() if deal.lead_id}
            
            # Fetch Companies for these leads
            company_ids = list(set([l.company_id for l in leads if l.company_id]))
            company_map = {}
            if company_ids:
                comp_res = await self.db.execute(
                    select(Company).where(Company.id.in_(company_ids), Company.organization_id == organization_id)
                )
                company_map = {c.id: c.name for c in comp_res.scalars().all()}
                
            # Fetch Salespeople (Users)
            owner_ids = list(set([l.owner_id for l in leads if l.owner_id]))
            user_map = {}
            if owner_ids:
                user_res = await self.db.execute(
                    select(User).where(User.id.in_(owner_ids))
                )
                user_map = {u.id: f"{u.first_name or ''} {u.last_name or ''}".strip() or u.email for u in user_res.scalars().all()}
                
            # Fetch Last Activity Timestamps
            act_res = await self.db.execute(
                select(Activity.lead_id, func.max(Activity.timestamp)).where(
                    Activity.lead_id.in_(lead_ids),
                    Activity.organization_id == organization_id
                ).group_by(Activity.lead_id)
            )
            activity_map = {lead_id: max_ts for lead_id, max_ts in act_res.all() if lead_id}
            
            # Build RelatedLeadSummary map
            for lead in leads:
                lead_map[lead.id] = {
                    "id": lead.id,
                    "first_name": lead.first_name,
                    "last_name": lead.last_name,
                    "email": lead.email,
                    "phone": lead.phone,
                    "company_name": company_map.get(lead.company_id),
                    "pipeline_stage": lead_stages.get(lead.id, "New"),
                    "lead_score": lead.lead_score,
                    "lead_source": lead.lead_source,
                    "assigned_salesperson": user_map.get(lead.owner_id, "Unassigned"),
                    "status": lead.status,
                    "last_activity_date": activity_map.get(lead.id)
                }
                
        # Group related lead summaries by task ID
        task_leads_map = {}
        for r in relations:
            if r.lead_id in lead_map:
                if r.task_id not in task_leads_map:
                    task_leads_map[r.task_id] = []
                task_leads_map[r.task_id].append(lead_map[r.lead_id])
                
        # Assign lead_ids and related_leads to each task response
        for task in tasks:
            task_leads = task_leads_map.get(task.id, [])
            task.lead_ids = [l["id"] for l in task_leads]
            task.related_leads = task_leads
            
            # Also support legacy lead_id if not present
            if task.lead_id and not task.lead_ids:
                legacy_summary = lead_map.get(task.lead_id)
                if legacy_summary:
                    task.lead_ids = [task.lead_id]
                    task.related_leads = [legacy_summary]

        return tasks

    async def check_overdue_tasks(self, organization_id: str):
        now = datetime.now(timezone.utc)
        stmt = select(Task).where(
            Task.organization_id == organization_id,
            Task.is_completed == False,
            Task.status != "Completed",
            Task.due_date < now
        )
        result = await self.db.execute(stmt)
        overdue_tasks = list(result.scalars().all())
        if not overdue_tasks:
            return

        task_ids = [t.id for t in overdue_tasks]

        # Batch fetch all TaskLead relations in 1 query
        tl_res = await self.db.execute(
            select(TaskLead).where(
                TaskLead.task_id.in_(task_ids),
                TaskLead.organization_id == organization_id
            )
        )
        task_leads_map = {}
        for r in tl_res.scalars().all():
            task_leads_map.setdefault(r.task_id, []).append(r.lead_id)

        # Batch fetch existing overdue Activities in 1 query
        act_res = await self.db.execute(
            select(Activity.task_id).where(
                Activity.type == "Task Overdue",
                Activity.task_id.in_(task_ids),
                Activity.organization_id == organization_id
            )
        )
        already_emitted = set([row for row in act_res.scalars().all() if row])

        any_added = False
        for task in overdue_tasks:
            if task.id in already_emitted:
                continue

            lead_ids = task_leads_map.get(task.id, [])
            if task.lead_id and task.lead_id not in lead_ids:
                lead_ids.append(task.lead_id)

            await publish("task.overdue", GenericEvent(
                event_name="task.overdue",
                organization_id=organization_id,
                entity_id=task.id,
                trigger_name="task.overdue",
                data={
                    "task_id": task.id,
                    "title": task.title,
                    "due_date": task.due_date.isoformat() if task.due_date else None,
                    "lead_id": task.lead_id,
                    "lead_ids": lead_ids,
                    "department": task.department,
                    "assigned_to_id": task.assigned_to_id
                }
            ))

            author_id = task.assigned_to_id or task.owner_id or task.assigned_by_id
            if not author_id:
                admin_res = await self.db.execute(select(User.id).where(User.organization_id == organization_id))
                author_id = admin_res.scalars().first()
            if not author_id:
                continue

            if lead_ids:
                for l_id in lead_ids:
                    self.db.add(Activity(
                        type="Task Overdue",
                        description=f"Task '{task.title}' became overdue. Task ID: {task.id}",
                        lead_id=l_id,
                        task_id=task.id,
                        author_id=author_id,
                        timestamp=datetime.now(timezone.utc),
                        organization_id=organization_id
                    ))
            else:
                self.db.add(Activity(
                    type="Task Overdue",
                    description=f"Task '{task.title}' became overdue. Task ID: {task.id}",
                    lead_id=task.lead_id,
                    task_id=task.id,
                    author_id=author_id,
                    timestamp=datetime.now(timezone.utc),
                    organization_id=organization_id
                ))
            any_added = True

        if any_added:
            await self.db.commit()

    async def log_task_activity(self, task: Task, lead_ids: List[str], event_type: str, author_id: str, organization_id: str):
        for lead_id in lead_ids:
            act = Activity(
                type=event_type,
                description=f"Task '{task.title}' was {event_type.lower().split('.')[-1]}. Task ID: {task.id}",
                lead_id=lead_id,
                task_id=task.id,
                author_id=author_id,
                timestamp=datetime.now(timezone.utc),
                organization_id=organization_id
            )
            self.db.add(act)
        await self.db.flush()

    async def handle_task_assignment(self, task: Task, assigned_to_id: str, assigner_user_id: str, organization_id: str):
        from app.modules.team.models import TeamMember
        
        # Verify team member is active and in organization
        tm_check = await self.db.execute(
            select(TeamMember).where(
                TeamMember.id == assigned_to_id,
                TeamMember.organization_id == organization_id,
                TeamMember.is_deleted == False
            )
        )
        member = tm_check.scalars().first()
        if not member:
            raise HTTPException(status_code=404, detail="Team member not found.")
            
        if member.status != "Active":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot assign task to inactive team member."
            )
            
        # Update assignment fields
        task.assigned_to_id = assigned_to_id
        task.assigned_by_id = assigner_user_id
        task.assigned_at = datetime.now(timezone.utc)
        
        # Fetch assigner name
        assigner_name = "System"
        if assigner_user_id:
            user_check = await self.db.execute(
                select(User).where(User.id == assigner_user_id)
            )
            user = user_check.scalars().first()
            if user:
                assigner_name = f"{user.first_name or ''} {user.last_name or ''}".strip() or user.email
                
        # Fetch Related Lead IDs
        tl_res = await self.db.execute(
            select(TaskLead.lead_id).where(
                TaskLead.task_id == task.id,
                TaskLead.organization_id == organization_id
            )
        )
        lead_ids = list(tl_res.scalars().all())
        if task.lead_id and task.lead_id not in lead_ids:
            lead_ids.append(task.lead_id)

        # 1. Create In-App Notification (only if member has a linked user_id)
        if member.user_id:
            from app.modules.notifications.models import Notification
            
            dept_str = f"\nDepartment: {task.department}" if task.department else ""
            leads_str = f"\nRelated Leads: {len(lead_ids)}" if lead_ids else ""
            priority_str = f"\nPriority: {task.priority}" if task.priority else ""
            
            due_label = "No due date"
            if task.due_date:
                from datetime import date
                today = date.today()
                due_date_local = task.due_date.date()
                if (due_date_local - today).days == 1:
                    due_label = "Due Tomorrow"
                elif (due_date_local - today).days == 0:
                    due_label = "Due Today"
                else:
                    due_label = f"Due {due_date_local.strftime('%Y-%m-%d')}"
                    
            notif_content = f"Task: {task.title}{dept_str}{leads_str}{priority_str}\n{due_label}"
            
            notif = Notification(
                user_id=member.user_id,
                type="Task",
                title="New Task Assigned",
                content=notif_content,
                is_read=False,
                related_entity_type="Task",
                related_entity_id=task.id,
                organization_id=organization_id
            )
            self.db.add(notif)
            
        # 2. Log CRM Activity
        member_name = f"{member.first_name or ''} {member.last_name or ''}".strip()
        act_desc = f"Task '{task.title}' assigned to {member_name}"
        if lead_ids:
            for lead_id in lead_ids:
                act = Activity(
                    type="Task Assigned",
                    description=act_desc,
                    lead_id=lead_id,
                    task_id=task.id,
                    author_id=assigner_user_id or "system",
                    timestamp=datetime.now(timezone.utc),
                    organization_id=organization_id
                )
                self.db.add(act)
        else:
            act = Activity(
                type="Task Assigned",
                description=act_desc,
                lead_id=task.lead_id,
                task_id=task.id,
                author_id=assigner_user_id or "system",
                timestamp=datetime.now(timezone.utc),
                organization_id=organization_id
            )
            self.db.add(act)
        await self.db.flush()
        
        # 3. Send Email Notification
        if member.email:
            try:
                from app.modules.email.models import EmailTemplate
                from app.modules.email.services import EmailLogService
                from app.modules.email.schemas import EmailSendRequest
                
                # Check / Create email template
                tmpl_check = await self.db.execute(
                    select(EmailTemplate).where(
                        EmailTemplate.name == "Task Assignment",
                        EmailTemplate.organization_id == organization_id
                    )
                )
                tmpl = tmpl_check.scalars().first()
                
                email_html = """
                        <p>Hello {{FirstName}},</p>
                        <p>A new task has been assigned to you.</p>
                        <p><strong>Task:</strong> {{task_title}}<br/>
                        <strong>Due Date:</strong> {{due_date}}<br/>
                        <strong>Priority:</strong> {{priority}}<br/>
                        <strong>Assigned By:</strong> {{assigned_by}}</p>
                        {% if related_leads %}
                        <p><strong>Related Leads:</strong></p>
                        <ul>
                        {% for lead in related_leads %}
                          <li>
                            <strong>{{ lead.name }}</strong> (Score: {{ lead.score }}, Stage: {{ lead.stage }})<br/>
                            Phone: {{ lead.phone }} | Email: {{ lead.email }}
                          </li>
                        {% endfor %}
                        </ul>
                        {% endif %}
                        <p>Please log into GrowthOS to view details.</p>
                """
                
                if not tmpl:
                    tmpl = EmailTemplate(
                        name="Task Assignment",
                        subject="New Task Assigned",
                        html_content=email_html,
                        organization_id=organization_id
                    )
                    self.db.add(tmpl)
                    await self.db.flush()
                else:
                    tmpl.html_content = email_html
                
                # Fetch detailed lead info for variables
                related_leads_data = []
                if lead_ids:
                    leads_res = await self.db.execute(
                        select(Lead).where(Lead.id.in_(lead_ids), Lead.organization_id == organization_id)
                    )
                    leads_objs = list(leads_res.scalars().all())
                    
                    deals_res = await self.db.execute(
                        select(Deal, Stage.name).join(Stage, Deal.stage_id == Stage.id).where(
                            Deal.lead_id.in_(lead_ids),
                            Deal.organization_id == organization_id
                        )
                    )
                    lead_stages = {deal.lead_id: stage_name for deal, stage_name in deals_res.all() if deal.lead_id}
                    
                    for lead in leads_objs:
                        related_leads_data.append({
                            "name": f"{lead.first_name} {lead.last_name}",
                            "score": lead.lead_score,
                            "stage": lead_stages.get(lead.id, "New"),
                            "phone": lead.phone or "N/A",
                            "email": lead.email or "N/A"
                        })
                
                req = EmailSendRequest(
                    template_id=tmpl.id,
                    recipient_email=member.email,
                    lead_id=task.lead_id,
                    variables={
                        "task_id": task.id,
                        "FirstName": member.first_name,
                        "task_title": task.title,
                        "due_date": task.due_date.strftime("%Y-%m-%d") if task.due_date else "No due date",
                        "priority": task.priority or "Normal",
                        "assigned_by": assigner_name,
                        "related_leads": related_leads_data
                    }
                )
                await EmailLogService.send_email(self.db, req, organization_id)
            except Exception as e:
                import logging
                logging.getLogger(__name__).warning(f"Failed to send task assignment email: {e}")
                
        # 4. Publish Event
        await publish("task.assigned", GenericEvent(
            event_name="task.assigned",
            organization_id=organization_id,
            data={
                "task_id": task.id,
                "title": task.title,
                "assigned_to_id": task.assigned_to_id,
                "assigned_by_id": task.assigned_by_id,
                "due_date": task.due_date.isoformat() if task.due_date else None,
                "priority": task.priority,
                "lead_ids": lead_ids,
                "department": task.department
            }
        ))

    async def create_task(self, task_in: TaskCreate, organization_id: str, owner_id: str) -> Task:
        import logging
        logger = logging.getLogger("tasks_management")
        
        # Validate Department
        if task_in.department:
            from app.modules.team.models import TeamMember
            result_depts = await self.db.execute(
                select(distinct(TeamMember.department)).where(
                    TeamMember.organization_id == organization_id,
                    TeamMember.is_deleted == False
                )
            )
            existing_depts = [d for d in result_depts.scalars().all() if d]
            if existing_depts and task_in.department not in existing_depts:
                raise HTTPException(status_code=400, detail=f"Department '{task_in.department}' does not exist.")

        # Validate Assigned Team Member
        if task_in.assigned_to_id:
            from app.modules.team.models import TeamMember
            tm_check = await self.db.execute(
                select(TeamMember).where(
                    TeamMember.id == task_in.assigned_to_id,
                    TeamMember.organization_id == organization_id,
                    TeamMember.is_deleted == False
                )
            )
            member = tm_check.scalars().first()
            if not member:
                raise HTTPException(status_code=404, detail="Assigned team member not found.")
            if member.status != "Active":
                raise HTTPException(status_code=400, detail="Cannot assign task to inactive team member.")

        # Related Leads Validation
        lead_ids = task_in.lead_ids or []
        if task_in.lead_id and task_in.lead_id not in lead_ids:
            lead_ids.insert(0, task_in.lead_id)

        if lead_ids:
            res_leads = await self.db.execute(
                select(Lead).where(
                    Lead.id.in_(lead_ids),
                    Lead.organization_id == organization_id
                )
            )
            found_leads = res_leads.scalars().all()
            if len(found_leads) != len(set(lead_ids)):
                raise HTTPException(status_code=400, detail="One or more related leads do not belong to this organization or do not exist.")

        task_data = task_in.model_dump(exclude={"assigned_to_id", "assigned_by_id", "assigned_at", "lead_ids"})
        task = Task(
            **task_data,
            organization_id=organization_id,
            owner_id=owner_id
        )
        if lead_ids:
            task.lead_id = lead_ids[0]

        self.db.add(task)
        await self.db.flush()

        # Save junction associations
        for l_id in lead_ids:
            assoc = TaskLead(
                task_id=task.id,
                lead_id=l_id,
                organization_id=organization_id
            )
            self.db.add(assoc)
        await self.db.flush()

        if task_in.assigned_to_id:
            await self.handle_task_assignment(task, task_in.assigned_to_id, owner_id, organization_id)

        # Log timeline Activity
        await self.log_task_activity(task, lead_ids, "Task Created", owner_id, organization_id)

        await self.db.commit()
        await self.db.refresh(task)

        # Log details
        logger.info(
            f"Task Created - Task ID: {task.id}, Title: '{task.title}', "
            f"Department: {task.department}, Assigned User: {task.assigned_to_id}, "
            f"Selected Lead IDs: {lead_ids}, Creator: {owner_id}, "
            f"Organization: {organization_id}, Timestamp: {task.created_at.isoformat()}, "
            f"Automation Trigger: task.created"
        )

        await publish("task.created", GenericEvent(
            event_name="task.created",
            organization_id=organization_id,
            data={
                "task_id": task.id,
                "title": task.title,
                "owner_id": task.owner_id,
                "lead_id": task.lead_id,
                "lead_ids": lead_ids,
                "department": task.department,
                "assigned_to_id": task.assigned_to_id
            }
        ))
        return task

    async def update_task(self, task_id: str, task_in: TaskUpdate, organization_id: str, assigner_user_id: Optional[str] = None) -> Optional[Task]:
        import logging
        logger = logging.getLogger("tasks_management")
        
        result = await self.db.execute(
            select(Task).where(Task.id == task_id, Task.organization_id == organization_id)
        )
        task = result.scalars().first()
        if not task:
            return None
        
        old_status = task.status
        old_assigned_to_id = task.assigned_to_id
        
        # Validate Department
        if task_in.department:
            from app.modules.team.models import TeamMember
            result_depts = await self.db.execute(
                select(distinct(TeamMember.department)).where(
                    TeamMember.organization_id == organization_id,
                    TeamMember.is_deleted == False
                )
            )
            existing_depts = [d for d in result_depts.scalars().all() if d]
            if existing_depts and task_in.department not in existing_depts:
                raise HTTPException(status_code=400, detail=f"Department '{task_in.department}' does not exist.")

        # Validate Assigned Team Member
        assigned_to_id = task_in.assigned_to_id
        if assigned_to_id:
            from app.modules.team.models import TeamMember
            tm_check = await self.db.execute(
                select(TeamMember).where(
                    TeamMember.id == assigned_to_id,
                    TeamMember.organization_id == organization_id,
                    TeamMember.is_deleted == False
                )
            )
            member = tm_check.scalars().first()
            if not member:
                raise HTTPException(status_code=404, detail="Assigned team member not found.")
            if member.status != "Active":
                raise HTTPException(status_code=400, detail="Cannot assign task to inactive team member.")

        update_data = task_in.model_dump(exclude_unset=True)
        lead_ids = update_data.pop("lead_ids", None)
        legacy_lead_id = update_data.get("lead_id")

        if lead_ids is not None:
            if legacy_lead_id and legacy_lead_id not in lead_ids:
                lead_ids.insert(0, legacy_lead_id)
                
            if lead_ids:
                res_leads = await self.db.execute(
                    select(Lead).where(
                        Lead.id.in_(lead_ids),
                        Lead.organization_id == organization_id
                    )
                )
                found_leads = res_leads.scalars().all()
                if len(found_leads) != len(set(lead_ids)):
                    raise HTTPException(status_code=400, detail="One or more related leads do not belong to this organization or do not exist.")
            
            # Delete old task leads
            from sqlalchemy import delete
            await self.db.execute(
                delete(TaskLead).where(
                    TaskLead.task_id == task.id,
                    TaskLead.organization_id == organization_id
                )
            )
            # Insert new task leads
            for l_id in lead_ids:
                assoc = TaskLead(
                    task_id=task.id,
                    lead_id=l_id,
                    organization_id=organization_id
                )
                self.db.add(assoc)
            await self.db.flush()
            task.lead_id = lead_ids[0] if lead_ids else None
        else:
            if "lead_id" in update_data:
                from sqlalchemy import delete
                await self.db.execute(
                    delete(TaskLead).where(
                        TaskLead.task_id == task.id,
                        TaskLead.organization_id == organization_id
                    )
                )
                if legacy_lead_id:
                    res_lead = await self.db.execute(
                        select(Lead).where(Lead.id == legacy_lead_id, Lead.organization_id == organization_id)
                    )
                    if not res_lead.scalars().first():
                        raise HTTPException(status_code=400, detail="Related lead does not belong to this organization.")
                    assoc = TaskLead(
                        task_id=task.id,
                        lead_id=legacy_lead_id,
                        organization_id=organization_id
                    )
                    self.db.add(assoc)
                await self.db.flush()
                
            tl_res = await self.db.execute(
                select(TaskLead.lead_id).where(
                    TaskLead.task_id == task.id,
                    TaskLead.organization_id == organization_id
                )
            )
            lead_ids = list(tl_res.scalars().all())

        update_data.pop("assigned_to_id", None)
        for key, value in update_data.items():
            setattr(task, key, value)
            
        if assigned_to_id is not None and assigned_to_id != old_assigned_to_id:
            await self.handle_task_assignment(task, assigned_to_id, assigner_user_id or task.owner_id, organization_id)
            
        if old_status != task.status and task.status == "Completed":
            task.is_completed = True
            await self.log_task_activity(task, lead_ids, "Task Completed", assigner_user_id or "system", organization_id)
            
            await publish("task.completed", GenericEvent(
                event_name="task.completed",
                organization_id=organization_id,
                data={
                    "task_id": task.id,
                    "title": task.title,
                    "lead_id": task.lead_id,
                    "lead_ids": lead_ids,
                    "department": task.department,
                    "assigned_to_id": task.assigned_to_id
                }
            ))
        elif old_status == "Completed" and task.status != "Completed":
            task.is_completed = False
            await self.log_task_activity(task, lead_ids, "Task Reopened", assigner_user_id or "system", organization_id)
            
            await publish("task.reopened", GenericEvent(
                event_name="task.reopened",
                organization_id=organization_id,
                data={
                    "task_id": task.id,
                    "title": task.title,
                    "lead_id": task.lead_id,
                    "lead_ids": lead_ids,
                    "department": task.department,
                    "assigned_to_id": task.assigned_to_id
                }
            ))
            
        await self.db.commit()
        await self.db.refresh(task)
        return task

    async def delete_task(self, task_id: str, organization_id: str) -> bool:
        result = await self.db.execute(
            select(Task).where(Task.id == task_id, Task.organization_id == organization_id)
        )
        task = result.scalars().first()
        if not task:
            return False
        
        await self.db.delete(task)
        await self.db.commit()
        return True
