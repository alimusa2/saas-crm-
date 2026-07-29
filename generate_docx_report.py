import docx
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml import OxmlElement, parse_xml
from docx.oxml.ns import nsdecls, qn
import datetime
import os

def set_cell_background(cell, fill_hex):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = parse_xml(f'<w:shd {nsdecls("w")} w:fill="{fill_hex}"/>')
    tcPr.append(shd)

def set_cell_margins(cell, top=100, bottom=100, left=150, right=150):
    tcPr = cell._tc.get_or_add_tcPr()
    tcMar = OxmlElement('w:tcMar')
    for m, val in [('top', top), ('bottom', bottom), ('left', left), ('right', right)]:
        node = OxmlElement(f'w:{m}')
        node.set(qn('w:w'), str(val))
        node.set(qn('w:type'), 'dxa')
        tcMar.append(node)
    tcPr.append(tcMar)

def add_callout(doc, text, title="KEY STRATEGIC TAKEAWAY", border_color="4F46E5", fill_color="F0F4FF"):
    tbl = doc.add_table(rows=1, cols=1)
    tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
    tbl.autofit = False
    
    cell = tbl.cell(0, 0)
    cell.width = Inches(6.5)
    set_cell_background(cell, fill_color)
    set_cell_margins(cell, top=140, bottom=140, left=200, right=200)
    
    # Left border only
    tcPr = cell._tc.get_or_add_tcPr()
    tcBorders = parse_xml(
        f'<w:tcBorders {nsdecls("w")}>\n'
        f'  <w:top w:val="none"/>\n'
        f'  <w:left w:val="single" w:sz="36" w:space="0" w:color="{border_color}"/>\n'
        f'  <w:bottom w:val="none"/>\n'
        f'  <w:right w:val="none"/>\n'
        f'</w:tcBorders>'
    )
    tcPr.append(tcBorders)
    
    p = cell.paragraphs[0]
    p.paragraph_format.space_before = Pt(2)
    p.paragraph_format.space_after = Pt(4)
    run_title = p.add_run(f"💡 {title}\n")
    run_title.bold = True
    run_title.font.name = 'Calibri'
    run_title.font.size = Pt(11)
    run_title.font.color.rgb = RGBColor(79, 70, 229)
    
    run_text = p.add_run(text)
    run_text.font.name = 'Calibri'
    run_text.font.size = Pt(10.5)
    run_text.font.color.rgb = RGBColor(30, 41, 59)
    
    p_after = doc.add_paragraph()
    p_after.paragraph_format.space_before = Pt(0)
    p_after.paragraph_format.space_after = Pt(6)

def style_heading_1(p):
    p.paragraph_format.space_before = Pt(18)
    p.paragraph_format.space_after = Pt(8)
    p.paragraph_format.keep_with_next = True
    for r in p.runs:
        r.font.name = 'Calibri'
        r.font.size = Pt(18)
        r.bold = True
        r.font.color.rgb = RGBColor(30, 41, 59) # Dark Slate

def style_heading_2(p):
    p.paragraph_format.space_before = Pt(14)
    p.paragraph_format.space_after = Pt(6)
    p.paragraph_format.keep_with_next = True
    for r in p.runs:
        r.font.name = 'Calibri'
        r.font.size = Pt(14)
        r.bold = True
        r.font.color.rgb = RGBColor(79, 70, 229) # Indigo

def style_heading_3(p):
    p.paragraph_format.space_before = Pt(10)
    p.paragraph_format.space_after = Pt(4)
    p.paragraph_format.keep_with_next = True
    for r in p.runs:
        r.font.name = 'Calibri'
        r.font.size = Pt(12)
        r.bold = True
        r.font.color.rgb = RGBColor(15, 118, 110) # Teal

