from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import func, distinct
from fastapi import HTTPException, status
from typing import List, Optional
from datetime import datetime, timezone, timedelta

from app.modules.calendar.models import Appointment
from app.modules.calendar.schemas import AppointmentCreate, AppointmentUpdate
from app.modules.calendar.lifecycle import MeetingLifecycleEngine
from app.modules.crm.models import Lead, Activity, Company
from app.modules.pipeline.models import Deal, Stage
from app.modules.team.models import TeamMember
from app.modules.auth.models import User
from app.modules.email.models import EmailTemplate

class CalendarService:
    def __init__(self, db: AsyncSession):
        self.db = db

    @staticmethod
    async def seed_meeting_templates(db: AsyncSession, organization_id: str):
        templates_to_seed = {
            "Meeting Assigned": {
                "subject": "New Meeting Assigned: {{meeting_title}}",
                "html_content": """
                <p>Hello {{recipient_name}} ({{recipient_email}}),</p>
                <p>You have been assigned to a new meeting:</p>
                <p><strong>Title:</strong> {{meeting_title}}<br/>
                <strong>Date/Time:</strong> {{meeting_date}} {{meeting_time}}<br/>
                <strong>Duration:</strong> {{meeting_duration}} minutes<br/>
                <strong>Location/Link:</strong> {{meeting_location}}<br/>
                <strong>Organizer:</strong> {{organizer}}</p>
                {% if lead_name != 'N/A' %}
                <p><strong>Related Lead Details:</strong><br/>
                Name: {{lead_name}}<br/>
                Email: {{lead_email}}<br/>
                Phone: {{lead_phone}}<br/>
                Company: {{lead_company}}<br/>
                Pipeline Stage: {{pipeline_stage}}<br/>
                Lead Score: {{lead_score}}</p>
                {% endif %}
                {% if custom_message %}
                <p><strong>Special Instructions:</strong><br/>{{custom_message}}</p>
                {% endif %}
                <p>Please prepare accordingly.</p>
                """
            },
            "Meeting Confirmed": {
                "subject": "Meeting Confirmed: {{meeting_title}}",
                "html_content": """
                <p>Hello {{recipient_name}} ({{recipient_email}}),</p>
                <p>The following meeting has been confirmed:</p>
                <p><strong>Title:</strong> {{meeting_title}}<br/>
                <strong>Date/Time:</strong> {{meeting_date}} {{meeting_time}}<br/>
                <strong>Duration:</strong> {{meeting_duration}} minutes<br/>
                <strong>Assigned Salesperson:</strong> {{team_member_name}} ({{team_member_email}})</p>
                <div style="margin: 16px 0; background: #F8FAFC; padding: 14px; border-radius: 8px; border: 1px solid #E2E8F0;">
                  <a href="{{meeting_location}}" target="_blank" style="background-color: #2563EB; color: #ffffff !important; padding: 12px 22px; text-decoration: none !important; border-radius: 8px; font-weight: 700; display: inline-block;"><span style="color: #ffffff !important; font-weight: 700; text-decoration: none !important;">🎥 Join Meeting Room (Waiting Room)</span></a>
                  <p style="font-size: 12px; color: #475569; margin: 8px 0 0 0;">Your sales host ({{team_member_name}}) is the Meeting Host (Admin) and will admit you to the video call when the session starts.</p>
                  <p style="font-size: 11px; color: #94A3B8; margin: 4px 0 0 0;">Direct URL: <a href="{{meeting_location}}" style="color: #4F46E5;">{{meeting_location}}</a></p>
                </div>
                {% if custom_message %}
                <p><strong>Additional Notes:</strong><br/>{{custom_message}}</p>
                {% endif %}
                """
            },
            "Meeting Cancelled": {
                "subject": "Meeting Cancelled: {{meeting_title}}",
                "html_content": """
                <p>Hello {{recipient_name}} ({{recipient_email}}),</p>
                <p>Please note that the meeting <strong>{{meeting_title}}</strong> scheduled for {{meeting_date}} has been cancelled.</p>
                <p><strong>Assigned Salesperson:</strong> {{team_member_name}} ({{team_member_email}})</p>
                {% if custom_message %}
                <p><strong>Reason for cancellation:</strong><br/>{{custom_message}}</p>
                {% endif %}
                """
            },
            "Meeting Completed": {
                "subject": "Meeting Completed: {{meeting_title}}",
                "html_content": """
                <p>Hello {{recipient_name}} ({{recipient_email}}),</p>
                <p>The meeting <strong>{{meeting_title}}</strong> has been marked as completed.</p>
                <p><strong>Assigned Salesperson:</strong> {{team_member_name}} ({{team_member_email}})</p>
                {% if custom_message %}
                <p><strong>Follow-up Notes / Action Items:</strong><br/>{{custom_message}}</p>
                {% endif %}
                """
            },
            "Meeting Rescheduled": {
                "subject": "Meeting Rescheduled: {{meeting_title}}",
                "html_content": """
                <p>Hello {{recipient_name}} ({{recipient_email}}),</p>
                <p>The meeting <strong>{{meeting_title}}</strong> has been rescheduled.</p>
                <p><strong>New Date/Time:</strong> {{meeting_date}} {{meeting_time}}<br/>
                <strong>New Location/Link:</strong> {{meeting_location}}<br/>
                <strong>Assigned Salesperson:</strong> {{team_member_name}} ({{team_member_email}})</p>
                {% if custom_message %}
                <p><strong>Rescheduling Reason / Context:</strong><br/>{{custom_message}}</p>
                {% endif %}
                """
            },
            "Meeting Reminder": {
                "subject": "Reminder: Upcoming Meeting {{meeting_title}}",
                "html_content": """
                <p>Hello {{recipient_name}} ({{recipient_email}}),</p>
                <p>This is a reminder for your upcoming meeting <strong>{{meeting_title}}</strong> scheduled for {{meeting_date}} {{meeting_time}}.</p>
                <p><strong>Assigned Salesperson:</strong> {{team_member_name}} ({{team_member_email}})</p>
                {% if custom_message %}
                <p><strong>Preparation Instructions:</strong><br/>{{custom_message}}</p>
                {% endif %}
                """
            },
            "No Show": {
                "subject": "Participant No Show: {{meeting_title}}",
                "html_content": """
                <p>Hello {{recipient_name}} ({{recipient_email}}),</p>
                <p>The participant for the meeting <strong>{{meeting_title}}</strong> did not show up.</p>
                <p><strong>Assigned Salesperson:</strong> {{team_member_name}} ({{team_member_email}})</p>
                {% if custom_message %}
                <p><strong>Follow-up Notes:</strong><br/>{{custom_message}}</p>
                {% endif %}
                """
            }
        }

        for name, data in templates_to_seed.items():
            tmpl_check = await db.execute(
                select(EmailTemplate).where(
                    EmailTemplate.name == name,
                    EmailTemplate.organization_id == organization_id
                )
            )
            tmpl = tmpl_check.scalars().first()
            if not tmpl:
                tmpl = EmailTemplate(
                    name=name,
                    subject=data["subject"],
                    html_content=data["html_content"],
                    organization_id=organization_id
                )
                db.add(tmpl)
            else:
                tmpl.html_content = data["html_content"]
                tmpl.subject = data["subject"]
        await db.commit()
        await db.commit()

    async def get_appointments(self, organization_id: str, user_id: Optional[str] = None, current_user: Optional[dict] = None) -> List[Appointment]:
        # Seed templates silently
        try:
            await self.seed_meeting_templates(self.db, organization_id)
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning(f"Failed to seed templates: {e}")

        try:
            await self.check_appointment_reminders(organization_id)
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning(f"Failed checking reminders: {e}")

        stmt = select(Appointment).where(Appointment.organization_id == organization_id)

        # Non-admin Employee Data Isolation Filter
        if current_user and not current_user.get("is_superuser") and current_user.get("role") != "Admin":
            from app.core.permissions import get_employee_permissions_context
            from sqlalchemy import or_
            perm_ctx = await get_employee_permissions_context(self.db, current_user)
            if not perm_ctx["is_admin"]:
                u_id = perm_ctx["user_id"]
                m_id = perm_ctx["member_id"]
                assigned = perm_ctx["assigned_calendars"]
                
                conds = []
                if u_id: conds.append(Appointment.organizer_id == u_id)
                if m_id: conds.append(Appointment.assigned_to_id == m_id)
                if assigned and len(assigned) > 0: conds.append(Appointment.id.in_(assigned))
                
                if conds:
                    stmt = stmt.where(or_(*conds))

        result = await self.db.execute(stmt)
        appts = list(result.scalars().all())

        if user_id:
            from datetime import timedelta
            # Fetch assigned tasks to display on calendar virtually
            tm_res = await self.db.execute(
                select(TeamMember).where(
                    TeamMember.user_id == user_id,
                    TeamMember.organization_id == organization_id,
                    TeamMember.is_deleted == False
                )
            )
            tm = tm_res.scalars().first()
            if tm:
                from app.modules.tasks.models import Task
                t_res = await self.db.execute(
                    select(Task).where(
                        Task.organization_id == organization_id,
                        Task.assigned_to_id == tm.id,
                        Task.due_date != None
                    )
                )
                tasks = t_res.scalars().all()
                for task in tasks:
                    virtual_appt = Appointment(
                        id=task.id,
                        title=f"Task: {task.title}",
                        description=task.description or "",
                        start_time=task.due_date,
                        end_time=task.due_date + timedelta(minutes=30),
                        status="Completed" if task.is_completed else "Booked",
                        location="CRM Tasks",
                        lead_id=task.lead_id,
                        organizer_id=task.owner_id or "system",
                        organization_id=organization_id,
                        created_at=task.created_at,
                        updated_at=task.updated_at
                    )
                    appts.append(virtual_appt)
        return appts

    async def create_appointment(self, appt_in: AppointmentCreate, organization_id: str, organizer_id: str) -> Appointment:
        # Validate times
        if not appt_in.start_time or not appt_in.end_time or appt_in.start_time >= appt_in.end_time:
            raise HTTPException(status_code=400, detail="Invalid appointment times")
        
        effective_assigned_to_id = appt_in.assigned_to_id
        if not effective_assigned_to_id and appt_in.related_entity_type and appt_in.related_entity_type.lower() in ["team_member", "member", "user"]:
            effective_assigned_to_id = appt_in.related_entity_id

        member = None
        # Validate Meeting With (Team Member) - OPTIONAL
        if effective_assigned_to_id:
            tm_check = await self.db.execute(
                select(TeamMember).where(
                    TeamMember.id == effective_assigned_to_id,
                    TeamMember.organization_id == organization_id,
                    TeamMember.is_deleted == False
                )
            )
            member = tm_check.scalars().first()
            if not member and appt_in.assigned_to_id:
                raise HTTPException(status_code=404, detail="Assigned team member not found.")
            if member and member.status != "Active":
                raise HTTPException(status_code=400, detail="Cannot assign meeting to inactive team member.")

        # Validate Related Lead - OPTIONAL
        effective_lead_id = appt_in.lead_id
        if not effective_lead_id and appt_in.related_entity_type and appt_in.related_entity_type.lower() == "lead":
            effective_lead_id = appt_in.related_entity_id

        lead = None
        if effective_lead_id:
            lead_check = await self.db.execute(
                select(Lead).where(
                    Lead.id == effective_lead_id,
                    Lead.organization_id == organization_id
                )
            )
            lead = lead_check.scalars().first()
            if not lead and (appt_in.lead_id or appt_in.related_entity_id):
                raise HTTPException(status_code=400, detail="Related lead does not belong to this organization or does not exist.")

        # Duplicate check to prevent double bookings
        dup_stmt = select(Appointment).where(
            Appointment.organization_id == organization_id,
            Appointment.assigned_to_id == appt_in.assigned_to_id,
            Appointment.start_time == appt_in.start_time,
            Appointment.end_time == appt_in.end_time
        )
        dup_res = await self.db.execute(dup_stmt)
        if dup_res.scalars().first():
            raise HTTPException(status_code=400, detail="An identical appointment with this participant already exists.")

        data = appt_in.model_dump()
        
        # Populate details for backward compatibility
        disp_name = data.get("display_name") or appt_in.title
        email_val = data.get("email")
        phone_val = data.get("phone")
        rel_type = appt_in.related_entity_type
        rel_id = appt_in.related_entity_id
        
        if member:
            disp_name = f"{member.first_name} {member.last_name}"
            email_val = member.email
            phone_val = member.phone
            rel_type = "team_member"
            rel_id = member.id
            
        if lead:
            disp_name = f"{lead.first_name} {lead.last_name}"
            email_val = lead.email
            phone_val = lead.phone
            rel_type = "lead"
            rel_id = lead.id

        data["assigned_to_id"] = member.id if member else appt_in.assigned_to_id
        data["lead_id"] = lead.id if lead else appt_in.lead_id
        data["display_name"] = disp_name
        data["email"] = email_val
        data["phone"] = phone_val
        data["related_entity_type"] = rel_type
        data["related_entity_id"] = rel_id

        if not data.get("location"):
            from app.modules.gmail.services import GmailService
            gmail_svc = GmailService(self.db)
            access_token = await gmail_svc.get_valid_access_token(organization_id)

            from app.modules.calendar.google_meet_service import generate_google_meet_link
            data["location"] = await generate_google_meet_link(
                title=data.get("title", "GrowthOS Meeting"),
                start_time=data.get("start_time", datetime.now(timezone.utc)),
                end_time=data.get("end_time", datetime.now(timezone.utc) + timedelta(minutes=30)),
                attendee_email=email_val or "client@example.com",
                access_token=access_token
            )

        data.update({
            "related_entity_type": rel_type,
            "related_entity_id": rel_id,
            "display_name": disp_name,
            "email": email_val,
            "phone": phone_val,
            "status": "Scheduled"
        })

        appointment = Appointment(**data, organization_id=organization_id, organizer_id=organizer_id)
        self.db.add(appointment)
        await self.db.flush()

        # Delegate workflow triggers to central MeetingLifecycleEngine
        await MeetingLifecycleEngine.transition_status(
            self.db, appointment.id, "Scheduled", organization_id, organizer_id
        )

        return appointment

    async def update_appointment(self, appt_id: str, appt_in: AppointmentUpdate, organization_id: str) -> Optional[Appointment]:
        result = await self.db.execute(
            select(Appointment).where(Appointment.id == appt_id, Appointment.organization_id == organization_id)
        )
        appointment = result.scalars().first()
        if not appointment:
            return None

        # Validate times if updated
        start_time = appt_in.start_time if appt_in.start_time is not None else appointment.start_time
        end_time = appt_in.end_time if appt_in.end_time is not None else appointment.end_time
        if start_time and end_time and start_time >= end_time:
            raise HTTPException(status_code=400, detail="Invalid appointment times")

        # Validate Team Member if updated
        if appt_in.assigned_to_id:
            tm_check = await self.db.execute(
                select(TeamMember).where(
                    TeamMember.id == appt_in.assigned_to_id,
                    TeamMember.organization_id == organization_id,
                    TeamMember.is_deleted == False
                )
            )
            member = tm_check.scalars().first()
            if not member:
                raise HTTPException(status_code=404, detail="Assigned team member not found.")
            if member.status != "Active":
                raise HTTPException(status_code=400, detail="Cannot assign task to inactive team member.")

        # Validate Lead if updated
        if appt_in.lead_id:
            lead_check = await self.db.execute(
                select(Lead).where(
                    Lead.id == appt_in.lead_id,
                    Lead.organization_id == organization_id
                )
            )
            if not lead_check.scalars().first():
                raise HTTPException(status_code=400, detail="Lead does not belong to this organization.")

        # Track modifications
        old_status = appointment.status
        is_rescheduled = False
        if (appt_in.start_time is not None and appt_in.start_time != appointment.start_time) or \
           (appt_in.end_time is not None and appt_in.end_time != appointment.end_time):
            is_rescheduled = True

        update_data = appt_in.model_dump(exclude_unset=True)
        custom_message = update_data.pop("custom_message", None)
        
        # Apply edits
        for key, value in update_data.items():
            setattr(appointment, key, value)
        await self.db.flush()

        # Handle reschedule trigger automatically
        if is_rescheduled and appointment.status not in ["Cancelled", "Completed", "No Show"]:
            await MeetingLifecycleEngine.transition_status(
                self.db, appointment.id, "Rescheduled", organization_id, appointment.organizer_id, custom_message
            )
        # Handle manual status updates
        elif appt_in.status is not None and appt_in.status != old_status:
            await MeetingLifecycleEngine.transition_status(
                self.db, appointment.id, appt_in.status, organization_id, appointment.organizer_id, custom_message
            )
        else:
            await self.db.commit()

        await self.db.refresh(appointment)
        return appointment

    async def get_meeting_analytics(self, organization_id: str) -> dict:
        # 1. Meetings by Department
        dept_query = await self.db.execute(
            select(TeamMember.department, func.count(Appointment.id))
            .join(TeamMember, Appointment.assigned_to_id == TeamMember.id)
            .where(Appointment.organization_id == organization_id)
            .group_by(TeamMember.department)
        )
        dept_stats = {dept or "Unknown": count for dept, count in dept_query.all()}

        # 2. Meetings by Team Member
        member_query = await self.db.execute(
            select(TeamMember.first_name, TeamMember.last_name, func.count(Appointment.id))
            .join(TeamMember, Appointment.assigned_to_id == TeamMember.id)
            .where(Appointment.organization_id == organization_id)
            .group_by(TeamMember.id)
        )
        member_stats = {f"{first or ''} {last or ''}".strip(): count for first, last, count in member_query.all()}

        # 3. Meetings by Status
        status_query = await self.db.execute(
            select(Appointment.status, func.count(Appointment.id))
            .where(Appointment.organization_id == organization_id)
            .group_by(Appointment.status)
        )
        status_stats = {status: count for status, count in status_query.all()}

        # 4. Meetings by Lead Source
        source_query = await self.db.execute(
            select(Lead.lead_source, func.count(Appointment.id))
            .join(Lead, Appointment.lead_id == Lead.id)
            .where(Appointment.organization_id == organization_id)
            .group_by(Lead.lead_source)
        )
        source_stats = {source or "Unknown": count for source, count in source_query.all()}

        # 5. Meetings by Pipeline Stage
        stage_stats = {}
        try:
            stage_query = await self.db.execute(
                select(Stage.name, func.count(Appointment.id))
                .join(Lead, Appointment.lead_id == Lead.id)
                .join(Deal, Lead.id == Deal.lead_id)
                .join(Stage, Deal.stage_id == Stage.id)
                .where(Appointment.organization_id == organization_id)
                .group_by(Stage.name)
            )
            stage_stats = {stage: count for stage, count in stage_query.all()}
        except Exception:
            pass

        # 6. Specific counts
        completed_count = status_stats.get("Completed", 0)
        cancelled_count = status_stats.get("Cancelled", 0)
        no_show_count = status_stats.get("No Show", 0)

        # 7. Average completion rate
        total_meetings_res = await self.db.execute(
            select(func.count(Appointment.id)).where(
                Appointment.organization_id == organization_id,
                Appointment.status != "Cancelled"
            )
        )
        total_valid = total_meetings_res.scalar() or 0
        completion_rate = (completed_count / total_valid) if total_valid > 0 else 0.0

        return {
            "by_department": dept_stats,
            "by_team_member": member_stats,
            "by_status": status_stats,
            "by_lead_source": source_stats,
            "by_pipeline_stage": stage_stats,
            "completed_meetings": completed_count,
            "cancelled_meetings": cancelled_count,
            "no_shows": no_show_count,
            "average_completion_rate": completion_rate
        }

    async def check_appointment_reminders(self, organization_id: str):
        now = datetime.now(timezone.utc)
        target_time = now + timedelta(hours=24)
        
        stmt = select(Appointment).where(
            Appointment.organization_id == organization_id,
            Appointment.status == "Scheduled",
            Appointment.start_time >= now,
            Appointment.start_time <= target_time
        )
        result = await self.db.execute(stmt)
        reminders = result.scalars().all()
        
        for appt in reminders:
            # Check if reminder already sent
            act_stmt = select(Activity).where(
                Activity.type == "Appointment Reminder Sent",
                Activity.description.like(f"%Appt ID: {appt.id}%"),
                Activity.organization_id == organization_id
            )
            act_res = await self.db.execute(act_stmt)
            if not act_res.scalars().first():
                # Publish event
                try:
                    from app.core.events import publish, GenericEvent
                    await publish("appointment.reminder_time", GenericEvent(
                        event_name="appointment.reminder_time",
                        organization_id=organization_id,
                        entity_id=appt.id,
                        trigger_name="appointment.reminder_time",
                        data={
                            "appointment_id": appt.id,
                            "title": appt.title,
                            "start_time": appt.start_time.isoformat() if appt.start_time else None,
                            "lead_id": appt.lead_id
                        }
                    ))
                except Exception:
                    pass

                # Build template variables for email
                try:
                    # Fetch detailed entities for variables
                    member = None
                    if appt.assigned_to_id:
                        res_tm = await self.db.execute(
                            select(TeamMember).where(TeamMember.id == appt.assigned_to_id)
                        )
                        member = res_tm.scalars().first()
                    
                    lead = None
                    if appt.lead_id:
                        res_ld = await self.db.execute(select(Lead).where(Lead.id == appt.lead_id))
                        lead = res_ld.scalars().first()
                    
                    organizer_name = "Organizer"
                    organizer_email = "system"
                    if appt.organizer_id:
                        res_usr = await self.db.execute(select(User).where(User.id == appt.organizer_id))
                        usr = res_usr.scalars().first()
                        if usr:
                            organizer_name = f"{usr.first_name or ''} {usr.last_name or ''}".strip() or usr.email
                            organizer_email = usr.email

                    duration_min = int((appt.end_time - appt.start_time).total_seconds() / 60) if appt.end_time and appt.start_time else 0
                    variables = {
                        "meeting_title": appt.title,
                        "meeting_date": appt.start_time.strftime("%Y-%m-%d") if appt.start_time else "",
                        "meeting_time": appt.start_time.strftime("%H:%M UTC") if appt.start_time else "",
                        "meeting_duration": duration_min,
                        "meeting_location": appt.location or "No location specified",
                        "meeting_link": appt.location if (appt.location and "http" in appt.location) else "No link",
                        "team_member_name": f"{member.first_name} {member.last_name}" if member else "Unassigned",
                        "lead_name": f"{lead.first_name} {lead.last_name}" if lead else "N/A",
                        "lead_email": lead.email if lead else "N/A",
                        "lead_phone": lead.phone if lead else "N/A",
                        "lead_company": "N/A",
                        "pipeline_stage": "New",
                        "lead_score": lead.lead_score if lead else 0,
                        "organizer": organizer_name,
                        "custom_message": ""
                    }
                    
                    if lead and lead.email:
                        await MeetingLifecycleEngine.send_lifecycle_email(
                            self.db, "Meeting Reminder", lead.email, variables,
                            appt.lead_id, organizer_email, appt.id, organization_id, is_team_email=False
                        )
                except Exception:
                    pass

                # Log Activity
                act = Activity(
                    type="Appointment Reminder Sent",
                    description=f"Reminder sent for appointment '{appt.title}'. Appt ID: {appt.id}",
                    lead_id=appt.lead_id,
                    author_id="system",
                    appointment_id=appt.id,
                    timestamp=datetime.now(timezone.utc),
                    organization_id=organization_id
                )
                self.db.add(act)
                await self.db.commit()

    async def delete_appointment(self, appt_id: str, organization_id: str) -> bool:
        result = await self.db.execute(
            select(Appointment).where(Appointment.id == appt_id, Appointment.organization_id == organization_id)
        )
        appointment = result.scalars().first()
        if not appointment:
            return False
        
        await self.db.delete(appointment)
        await self.db.commit()
        return True
