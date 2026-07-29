import React, { useState, useEffect, useRef } from 'react';
import styles from './AutomationsPage.module.css';
import { automationsApi, emailApi } from '../../lib/api';
import type { Workflow } from '../../lib/api';
import { Plus, Settings2, Zap, ToggleLeft, ToggleRight, X, ChevronDown, ChevronUp, Trash2, Play, Edit3, History, Terminal, ClipboardList } from 'lucide-react';

const TRIGGER_OPTIONS = [
  // CRM
  { value: 'lead.created', label: 'Lead Created', category: 'CRM' },
  { value: 'lead.updated', label: 'Lead Updated', category: 'CRM' },
  { value: 'lead.deleted', label: 'Lead Deleted', category: 'CRM' },
  { value: 'lead.assigned', label: 'Lead Assigned', category: 'CRM' },
  { value: 'lead.status_changed', label: 'Lead Status Changed', category: 'CRM' },
  { value: 'contact.created', label: 'Contact Created', category: 'CRM' },
  { value: 'contact.updated', label: 'Contact Updated', category: 'CRM' },
  { value: 'company.created', label: 'Company Created', category: 'CRM' },
  { value: 'company.updated', label: 'Company Updated', category: 'CRM' },
  { value: 'deal.created', label: 'Deal Created', category: 'CRM' },
  { value: 'deal.updated', label: 'Deal Updated', category: 'CRM' },
  { value: 'deal.won', label: 'Deal Won', category: 'CRM' },
  { value: 'deal.lost', label: 'Deal Lost', category: 'CRM' },
  { value: 'pipeline.stage_changed', label: 'Pipeline Stage Changed', category: 'CRM' },
  { value: 'pipeline.stage_new', label: 'Pipeline Stage: New', category: 'CRM' },
  { value: 'pipeline.stage_contacted', label: 'Pipeline Stage: Contacted', category: 'CRM' },
  { value: 'pipeline.stage_qualified', label: 'Pipeline Stage: Qualified', category: 'CRM' },
  { value: 'pipeline.stage_proposal', label: 'Pipeline Stage: Proposal', category: 'CRM' },
  { value: 'pipeline.stage_negotiation', label: 'Pipeline Stage: Negotiation', category: 'CRM' },
  { value: 'pipeline.stage_deal_lost', label: 'Pipeline Stage: Deal Lost', category: 'CRM' },
  { value: 'pipeline.stage_deal_won', label: 'Pipeline Stage: Deal Won', category: 'CRM' },
  { value: 'owner.changed', label: 'Owner Changed', category: 'CRM' },
  { value: 'tag.added', label: 'Tag Added', category: 'CRM' },
  { value: 'tag.removed', label: 'Tag Removed', category: 'CRM' },
  
  // Forms
  { value: 'form.submitted', label: 'Form Submitted', category: 'Forms' },
  { value: 'duplicate.submission', label: 'Duplicate Submission', category: 'Forms' },
  { value: 'file.uploaded', label: 'File Uploaded', category: 'Forms' },
  { value: 'form.abandoned', label: 'Form Abandoned (Future-Ready)', category: 'Forms' },
  
  // Email
  { value: 'email.sent', label: 'Email Sent', category: 'Email' },
  { value: 'email.delivered', label: 'Email Delivered', category: 'Email' },
  { value: 'email.failed', label: 'Email Failed', category: 'Email' },
  { value: 'email.opened', label: 'Email Opened', category: 'Email' },
  { value: 'email.clicked', label: 'Email Clicked', category: 'Email' },
  { value: 'email.reply_received', label: 'Reply Received', category: 'Email' },
  { value: 'email.bounce_detected', label: 'Bounce Detected', category: 'Email' },
  
  // Inbox
  { value: 'message.incoming_email', label: 'Incoming Email', category: 'Inbox' },
  { value: 'message.incoming', label: 'Incoming Message', category: 'Inbox' },
  { value: 'message.conversation_started', label: 'Conversation Started', category: 'Inbox' },
  { value: 'message.conversation_closed', label: 'Conversation Closed', category: 'Inbox' },
  
  // Calendar
  { value: 'appointment.booked', label: 'Appointment Booked', category: 'Calendar' },
  { value: 'appointment.cancelled', label: 'Appointment Cancelled', category: 'Calendar' },
  { value: 'appointment.completed', label: 'Appointment Completed', category: 'Calendar' },
  { value: 'appointment.reminder_time', label: 'Appointment Reminder Time', category: 'Calendar' },
  
  // Tasks
  { value: 'task.created', label: 'Task Created', category: 'Tasks' },
  { value: 'task.assigned', label: 'Task Assigned', category: 'Tasks' },
  { value: 'task.completed', label: 'Task Completed', category: 'Tasks' },
  { value: 'task.overdue', label: 'Task Overdue', category: 'Tasks' },
  
  // Payments
  { value: 'invoice.created', label: 'Invoice Created', category: 'Payments' },
  { value: 'invoice.paid', label: 'Invoice Paid', category: 'Payments' },
  { value: 'payment.failed', label: 'Payment Failed', category: 'Payments' },
  { value: 'refund.issued', label: 'Refund Issued', category: 'Payments' },
  
  // Funnels
  { value: 'funnel.started', label: 'Funnel Started', category: 'Funnels' },
  { value: 'funnel.step_completed', label: 'Funnel Step Completed', category: 'Funnels' },
  { value: 'funnel.completed', label: 'Funnel Completed', category: 'Funnels' },
  
  // Workflow
  { value: 'workflow.started', label: 'Workflow Started', category: 'Workflow' },
  { value: 'workflow.completed', label: 'Workflow Completed', category: 'Workflow' },
  { value: 'workflow.failed', label: 'Workflow Failed', category: 'Workflow' },
  
  // Integrations
  { value: 'webhook.received', label: 'Webhook Received', category: 'Integrations' },
  { value: 'stripe.webhook', label: 'Stripe Webhook', category: 'Integrations' },
  { value: 'gmail.connected', label: 'Gmail Connected', category: 'Integrations' },
  { value: 'gmail.disconnected', label: 'Gmail Disconnected', category: 'Integrations' },
  { value: 'oauth.connected', label: 'OAuth Connected', category: 'Integrations' },
];

