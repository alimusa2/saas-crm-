from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import or_, and_, desc
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone

from app.modules.team.models import TeamMember
from app.modules.crm.models import Lead, Contact
from app.modules.pipeline.models import Deal
from app.modules.tasks.models import Task
from app.modules.calendar.models import Appointment
from app.modules.funnels.models import Funnel
from app.modules.forms.models import Form

class EmployeeService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_team_member_for_user(self, user_id: str, organization_id: str) -> Optional[TeamMember]:
        res = await self.db.execute(
            select(TeamMember).where(
                TeamMember.user_id == user_id,
                TeamMember.organization_id == organization_id,
                TeamMember.is_deleted == False
            )
        )
        return res.scalars().first()

    async def get_employee_dashboard(self, user_id: str, organization_id: str) -> Dict[str, Any]:
        member = await self.get_team_member_for_user(user_id, organization_id)
        member_id = member.id if member else None

        # 1. Scoped Leads
        res_l = await self.db.execute(
            select(Lead).where(
                Lead.organization_id == organization_id,
                or_(
                    Lead.owner_id == user_id,
                    Lead.owner_id == member_id,
                    Lead.id.in_(member.assigned_contacts if member and member.assigned_contacts else [])
                )
            ).order_by(Lead.updated_at.desc()).limit(10)
        )
        leads = res_l.scalars().all()

        # 2. Scoped Deals / Opportunities
        res_d = await self.db.execute(
            select(Deal).where(
                Deal.organization_id == organization_id,
                or_(
                    Deal.owner_id == user_id,
                    Deal.owner_id == member_id,
                    Deal.id.in_(member.assigned_deals if member and member.assigned_deals else [])
                )
            ).order_by(Deal.updated_at.desc()).limit(10)
        )
        deals = res_d.scalars().all()

        # 3. Scoped Tasks
        res_t = await self.db.execute(
            select(Task).where(
                Task.organization_id == organization_id,
                or_(
                    Task.assigned_to_id == member_id,
                    Task.assigned_to_id == user_id,
                    Task.created_by_id == user_id
                )
            ).order_by(Task.due_date.asc() if hasattr(Task, 'due_date') else Task.created_at.desc()).limit(10)
        )
        tasks = res_t.scalars().all()

        # 4. Scoped Appointments
        res_a = await self.db.execute(
            select(Appointment).where(
                Appointment.organization_id == organization_id,
                or_(
                    Appointment.assigned_to_id == member_id,
                    Appointment.user_id == user_id,
                    Appointment.id.in_(member.assigned_calendars if member and member.assigned_calendars else [])
                )
            ).order_by(Appointment.start_time.asc()).limit(10)
        )
        appts = res_a.scalars().all()

        # Compute KPI summary metrics
        assigned_leads_count = len(leads)
        open_opportunities_count = len([d for d in deals if d.status == "Open"])
        todays_tasks_count = len([t for t in tasks if t.status in ["Pending", "In Progress"]])
        upcoming_meetings_count = len([a for a in appts if a.status in ["Scheduled", "Confirmed"]])
        pending_followups_count = len([l for l in leads if l.status in ["New", "Contacted", "Follow-up"]])

        return {
            "member_id": member_id,
            "user_id": user_id,
            "name": f"{member.first_name} {member.last_name}" if member else "Employee",
            "department": member.department if member else "Sales",
            "role": member.role if member else "Employee",
            "assigned_leads_count": assigned_leads_count,
            "open_opportunities_count": open_opportunities_count,
            "todays_tasks_count": todays_tasks_count,
            "upcoming_meetings_count": upcoming_meetings_count,
            "pending_followups_count": pending_followups_count,
            "assigned_funnels_count": len(member.assigned_funnels) if member and member.assigned_funnels else 0,
            "assigned_forms_count": len(member.assigned_forms) if member and member.assigned_forms else 0,
            "recent_leads": [
                {
                    "id": l.id,
                    "first_name": l.first_name,
                    "last_name": l.last_name,
                    "email": l.email,
                    "phone": l.phone,
                    "status": l.status,
                    "priority": getattr(l, "priority", "Normal")
                } for l in leads
            ],
            "recent_deals": [
                {
                    "id": d.id,
                    "title": d.title,
                    "value": d.value,
                    "status": d.status
                } for d in deals
            ],
            "recent_tasks": [
                {
                    "id": t.id,
                    "title": t.title,
                    "status": t.status,
                    "priority": getattr(t, "priority", "Normal")
                } for t in tasks
            ],
            "upcoming_appointments": [
                {
                    "id": a.id,
                    "title": a.title,
                    "start_time": a.start_time.isoformat() if a.start_time else None,
                    "status": a.status
                } for a in appts
            ]
        }

    async def get_employee_leads(self, user_id: str, organization_id: str) -> List[Lead]:
        member = await self.get_team_member_for_user(user_id, organization_id)
        member_id = member.id if member else None

        res = await self.db.execute(
            select(Lead).where(
                Lead.organization_id == organization_id,
                or_(
                    Lead.owner_id == user_id,
                    Lead.owner_id == member_id,
                    Lead.id.in_(member.assigned_contacts if member and member.assigned_contacts else [])
                )
            ).order_by(Lead.updated_at.desc())
        )
        return res.scalars().all()

    async def get_employee_opportunities(self, user_id: str, organization_id: str) -> List[Deal]:
        member = await self.get_team_member_for_user(user_id, organization_id)
        member_id = member.id if member else None

        res = await self.db.execute(
            select(Deal).where(
                Deal.organization_id == organization_id,
                or_(
                    Deal.owner_id == user_id,
                    Deal.owner_id == member_id,
                    Deal.id.in_(member.assigned_deals if member and member.assigned_deals else [])
                )
            ).order_by(Deal.updated_at.desc())
        )
        return res.scalars().all()

    async def get_employee_tasks(self, user_id: str, organization_id: str) -> List[Task]:
        member = await self.get_team_member_for_user(user_id, organization_id)
        member_id = member.id if member else None

        res = await self.db.execute(
            select(Task).where(
                Task.organization_id == organization_id,
                or_(
                    Task.assigned_to_id == member_id,
                    Task.assigned_to_id == user_id,
                    Task.created_by_id == user_id
                )
            ).order_by(Task.created_at.desc())
        )
        return res.scalars().all()

    async def get_employee_funnels(self, user_id: str, organization_id: str) -> List[Funnel]:
        member = await self.get_team_member_for_user(user_id, organization_id)
        if not member or not member.assigned_funnels:
            res_all = await self.db.execute(select(Funnel).where(Funnel.organization_id == organization_id).limit(5))
            return res_all.scalars().all()

        res = await self.db.execute(
            select(Funnel).where(
                Funnel.organization_id == organization_id,
                Funnel.id.in_(member.assigned_funnels)
            )
        )
        return res.scalars().all()

    async def get_employee_forms(self, user_id: str, organization_id: str) -> List[Form]:
        member = await self.get_team_member_for_user(user_id, organization_id)
        if not member or not member.assigned_forms:
            res_all = await self.db.execute(select(Form).where(Form.organization_id == organization_id).limit(5))
            return res_all.scalars().all()

        res = await self.db.execute(
            select(Form).where(
                Form.organization_id == organization_id,
                Form.id.in_(member.assigned_forms)
            )
        )
        return res.scalars().all()