def build_docx_report():
    doc = Document()
    
    # Page setup - 1 inch margins
    sections = doc.sections
    for section in sections:
        section.top_margin = Inches(1)
        section.bottom_margin = Inches(1)
        section.left_margin = Inches(1)
        section.right_margin = Inches(1)
        
    # Standard normal style setup
    style_normal = doc.styles['Normal']
    font_normal = style_normal.font
    font_normal.name = 'Calibri'
    font_normal.size = Pt(11)
    font_normal.color.rgb = RGBColor(51, 65, 85) # Slate #334155
    
    # COVER PAGE / TITLE SECTION
    p_title = doc.add_paragraph()
    p_title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p_title.paragraph_format.space_before = Pt(36)
    p_title.paragraph_format.space_after = Pt(6)
    r_title = p_title.add_run("GROWTHOS CRM & SALES PLATFORM")
    r_title.font.name = 'Calibri'
    r_title.font.size = Pt(28)
    r_title.bold = True
    r_title.font.color.rgb = RGBColor(30, 41, 59)
    
    p_sub = doc.add_paragraph()
    p_sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p_sub.paragraph_format.space_after = Pt(24)
    r_sub = p_sub.add_run("Comprehensive Technical Audit, Architecture Breakdown, Commercialization Strategy (SaaS vs. Product), Complete Workflows & Sales Pitching Blueprint")
    r_sub.font.name = 'Calibri'
    r_sub.font.size = Pt(13)
    r_sub.font.color.rgb = RGBColor(79, 70, 229)
    
    # Divider line
    p_div = doc.add_paragraph()
    p_div.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p_div.paragraph_format.space_after = Pt(24)
    r_div = p_div.add_run("―" * 40)
    r_div.font.color.rgb = RGBColor(203, 213, 225)
    
    # Meta table
    tbl_meta = doc.add_table(rows=4, cols=2)
    tbl_meta.alignment = WD_TABLE_ALIGNMENT.CENTER
    meta_data = [
        ("Document Type:", "Executive Business & Technical Blueprint Report"),
        ("Platform Name:", "GrowthOS (AI-Powered All-in-One CRM & Sales Engine)"),
        ("Date of Report:", datetime.datetime.now().strftime("%B %d, %Y")),
        ("Status & Version:", "Production-Ready Full-Stack System (v1.0)")
    ]
    for idx, (k, v) in enumerate(meta_data):
        cell_k = tbl_meta.cell(idx, 0)
        cell_v = tbl_meta.cell(idx, 1)
        cell_k.width = Inches(2.2)
        cell_v.width = Inches(4.3)
        
        pk = cell_k.paragraphs[0]
        pk.paragraph_format.space_after = Pt(4)
        rk = pk.add_run(k)
        rk.bold = True
        rk.font.color.rgb = RGBColor(30, 41, 59)
        
        pv = cell_v.paragraphs[0]
        pv.paragraph_format.space_after = Pt(4)
        rv = pv.add_run(v)
        rv.font.color.rgb = RGBColor(71, 85, 105)
        
        set_cell_background(cell_k, "F8FAFC")
        set_cell_background(cell_v, "F8FAFC")
        set_cell_margins(cell_k, top=80, bottom=80, left=100, right=100)
        set_cell_margins(cell_v, top=80, bottom=80, left=100, right=100)
        
    doc.add_page_break()
    
    # EXECUTIVE SUMMARY
    h1 = doc.add_paragraph("Executive Summary")
    style_heading_1(h1)
    
    p = doc.add_paragraph(
        "GrowthOS is an enterprise-grade, high-performance CRM, marketing funnel, sales pipeline, "
        "and workflow automation platform built with modern asynchronous technology (FastAPI, SQLAlchemy 2.0 Async, "
        "React 19, TypeScript, Celery, and Redis). Designed as a comprehensive growth engine, GrowthOS merges lead management, "
        "visual deal pipelines, dynamic form builders, multi-channel drip campaigns, unified inbox communications, calendar scheduling, "
        "automated lead scoring, and automated billing into a single unified workspace."
    )
    p.paragraph_format.space_after = Pt(10)
    
    p2 = doc.add_paragraph(
        "The objective of this comprehensive report is to provide an in-depth audit of the platform's architectural foundation, "
        "evaluate commercialization pathways (SaaS vs. White-Label Product), delineate end-to-end data workflows, pinpoint target audience "
        "personas, and arm sales teams with actionable pitching blueprints and objection-handling strategies."
    )
    p2.paragraph_format.space_after = Pt(14)
    
    add_callout(
        doc,
        "GrowthOS occupies a high-value market sweet spot combining key capabilities of GoHighLevel (funnel & agency automation), "
        "HubSpot (lead management & automated scoring), and Zapier/Make (event-driven workflow engine) into a lightweight, "
        "modern codebase capable of scaling to thousands of multi-tenant organizations.",
        title="EXECUTIVE POSITIONING HIGHLIGHT"
    )

    # SECTION 1: ARCHITECTURE & TECHNICAL STACK
    h1 = doc.add_paragraph("1. Technical Architecture & Stack Deep-Dive")
    style_heading_1(h1)
    
    p = doc.add_paragraph(
        "GrowthOS utilizes a decoupled full-stack architecture built for high throughput, sub-100ms API responses, "
        "and seamless multi-tenant isolation. The technology stack choices prioritize reliability, async execution, "
        "type safety, and low operational overhead."
    )
    p.paragraph_format.space_after = Pt(10)
    
    h2 = doc.add_paragraph("1.1 Backend Architecture (FastAPI & Async SQL)")
    style_heading_2(h2)
    
    p_tech = doc.add_paragraph()
    p_tech.paragraph_format.space_after = Pt(8)
    p_tech.add_run("• Core Framework: ").bold = True
    p_tech.add_run("FastAPI (Python 3.12+) providing high-speed OpenAPI documentation and async non-blocking execution.\n")
    p_tech.add_run("• ORM & Database Engine: ").bold = True
    p_tech.add_run("SQLAlchemy 2.0 Async ORM with Alembic schema migrations. Supports SQLite for zero-config local deployment, PostgreSQL for high-scale enterprise production, and Supabase cloud storage integration.\n")
    p_tech.add_run("• Task Queue & Background Scheduling: ").bold = True
    p_tech.add_run("Celery powered by Redis broker for scheduled marketing drip campaigns, background job processing, and async email dispatch.\n")
    p_tech.add_run("• Event Bus Pattern: ").bold = True
    p_tech.add_run("Decoupled internal publish-subscribe event bus (`app.core.events`) that connects system actions across modules without circular dependencies.\n")
    p_tech.add_run("• Security & Auth: ").bold = True
    p_tech.add_run("JWT bearer tokens, Passlib bcrypt password hashing, Cryptography library token encryption, Google OAuth 2.0 integration, and Organization ID tenant scoping.")

    h2 = doc.add_paragraph("1.2 Frontend Architecture (React 19 & TypeScript)")
    style_heading_2(h2)
    
    p_front = doc.add_paragraph()
    p_front.paragraph_format.space_after = Pt(8)
    p_front.add_run("• Core UI Framework: ").bold = True
    p_front.add_run("React 19 with full TypeScript typing for robust developer productivity and component reusability.\n")
    p_front.add_run("• Build Tooling: ").bold = True
    p_front.add_run("Vite 8 providing instant HMR (Hot Module Replacement) and optimized production bundles.\n")
    p_front.add_run("• UI & Icons: ").bold = True
    p_front.add_run("Lucide React iconography, custom modular CSS (CSS Modules) for localized scoped styling without utility bloat, and responsive layout primitives.\n")
    p_front.add_run("• Data Visualization: ").bold = True
    p_front.add_run("Recharts library for rendering dynamic pipeline funnels, lead conversion trends, revenue distribution, and activity charts.")

    # Table: Tech Stack Summary
    h3 = doc.add_paragraph("Table 1.1: Stack Components Summary")
    style_heading_3(h3)
    
    tbl_stack = doc.add_table(rows=6, cols=3)
    tbl_stack.alignment = WD_TABLE_ALIGNMENT.CENTER
    tbl_stack.autofit = False
    
    headers = ["Layer", "Technologies Used", "Primary Responsibility"]
    hdr_row = tbl_stack.rows[0]
    for i, h in enumerate(headers):
        cell = hdr_row.cells[i]
        set_cell_background(cell, "1E293B")
        set_cell_margins(cell, top=100, bottom=100, left=120, right=120)
        p = cell.paragraphs[0]
        r = p.add_run(h)
        r.bold = True
        r.font.color.rgb = RGBColor(255, 255, 255)
        
    stack_data = [
        ("Frontend UI", "React 19, TypeScript, Vite, CSS Modules", "Single-Page Application dashboard, interactive builders, forms & public funnel renderers."),
        ("API & Gateway", "FastAPI, Pydantic v2, Python 3.12+", "RESTful endpoints, JWT authorization, data validation, CORS, OpenAPI specification."),
        ("Data Persistence", "SQLAlchemy 2.0 Async, Alembic, PostgreSQL / SQLite", "Relational persistence, multi-tenant organization scoping, schema migrations."),
        ("Async & Events", "Internal Event Bus, Celery, Redis", "Real-time trigger execution, campaign queueing, background polling loops."),
        ("Third-Party APIs", "Stripe API, Google Gmail API, Twilio, SendGrid", "External payment processing, email sync, SMS messaging, webhook integrations.")
    ]
    
    col_widths = [Inches(1.5), Inches(2.2), Inches(2.8)]
    for r_idx, row_vals in enumerate(stack_data):
        row = tbl_stack.rows[r_idx + 1]
        bg_color = "F8FAFC" if r_idx % 2 == 0 else "FFFFFF"
        for c_idx, val in enumerate(row_vals):
            cell = row.cells[c_idx]
            cell.width = col_widths[c_idx]
            set_cell_background(cell, bg_color)
            set_cell_margins(cell, top=80, bottom=80, left=100, right=100)
            p = cell.paragraphs[0]
            p.paragraph_format.space_after = Pt(2)
            r = p.add_run(val)
            r.font.size = Pt(10)

    # SECTION 2: COMPREHENSIVE MODULE BREAKDOWN
    doc.add_page_break()
    h1 = doc.add_paragraph("2. Comprehensive Platform Module Breakdown")
    style_heading_1(h1)
    
    p = doc.add_paragraph(
        "GrowthOS contains 22 specialized backend modules working in synergy. Below is a detailed breakdown of each module's "
        "functionality, underlying database tables, and key API endpoints."
    )
    p.paragraph_format.space_after = Pt(12)

    modules_info = [
        ("2.1 Core CRM & Lead Management (`app.modules.crm`)",
         "Manages the complete lifecycle of leads, contacts, accounts, and companies. Features automated and manual lead scoring logic (`scoring.py`) that evaluates lead activity, budget, and custom properties to dynamically update lead heat scores. Tracks interaction activity timelines.",
         "Lead, Contact, Company, Activity, Tag, LeadScoreHistory",
         "/api/v1/crm/leads, /api/v1/crm/contacts, /api/v1/crm/companies, /api/v1/crm/activities"),
         
        ("2.2 Visual Pipeline & Deal Engine (`app.modules.pipeline`)",
         "Provides a drag-and-drop Kanban deal board. Configurable deal stages ('New', 'Contacted', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost'). Automatically creates deal cards upon form submission or new lead creation via event listeners.",
         "Pipeline, Stage, Deal",
         "/api/v1/pipeline/pipelines, /api/v1/pipeline/stages, /api/v1/pipeline/deals"),
         
        ("2.3 Dynamic Funnel Builder (`app.modules.funnels`)",
         "Engine for creating multi-step landing pages and sales funnels. Features published page hosting, step ordering, customizable CTA action handling (redirect, form submit, next step), and visitor analytics tracking (UTM tags, device, browser, OS, referrer).",
         "Funnel, FunnelStep, FunnelVisit",
         "/api/v1/funnels, /api/v1/funnels/{id}/steps, /api/v1/funnels/public/{slug}"),
         
        ("2.4 Dynamic Form Builder (`app.modules.forms`)",
         "Visual form creation modal allowing users to generate custom lead capture forms with dynamic text, select, email, and phone fields. Includes public embeddable form endpoints and automatic conversion of form submissions into system leads & deals.",
         "Form, FormSubmission",
         "/api/v1/forms, /api/v1/forms/{id}/submit, /api/v1/forms/public/{id}"),
         
        ("2.5 Visual Workflow Automation Engine (`app.modules.workflow`)",
         "An enterprise-grade automation engine inspired by Zapier and GoHighLevel. Listens to system events (`form.submitted`, `lead.created`, `pipeline.stage_changed`, `email.sent`). Executes conditional branching workflows, delays, automated tag assignment, emails, and tasks.",
         "Workflow, WorkflowStep, WorkflowExecution",
         "/api/v1/workflow/workflows, /api/v1/workflow/executions"),
         
        ("2.6 Multi-Channel Drip Campaigns (`app.modules.campaigns`)",
         "Manages automated email and SMS drip campaigns. Supports scheduled messaging, subscriber tagging filtering, campaign step delays, delivery tracking, and background loop processing via Celery or local async loop.",
         "Campaign, CampaignStep, CampaignSubscriber",
         "/api/v1/campaigns, /api/v1/campaigns/{id}/launch"),
         
        ("2.7 Unified Communication Inbox (`app.modules.inbox`)",
         "Centralized hub consolidating multi-channel conversations (Email, SMS, system notifications). Links messages directly to related leads, tasks, appointments, and invoices, resolving context ambiguity for sales teams.",
         "Inbox, Message, ConversationThread",
         "/api/v1/inbox/messages, /api/v1/inbox/threads"),
         
        ("2.8 Calendar & Meeting Scheduling (`app.modules.calendar`)",
         "Interactive calendar for scheduling sales demos, client meetings, and appointments. Supports team member assignment, participant details, and automated meeting reminder triggers.",
         "Appointment, CalendarEvent",
         "/api/v1/calendar/appointments, /api/v1/calendar/events"),
         
        ("2.9 Task & Project Management (`app.modules.tasks`)",
         "Task creation, subtask breakdowns, department tags, due date reminders, and team assignment tracking. Integrates with CRM activities so task status updates reflect on lead histories.",
         "Task, Subtask",
         "/api/v1/tasks, /api/v1/tasks/{id}/complete"),
         
        ("2.10 Payments, Subscriptions & Invoicing (`app.modules.payments`)",
         "Stripe payment gateway integration supporting customer subscription management, recurring plan billing, manual one-off payments, custom PDF invoice generation, line-item tax calculations, and payment status Webhooks.",
         "PaymentPlan, Subscription, Invoice, InvoiceItem",
         "/api/v1/payments/subscriptions, /api/v1/payments/invoices, /api/v1/payments/webhook"),
         
        ("2.11 Reputation & Review Management (`app.modules.reviews`)",
         "Reputation engine that triggers automated review request campaigns (via SMS/Email) after deal closure. Tracks review submissions across Google Business Profile, Trustpilot, and custom platforms, calculating sentiment stats.",
         "ReviewRequest, Review",
         "/api/v1/reviews/requests, /api/v1/reviews/stats"),
         
        ("2.12 Bi-Directional Gmail & Email Sync (`app.modules.gmail` & `app.modules.email`)",
         "OAuth 2.0 connection to Google Gmail API for live email sync. Parses incoming client emails into inbox threads, sends outbound emails via connected accounts or SMTP/SendGrid, and logs email open/click metrics.",
         "GmailAccount, EmailTemplate, SentEmailLog",
         "/api/v1/gmail/auth, /api/v1/email/send, /api/v1/email/templates"),
         
        ("2.13 Organization, Team & Settings (`app.modules.organization`, `app.modules.team`, `app.modules.settings`)",
         "Multi-tenant infrastructure supporting tenant isolation, team invitations, role-based access control (Admin, Manager, Agent), workspace branding settings (logo, primary color, domain), and system defaults.",
         "Organization, TeamMember, User, Settings",
         "/api/v1/team/members, /api/v1/settings/organization, /api/v1/auth/register")
    ]

    for title, desc, tables, endpoints in modules_info:
        h2 = doc.add_paragraph(title)
        style_heading_2(h2)
        
        p = doc.add_paragraph(desc)
        p.paragraph_format.space_after = Pt(4)
        
        p_meta = doc.add_paragraph()
        p_meta.paragraph_format.space_after = Pt(8)
        p_meta.add_run("• Key Entities / Tables: ").bold = True
        p_meta.add_run(f"{tables}\n")
        p_meta.add_run("• Primary API Endpoints: ").bold = True
        p_meta.add_run(endpoints)

    # SECTION 3: COMPLETE END-TO-END WORKFLOW
    doc.add_page_break()
    h1 = doc.add_paragraph("3. Complete End-to-End System & Data Workflow")
    style_heading_1(h1)
    
    p = doc.add_paragraph(
        "GrowthOS operates on a continuous, event-driven data pipeline designed to convert cold website traffic "
        "into paying customers and repeat brand advocates without manual intervention."
    )
    p.paragraph_format.space_after = Pt(10)
    
    add_callout(
        doc,
        "WORKFLOW LIFECYCLE STEPS:\n"
        "1. Traffic Capture -> Published Funnel / Embedded Public Form\n"
        "2. Event Trigger -> form.submitted & lead.created emitted on Event Bus\n"
        "3. Lead Auto-Creation -> Lead record created & Lead Scoring engine evaluates budget/source\n"
        "4. Pipeline Card Creation -> Deal automatically generated in 'New' stage of Default Pipeline\n"
        "5. Automation Execution -> Workflow engine triggers email sequence & assigns rep task\n"
        "6. Unified Inbox Outreach -> Bi-directional email sync logs lead replies in Central Inbox\n"
        "7. Calendar Booking -> Client schedules demo via interactive calendar link\n"
        "8. Deal Conversion -> Deal moved to 'Won'; Stripe Invoice generated automatically\n"
        "9. Post-Sale Advocacy -> Reputation review request sent 7 days post-payment",
        title="END-TO-END AUTOMATED LEAD JOURNEY",
        border_color="10B981",
        fill_color="F0FDF4"
    )

    h2 = doc.add_paragraph("3.1 Detailed Step-by-Step Execution Sequence")
    style_heading_2(h2)

    steps = [
        ("Step 1: Visitor Traffic & Lead Capture",
         "A prospective client visits a published funnel step built in GrowthOS or interacts with an embedded public form on a third-party website. The funnel visit tracking engine logs UTM parameters, referrer source, browser, and device metrics."),
         
        ("Step 2: Event Emitting & Lead Scoring",
         "Upon form submission, FastAPI dispatches the form.submitted event. The CRM service ingests submission payload, creates or updates a Lead record, and triggers init_scoring_listeners(). The lead's heat score is dynamically computed (e.g., +25 points for enterprise budget, +10 points for corporate email)."),
         
        ("Step 3: Automated Pipeline Deal Generation",
         "The pipeline subscriber on_lead_created intercepts the event. It verifies whether a Deal card already exists; if not, it fetches the organization's default sales pipeline, locates the initial 'New' stage, and creates a deal card titled '[Lead Name] Deal' with budget value."),
         
        ("Step 4: Workflow Engine Trigger & Drip Execution",
         "The workflow engine evaluates active workflows listening for lead.created. If matched, it executes steps sequentially: sending a welcome email template, adding a tag 'Hot-Lead', scheduling a follow-up task for the assigned sales representative, and queueing a 3-day email drip in app.modules.campaigns."),
         
        ("Step 5: Unified Inbox & Calendar Meeting Booking",
         "When the lead replies to an automated email, the bi-directional Gmail/SMTP engine captures the response and logs it in the Unified Inbox. The sales rep views the complete lead history, notes, and activity timeline, then sends a calendar appointment link. The lead books a meeting slot, creating an Appointment record and emitting a calendar notification."),
         
        ("Step 6: Deal Won & Stripe Invoice Dispatch",
         "Following a successful sales demo, the rep drags the Deal card to the 'Won' stage on the Kanban pipeline board. This emits pipeline.stage_deal_won. The workflow engine automatically generates a Stripe invoice via app.modules.payments, complete with tax lines and payment links, and emails it to the client."),
         
        ("Step 7: Payment Confirmation & Review Collection",
         "Upon receiving payment, Stripe triggers a webhook (/payments/webhook), marking the invoice as 'Paid' and updating lead status to 'Customer'. Seven days later, the reviews module sends an automated review request via SMS/Email, inviting the customer to leave feedback on Google or Trustpilot.")
    ]

    for title, text in steps:
        p_step = doc.add_paragraph()
        p_step.paragraph_format.space_after = Pt(6)
        r_s = p_step.add_run(f"{title}: ")
        r_s.bold = True
        r_s.font.color.rgb = RGBColor(30, 41, 59)
        p_step.add_run(text)

    # SECTION 4: COMMERCIALIZATION MODELS (SAAS VS PRODUCT)
    doc.add_page_break()
    h1 = doc.add_paragraph("4. Commercialization Strategy: SaaS vs. Product Options")
    style_heading_1(h1)
    
    p = doc.add_paragraph(
        "To maximize market impact and enterprise valuation, GrowthOS can be commercialized through two primary business models: "
        "a Multi-Tenant SaaS Subscription Model or a Self-Hosted / White-Label License Product. "
        "Below is a strategic analysis, financial projection, and final recommendation."
    )
    p.paragraph_format.space_after = Pt(12)

    h2 = doc.add_paragraph("Option A: Software-as-a-Service (SaaS) Subscription Model")
    style_heading_2(h2)
    
    p = doc.add_paragraph(
        "In the SaaS model, GrowthOS is hosted centrally on managed cloud infrastructure (AWS / GCP / DigitalOcean / Supabase) "
        "and offered to businesses as a monthly/annual recurring subscription. Organizations sign up, select a plan, "
        "and access their isolated workspace instantly."
    )
    p.paragraph_format.space_after = Pt(8)
    
    p_tier = doc.add_paragraph()
    p_tier.paragraph_format.space_after = Pt(10)
    p_tier.add_run("• Starter Plan ($49 / month): ").bold = True
    p_tier.add_run("Targeted at solo entrepreneurs and small teams. Includes up to 2,500 contacts, 3 pipelines, basic email forms, and standard CRM tools.\n")
    p_tier.add_run("• Professional Plan ($149 / month): ").bold = True
    p_tier.add_run("Targeted at growing SMEs. Includes 15,000 contacts, unlimited funnels, custom workflow automations, visual pipeline, Gmail sync, and review management.\n")
    p_tier.add_run("• Agency / Enterprise Plan ($299 - $499 / month): ").bold = True
    p_tier.add_run("Targeted at marketing agencies and enterprise sales teams. Includes unlimited sub-accounts/organizations, full white-labeling (custom domain & branding), unlimited contacts, Stripe invoicing, and priority support.")

    h2 = doc.add_paragraph("Option B: White-Label / Self-Hosted Product License Model")
    style_heading_2(h2)
    
    p = doc.add_paragraph(
        "In the Product model, GrowthOS is packaged as a turn-key downloadable software license or custom deployed "
        "into client-owned cloud infrastructure (Docker containerized, single-tenant deployment)."
    )
    p.paragraph_format.space_after = Pt(8)
    
    p_prod = doc.add_paragraph()
    p_prod.paragraph_format.space_after = Pt(10)
    p_prod.add_run("• One-Time Lifetime License ($1,499 - $3,500): ").bold = True
    p_prod.add_run("Agencies pay an upfront fee to own and run the code on their own server with unlimited clients.\n")
    p_prod.add_run("• Annual Maintenance & Upgrades Fee ($499 / year): ").bold = True
    p_prod.add_run("Provides access to system updates, security patches, and new feature releases.\n")
    p_prod.add_run("• Managed Setup & Deployment Add-on ($500 - $1,000 one-time): ").bold = True
    p_prod.add_run("Done-for-you installation on AWS/DigitalOcean with custom domain, SSL, and SMTP configuration.")

    # Table: SaaS vs Product Comparison
    h3 = doc.add_paragraph("Table 4.1: SaaS vs. Product License Comparative Analysis")
    style_heading_3(h3)
    
    tbl_comp = doc.add_table(rows=7, cols=3)
    tbl_comp.alignment = WD_TABLE_ALIGNMENT.CENTER
    tbl_comp.autofit = False
    
    headers_c = ["Dimension", "Option A: Multi-Tenant SaaS", "Option B: White-Label Product"]
    for i, h in enumerate(headers_c):
        cell = tbl_comp.rows[0].cells[i]
        set_cell_background(cell, "1E293B")
        set_cell_margins(cell, top=100, bottom=100, left=120, right=120)
        p = cell.paragraphs[0]
        r = p.add_run(h)
        r.bold = True
        r.font.color.rgb = RGBColor(255, 255, 255)
        
    comp_data = [
        ("Revenue Model", "Predictable Recurring Monthly/Annual (MRR/ARR)", "Upfront high ticket cash flow + annual maintenance"),
        ("Customer Lifetime Value", "Very High ($1,800 - $6,000+ per user over 3 yrs)", "Moderate ($2,000 - $4,500 total LTV)"),
        ("Infra Overhead", "High (Managing server cluster, DB scale, security)", "Low (Client pays and maintains their own cloud server)"),
        ("Sales Cycle", "Short (Self-serve credit card sign-up)", "Medium to Long (Requires sales calls & technical demos)"),
        ("Market Reach", "Broad mass-market (SMEs, Freelancers, Startups)", "Niche (Agencies, Enterprise IT, Security-conscious firms)"),
        ("Valuation Multiple", "8x - 15x ARR (High SaaS multiple)", "2x - 4x Revenue (Lower multiple for one-time sales)")
    ]
    
    col_w = [Inches(1.6), Inches(2.4), Inches(2.5)]
    for r_idx, row_vals in enumerate(comp_data):
        row = tbl_comp.rows[r_idx + 1]
        bg_color = "F8FAFC" if r_idx % 2 == 0 else "FFFFFF"
        for c_idx, val in enumerate(row_vals):
            cell = row.cells[c_idx]
            cell.width = col_w[c_idx]
            set_cell_background(cell, bg_color)
            set_cell_margins(cell, top=80, bottom=80, left=100, right=100)
            p = cell.paragraphs[0]
            p.paragraph_format.space_after = Pt(2)
            r = p.add_run(val)
            r.font.size = Pt(9.5)

    h2 = doc.add_paragraph("4.3 Strategic Recommendation: Hybrid SaaS-First Strategy")
    style_heading_2(h2)
    
    add_callout(
        doc,
        "RECOMMENDED HYBRID GO-TO-MARKET:\n"
        "1. Launch as Multi-Tenant SaaS (Core Revenue Engine): Target SMBs and growth teams with $49 - $299/mo plans to build compounding MRR.\n"
        "2. Offer Agency White-Label Tier ($399/mo or $3,999/yr): Allow digital marketing agencies to rebrand GrowthOS as their own proprietary software and resell sub-accounts to their business clients at 100% markup.\n"
        "3. Sell Enterprise On-Premise Licenses ($4,999+ one-time): For security-sensitive clients (legal, healthcare, finance) who demand data sovereignty on private cloud infra.",
        title="FINAL COMMERCIALIZATION RECOMMENDATION",
        border_color="4F46E5",
        fill_color="F0F4FF"
    )

    # SECTION 5: TARGET AUDIENCE & CLIENT MATRIX
    doc.add_page_break()
    h1 = doc.add_paragraph("5. Target Audience, Client Segments & Market Fit")
    style_heading_1(h1)
    
    p = doc.add_paragraph(
        "GrowthOS addresses specific high-pain operational bottlenecks across multiple commercial industries. "
        "Below is the target client matrix defining ideal customer profiles (ICPs), key pain points solved, "
        "and tailored feature positioning."
    )
    p.paragraph_format.space_after = Pt(12)

    h3 = doc.add_paragraph("Table 5.1: Target Client Vertical Matrix")
    style_heading_3(h3)
    
    tbl_aud = doc.add_table(rows=6, cols=4)
    tbl_aud.alignment = WD_TABLE_ALIGNMENT.CENTER
    tbl_aud.autofit = False
    
    headers_a = ["Client Segment", "Ideal Customer Profile", "Core Pain Points Solved", "Killer GrowthOS Features"]
    for i, h in enumerate(headers_a):
        cell = tbl_aud.rows[0].cells[i]
        set_cell_background(cell, "1E293B")
        set_cell_margins(cell, top=100, bottom=100, left=100, right=100)
        p = cell.paragraphs[0]
        r = p.add_run(h)
        r.bold = True
        r.font.size = Pt(9.5)
        r.font.color.rgb = RGBColor(255, 255, 255)
        
    aud_data = [
        ("Digital Marketing Agencies", "Agencies managing 10-50+ client accounts needing client dashboards.", "Juggling 5 different software subscriptions per client (CRM, funnel builder, email, SMS).", "Multi-tenant sub-accounts, white-label branding, automated client onboarding workflows."),
        ("B2B SaaS & Tech Startups", "Seed to Series-A startups with 3-15 sales reps.", "High lead churn, slow manual response times, lack of lead scoring prioritization.", "Automated lead scoring, instant pipeline deal creation, visual workflow engine."),
        ("Real Estate Agencies & Brokers", "Residential & commercial brokerages with active agent teams.", "Leads slipping through cracks, missed follow-ups, fragmented client communication.", "Unified communication inbox, automated SMS drip campaigns, calendar appointment booking."),
        ("Professional Services (Consultants / Legal)", "Consulting firms, law practices, accounting agencies.", "Manual invoicing hassle, tracking billable client acquisition, lack of review trust.", "Stripe invoice automation, form builder, automated review requests (Google/Trustpilot)."),
        ("Local Service Businesses (HVAC, Solar, Dental)", "High-ticket home service & medical service providers.", "Missed phone leads, delayed quote dispatch, reliance on manual phone calls.", "Instant lead capture forms, automated SMS fast-reply workflow, calendar booking.")
    ]
    
    col_wa = [Inches(1.5), Inches(1.7), Inches(1.8), Inches(1.5)]
    for r_idx, row_vals in enumerate(aud_data):
        row = tbl_aud.rows[r_idx + 1]
        bg_color = "F8FAFC" if r_idx % 2 == 0 else "FFFFFF"
        for c_idx, val in enumerate(row_vals):
            cell = row.cells[c_idx]
            cell.width = col_wa[c_idx]
            set_cell_background(cell, bg_color)
            set_cell_margins(cell, top=80, bottom=80, left=80, right=80)
            p = cell.paragraphs[0]
            p.paragraph_format.space_after = Pt(2)
            r = p.add_run(val)
            r.font.size = Pt(8.5)

    # SECTION 6: PITCHING STRATEGY & SALES PLAYBOOK
    doc.add_page_break()
    h1 = doc.add_paragraph("6. Pitching Strategy & Sales Playbook")
    style_heading_1(h1)
    
    p = doc.add_paragraph(
        "To effectively sell GrowthOS to prospective clients and agencies, sales teams must execute "
        "a value-first, consultative selling strategy. Below are pitch frameworks, demo scripts, "
        "objection handling guides, and cold outreach templates."
    )
    p.paragraph_format.space_after = Pt(12)

    h2 = doc.add_paragraph("6.1 Core Elevator Pitch (30-Second Pitch)")
    style_heading_2(h2)
    
    p_pitch = doc.add_paragraph()
    p_pitch.paragraph_format.space_after = Pt(10)
    p_pitch.add_run('“GrowthOS is the all-in-one sales and growth engine that replaces your fragmented CRM, funnel builder, email automation, calendar scheduler, and invoicing tools into a single, unified workspace. Instead of paying $1,000+ per month across 5 separate subscriptions, GrowthOS captures your leads, scores them automatically, triggers instant follow-up workflows, and lets your team close deals faster—all from one place.”')
    p_pitch.runs[0].font.italic = True
    p_pitch.runs[0].font.color.rgb = RGBColor(30, 41, 59)

    h2 = doc.add_paragraph("6.2 4-Step Live Product Demo Script")
    style_heading_2(h2)

    demo_steps = [
        ("Phase 1: Lead Capture & Instant Funnel (2 Mins)", "Show live submission on a published GrowthOS form/funnel. Highlight how lead data instantly pops up in the CRM with automated lead scoring applied based on budget."),
        ("Phase 2: Visual Pipeline & Automated Workflow (3 Mins)", "Demonstrate dragging the lead card across Kanban pipeline stages. Trigger a live workflow automation that sends a personalized email and creates a sales rep follow-up task."),
        ("Phase 3: Unified Inbox & Calendar Booking (3 Mins)", "Show the lead's reply appearing in the Unified Inbox. Demonstrate booking a demo appointment directly on the interactive calendar."),
        ("Phase 4: Instant Invoicing & Review Collection (2 Mins)", "Move deal to 'Won', show instant Stripe invoice generation with tax breakdown, and trigger automated Google review request campaign.")
    ]

    for phase, detail in demo_steps:
        p_d = doc.add_paragraph()
        p_d.paragraph_format.space_after = Pt(6)
        rd = p_d.add_run(f"• {phase}: ")
        rd.bold = True
        rd.font.color.rgb = RGBColor(79, 70, 229)
        p_d.add_run(detail)

    h2 = doc.add_paragraph("6.3 Objection Handling Playbook")
    style_heading_2(h2)

    objs = [
        ("Objection 1: 'We already use HubSpot / Salesforce.'",
         "Response: 'HubSpot and Salesforce are great for massive enterprises, but they quickly become expensive ($800+/mo for basic workflows) and overly complex. GrowthOS gives you the exact core features—lead management, visual pipelines, email drips, and workflow automations—at a fraction of the cost, without needing a full-time administrator.'"),
         
        ("Objection 2: 'Migration sounds too painful.'",
         "Response: 'We offer full automated CSV lead import and done-for-you onboarding assistance. You can import all existing contacts, tags, and pipelines into GrowthOS in less than 15 minutes without losing historical notes.'"),
         
        ("Objection 3: 'Is our data secure?'",
         "Response: 'GrowthOS utilizes JWT token security, encrypted database connections, role-based access control, and complete multi-tenant organization data isolation. For enterprise customers, we also offer dedicated single-tenant self-hosted deployments.'")
    ]

    for o_title, o_text in objs:
        p_o = doc.add_paragraph()
        p_o.paragraph_format.space_after = Pt(6)
        ro = p_o.add_run(f"• {o_title}\n")
        ro.bold = True
        ro.font.color.rgb = RGBColor(30, 41, 59)
        p_o.add_run(o_text)

    h2 = doc.add_paragraph("6.4 High-Converting Cold Email Template")
    style_heading_2(h2)

    p_em = doc.add_paragraph()
    p_em.paragraph_format.space_after = Pt(12)
    p_em.add_run(
        "Subject: Quick question regarding your lead follow-up stack at {Company_Name}\n\n"
        "Hi {First_Name},\n\n"
        "Notice you're running active acquisition campaigns for {Company_Name}. Most growth teams we speak with are currently juggling 3-5 separate tools for CRM, funnels, calendar booking, and email drips—leading to missed leads and high software bills.\n\n"
        "We built GrowthOS to consolidate your entire sales engine into one unified workspace with automated lead scoring, visual pipeline tracking, and instant workflow follow-ups.\n\n"
        "Would you be open to a 10-minute demo this Thursday to see how we helped similar teams cut software spend by 60% while doubling lead conversion rates?\n\n"
        "Best regards,\n[Your Name] | GrowthOS Sales Team"
    )

    # SECTION 7: FUTURE ROADMAP & CONCLUSION
    doc.add_page_break()
    h1 = doc.add_paragraph("7. Strategic Product Roadmap & Conclusion")
    style_heading_1(h1)
    
    p = doc.add_paragraph(
        "GrowthOS represents a solid, highly extensible foundation. To scale from initial launch to an enterprise platform, "
        "the following strategic product enhancements are recommended:"
    )
    p.paragraph_format.space_after = Pt(10)

    roadmaps = [
        ("Phase 1: Native Mobile App (iOS / Android)", "Develop React Native mobile companion app for real-time inbox notifications and lead status updates on the go."),
        ("Phase 2: Generative AI Sales Assistant", "Integrate LLM API calls inside the workflow engine to auto-generate personalized email replies, qualify lead intent, and draft custom proposal notes."),
        ("Phase 3: Deep WhatsApp & Twilio Voice Integration", "Expand multi-channel inbox capabilities with bi-directional WhatsApp Business API and browser-based VOIP phone calling."),
        ("Phase 4: Marketplace & Webhook Apps", "Launch a public App Store enabling third-party developers to build custom integration plugins for GrowthOS.")
    ]

    for phase, desc in roadmaps:
        p_r = doc.add_paragraph()
        p_r.paragraph_format.space_after = Pt(6)
        rr = p_r.add_run(f"• {phase}: ")
        rr.bold = True
        rr.font.color.rgb = RGBColor(15, 118, 110)
        p_r.add_run(desc)

    p_conc = doc.add_paragraph(
        "Conclusion: GrowthOS is fully engineered to disrupt the middle-market CRM and sales automation space. "
        "With robust asynchronous architecture, multi-channel customer engagement features, and a scalable multi-tenant foundation, "
        "executing the hybrid SaaS & White-Label strategy outlined in this report will position GrowthOS for rapid market adoption and high recurring enterprise revenue."
    )
    p_conc.paragraph_format.space_before = Pt(14)
    p_conc.paragraph_format.space_after = Pt(14)

    # Save document
    out_filename = "GrowthOS_Comprehensive_Project_Report.docx"
    doc.save(out_filename)
    print(f"Successfully generated comprehensive Word document report: {os.path.abspath(out_filename)}")

if __name__ == "__main__":
    build_docx_report()