const ACTION_TYPES = [
  // CRM
  { value: 'create_lead', label: 'Create Lead', category: 'CRM' },
  { value: 'update_lead', label: 'Update Lead Status/Score', category: 'CRM' },
  { value: 'create_contact', label: 'Create Contact', category: 'CRM' },
  { value: 'update_contact', label: 'Update Contact', category: 'CRM' },
  { value: 'create_company', label: 'Create Company', category: 'CRM' },
  { value: 'update_company', label: 'Update Company', category: 'CRM' },
  { value: 'create_deal', label: 'Create Deal', category: 'CRM' },
  { value: 'update_deal', label: 'Update Deal', category: 'CRM' },
  { value: 'move_pipeline_stage', label: 'Move Pipeline Stage', category: 'CRM' },
  { value: 'assign_owner', label: 'Assign Owner', category: 'CRM' },
  { value: 'add_tag', label: 'Add Tag', category: 'CRM' },
  { value: 'remove_tag', label: 'Remove Tag', category: 'CRM' },
  { value: 'create_note', label: 'Create Note', category: 'CRM' },
  { value: 'create_activity', label: 'Create Activity', category: 'CRM' },
  
  // Email
  { value: 'send_email', label: 'Send Email', category: 'Email' },
  { value: 'send_template_email', label: 'Send Template Email', category: 'Email' },
  { value: 'send_internal_notification', label: 'Send Internal Notification', category: 'Email' },
  { value: 'queue_email', label: 'Queue Email', category: 'Email' },
  { value: 'stop_email_sequence', label: 'Stop Email Sequence', category: 'Email' },
  
  // Tasks
  { value: 'create_task', label: 'Create Task', category: 'Tasks' },
  { value: 'complete_task', label: 'Complete Task', category: 'Tasks' },
  { value: 'assign_task', label: 'Assign Task', category: 'Tasks' },
  { value: 'update_due_date', label: 'Update Due Date', category: 'Tasks' },
  
  // Calendar
  { value: 'create_appointment', label: 'Create Appointment', category: 'Calendar' },
  { value: 'send_appointment_reminder', label: 'Send Appointment Reminder', category: 'Calendar' },
  
  // Workflow
  { value: 'delay', label: 'Wait / Delay', category: 'Workflow' },
  { value: 'delay_until_date', label: 'Delay Until Date', category: 'Workflow' },
  { value: 'condition', label: 'Condition / Branch (If/Else)', category: 'Workflow' },
  { value: 'end_workflow', label: 'End Workflow', category: 'Workflow' },
  { value: 'trigger_another_workflow', label: 'Trigger Another Workflow', category: 'Workflow' },
  
  // Communication
  { value: 'send_sms', label: 'Send SMS (Mock)', category: 'Communication' },
  { value: 'send_whatsapp', label: 'Send WhatsApp (Mock)', category: 'Communication' },
  { value: 'create_inbox_conversation', label: 'Create Inbox Conversation', category: 'Communication' },
  { value: 'notify_user', label: 'Notify User (In-App)', category: 'Communication' },
  
  // Payments
  { value: 'create_invoice', label: 'Create Invoice', category: 'Payments' },
  { value: 'mark_invoice_paid', label: 'Mark Invoice Paid', category: 'Payments' },
  { value: 'send_receipt', label: 'Send Receipt', category: 'Payments' },
  
  // Webhooks
  { value: 'send_webhook', label: 'Send Webhook', category: 'Webhooks' },
  { value: 'call_api_endpoint', label: 'Call API Endpoint', category: 'Webhooks' },
  
  // Misc
  { value: 'log_event', label: 'Log Event', category: 'Misc' },
  { value: 'add_audit_record', label: 'Add Audit Record', category: 'Misc' },
  { value: 'update_custom_field', label: 'Update Custom Field', category: 'Misc' },
];

const AUTOMATION_TEMPLATES = [
  {
    name: "Welcome New Lead",
    description: "Send a welcome email template immediately when a new lead is created.",
    trigger: "lead.created",
    actions: [
      { id: "step_welcome", type: "send_email", template_id: "" }
    ]
  },
  {
    name: "Follow Up After 3 Days",
    description: "Wait 3 days, send a template email, and create a follow-up task.",
    trigger: "lead.created",
    actions: [
      { id: "step_wait", type: "delay", delay_seconds: 259200 },
      { id: "step_followup", type: "send_email", template_id: "" },
      { id: "step_task", type: "create_task", title: "Follow up with {{first_name}}", description: "Call lead to discuss pricing.", due_days: 1 }
    ]
  },
  {
    name: "Move Deal After Payment",
    description: "When an invoice is paid, update the deal status to Won and log an activity record.",
    trigger: "invoice.paid",
    actions: [
      { id: "step_deal_won", type: "update_deal", status: "Won" },
      { id: "step_receipt", type: "send_receipt", invoice_id: "{{invoice_id}}" }
    ]
  },
  {
    name: "Appointment Reminder",
    description: "Send an email reminder template when an appointment is booked.",
    trigger: "appointment.booked",
    actions: [
      { id: "step_reminder", type: "send_appointment_reminder", template_id: "" }
    ]
  },
  {
    name: "Form Submitted → Create Lead + Notify Salesperson",
    description: "When a website form is submitted, create a lead and notify the sales owner.",
    trigger: "form.submitted",
    actions: [
      { id: "step_lead", type: "create_lead", first_name: "{{first_name}}", last_name: "{{last_name}}", email: "{{email}}", phone: "{{phone}}", status: "New" },
      { id: "step_notify", type: "notify_user", title: "New Form Lead: {{first_name}} {{last_name}}", description: "Please review form submission data." }
    ]
  }
];

type ActionStep = {
  id: string;
  type: string;
  template_id?: string;
  title?: string;
  description?: string;
  due_days?: number;
  status?: string;
  delay_seconds?: number;
  field?: string;
  operator?: string;
  value?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  priority?: string;
  lead_score?: number;
  name?: string;
  website?: string;
  industry?: string;
  address?: string;
  stage_id?: string;
  owner_id?: string;
  tag?: string;
  content?: string;
  recipient_email?: string;
  subject?: string;
  body?: string;
  date?: string;
  target_workflow_id?: string;
  message?: string;
  channel?: string;
  amount?: number;
  customer_email?: string;
  invoice_id?: string;
  url?: string;
  field_name?: string;
  field_value?: string;
};

const LEAD_STATUSES = ['New', 'Contacted', 'Interested', 'Qualified', 'Lost'];

