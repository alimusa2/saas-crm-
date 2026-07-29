from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from typing import Optional, List
from datetime import datetime, timezone

from app.modules.calendar.models import Appointment
from app.modules.crm.models import Lead, Activity
from app.modules.team.models import TeamMember
from app.modules.auth.models import User

class MeetingLifecycleEngine:
    @staticmethod
    async def create_in_app_notification(db: AsyncSession, user_id: str, title: str, content: str, appointment_id: str, organization_id: str):
        try:
            from app.modules.notifications.models import Notification
            notif = Notification(
                user_id=user_id,
                type="Reminder",
                title=title,
                content=content,
                is_read=False,
                related_entity_type="Appointment",
                related_entity_id=appointment_id,
                organization_id=organization_id
            )
            db.add(notif)
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning(f"Failed to create meeting notification: {e}")

    @staticmethod
    async def send_lifecycle_email(db: AsyncSession, template_name: str, recipient_email: str, variables: dict, lead_id: Optional[str], organizer_email: str, appointment_id: str, organization_id: str, is_team_email: bool = False):
        from app.modules.email.models import EmailTemplate
        from app.modules.email.services import EmailLogService
        from app.modules.email.schemas import EmailSendRequest
        from jinja2 import Template

        try:
            # 1. Fetch Template
            tmpl_res = await db.execute(
                select(EmailTemplate).where(
                    EmailTemplate.name == template_name,
                    EmailTemplate.organization_id == organization_id
                )
            )
            tmpl = tmpl_res.scalars().first()
            if not tmpl:
                tmpl = EmailTemplate(
                    name=template_name,
                    subject=f"{template_name}: {variables.get('meeting_title', 'Meeting')}",
                    html_content="<p>Hello {{recipient_name}},</p><p>Regarding: {{meeting_title}} on {{meeting_date}} at {{meeting_time}}.</p>",
                    organization_id=organization_id
                )
                db.add(tmpl)
                await db.flush()

            # Inject recipient details into template context copy
            vars_copy = dict(variables)
            if is_team_email:
                vars_copy["recipient_name"] = variables.get("team_member_name", "Team Member")
                vars_copy["recipient_email"] = recipient_email
            else:
                vars_copy["recipient_name"] = variables.get("lead_name", "Valued Client")
                vars_copy["recipient_email"] = recipient_email

            # 2. Render Template
            rendered_subject = Template(tmpl.subject).render(**vars_copy)
            rendered_html = Template(tmpl.html_content).render(**vars_copy)

            # 3. Queue email
            req = EmailSendRequest(
                template_id=tmpl.id,
                recipient_email=recipient_email,
                lead_id=lead_id,
                variables=vars_copy
            )
            email_log = await EmailLogService.send_email(db, req, organization_id)
            
            # 4. Link internal inbox record to appointment_id
            from app.modules.inbox.models import Message
            # Wait, allow a small delay or query immediately
            res_msg = await db.execute(
                select(Message).where(
                    Message.recipient_email == recipient_email,
                    Message.subject == rendered_subject,
                    Message.organization_id == organization_id
                ).order_by(Message.created_at.desc())
            )
            msg = res_msg.scalars().first()
            if msg:
                msg.appointment_id = appointment_id
                if is_team_email:
                    from app.modules.inbox.services import InboxService
                    recipient_user_id = await InboxService.get_team_user_id(db, recipient_email, organization_id)
                    if recipient_user_id:
                        msg.recipient_id = recipient_user_id
                        msg.message_type = "Internal"
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning(f"Failed to queue meeting email / route to inbox: {e}")

    @staticmethod
    async def transition_status(db: AsyncSession, appointment_id: str, new_status: str, organization_id: str, author_id: str, custom_message: Optional[str] = None) -> Optional[Appointment]:
        stmt = select(Appointment).where(
            Appointment.id == appointment_id,
            Appointment.organization_id == organization_id
        )
        res = await db.execute(stmt)
        appointment = res.scalars().first()
        if not appointment:
            return None

        # Fetch organizer user
        organizer_name = "Organizer"
        organizer_email = "system"
        if appointment.organizer_id:
            res_usr = await db.execute(select(User).where(User.id == appointment.organizer_id))
            usr = res_usr.scalars().first()
            if usr:
                organizer_name = f"{usr.first_name or ''} {usr.last_name or ''}".strip() or usr.email
                organizer_email = usr.email

        # Fetch assignee team member
        member = None
        if appointment.assigned_to_id:
            res_tm = await db.execute(
                select(TeamMember).where(
                    TeamMember.id == appointment.assigned_to_id,
                    TeamMember.organization_id == organization_id,
                    TeamMember.is_deleted == False
                )
            )
            member = res_tm.scalars().first()

        # Fetch related lead
        lead = None
        lead_stages = {}
        lead_salespersons = {}
        if appointment.lead_id:
            res_ld = await db.execute(
                select(Lead).where(Lead.id == appointment.lead_id, Lead.organization_id == organization_id)
            )
            lead = res_ld.scalars().first()
            if lead:
                # Stage
                try:
                    from app.modules.pipeline.models import Deal, Stage
                    res_deal = await db.execute(
                        select(Stage.name).join(Deal, Deal.stage_id == Stage.id).where(
                            Deal.lead_id == lead.id,
                            Deal.organization_id == organization_id
                        )
                    )
                    stage_name = res_deal.scalars().first()
                    if stage_name:
                        lead_stages[lead.id] = stage_name
                except Exception:
                    pass
                
                # Salesperson
                if lead.owner_id:
                    res_owner = await db.execute(select(User).where(User.id == lead.owner_id))
                    owner_usr = res_owner.scalars().first()
                    if owner_usr:
                        lead_salespersons[lead.id] = f"{owner_usr.first_name or ''} {owner_usr.last_name or ''}".strip() or owner_usr.email

        # Duration
        duration_min = int((appointment.end_time - appointment.start_time).total_seconds() / 60) if appointment.end_time and appointment.start_time else 0
        
        # Human-readable date and 12-hour AM/PM time formatting
        m_date = ""
        m_time = ""
        if appointment.start_time:
            m_date = appointment.start_time.strftime("%A, %B %d, %Y")
            m_time = appointment.start_time.strftime("%I:%M %p").lstrip("0")

        # Ensure valid Google Meet link exists before building email variables
        if not appointment.location or "new" in appointment.location or not appointment.location.startswith("https://meet.google.com/"):
            try:
                from app.modules.gmail.services import GmailService
                from app.modules.calendar.google_meet_service import generate_google_meet_link
                gmail_svc = GmailService(db)
                token = await gmail_svc.get_valid_access_token(organization_id)
                appointment.location = await generate_google_meet_link(
                    title=appointment.title or "GrowthOS Meeting",
                    start_time=appointment.start_time,
                    end_time=appointment.end_time,
                    attendee_email=(lead.email if lead else appointment.email) or "ahmadaaamir962@gmail.com",
                    access_token=token
                )
                await db.flush()
            except Exception as e:
                print(f"Failed to generate Meet link on transition: {e}")

        variables = {
            "meeting_title": appointment.title,
            "meeting_date": m_date,
            "meeting_time": m_time,
            "meeting_duration": duration_min,
            "meeting_location": appointment.location or "No location specified",
            "meeting_link": appointment.location if (appointment.location and "http" in appointment.location) else "No link",
            "team_member_name": f"{member.first_name} {member.last_name}" if member else "Unassigned",
            "team_member_email": member.email if member else "N/A",
            "lead_name": f"{lead.first_name} {lead.last_name}" if lead else "N/A",
            "lead_email": lead.email if lead else "N/A",
            "lead_phone": lead.phone if lead else "N/A",
            "lead_company": "N/A",
            "pipeline_stage": lead_stages.get(lead.id, "New") if lead else "N/A",
            "lead_score": lead.lead_score if lead else 0,
            "organizer": organizer_name,
            "custom_message": custom_message or ""
        }

        # Company
        if lead and lead.company_id:
            try:
                from app.modules.crm.models import Company
                res_comp = await db.execute(select(Company).where(Company.id == lead.company_id, Company.organization_id == organization_id))
                comp = res_comp.scalars().first()
                if comp:
                    variables["lead_company"] = comp.name
            except Exception:
                pass

        # Update database status
        appointment.status = new_status
        await db.flush()

        # Build timeline activity
        activity_type = f"Meeting {new_status}"
        if new_status in ["Scheduled", "Booked"]:
            activity_type = "Meeting Scheduled"

        # Create activity logs
        if appointment.lead_id:
            act_lead = Activity(
                type=activity_type,
                description=f"Meeting '{appointment.title}' status changed to {new_status}. Organizer: {organizer_name}",
                lead_id=appointment.lead_id,
                author_id=author_id,
                appointment_id=appointment.id,
                timestamp=datetime.now(timezone.utc),
                organization_id=organization_id
            )
            db.add(act_lead)
        else:
            act_sys = Activity(
                type=activity_type,
                description=f"Meeting '{appointment.title}' status changed to {new_status}. Assigned: {variables['team_member_name']}",
                author_id=author_id,
                appointment_id=appointment.id,
                timestamp=datetime.now(timezone.utc),
                organization_id=organization_id
            )
            db.add(act_sys)

        # Trigger logic
        if new_status in ["Scheduled", "Booked"]:
            if member and member.user_id:
                await MeetingLifecycleEngine.create_in_app_notification(
                    db, member.user_id, "New Meeting Assigned",
                    f"You have been assigned to the meeting: {appointment.title} on {variables['meeting_date']}",
                    appointment.id, organization_id
                )
            if member and member.email:
                await MeetingLifecycleEngine.send_lifecycle_email(
                    db, "Meeting Assigned", member.email, variables,
                    appointment.lead_id, organizer_email, appointment.id, organization_id, is_team_email=True
                )
            client_email_raw = (lead.email if lead else appointment.email)
            if client_email_raw:
                client_emails = [e.strip() for e in client_email_raw.replace(';', ',').split(',') if e.strip()]
                for target_email in client_emails:
                    await MeetingLifecycleEngine.send_lifecycle_email(
                        db, "Meeting Scheduled", target_email, variables,
                        appointment.lead_id, organizer_email, appointment.id, organization_id, is_team_email=False
                    )
            event_trigger = "meeting.created"
            legacy_event = "AppointmentCreated"

        elif new_status == "Confirmed":
            if member and member.email:
                await MeetingLifecycleEngine.send_lifecycle_email(
                    db, "Meeting Confirmed", member.email, variables,
                    appointment.lead_id, organizer_email, appointment.id, organization_id, is_team_email=True
                )
            client_email_raw = (lead.email if lead else appointment.email)
            if client_email_raw:
                client_emails = [e.strip() for e in client_email_raw.replace(';', ',').split(',') if e.strip()]
                for target_email in client_emails:
                    res_ld = await db.execute(select(Lead).where(Lead.email == target_email, Lead.organization_id == organization_id))
                    existing_ld = res_ld.scalars().first()
                    target_owner = (member.user_id if member and member.user_id else author_id)
                    if existing_ld and target_owner and existing_ld.owner_id != target_owner:
                        existing_ld.owner_id = target_owner
                        await db.flush()

                    await MeetingLifecycleEngine.send_lifecycle_email(
                        db, "Meeting Confirmed", target_email, variables,
                        existing_ld.id if existing_ld else appointment.lead_id, organizer_email, appointment.id, organization_id, is_team_email=False
                    )
            if member and member.user_id:
                await MeetingLifecycleEngine.create_in_app_notification(
                    db, member.user_id, "Meeting Confirmed",
                    f"Meeting '{appointment.title}' has been confirmed.",
                    appointment.id, organization_id
                )
            event_trigger = "meeting.confirmed"
            legacy_event = "AppointmentConfirmed"

        elif new_status == "Cancelled":
            if member and member.email:
                await MeetingLifecycleEngine.send_lifecycle_email(
                    db, "Meeting Cancelled", member.email, variables,
                    appointment.lead_id, organizer_email, appointment.id, organization_id, is_team_email=True
                )
            client_email_raw = (lead.email if lead else appointment.email)
            if client_email_raw:
                client_emails = [e.strip() for e in client_email_raw.replace(';', ',').split(',') if e.strip()]
                for target_email in client_emails:
                    await MeetingLifecycleEngine.send_lifecycle_email(
                        db, "Meeting Cancelled", target_email, variables,
                        appointment.lead_id, organizer_email, appointment.id, organization_id, is_team_email=False
                    )
            if member and member.user_id:
                await MeetingLifecycleEngine.create_in_app_notification(
                    db, member.user_id, "Meeting Cancelled",
                    f"Meeting '{appointment.title}' has been cancelled.",
                    appointment.id, organization_id
                )
            event_trigger = "meeting.cancelled"
            legacy_event = "AppointmentCancelled"

        elif new_status == "Completed":
            if member and member.email:
                await MeetingLifecycleEngine.send_lifecycle_email(
                    db, "Meeting Completed", member.email, variables,
                    appointment.lead_id, organizer_email, appointment.id, organization_id, is_team_email=True
                )
            client_email_raw = (lead.email if lead else appointment.email)
            if client_email_raw:
                client_emails = [e.strip() for e in client_email_raw.replace(';', ',').split(',') if e.strip()]
                for target_email in client_emails:
                    await MeetingLifecycleEngine.send_lifecycle_email(
                        db, "Meeting Completed", target_email, variables,
                        appointment.lead_id, organizer_email, appointment.id, organization_id, is_team_email=False
                    )
            if member and member.user_id:
                await MeetingLifecycleEngine.create_in_app_notification(
                    db, member.user_id, "Meeting Completed",
                    f"Meeting '{appointment.title}' has been completed.",
                    appointment.id, organization_id
                )
            event_trigger = "meeting.completed"
            legacy_event = "AppointmentCompleted"

        elif new_status == "Rescheduled":
            if member and member.email:
                await MeetingLifecycleEngine.send_lifecycle_email(
                    db, "Meeting Rescheduled", member.email, variables,
                    appointment.lead_id, organizer_email, appointment.id, organization_id, is_team_email=True
                )
            if lead and lead.email:
                await MeetingLifecycleEngine.send_lifecycle_email(
                    db, "Meeting Rescheduled", lead.email, variables,
                    appointment.lead_id, organizer_email, appointment.id, organization_id, is_team_email=False
                )
            if member and member.user_id:
                await MeetingLifecycleEngine.create_in_app_notification(
                    db, member.user_id, "Meeting Rescheduled",
                    f"Meeting '{appointment.title}' has been rescheduled to {variables['meeting_date']}.",
                    appointment.id, organization_id
                )
            event_trigger = "meeting.rescheduled"
            legacy_event = "AppointmentRescheduled"

        elif new_status == "No Show":
            if appointment.organizer_id:
                await MeetingLifecycleEngine.create_in_app_notification(
                    db, appointment.organizer_id, "Meeting No Show",
                    f"Participant did not show up for meeting '{appointment.title}'.",
                    appointment.id, organization_id
                )
            if member and member.email:
                await MeetingLifecycleEngine.send_lifecycle_email(
                    db, "No Show", member.email, variables,
                    appointment.lead_id, organizer_email, appointment.id, organization_id, is_team_email=True
                )
            event_trigger = "meeting.no_show"
            legacy_event = "AppointmentNoShow"

        else:
            event_trigger = f"meeting.{new_status.lower().replace(' ', '_')}"
            legacy_event = f"Appointment{new_status.replace(' ', '')}"

        # Publish automations events
        try:
            from app.core.events import publish, GenericEvent
            evt_data = {
                "appointment_id": appointment.id,
                "title": appointment.title,
                "status": appointment.status,
                "start_time": appointment.start_time.isoformat() if appointment.start_time else None,
                "end_time": appointment.end_time.isoformat() if appointment.end_time else None,
                "lead_id": appointment.lead_id,
                "assigned_to_id": appointment.assigned_to_id,
                "related_entity_type": appointment.related_entity_type,
                "related_entity_id": appointment.related_entity_id,
                "custom_message": custom_message
            }
            await publish(event_trigger, GenericEvent(
                event_name=event_trigger,
                organization_id=organization_id,
                entity_id=appointment.id,
                trigger_name=event_trigger,
                data=evt_data
            ))
            await publish(legacy_event, GenericEvent(
                event_name=legacy_event,
                organization_id=organization_id,
                entity_id=appointment.id,
                trigger_name=legacy_event,
                data=evt_data
            ))
            appt_trigger = f"appointment.{new_status.lower().replace(' ', '_')}"
            if appt_trigger != event_trigger and appt_trigger != legacy_event:
                await publish(appt_trigger, GenericEvent(
                    event_name=appt_trigger,
                    organization_id=organization_id,
                    entity_id=appointment.id,
                    trigger_name=appt_trigger,
                    data=evt_data
                ))
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning(f"Failed to publish event triggers: {e}")

        await db.commit()
        await db.refresh(appointment)
        return appointment
