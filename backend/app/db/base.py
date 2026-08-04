from app.db.base_class import Base
from app.modules.organization.models import Organization
from app.modules.auth.models import User, Role
from app.modules.crm.models import Lead, Contact, Company, Note, Activity, ImportJob, ExportJob
from app.modules.pipeline.models import Pipeline, Stage, Deal
from app.modules.workflow.models import Workflow, WorkflowExecution, ExecutionLog
from app.modules.tasks.models import Task, TaskLead
from app.modules.calendar.models import Appointment
from app.modules.forms.models import Form, FormField, FormSubmission
from app.modules.email.models import EmailConfig, EmailTemplate, EmailCampaign, EmailLog
from app.modules.notifications.models import Notification
from app.modules.funnels.models import Funnel, FunnelStep, FunnelVisit, FunnelComponent, MediaAsset
from app.modules.inbox.models import Message
from app.modules.reviews.models import Review
from app.modules.payments.models import Invoice, Payment, InvoiceItem
from app.modules.integrations.models import Integration
from app.modules.gmail.models import GmailIntegration, GmailSyncLog
from app.modules.team.models import TeamMember, EmployeeActivityLog
from app.modules.campaigns.models import Campaign, CampaignRecipient
from app.modules.ai_coach.models import CoachSession, CoachMessage
from app.modules.ai_lead_handler.models import LeadAIThread, LeadAIMessage