function ActionStepEditor({ step, onChange, onDelete, index, templates }: {
  step: ActionStep;
  onChange: (updated: ActionStep) => void;
  onDelete: () => void;
  index: number;
  templates: { id: string; name: string }[];
}) {
  const [collapsed, setCollapsed] = useState(false);

  const upd = (fields: Partial<ActionStep>) => onChange({ ...step, ...fields });

  const groupedActions = ACTION_TYPES.reduce((acc, curr) => {
    if (!acc[curr.category]) acc[curr.category] = [];
    acc[curr.category].push(curr);
    return acc;
  }, {} as Record<string, typeof ACTION_TYPES>);

  return (
    <div style={{ border: '1px solid #E5E7EB', borderRadius: 8, marginBottom: 12, overflow: 'hidden', background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', background: '#F9FAFB', cursor: 'pointer', borderBottom: collapsed ? 'none' : '1px solid #F3F4F6' }}
        onClick={() => setCollapsed(!collapsed)}
      >
        <span style={{ fontWeight: 600, fontSize: 13, color: '#374151', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 20, height: 20, background: '#E0E7FF', color: '#4F46E5', borderRadius: '50%', fontSize: 11 }}>{index + 1}</span>
          {ACTION_TYPES.find(a => a.value === step.type)?.label || step.type}
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={(e) => { e.stopPropagation(); onDelete(); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#EF4444' }}>
            <Trash2 size={15} />
          </button>
          {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </div>
      </div>

      {!collapsed && (
        <div style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className={styles.formGroup}>
            <label>Action Type</label>
            <select
              value={step.type}
              onChange={e => {
                const newType = e.target.value;
                const defaultProps: Partial<ActionStep> = { type: newType };
                onChange({ id: step.id, ...defaultProps } as ActionStep);
              }}
            >
              {Object.entries(groupedActions).map(([category, items]) => (
                <optgroup key={category} label={category}>
                  {items.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                </optgroup>
              ))}
            </select>
          </div>

          {/* CRM: create_lead */}
          {step.type === 'create_lead' && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div className={styles.formGroup}><label>First Name</label><input value={step.first_name || ''} onChange={e => upd({ first_name: e.target.value })} /></div>
                <div className={styles.formGroup}><label>Last Name</label><input value={step.last_name || ''} onChange={e => upd({ last_name: e.target.value })} /></div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div className={styles.formGroup}><label>Email</label><input value={step.email || ''} onChange={e => upd({ email: e.target.value })} /></div>
                <div className={styles.formGroup}><label>Phone</label><input value={step.phone || ''} onChange={e => upd({ phone: e.target.value })} /></div>
              </div>
              <div className={styles.formGroup}>
                <label>Status</label>
                <select value={step.status || 'New'} onChange={e => upd({ status: e.target.value })}>
                  {LEAD_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </>
          )}

          {/* CRM: update_lead */}
          {step.type === 'update_lead' && (
            <>
              <div className={styles.formGroup}>
                <label>New Status</label>
                <select value={step.status || 'Contacted'} onChange={e => upd({ status: e.target.value })}>
                  <option value="">-- No Change --</option>
                  {LEAD_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className={styles.formGroup}>
                <label>Lead Score</label>
                <input type="number" value={step.lead_score ?? 0} onChange={e => upd({ lead_score: parseInt(e.target.value) || 0 })} />
              </div>
            </>
          )}

          {/* CRM: create_contact / update_contact */}
          {(step.type === 'create_contact' || step.type === 'update_contact') && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div className={styles.formGroup}><label>First Name</label><input value={step.first_name || ''} onChange={e => upd({ first_name: e.target.value })} /></div>
                <div className={styles.formGroup}><label>Last Name</label><input value={step.last_name || ''} onChange={e => upd({ last_name: e.target.value })} /></div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div className={styles.formGroup}><label>Email</label><input value={step.email || ''} onChange={e => upd({ email: e.target.value })} /></div>
                <div className={styles.formGroup}><label>Phone</label><input value={step.phone || ''} onChange={e => upd({ phone: e.target.value })} /></div>
              </div>
            </>
          )}

          {/* CRM: create_company / update_company */}
          {(step.type === 'create_company' || step.type === 'update_company') && (
            <>
              <div className={styles.formGroup}><label>Company Name</label><input value={step.name || ''} onChange={e => upd({ name: e.target.value })} /></div>
              <div className={styles.formGroup}><label>Website</label><input value={step.website || ''} onChange={e => upd({ website: e.target.value })} /></div>
              <div className={styles.formGroup}><label>Industry</label><input value={step.industry || ''} onChange={e => upd({ industry: e.target.value })} /></div>
              <div className={styles.formGroup}><label>Address</label><input value={step.address || ''} onChange={e => upd({ address: e.target.value })} /></div>
            </>
          )}

          {/* CRM: create_deal / update_deal */}
          {(step.type === 'create_deal' || step.type === 'update_deal') && (
            <>
              <div className={styles.formGroup}><label>Deal Title</label><input value={step.title || ''} onChange={e => upd({ title: e.target.value })} /></div>
              <div className={styles.formGroup}><label>Deal Value ($)</label><input type="number" value={step.amount ?? 0} onChange={e => upd({ amount: parseFloat(e.target.value) || 0 })} /></div>
              <div className={styles.formGroup}><label>Stage ID</label><input value={step.stage_id || ''} onChange={e => upd({ stage_id: e.target.value })} /></div>
              {step.type === 'update_deal' && (
                <div className={styles.formGroup}><label>Status</label><select value={step.status || 'Active'} onChange={e => upd({ status: e.target.value })}><option value="Active">Active</option><option value="Won">Won</option><option value="Lost">Lost</option></select></div>
              )}
            </>
          )}

          {/* CRM: move_pipeline_stage */}
          {step.type === 'move_pipeline_stage' && (
            <div className={styles.formGroup}><label>Stage ID</label><input value={step.stage_id || ''} onChange={e => upd({ stage_id: e.target.value })} /></div>
          )}

          {/* CRM: assign_owner */}
          {step.type === 'assign_owner' && (
            <div className={styles.formGroup}><label>Owner User ID</label><input value={step.owner_id || ''} onChange={e => upd({ owner_id: e.target.value })} /></div>
          )}

          {/* CRM: add_tag / remove_tag */}
          {(step.type === 'add_tag' || step.type === 'remove_tag') && (
            <div className={styles.formGroup}><label>Tag Name</label><input value={step.tag || ''} onChange={e => upd({ tag: e.target.value })} /></div>
          )}

          {/* CRM: create_note */}
          {step.type === 'create_note' && (
            <div className={styles.formGroup}><label>Note Content</label><textarea value={step.content || ''} onChange={e => upd({ content: e.target.value })} /></div>
          )}

          {/* CRM: create_activity */}
          {step.type === 'create_activity' && (
            <>
              <div className={styles.formGroup}><label>Activity Type</label><select value={step.channel || 'Note'} onChange={e => upd({ channel: e.target.value })}><option value="Call">📞 Call</option><option value="Email">✉️ Email</option><option value="Meeting">🤝 Meeting</option><option value="Note">📝 Note</option></select></div>
              <div className={styles.formGroup}><label>Description</label><textarea value={step.description || ''} onChange={e => upd({ description: e.target.value })} /></div>
            </>
          )}

          {/* Email: send_email / send_template_email / queue_email */}
          {(step.type === 'send_email' || step.type === 'send_template_email' || step.type === 'queue_email') && (
            <div className={styles.formGroup}>
              <label>Select Email Template</label>
              {templates.length === 0 ? (
                <small style={{ color: '#EF4444' }}>No templates created yet.</small>
              ) : (
                <select value={step.template_id || ''} onChange={e => upd({ template_id: e.target.value })}>
                  <option value="">-- Choose a template --</option>
                  {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              )}
            </div>
          )}

          {/* Email: send_internal_notification */}
          {step.type === 'send_internal_notification' && (
            <>
              <div className={styles.formGroup}><label>Recipient Email</label><input value={step.recipient_email || ''} onChange={e => upd({ recipient_email: e.target.value })} /></div>
              <div className={styles.formGroup}><label>Subject</label><input value={step.subject || ''} onChange={e => upd({ subject: e.target.value })} /></div>
              <div className={styles.formGroup}><label>Body</label><textarea value={step.body || ''} onChange={e => upd({ body: e.target.value })} /></div>
            </>
          )}

          {/* Tasks: create_task */}
          {step.type === 'create_task' && (
            <>
              <div className={styles.formGroup}><label>Task Title</label><input value={step.title || ''} onChange={e => upd({ title: e.target.value })} /></div>
              <div className={styles.formGroup}><label>Description</label><textarea value={step.description || ''} onChange={e => upd({ description: e.target.value })} /></div>
              <div className={styles.formGroup}><label>Due In (days)</label><input type="number" min={1} value={step.due_days ?? 1} onChange={e => upd({ due_days: parseInt(e.target.value) || 1 })} /></div>
            </>
          )}

          {/* Tasks: complete_task / assign_task / update_due_date */}
          {(step.type === 'complete_task' || step.type === 'assign_task' || step.type === 'update_due_date') && (
            <>
              <div className={styles.formGroup}><label>Task ID <small style={{ color: '#9CA3AF' }}>(leave empty for context task)</small></label><input value={step.invoice_id || ''} onChange={e => upd({ invoice_id: e.target.value })} /></div>
              {step.type === 'assign_task' && (
                <div className={styles.formGroup}><label>Assignee User ID</label><input value={step.owner_id || ''} onChange={e => upd({ owner_id: e.target.value })} /></div>
              )}
              {step.type === 'update_due_date' && (
                <div className={styles.formGroup}><label>Due In (days)</label><input type="number" min={1} value={step.due_days ?? 1} onChange={e => upd({ due_days: parseInt(e.target.value) || 1 })} /></div>
              )}
            </>
          )}

          {/* Calendar: create_appointment */}
          {step.type === 'create_appointment' && (
            <>
              <div className={styles.formGroup}><label>Appointment Title</label><input value={step.title || ''} onChange={e => upd({ title: e.target.value })} /></div>
              <div className={styles.formGroup}><label>Start Time (ISO or template)</label><input value={step.date || ''} onChange={e => upd({ date: e.target.value })} placeholder="e.g. 2026-07-15T10:00:00" /></div>
              <div className={styles.formGroup}><label>Description</label><textarea value={step.description || ''} onChange={e => upd({ description: e.target.value })} /></div>
            </>
          )}

          {/* Calendar: send_appointment_reminder */}
          {step.type === 'send_appointment_reminder' && (
            <>
              <div className={styles.formGroup}><label>Appointment ID</label><input value={step.invoice_id || ''} onChange={e => upd({ invoice_id: e.target.value })} /></div>
              <div className={styles.formGroup}><label>Reminder Template ID</label><input value={step.template_id || ''} onChange={e => upd({ template_id: e.target.value })} /></div>
            </>
          )}

          {/* Workflow: delay */}
          {step.type === 'delay' && (
            <div className={styles.formGroup}>
              <label>Wait Duration (seconds)</label>
              <input type="number" min={1} value={step.delay_seconds ?? 60} onChange={e => upd({ delay_seconds: parseInt(e.target.value) || 60 })} />
              <small style={{ color: '#9CA3AF' }}>e.g. 3600 = 1 hour, 86400 = 1 day</small>
            </div>
          )}

          {/* Workflow: delay_until_date */}
          {step.type === 'delay_until_date' && (
            <div className={styles.formGroup}>
              <label>Delay Until Date (ISO or template)</label>
              <input value={step.date || ''} onChange={e => upd({ date: e.target.value })} placeholder="e.g. 2026-07-20T12:00:00Z" />
            </div>
          )}

          {/* Workflow: condition */}
          {step.type === 'condition' && (
            <>
              <div className={styles.formGroup}><label>Field to Check</label><input placeholder="e.g. status" value={step.field || ''} onChange={e => upd({ field: e.target.value })} /></div>
              <div className={styles.formGroup}><label>Operator</label><select value={step.operator || '=='} onChange={e => upd({ operator: e.target.value })}><option value="==">equals (==)</option><option value="!=">not equals (!=)</option></select></div>
              <div className={styles.formGroup}><label>Value</label><input placeholder="e.g. Qualified" value={step.value || ''} onChange={e => upd({ value: e.target.value })} /></div>
            </>
          )}

          {/* Workflow: trigger_another_workflow */}
          {step.type === 'trigger_another_workflow' && (
            <div className={styles.formGroup}><label>Target Workflow ID</label><input value={step.target_workflow_id || ''} onChange={e => upd({ target_workflow_id: e.target.value })} /></div>
          )}

          {/* Communication: send_sms / send_whatsapp */}
          {(step.type === 'send_sms' || step.type === 'send_whatsapp') && (
            <>
              <div className={styles.formGroup}><label>Recipient Phone</label><input value={step.phone || ''} onChange={e => upd({ phone: e.target.value })} placeholder="e.g. {{lead.phone}}" /></div>
              <div className={styles.formGroup}><label>Message Body</label><textarea value={step.message || ''} onChange={e => upd({ message: e.target.value })} /></div>
            </>
          )}

          {/* Communication: create_inbox_conversation */}
          {step.type === 'create_inbox_conversation' && (
            <>
              <div className={styles.formGroup}><label>Conversation Subject</label><input value={step.subject || ''} onChange={e => upd({ subject: e.target.value })} /></div>
              <div className={styles.formGroup}><label>Message Body</label><textarea value={step.body || ''} onChange={e => upd({ body: e.target.value })} /></div>
            </>
          )}

          {/* Communication: notify_user */}
          {step.type === 'notify_user' && (
            <>
              <div className={styles.formGroup}><label>User ID</label><input value={step.owner_id || ''} onChange={e => upd({ owner_id: e.target.value })} placeholder="e.g. {{owner_id}}" /></div>
              <div className={styles.formGroup}><label>Notification Title</label><input value={step.title || ''} onChange={e => upd({ title: e.target.value })} /></div>
              <div className={styles.formGroup}><label>Notification Content</label><textarea value={step.description || ''} onChange={e => upd({ description: e.target.value })} /></div>
            </>
          )}

          {/* Payments: create_invoice */}
          {step.type === 'create_invoice' && (
            <>
              <div className={styles.formGroup}><label>Amount ($)</label><input type="number" value={step.amount ?? 0} onChange={e => upd({ amount: parseFloat(e.target.value) || 0 })} /></div>
              <div className={styles.formGroup}><label>Customer Email</label><input value={step.customer_email || ''} onChange={e => upd({ customer_email: e.target.value })} placeholder="e.g. {{lead.email}}" /></div>
              <div className={styles.formGroup}><label>Due In (days)</label><input type="number" min={1} value={step.due_days ?? 7} onChange={e => upd({ due_days: parseInt(e.target.value) || 7 })} /></div>
            </>
          )}

          {/* Payments: mark_invoice_paid / send_receipt */}
          {(step.type === 'mark_invoice_paid' || step.type === 'send_receipt') && (
            <>
              <div className={styles.formGroup}><label>Invoice ID</label><input value={step.invoice_id || ''} onChange={e => upd({ invoice_id: e.target.value })} placeholder="e.g. {{invoice_id}}" /></div>
              {step.type === 'send_receipt' && (
                <div className={styles.formGroup}><label>Receipt Email Template ID <small style={{ color: '#9CA3AF' }}>(optional)</small></label><input value={step.template_id || ''} onChange={e => upd({ template_id: e.target.value })} /></div>
              )}
            </>
          )}

          {/* Webhooks: send_webhook / call_api_endpoint */}
          {(step.type === 'send_webhook' || step.type === 'call_api_endpoint') && (
            <div className={styles.formGroup}><label>Webhook URL</label><input value={step.url || ''} onChange={e => upd({ url: e.target.value })} placeholder="https://api.example.com/webhook" /></div>
          )}

          {/* Misc: log_event / add_audit_record */}
          {(step.type === 'log_event' || step.type === 'add_audit_record') && (
            <div className={styles.formGroup}><label>Audit Message</label><textarea value={step.description || ''} onChange={e => upd({ description: e.target.value })} /></div>
          )}

          {/* Misc: update_custom_field */}
          {step.type === 'update_custom_field' && (
            <>
              <div className={styles.formGroup}><label>Field Name</label><input value={step.field_name || ''} onChange={e => upd({ field_name: e.target.value })} placeholder="e.g. industry" /></div>
              <div className={styles.formGroup}><label>Field Value</label><input value={step.field_value || ''} onChange={e => upd({ field_value: e.target.value })} /></div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function WorkflowBuilderModal({ workflow, onClose, onSaved }: {
  workflow: Workflow | null;
  onClose: () => void;
  onSaved: (wf: Workflow) => void;
}) {
  const isEdit = !!workflow;
  const [name, setName] = useState(workflow?.name || '');
  const [description, setDescription] = useState(workflow?.description || '');
  const [trigger, setTrigger] = useState(workflow?.trigger || 'lead.created');
  const [actions, setActions] = useState<ActionStep[]>(
    (workflow as any)?.flow_data?.actions || []
  );
  const [templates, setTemplates] = useState<{ id: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [stepSearch, setStepSearch] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowAddMenu(false);
      }
    };
    if (showAddMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showAddMenu]);

  useEffect(() => {
    const fetchTemplates = async () => {
      try {
        const emailTemplates = await emailApi.getTemplates();
        setTemplates(emailTemplates || []);
      } catch (err) {
        console.error('Failed to load email templates for builder:', err);
      }
    };
    fetchTemplates();
  }, []);

  const addAction = (type: string = 'send_email') => {
    setActions(prev => [
      ...prev,
      { id: `step_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`, type }
    ]);
    setShowAddMenu(false);
    setStepSearch('');
  };

  const updateAction = (index: number, updated: ActionStep) => {
    setActions(prev => prev.map((a, i) => i === index ? updated : a));
  };

  const deleteAction = (index: number) => {
    setActions(prev => prev.filter((_, i) => i !== index));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('Name is required'); return; }
    setSaving(true);
    setError('');
    try {
      const payload: Partial<Workflow> = {
        name: name.trim(),
        description: description.trim(),
        trigger,
        flow_data: { actions } as any,
        is_active: workflow?.is_active ?? true,
      };
      let saved: Workflow;
      if (isEdit) {
        saved = await automationsApi.updateWorkflow(workflow!.id, payload);
      } else {
        saved = await automationsApi.createWorkflow(payload);
      }
      onSaved(saved);
    } catch (e: any) {
      setError(e.message || 'Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const groupedTriggers = TRIGGER_OPTIONS.reduce((acc, curr) => {
    if (!acc[curr.category]) acc[curr.category] = [];
    acc[curr.category].push(curr);
    return acc;
  }, {} as Record<string, typeof TRIGGER_OPTIONS>);

  const filteredStepTypes = ACTION_TYPES.filter(a =>
    a.label.toLowerCase().includes(stepSearch.toLowerCase()) ||
    a.category.toLowerCase().includes(stepSearch.toLowerCase()) ||
    a.value.toLowerCase().includes(stepSearch.toLowerCase())
  );

  const groupedFilteredActions = filteredStepTypes.reduce((acc, curr) => {
    if (!acc[curr.category]) acc[curr.category] = [];
    acc[curr.category].push(curr);
    return acc;
  }, {} as Record<string, typeof ACTION_TYPES>);

  return (
    <div className={styles.modalOverlay}>
      <div style={{ background: 'var(--surface-color)', borderRadius: 12, padding: 24, width: 660, maxWidth: '96vw', maxHeight: '92vh', overflowY: 'auto' }}>
        <div className={styles.modalHeader}>
          <h2>{isEdit ? '✏️ Edit Automation' : '🚀 Create Automation'}</h2>
          <button type="button" onClick={onClose}><X size={20} /></button>
        </div>

        {/* Templates library in one-click import */}
        {!isEdit && (
          <div style={{ marginBottom: 20, background: '#F5F3FF', border: '1px solid #DDD6FE', padding: 14, borderRadius: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#6D28D9', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              🪄 Start with a template library option:
            </span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 8 }}>
              {AUTOMATION_TEMPLATES.map(tmpl => (
                <button
                  key={tmpl.name}
                  type="button"
                  onClick={() => {
                    setName(tmpl.name);
                    setDescription(tmpl.description);
                    setTrigger(tmpl.trigger);
                    setActions(tmpl.actions.map((act, i) => ({ ...act, id: `step_${Date.now()}_${i}` })));
                  }}
                  style={{ background: 'white', border: '1px solid #DDD6FE', borderRadius: 6, padding: '10px', textAlign: 'left', cursor: 'pointer', transition: 'all 0.2s', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = '#7C3AED'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = '#DDD6FE'}
                >
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#1F2937' }}>{tmpl.name}</div>
                  <div style={{ fontSize: 9, color: '#6B7280', marginTop: 2, height: 24, overflow: 'hidden' }}>{tmpl.description}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        <form onSubmit={handleSave}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 12, marginBottom: 14 }}>
            <div className={styles.formGroup} style={{ margin: 0 }}>
              <label>Automation Name *</label>
              <input required value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Welcome Email on Lead Created" />
            </div>
            <div className={styles.formGroup} style={{ margin: 0 }}>
              <label>Trigger Event *</label>
              <select value={trigger} onChange={e => setTrigger(e.target.value)}>
                {Object.entries(groupedTriggers).map(([category, items]) => (
                  <optgroup key={category} label={category}>
                    {items.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
          </div>
          <div className={styles.formGroup}>
            <label>Description</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="What does this automation do?" rows={2} />
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontWeight: 700, fontSize: 14, color: '#374151' }}>Action Steps <small style={{ color: '#9CA3AF', fontWeight: 400 }}>({actions.length} steps)</small></span>
              
              <div style={{ position: 'relative', marginLeft: 'auto' }} ref={menuRef}>
                <button type="button" onClick={() => setShowAddMenu(!showAddMenu)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#EEF2FF', color: '#5B48E5', border: '1px solid #C7D2FE', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  <Plus size={14} /> Add Step <ChevronDown size={14} style={{ transform: showAddMenu ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                </button>

                {showAddMenu && (
                  <div
                    style={{
                      position: 'absolute',
                      right: 0,
                      top: 'calc(100% + 4px)',
                      width: 280,
                      maxHeight: 340,
                      overflowY: 'auto',
                      background: 'white',
                      border: '1px solid #E5E7EB',
                      borderRadius: 8,
                      boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
                      zIndex: 100,
                      padding: '6px 0',
                    }}
                  >
                    <div style={{ padding: '6px 10px 8px 10px', borderBottom: '1px solid #F3F4F6' }}>
                      <input
                        type="text"
                        placeholder="Search step type..."
                        value={stepSearch}
                        onChange={e => setStepSearch(e.target.value)}
                        onClick={e => e.stopPropagation()}
                        autoFocus
                        style={{
                          width: '100%',
                          padding: '6px 10px',
                          fontSize: 12,
                          border: '1px solid #D1D5DB',
                          borderRadius: 6,
                          outline: 'none',
                          boxSizing: 'border-box',
                        }}
                      />
                    </div>

                    {filteredStepTypes.length === 0 ? (
                      <div style={{ padding: '12px', fontSize: 12, color: '#9CA3AF', textAlign: 'center' }}>
                        No matching step types
                      </div>
                    ) : (
                      Object.entries(groupedFilteredActions).map(([category, items]) => (
                        <div key={category} style={{ borderBottom: '1px solid #F3F4F6' }}>
                          <div
                            style={{
                              padding: '6px 12px 4px',
                              fontSize: 10,
                              fontWeight: 700,
                              textTransform: 'uppercase',
                              letterSpacing: '0.05em',
                              color: '#6B7280',
                              background: '#F9FAFB',
                            }}
                          >
                            {category}
                          </div>
                          {items.map(item => (
                            <button
                              key={item.value}
                              type="button"
                              onClick={() => addAction(item.value)}
                              style={{
                                display: 'block',
                                width: '100%',
                                textAlign: 'left',
                                padding: '8px 12px',
                                fontSize: 12,
                                color: '#374151',
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                transition: 'background 0.15s',
                              }}
                              onMouseEnter={e => (e.currentTarget.style.background = '#F3F4F6')}
                              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                            >
                              {item.label}
                            </button>
                          ))}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>

            {actions.length === 0 && (
              <div style={{ background: '#F9FAFB', border: '2px dashed #E5E7EB', borderRadius: 8, padding: '24px', textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>
                No steps defined. Click "Add Step" or load a template above.
              </div>
            )}

            {actions.map((action, i) => (
              <ActionStepEditor
                key={action.id}
                index={i}
                step={action}
                onChange={(updated) => updateAction(i, updated)}
                onDelete={() => deleteAction(i)}
                templates={templates}
              />
            ))}
          </div>

          {error && <div style={{ color: '#EF4444', fontSize: 13, marginBottom: 10 }}>{error}</div>}

          <div className={styles.modalActions}>
            <button type="button" className={styles.cancelBtn} onClick={onClose}>Cancel</button>
            <button type="submit" className={styles.submitBtn} disabled={saving}>
              {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Automation'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function TestWorkflowModal({ workflow, onClose }: { workflow: Workflow; onClose: () => void }) {
  const [payload, setPayload] = useState('{\n  "email": "test@example.com",\n  "first_name": "John",\n  "last_name": "Doe",\n  "phone": "+123456789"\n}');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState('');

  const handleTest = async () => {
    setRunning(true);
    setResult('');
    try {
      const parsed = JSON.parse(payload);
      const res = await automationsApi.testWorkflow(workflow.id, parsed);
      setResult(`Test run initiated successfully!\nExecution ID: ${res.execution_id}`);
    } catch (e: any) {
      setResult(`Error: ${e.message || 'Invalid JSON format'}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className={styles.modalOverlay}>
      <div style={{ background: 'var(--surface-color)', borderRadius: 12, padding: 24, width: 480, maxWidth: '95vw' }}>
        <div className={styles.modalHeader}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Terminal size={20} color="#5B48E5" /> Test Automation</h2>
          <button type="button" onClick={onClose}><X size={20} /></button>
        </div>
        <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 12 }}>
          Simulate a workflow trigger for <strong>"{workflow.name}"</strong> by providing a mock JSON payload.
        </p>

        <div className={styles.formGroup}>
          <label>JSON Context Data</label>
          <textarea
            value={payload}
            onChange={e => setPayload(e.target.value)}
            rows={6}
            style={{ fontFamily: 'Courier, monospace', fontSize: 12 }}
          />
        </div>

        {result && (
          <div style={{ background: '#F3F4F6', border: '1px solid #E5E7EB', padding: 12, borderRadius: 6, fontFamily: 'monospace', fontSize: 11, marginBottom: 14, whiteSpace: 'pre-wrap' }}>
            {result}
          </div>
        )}

        <div className={styles.modalActions}>
          <button type="button" className={styles.cancelBtn} onClick={onClose} disabled={running}>Close</button>
          <button type="button" className={styles.submitBtn} onClick={handleTest} disabled={running} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Play size={13} /> {running ? 'Running...' : 'Execute Test'}
          </button>
        </div>
      </div>
    </div>
  );
}

export const AutomationsPage = () => {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editingWf, setEditingWf] = useState<Workflow | null>(null);
  const [testingWf, setTestingWf] = useState<Workflow | null>(null);

  // Tabs navigation
  const [activeTab, setActiveTab] = useState<'workflows' | 'history'>('workflows');
  const [executions, setExecutions] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [expandedExecs, setExpandedExecs] = useState<Record<string, boolean>>({});
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchLogQuery, setSearchLogQuery] = useState<string>('');

  useEffect(() => {
    fetchWorkflows();
  }, []);

  const fetchWorkflows = async () => {
    setLoading(true);
    try {
      const data = await automationsApi.getWorkflows();
      setWorkflows(data || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const fetchExecutions = async () => {
    setLoadingHistory(true);
    try {
      const data = await automationsApi.getExecutions();
      setExecutions(data || []);
    } catch (e) { console.error(e); }
    finally { setLoadingHistory(false); }
  };

  useEffect(() => {
    if (activeTab === 'history') {
      fetchExecutions();
    }
  }, [activeTab]);

  const handleToggle = async (wf: Workflow) => {
    try {
      const updated = await automationsApi.updateWorkflow(wf.id, { is_active: !wf.is_active });
      setWorkflows(workflows.map(w => w.id === updated.id ? updated : w));
    } catch (e) { console.error(e); }
  };

  const handleDelete = async (wf: Workflow) => {
    if (!window.confirm(`Delete automation "${wf.name}"?`)) return;
    try {
      await automationsApi.deleteWorkflow(wf.id);
      setWorkflows(prev => prev.filter(w => w.id !== wf.id));
    } catch (e) { console.error(e); }
  };

  const handleSaved = (saved: Workflow) => {
    setWorkflows(prev => {
      const exists = prev.find(w => w.id === saved.id);
      return exists ? prev.map(w => w.id === saved.id ? saved : w) : [saved, ...prev];
    });
    setBuilderOpen(false);
    setEditingWf(null);
  };

  const toggleExec = (id: string) => {
    setExpandedExecs(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const filteredExecutions = executions.filter(exec => {
    const matchesStatus = statusFilter === 'ALL' || exec.status === statusFilter;
    const query = searchLogQuery.toLowerCase().trim();
    const matchesQuery = !query ||
      (exec.workflow_name && exec.workflow_name.toLowerCase().includes(query)) ||
      (exec.trigger_event && exec.trigger_event.toLowerCase().includes(query)) ||
      (exec.error_message && exec.error_message.toLowerCase().includes(query));
    return matchesStatus && matchesQuery;
  });

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1>⚙️ Workflow Automation Engine</h1>
          <p className={styles.subtitle}>Put your CRM processes, messaging, and pipeline stages on autopilot.</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ display: 'flex', background: '#E5E7EB', padding: 2, borderRadius: 8 }}>
            <button
              onClick={() => setActiveTab('workflows')}
              style={{ display: 'flex', alignItems: 'center', gap: 4, border: 'none', background: activeTab === 'workflows' ? 'white' : 'none', padding: '6px 12px', fontSize: 13, fontWeight: 600, borderRadius: 6, cursor: 'pointer', color: activeTab === 'workflows' ? '#1F2937' : '#4B5563' }}
            >
              <Zap size={14} /> Workflows
            </button>
            <button
              onClick={() => setActiveTab('history')}
              style={{ display: 'flex', alignItems: 'center', gap: 4, border: 'none', background: activeTab === 'history' ? 'white' : 'none', padding: '6px 12px', fontSize: 13, fontWeight: 600, borderRadius: 6, cursor: 'pointer', color: activeTab === 'history' ? '#1F2937' : '#4B5563' }}
            >
              <History size={14} /> Execution Logs
            </button>
          </div>
          {activeTab === 'workflows' && (
            <button className={styles.addBtn} onClick={() => { setEditingWf(null); setBuilderOpen(true); }}>
              <Plus size={18} /> Create Automation
            </button>
          )}
        </div>
      </div>

      {activeTab === 'workflows' ? (
        <>
          {loading && <div className={styles.stateMsg}>Loading workflows…</div>}

          <div className={styles.grid}>
            {!loading && workflows.map(wf => {
              const actionCount = (wf as any).flow_data?.actions?.length ?? 0;
              return (
                <div key={wf.id} className={`${styles.card} ${wf.is_active ? styles.active : styles.inactive}`}>
                  <div className={styles.cardTop}>
                    <div className={styles.cardIcon}>
                      <Zap size={20} color={wf.is_active ? '#5B48E5' : '#9CA3AF'} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <button className={styles.toggleBtn} onClick={() => handleToggle(wf)}
                        title={wf.is_active ? 'Deactivate' : 'Activate'}>
                        {wf.is_active ? <ToggleRight size={28} color="#5B48E5" /> : <ToggleLeft size={28} color="#9CA3AF" />}
                      </button>
                    </div>
                  </div>
                  <h3 className={styles.cardTitle}>{wf.name}</h3>
                  <p className={styles.cardDesc}>{wf.description || 'No description provided.'}</p>
                  <div className={styles.triggerBadge} style={{ marginBottom: 6 }}>
                    <Settings2 size={12} /> {TRIGGER_OPTIONS.find(t => t.value === wf.trigger)?.label || wf.trigger}
                  </div>
                  <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 12 }}>
                    {actionCount} action step{actionCount !== 1 ? 's' : ''}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #F3F4F6', paddingTop: 12 }}>
                    <div className={`${styles.statusLabel} ${wf.is_active ? styles.labelActive : styles.labelInactive}`} style={{ margin: 0 }}>
                      {wf.is_active ? '● Active' : '○ Inactive'}
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        onClick={() => setTestingWf(wf)}
                        style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#059669', background: 'none', border: '1px solid #A7F3D0', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontWeight: 600 }}>
                        <Play size={11} /> Test
                      </button>
                      <button
                        onClick={() => { setEditingWf(wf); setBuilderOpen(true); }}
                        style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#5B48E5', background: 'none', border: '1px solid #C7D2FE', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontWeight: 600 }}>
                        <Edit3 size={11} /> Edit
                      </button>
                      <button
                        onClick={() => handleDelete(wf)}
                        style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#EF4444', background: 'none', border: '1px solid #FECACA', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontWeight: 600 }}>
                        <Trash2 size={11} /> Delete
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

            {!loading && workflows.length === 0 && (
              <div className={styles.emptyState}>
                <Zap size={48} style={{ opacity: 0.2, marginBottom: 12 }} />
                <h3>No automations configured</h3>
                <p>Launch your first automated trigger-action sequence to automate lead engagement.</p>
              </div>
            )}
          </div>
        </>
      ) : (
        <div style={{ background: 'white', borderRadius: 12, border: '1px solid #E5E7EB', padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: '#1F2937' }}>Workflow Execution History & Logs</h3>
            <button
              type="button"
              onClick={fetchExecutions}
              disabled={loadingHistory}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: '#F3F4F6',
                color: '#374151',
                border: '1px solid #D1D5DB',
                borderRadius: 6,
                padding: '6px 12px',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              <History size={14} /> Refresh Logs
            </button>
          </div>

          <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <input
                type="text"
                placeholder="Filter by workflow name, trigger, or error..."
                value={searchLogQuery}
                onChange={e => setSearchLogQuery(e.target.value)}
                style={{
                  width: '100%',
                  padding: '7px 12px',
                  fontSize: 12,
                  border: '1px solid #D1D5DB',
                  borderRadius: 6,
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#6B7280' }}>Status:</span>
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                style={{
                  padding: '6px 10px',
                  fontSize: 12,
                  border: '1px solid #D1D5DB',
                  borderRadius: 6,
                  background: 'white',
                  color: '#374151',
                  outline: 'none',
                  cursor: 'pointer'
                }}
              >
                <option value="ALL">All Statuses ({executions.length})</option>
                <option value="Completed">Completed ({executions.filter(e => e.status === 'Completed').length})</option>
                <option value="Running">Running ({executions.filter(e => e.status === 'Running').length})</option>
                <option value="Failed">Failed ({executions.filter(e => e.status === 'Failed').length})</option>
              </select>
            </div>
          </div>

          {loadingHistory && <div className={styles.stateMsg}>Loading execution logs…</div>}
          
          {!loadingHistory && executions.length === 0 && (
            <div style={{ textAlign: 'center', padding: '60px', color: '#9CA3AF' }}>
              <ClipboardList size={40} style={{ opacity: 0.3, marginBottom: 10 }} />
              <p>No executions have run yet.</p>
            </div>
          )}

          {!loadingHistory && executions.length > 0 && filteredExecutions.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px', color: '#9CA3AF', fontSize: 13 }}>
              No executions match your selected filters.
            </div>
          )}

          {!loadingHistory && filteredExecutions.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #E5E7EB', textAlign: 'left', color: '#4B5563' }}>
                    <th style={{ padding: '12px 10px' }}>Workflow</th>
                    <th style={{ padding: '12px 10px' }}>Status</th>
                    <th style={{ padding: '12px 10px' }}>Started At</th>
                    <th style={{ padding: '12px 10px' }}>Duration</th>
                    <th style={{ padding: '12px 10px' }}>Logs</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredExecutions.map(exec => {
                    const isExpanded = !!expandedExecs[exec.id];
                    const statusColor = exec.status === 'Completed' ? '#10B981' : exec.status === 'Running' ? '#3B82F6' : '#EF4444';
                    return (
                      <React.Fragment key={exec.id}>
                        <tr style={{ borderBottom: '1px solid #F3F4F6' }}>
                          <td style={{ padding: '12px 10px', fontWeight: 600 }}>{exec.workflow_name}</td>
                          <td style={{ padding: '12px 10px' }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: `${statusColor}15`, color: statusColor, padding: '3px 8px', borderRadius: 12, fontSize: 11, fontWeight: 700 }}>
                              ● {exec.status}
                            </span>
                          </td>
                          <td style={{ padding: '12px 10px', color: '#6B7280' }}>
                            {exec.started_at ? new Date(exec.started_at).toLocaleString() : 'N/A'}
                          </td>
                          <td style={{ padding: '12px 10px', color: '#6B7280' }}>
                            {exec.execution_duration != null ? `${exec.execution_duration.toFixed(2)}s` : '—'}
                          </td>
                          <td style={{ padding: '12px 10px' }}>
                            <button
                              onClick={() => toggleExec(exec.id)}
                              style={{ border: 'none', background: 'none', color: '#5B48E5', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                            >
                              {exec.logs?.length || 0} step logs {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            </button>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr>
                            <td colSpan={5} style={{ background: '#F9FAFB', padding: '12px 16px' }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                <strong style={{ fontSize: 11, color: '#4B5563' }}>STEP RESOLUTIONS DETAIL LOGS:</strong>
                                {exec.logs && exec.logs.map((log: any, idx: number) => (
                                  <div key={log.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, borderLeft: '2px solid #5B48E5', paddingLeft: 10 }}>
                                    <div style={{ fontSize: 12 }}>
                                      <span style={{ fontWeight: 700, color: '#1F2937' }}>[{idx + 1}] {log.action}</span>
                                      <span style={{ marginLeft: 8, fontSize: 10, background: log.status === 'Success' ? '#DEF7EC' : '#FDE8E8', color: log.status === 'Success' ? '#03543F' : '#9B1C1C', padding: '1px 6px', borderRadius: 4, fontWeight: 600 }}>
                                        {log.status}
                                      </span>
                                      <div style={{ fontSize: 10, color: '#6B7280', marginTop: 2, fontFamily: 'monospace' }}>
                                        JSON Payload: {JSON.stringify(log.log_data)}
                                      </div>
                                    </div>
                                  </div>
                                ))}
                                {(!exec.logs || exec.logs.length === 0) && (
                                  <span style={{ fontSize: 12, color: '#9CA3AF' }}>No details logged yet for this running execution.</span>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {builderOpen && (
        <WorkflowBuilderModal
          workflow={editingWf}
          onClose={() => { setBuilderOpen(false); setEditingWf(null); }}
          onSaved={handleSaved}
        />
      )}

      {testingWf && (
        <TestWorkflowModal
          workflow={testingWf}
          onClose={() => setTestingWf(null)}
        />
      )}
    </div>
  );
};
