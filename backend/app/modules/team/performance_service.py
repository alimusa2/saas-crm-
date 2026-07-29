from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import func, distinct, or_, and_, desc
from datetime import datetime, timedelta, timezone
from typing import Dict, Any, List, Optional

from app.modules.team.models import TeamMember, EmployeeActivityLog
from app.modules.crm.models import Lead, Contact
from app.modules.pipeline.models import Deal
from app.modules.tasks.models import Task
from app.modules.calendar.models import Appointment
from app.modules.forms.models import FormSubmission
from app.modules.funnels.models import Funnel
from app.modules.auth.models import User

class PerformanceService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_employee_performance(
        self,
        member_id: str,
        organization_id: str,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None
    ) -> Dict[str, Any]:
        # 1. Fetch team member
        res_m = await self.db.execute(
            select(TeamMember).where(
                TeamMember.id == member_id,
                TeamMember.organization_id == organization_id,
                TeamMember.is_deleted == False
            )
        )
        member = res_m.scalars().first()
        if not member:
            return {}

        user_id = member.user_id

        # Parse date range filters if provided
        s_dt = None
        e_dt = None
        if start_date:
            try:
                s_dt = datetime.fromisoformat(start_date.replace('Z', '+00:00'))
            except Exception:
                pass
        if end_date:
            try:
                e_dt = datetime.fromisoformat(end_date.replace('Z', '+00:00'))
            except Exception:
                pass

        # 2. Lead Metrics (assigned_to_id == member_id or owner_id == user_id)
        lead_conds = [Lead.owner_id == member_id]
        if user_id:
            lead_conds.append(Lead.owner_id == user_id)
        if member.assigned_contacts and len(member.assigned_contacts) > 0:
            lead_conds.append(Lead.id.in_(member.assigned_contacts))

        lead_query = select(Lead).where(
            Lead.organization_id == organization_id,
            or_(*lead_conds)
        )
        res_leads = await self.db.execute(lead_query)
        leads = res_leads.scalars().all()

        total_assigned_leads = len(leads)
        active_leads = len([l for l in leads if l.status not in ["Lost", "Converted", "Unresponsive"]])
        qualified_leads = len([l for l in leads if l.status == "Qualified"])
        new_leads = len([l for l in leads if l.status == "New"])
        contacted_leads = len([l for l in leads if l.status == "Contacted"])
        lost_leads = len([l for l in leads if l.status == "Lost"])
        converted_leads = len([l for l in leads if l.status in ["Won", "Converted"]])

        # 3. Deal / Opportunity Metrics
        deal_conds = [Deal.owner_id == member_id]
        if user_id:
            deal_conds.append(Deal.owner_id == user_id)
        if member.assigned_deals and len(member.assigned_deals) > 0:
            deal_conds.append(Deal.id.in_(member.assigned_deals))

        deal_query = select(Deal).where(
            Deal.organization_id == organization_id,
            or_(*deal_conds)
        )
        res_deals = await self.db.execute(deal_query)
        deals = res_deals.scalars().all()

        total_opportunities = len(deals)
        open_opportunities = len([d for d in deals if d.status == "Open"])
        won_deals = [d for d in deals if d.status == "Won"]
        lost_deals = len([d for d in deals if d.status == "Lost"])
        won_count = len(won_deals)
        
        revenue_generated = sum([d.value or 0.0 for d in won_deals])
        pipeline_value = sum([d.value or 0.0 for d in deals if d.status == "Open"])
        avg_deal_size = (revenue_generated / won_count) if won_count > 0 else 0.0
        conversion_rate = (won_count / total_assigned_leads * 100) if total_assigned_leads > 0 else (
            (won_count / total_opportunities * 100) if total_opportunities > 0 else 0.0
        )

        # 4. Task Metrics
        task_conds = [Task.assigned_to_id == member_id]
        if user_id:
            task_conds.extend([Task.assigned_to_id == user_id, Task.owner_id == user_id, Task.assigned_by_id == user_id])

        task_query = select(Task).where(
            Task.organization_id == organization_id,
            or_(*task_conds)
        )
        res_tasks = await self.db.execute(task_query)
        tasks = res_tasks.scalars().all()

        tasks_completed = len([t for t in tasks if t.status == "Completed"])
        tasks_pending = len([t for t in tasks if t.status in ["Pending", "In Progress"]])
        tasks_overdue = len([t for t in tasks if t.due_date and t.due_date < datetime.now(timezone.utc) and t.status != "Completed"])

        # 5. Appointment / Meeting Metrics
        appt_conds = [Appointment.assigned_to_id == member_id]
        if user_id:
            appt_conds.append(Appointment.organizer_id == user_id)
        if member.assigned_calendars and len(member.assigned_calendars) > 0:
            appt_conds.append(Appointment.id.in_(member.assigned_calendars))

        appt_query = select(Appointment).where(
            Appointment.organization_id == organization_id,
            or_(*appt_conds)
        )
        res_appts = await self.db.execute(appt_query)
        appts = res_appts.scalars().all()

        meetings_scheduled = len(appts)
        meetings_completed = len([a for a in appts if a.status == "Completed"])
        meetings_cancelled = len([a for a in appts if a.status == "Cancelled"])
        meetings_pending = len([a for a in appts if a.status in ["Scheduled", "Confirmed"]])

        # 6. Assigned Funnels & Forms
        assigned_funnels_count = len(member.assigned_funnels or [])
        assigned_forms_count = len(member.assigned_forms or [])

        # 7. Recent Activity Feed
        timeline = []
        try:
            activity_query = select(EmployeeActivityLog).where(
                EmployeeActivityLog.team_member_id == member_id,
                EmployeeActivityLog.organization_id == organization_id
            ).order_by(EmployeeActivityLog.created_at.desc()).limit(50)
            res_act = await self.db.execute(activity_query)
            activity_logs = res_act.scalars().all()

            for log in activity_logs:
                timeline.append({
                    "id": log.id,
                    "action_type": log.action_type,
                    "title": log.title,
                    "details": log.details,
                    "created_at": log.created_at.isoformat() if log.created_at else None
                })
        except Exception:
            pass

        # Comprehensive Performance Scoring System (1.0 to 5.0 Rating)
        # 1. Conversion Component (25% weight)
        conv_score = min(5.0, (conversion_rate / 25.0) * 5.0) if conversion_rate > 0 else 2.5
        
        # 2. Revenue & Won Deals Component (35% weight)
        if won_count == 0:
            deal_score = 2.5 if total_opportunities == 0 else 1.5
        else:
            deal_score = min(5.0, 3.0 + (won_count * 0.4) + min(1.0, revenue_generated / 10000.0))
            
        # 3. Task SLA & Completion Rate (20% weight)
        total_tasks = tasks_completed + tasks_pending + tasks_overdue
        if total_tasks == 0:
            task_score = 3.5
        else:
            completion_ratio = tasks_completed / total_tasks
            task_score = min(5.0, max(1.0, completion_ratio * 5.0 - (tasks_overdue * 0.5)))
            
        # 4. Client Engagement / Meetings Component (20% weight)
        if meetings_scheduled == 0:
            meeting_score = 3.0
        else:
            meeting_score = min(5.0, max(1.0, (meetings_completed / meetings_scheduled) * 5.0))
            
        # Weighted Overall Score
        overall_score = (deal_score * 0.35) + (conv_score * 0.25) + (task_score * 0.20) + (meeting_score * 0.20)
        rating = round(min(5.0, max(1.0, overall_score)), 1)

        return {
            "member_id": member.id,
            "name": f"{member.first_name} {member.last_name}",
            "job_title": member.job_title or "Sales Representative",
            "department": member.department,
            "designation": member.designation or member.job_title or "Team Member",
            "status": member.status,
            "avatar": member.avatar,
            "role": member.role,

            # General Metrics
            "assigned_leads": total_assigned_leads,
            "active_leads": active_leads,
            "qualified_leads": qualified_leads,
            "new_leads": new_leads,
            "contacted_leads": contacted_leads,
            "lost_leads": lost_leads,
            "converted_leads": converted_leads,

            # Opportunity Metrics
            "total_opportunities": total_opportunities,
            "open_opportunities": open_opportunities,
            "won_deals": won_count,
            "lost_deals": lost_deals,
            "revenue_generated": round(revenue_generated, 2),
            "pipeline_value": round(pipeline_value, 2),
            "avg_deal_size": round(avg_deal_size, 2),
            "conversion_rate": round(conversion_rate, 1),

            # Task & Meeting Metrics
            "tasks_completed": tasks_completed,
            "tasks_pending": tasks_pending,
            "tasks_overdue": tasks_overdue,
            "meetings_scheduled": meetings_scheduled,
            "meetings_completed": meetings_completed,
            "meetings_cancelled": meetings_cancelled,
            "meetings_pending": meetings_pending,

            # Asset Assignments
            "funnels_assigned": assigned_funnels_count,
            "forms_assigned": assigned_forms_count,

            # Performance Rating & Breakdown
            "rating": rating,
            "performance_rating": rating,
            "overall_score": rating,
            "score_breakdown": {
                "deal_score": round(deal_score, 1),
                "conversion_score": round(conv_score, 1),
                "task_score": round(task_score, 1),
                "meeting_score": round(meeting_score, 1)
            },

            # Timeline
            "timeline": timeline
        }

    async def get_team_leaderboard(
        self,
        organization_id: str,
        sort_by: str = "revenue"
    ) -> List[Dict[str, Any]]:
        res_m = await self.db.execute(
            select(TeamMember).where(
                TeamMember.organization_id == organization_id,
                TeamMember.is_deleted == False
            )
        )
        members = res_m.scalars().all()

        leaderboard = []
        for m in members:
            perf = await self.get_employee_performance(m.id, organization_id)
            if perf:
                leaderboard.append({
                    "member_id": m.id,
                    "name": perf["name"],
                    "department": perf["department"],
                    "role": perf["role"],
                    "avatar": perf["avatar"],
                    "revenue": perf["revenue_generated"],
                    "won_deals": perf["won_deals"],
                    "conversion_rate": perf["conversion_rate"],
                    "meetings_completed": perf["meetings_completed"],
                    "tasks_completed": perf["tasks_completed"],
                    "performance_rating": perf["performance_rating"]
                })

        # Sort leaderboard
        if sort_by == "deals":
            leaderboard.sort(key=lambda x: x["won_deals"], reverse=True)
        elif sort_by == "conversion":
            leaderboard.sort(key=lambda x: x["conversion_rate"], reverse=True)
        elif sort_by == "meetings":
            leaderboard.sort(key=lambda x: x["meetings_completed"], reverse=True)
        elif sort_by == "tasks":
            leaderboard.sort(key=lambda x: x["tasks_completed"], reverse=True)
        elif sort_by == "rating":
            leaderboard.sort(key=lambda x: x["performance_rating"], reverse=True)
        else: # revenue
            leaderboard.sort(key=lambda x: x["revenue"], reverse=True)

        for rank, item in enumerate(leaderboard, 1):
            item["rank"] = rank

        return leaderboard
