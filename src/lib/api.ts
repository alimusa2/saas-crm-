const API_BASE = import.meta.env.VITE_API_BASE || '/api/v1';

function getToken(): string | null {
  return localStorage.getItem('access_token');
}

export function setToken(token: string): void {
  localStorage.setItem('access_token', token);
}

export function clearToken(): void {
  localStorage.removeItem('access_token');
}

// Transparent in-memory response cache for GET requests to make component navigation instant
const apiCache = new Map<string, { timestamp: number; data: any }>();
const CACHE_TTL_MS = 10000; // 10 seconds cache window

export function clearApiCache(): void {
  apiCache.clear();
}

export async function api<T = unknown>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const method = (init.method || 'GET').toUpperCase();

  // Automatically invalidate cache on state mutations (POST, PUT, PATCH, DELETE)
  if (method !== 'GET') {
    clearApiCache();
  }

  // Serve from in-memory cache for GET requests unless explicitly bypassed with cache: 'no-store'
  const isCacheable = method === 'GET' && init.cache !== 'no-store';
  if (isCacheable) {
    const cached = apiCache.get(path);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.data as T;
    }
  }

  const token = getToken();
  const headers: Record<string, string> = {
    ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
    ...(init.headers as Record<string, string> ?? {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new Error('API request timed out after 30 seconds'));
  }, 30000);

  try {
    const resp = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers,
      signal: init.signal || controller.signal,
    });

    if (!resp.ok) {
      if (resp.status === 401) {
        clearToken();
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event('auth:unauthorized'));
        }
      }
      let msg = `HTTP ${resp.status}`;
      let detail: any = null;
      try {
        const j = await resp.json();
        detail = j.detail;
        msg = typeof detail === 'string' ? detail : (detail?.message ?? msg);
      } catch {}
      const err = new Error(msg) as any;
      err.status = resp.status;
      err.detail = detail;
      throw err;
    }
    // 204 No Content
    if (resp.status === 204) return undefined as T;

    const data = await resp.json();
    if (isCacheable) {
      apiCache.set(path, { timestamp: Date.now(), data });
    }
    return data as T;
  } finally {
    clearTimeout(timeoutId);
  }
}


// ─── Typed helpers ───────────────────────────────────────────────────────────

export type Lead = {
  id: string;
  first_name: string;
  last_name: string;
  email?: string;
  phone?: string;
  status: string;
  priority: string;
  lead_source?: string;
  lead_score: number;
  organization_id: string;
  created_at: string;
  updated_at: string;
  automatic_score?: number;
  manual_score?: number;
  is_score_manual?: boolean;
  score_source?: string;
  score_history?: string;
  score_last_updated?: string;
  company_id?: string;
  owner_id?: string;
};

export type RelatedLeadSummary = {
  id: string;
  first_name: string;
  last_name: string;
  email?: string;
  phone?: string;
  company_name?: string;
  pipeline_stage?: string;
  lead_score: number;
  lead_source?: string;
  assigned_salesperson?: string;
  status: string;
  last_activity_date?: string;
};

export type Task = {
  id: string;
  title: string;
  description?: string;
  due_date?: string;
  status: string;
  priority: string;
  is_completed: boolean;
  lead_id?: string;
  owner_id?: string;
  organization_id: string;
  created_at: string;
  updated_at: string;
  assigned_to_id?: string;
  assigned_by_id?: string;
  assigned_at?: string;
  department?: string;
  lead_ids?: string[];
  related_leads?: RelatedLeadSummary[];
};

export type Pipeline = {
  id: string;
  name: string;
  description?: string;
  organization_id: string;
};

export type Stage = {
  id: string;
  name: string;
  order: number;
  pipeline_id: string;
  organization_id: string;
};

export type Deal = {
  id: string;
  title: string;
  value?: number;
  status: string;
  stage_id: string;
  owner_id?: string;
  organization_id: string;
  created_at: string;
  updated_at: string;
};

export type LoginResponse = {
  access_token: string;
  token_type: string;
};

export type UserRegister = {
  email: string;
  password: string;
  first_name?: string;
  last_name?: string;
  organization_name: string;
};

// ─── Forms ───────────────────────────────────────────────────────────────────
export type FormField = {
  id: string;
  name: string;
  label: string;
  field_type: string;
  is_required: boolean;
  order: number;
};

export type Form = {
  id: string;
  title: string;
  description?: string;
  embed_code?: string;
  is_active: boolean;
  fields?: FormField[];
};

// ─── Email ───────────────────────────────────────────────────────────────────
export type EmailTemplate = {
  id: string;
  name: string;
  subject: string;
  html_content: string;
};

export type EmailCampaign = {
  id: string;
  name: string;
  template_id: string;
  status: string;
};

export type RecipientFilter = {
  type: string;
  value?: string;
};

export type Campaign = {
  id: string;
  name: string;
  subject: string;
  description?: string;
  status: string;
  template_id?: string;
  sender_gmail_account?: string;
  reply_to?: string;
  recipient_filter?: RecipientFilter;
  scheduled_for?: string;
  sent_at?: string;
  completed_at?: string;
  recipient_count: number;
  sent_count: number;
  failed_count: number;
  reply_count: number;
  created_by_id?: string;
  organization_id: string;
  created_at: string;
  updated_at: string;
};

export type CampaignRecipient = {
  id: string;
  campaign_id: string;
  recipient_email: string;
  lead_id?: string;
  contact_id?: string;
  email_log_id?: string;
  status: string;
  error_message?: string;
  skipped_reason?: string;
  sent_at?: string;
  organization_id: string;
  created_at: string;
};

export type RecipientPreview = {
  email: string;
  first_name?: string;
  last_name?: string;
  lead_id?: string;
  contact_id?: string;
};

export type CampaignReview = {
  campaign_id: string;
  campaign_name: string;
  subject: string;
  template_name?: string;
  gmail_account?: string;
  gmail_connected: boolean;
  recipient_count: number;
  duplicate_count: number;
  recipients_preview: RecipientPreview[];
  warnings: string[];
  can_send: boolean;
};

export type CampaignAnalytics = {
  campaign_id: string;
  recipient_count: number;
  queued_count: number;
  sent_count: number;
  failed_count: number;
  skipped_count: number;
  reply_count: number;
  success_rate: number;
  duration_seconds?: number;
};


// ─── Notifications ───────────────────────────────────────────────────────────
export type Notification = {
  id: string;
  type: string; // Success, Warning, Error, Reminder, Task
  title: string;
  content?: string;
  is_read: boolean;
  created_at: string;
};

// ─── Funnels ─────────────────────────────────────────────────────────────────
export type Funnel = {
  id: string;
  name: string;
  description?: string;
  type: string;
  is_active: boolean;
  status: string; // Draft | Published
  published_url?: string;
  published_at?: string;
  organization_id: string;
  created_at: string;
  steps?: FunnelStep[];
  settings?: Record<string, any>;
};

export type FunnelComponent = {
  id: string;
  step_id: string;
  type: string;
  order: number;
  config?: string; // JSON string of component settings
  organization_id: string;
};

export type FunnelStep = {
  id: string;
  name: string;
  order: number;
  funnel_id: string;
  form_id?: string | null;
  title?: string;
  heading?: string;
  paragraph_text?: string;
  image_url?: string;
  button_text?: string;
  background_color?: string;
  next_step_id?: string;
  status?: string;
  action_type?: string;
  action_value?: string;
  components?: FunnelComponent[];
  page_content?: string;
  // Builder layout (JSON string or parsed object)
  layout?: string | any;
  // Legacy step fields
  header_text?: string;
  subheader_text?: string;
  organization_id: string;
  created_at: string;
};

export type FunnelAnalytics = {
  funnel_id: string;
  total_visits: number;
  total_conversions: number;
  completion_rate: number;
  unique_visitors: number;
  form_submissions: number;
  conversion_rate: number;
  most_visited_step?: string;
  steps: {
    step_id: string;
    name: string;
    order: number;
    visits: number;
    conversions: number;
    conversion_rate: number;
    drop_off_rate: number;
  }[];
};


// ─── Auth ────────────────────────────────────────────────────────────────────
export const authApi = {
  login: (email: string, password: string) => {
    const body = new URLSearchParams({ username: email, password });
    return api<LoginResponse>('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  },
  register: (data: UserRegister) =>
    api('/auth/register', { method: 'POST', body: JSON.stringify(data) }),
  me: () => api('/auth/me'),
};

export type Company = {
  id: string;
  name: string;
  website?: string;
  industry?: string;
  address?: string;
  tax_information?: string;
  organization_id: string;
  created_at: string;
  updated_at: string;
};

// ─── CRM ─────────────────────────────────────────────────────────────────────
export const crmApi = {
  getLeads: (
    skip = 0,
    limit = 100,
    filters?: {
      search?: string;
      pipeline_stage?: string;
      lead_score_min?: number;
      lead_score_max?: number;
      lead_source?: string;
      assigned_salesperson_id?: string;
      status?: string;
      recently_created?: boolean;
      last_activity_days?: number;
      company_name?: string;
    }
  ) => {
    const params = new URLSearchParams({ skip: String(skip), limit: String(limit) });
    if (filters) {
      Object.entries(filters).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') {
          params.append(k, String(v));
        }
      });
    }
    return api<Lead[]>(`/crm/leads?${params.toString()}`);
  },
  getLeadSources: () => api<string[]>('/crm/leads/sources'),
  getLeadStatuses: () => api<string[]>('/crm/leads/statuses'),
  createLead: (data: Partial<Lead>, ignoreDuplicates = false) =>
    api<Lead>(`/crm/leads?ignore_duplicates=${ignoreDuplicates}`, { method: 'POST', body: JSON.stringify(data) }),
  mergeLead: (id: string, data: Partial<Lead>) =>
    api<Lead>(`/crm/leads/${id}/merge`, { method: 'POST', body: JSON.stringify(data) }),
  updateLead: (id: string, data: Partial<Lead>) =>
    api<Lead>(`/crm/leads/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteLead: (id: string) =>
    api(`/crm/leads/${id}`, { method: 'DELETE' }),
  getCompanies: (skip = 0, limit = 100) =>
    api<Company[]>(`/crm/companies?skip=${skip}&limit=${limit}`),
  createCompany: (data: Partial<Company>) =>
    api<Company>('/crm/companies', { method: 'POST', body: JSON.stringify(data) }),
  validateImport: (data: { filename: string; file_content_base64: string; field_mapping: Record<string, string> }) =>
    api<{ total_records: number; valid_records: number; invalid_records: number; warnings: string[] }>('/crm/leads/import/validate', { method: 'POST', body: JSON.stringify(data) }),
  startImport: (data: { filename: string; file_content_base64: string; field_mapping: Record<string, string>; duplicate_handling: string; run_automations: boolean }) =>
    api<any>('/crm/leads/import', { method: 'POST', body: JSON.stringify(data) }),
  getImportJobs: () =>
    api<any[]>('/crm/leads/import/jobs'),
  startExport: (data: { filters: any; format: string }) =>
    api<any>('/crm/leads/export', { method: 'POST', body: JSON.stringify(data) }),
  getExportJobs: () =>
    api<any[]>('/crm/leads/export/jobs'),
  overrideScore: (leadId: string, manualScore: number) =>
    api<Lead>(`/crm/leads/${leadId}/override-score?manual_score=${manualScore}`, { method: 'POST' }),
  resetScore: (leadId: string) =>
    api<Lead>(`/crm/leads/${leadId}/reset-score`, { method: 'POST' }),
};


// ─── Tasks ───────────────────────────────────────────────────────────────────
export const tasksApi = {
  getTasks: () => api<Task[]>('/tasks/'),
  createTask: (data: Partial<Task>) =>
    api<Task>('/tasks/', { method: 'POST', body: JSON.stringify(data) }),
  updateTask: (id: string, data: Partial<Task>) =>
    api<Task>(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteTask: (id: string) =>
    api(`/tasks/${id}`, { method: 'DELETE' }),
};

// ─── Pipeline ────────────────────────────────────────────────────────────────
export const pipelineApi = {
  getPipelines: () => api<Pipeline[]>('/pipeline/'),
  getDeals: () => api<Deal[]>('/pipeline/deals'),
  getStages: (pipelineId: string) =>
    api<Stage[]>(`/pipeline/${pipelineId}/stages`),
  getAllStages: () => api<Stage[]>('/pipeline/all-stages'),
  createDeal: (data: Partial<Deal>) =>
    api<Deal>('/pipeline/deals', { method: 'POST', body: JSON.stringify(data) }),
  updateDeal: (id: string, data: Partial<Deal>) =>
    api<Deal>(`/pipeline/deals/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteDeal: (id: string) =>
    api(`/pipeline/deals/${id}`, { method: 'DELETE' }),
};

// ─── Forms API ───────────────────────────────────────────────────────────────
export const formsApi = {
  getForms: () => api<Form[]>('/forms/'),
  getForm: (id: string) => api<Form>(`/forms/${id}`),
  createForm: (data: Partial<Form>) =>
    api<Form>('/forms/', { method: 'POST', body: JSON.stringify(data) }),
  getFields: (formId: string) =>
    api<FormField[]>(`/forms/${formId}/fields`),
  createField: (formId: string, data: Partial<FormField>) =>
    api<FormField>(`/forms/${formId}/fields`, { method: 'POST', body: JSON.stringify(data) }),
  deleteField: (formId: string, fieldId: string) =>
    api(`/forms/${formId}/fields/${fieldId}`, { method: 'DELETE' }),
  submitForm: (formId: string, data: any) =>
    api<any>(`/forms/${formId}/submit`, { method: 'POST', body: JSON.stringify(data) }),
};

// ─── Email API ───────────────────────────────────────────────────────────────
export const emailApi = {
  getTemplates: () => api<EmailTemplate[]>('/email/templates'),
  createTemplate: (data: Partial<EmailTemplate>) =>
    api<EmailTemplate>('/email/templates', { method: 'POST', body: JSON.stringify(data) }),
  getCampaigns: () => api<EmailCampaign[]>('/email/campaigns'),
  createCampaign: (data: Partial<EmailCampaign>) =>
    api<EmailCampaign>('/email/campaigns', { method: 'POST', body: JSON.stringify(data) }),
};

export const campaignsApi = {
  getCampaigns: () => api<Campaign[]>('/campaigns'),
  getCampaign: (id: string) => api<Campaign>(`/campaigns/${id}`),
  createCampaign: (data: Partial<Campaign>) =>
    api<Campaign>('/campaigns', { method: 'POST', body: JSON.stringify(data) }),
  updateCampaign: (id: string, data: Partial<Campaign>) =>
    api<Campaign>(`/campaigns/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteCampaign: (id: string) =>
    api(`/campaigns/${id}`, { method: 'DELETE' }),
  getReview: (id: string) =>
    api<CampaignReview>(`/campaigns/${id}/review`),
  queueCampaign: (id: string) =>
    api<Campaign>(`/campaigns/${id}/queue`, { method: 'POST' }),
  cancelCampaign: (id: string) =>
    api<Campaign>(`/campaigns/${id}/cancel`, { method: 'POST' }),
  resumeCampaign: (id: string) =>
    api<{ campaign_id: string; re_queued: number }>(`/campaigns/${id}/resume`, { method: 'POST' }),
  retryCampaign: (id: string) =>
    api<{ campaign_id: string; re_queued: number }>(`/campaigns/${id}/retry`, { method: 'POST' }),
  getRecipients: (id: string) =>
    api<CampaignRecipient[]>(`/campaigns/${id}/recipients`),
  getAnalytics: (id: string) =>
    api<CampaignAnalytics>(`/campaigns/${id}/analytics`),
  previewFilter: (filterType: string, filterValue?: string) => {
    const params = new URLSearchParams();
    params.append('filter_type', filterType);
    if (filterValue) params.append('filter_value', filterValue);
    return api<RecipientPreview[]>(`/campaigns/leads/filter?${params.toString()}`);
  },
};


// ─── Notifications API ───────────────────────────────────────────────────────
export const notificationsApi = {
  getNotifications: () => api<Notification[]>('/notifications/'),
  markAsRead: (id: string) =>
    api<Notification>(`/notifications/${id}/read`, { method: 'PATCH' }),
  markAllAsRead: () =>
    api('/notifications/mark-all-read', { method: 'POST' }),
};

// ─── Funnels API ─────────────────────────────────────────────────────────────
export const funnelsApi = {
  getFunnels: () => api<Funnel[]>('/funnels/'),
  getFunnel: (funnelId: string) => api<Funnel>(`/funnels/${funnelId}`),
  createFunnel: (data: Partial<Funnel>) =>
    api<Funnel>('/funnels/', { method: 'POST', body: JSON.stringify(data) }),
  deleteFunnel: (funnelId: string) =>
    api(`/funnels/${funnelId}`, { method: 'DELETE' }),
  publishFunnel: (funnelId: string) =>
    api<Funnel>(`/funnels/${funnelId}/publish`, { method: 'POST' }),
  unpublishFunnel: (funnelId: string) =>
    api<Funnel>(`/funnels/${funnelId}/unpublish`, { method: 'POST' }),
  getSteps: (funnelId: string) =>
    api<FunnelStep[]>(`/funnels/${funnelId}/steps`),
  createStep: (funnelId: string, data: Partial<FunnelStep>) =>
    api<FunnelStep>(`/funnels/${funnelId}/steps`, { method: 'POST', body: JSON.stringify(data) }),
  updateStep: (funnelId: string, stepId: string, data: Partial<FunnelStep>) =>
    api<FunnelStep>(`/funnels/${funnelId}/steps/${stepId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  duplicateStep: (funnelId: string, stepId: string) =>
    api<FunnelStep>(`/funnels/${funnelId}/steps/${stepId}/duplicate`, { method: 'POST' }),
  deleteStep: (funnelId: string, stepId: string) =>
    api(`/funnels/${funnelId}/steps/${stepId}`, { method: 'DELETE' }),
  getAnalytics: (funnelId: string) =>
    api<FunnelAnalytics>(`/funnels/${funnelId}/analytics`),
  getMediaLibrary: () =>
    api<any[]>('/funnels/media/library'),
  deleteMediaAsset: (id: string) =>
    api<any>(`/funnels/media/${id}`, { method: 'DELETE' }),
  trackPublicVisit: (funnelId: string, data: {
    step_id: string;
    session_id: string;
    event_type?: string;
    referrer?: string;
    device?: string;
    browser?: string;
    os?: string;
    utm_source?: string;
    utm_medium?: string;
    utm_campaign?: string;
    utm_term?: string;
    utm_content?: string;
    converted?: boolean;
  }) => fetch(`http://localhost:8000/api/v1/funnels/public/${funnelId}/visit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }),
  getPublicFunnel: (funnelId: string) =>
    fetch(`http://localhost:8000/api/v1/funnels/public/${funnelId}`).then(r => r.ok ? r.json() : Promise.reject('Funnel not found or not published')),
};

// ─── Contacts API ─────────────────────────────────────────────────────────────
export type Contact = {
  id: string;
  first_name: string;
  last_name: string;
  email?: string;
  phone?: string;
  company_id?: string;
  organization_id: string;
  created_at: string;
  updated_at: string;
};

export const contactsApi = {
  getContacts: (skip = 0, limit = 100) =>
    api<Contact[]>(`/crm/contacts?skip=${skip}&limit=${limit}`),
  createContact: (data: Partial<Contact>, ignoreDuplicates = false) =>
    api<Contact>(`/crm/contacts?ignore_duplicates=${ignoreDuplicates}`, { method: 'POST', body: JSON.stringify(data) }),
  mergeContact: (id: string, data: Partial<Contact>) =>
    api<Contact>(`/crm/contacts/${id}/merge`, { method: 'POST', body: JSON.stringify(data) }),
  updateContact: (id: string, data: Partial<Contact>) =>
    api<Contact>(`/crm/contacts/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteContact: (id: string) =>
    api(`/crm/contacts/${id}`, { method: 'DELETE' }),
};

// ─── Inbox API ────────────────────────────────────────────────────────────────
export type AttachmentMetadata = {
  id: string;
  filename: string;
  mime_type: string;
  size: number;
};

export type Message = {
  id: string;
  body: string;
  subject?: string;
  sender_id: string;
  recipient_id?: string;
  lead_id?: string;
  contact_id?: string;
  is_read: boolean;
  message_type: string;          // Internal | Email | SMS
  organization_id: string;
  created_at: string;
  // CRM tracking
  direction: string;             // Outgoing | Incoming
  delivery_status: string;       // Sending | Sent | Delivered | Failed | Draft
  sender_email?: string;
  recipient_email?: string;
  gmail_message_id?: string;
  error_message?: string;
  parent_id?: string;
  appointment_id?: string;
  task_id?: string;
  is_ambiguous?: boolean;
  // Extended Phase 1 Gmail Sync fields
  gmail_thread_id?: string;
  company_id?: string;
  is_starred?: boolean;
  is_archived?: boolean;
  is_unknown_contact?: boolean;
  attachments_metadata?: string;
};

export type EmailSendRequest = {
  to_email: string;
  subject: string;
  body: string;
  lead_id?: string;
  contact_id?: string;
  parent_id?: string;
  attachments?: Array<{ filename: string; url: string; mime_type?: string; size?: number }>;
};

export const inboxApi = {
  getMessages: (
    lead_id?: string,
    contact_id?: string,
    options?: { skip?: number; limit?: number; include_full_body?: boolean; thread_id?: string }
  ) => {
    const params = new URLSearchParams();
    if (lead_id) params.set('lead_id', lead_id);
    if (contact_id) params.set('contact_id', contact_id);
    if (options?.skip !== undefined) params.set('skip', options.skip.toString());
    if (options?.limit !== undefined) params.set('limit', options.limit.toString());
    if (options?.include_full_body !== undefined) params.set('include_full_body', options.include_full_body.toString());
    if (options?.thread_id) params.set('thread_id', options.thread_id);
    const qs = params.toString();
    return api<Message[]>(`/inbox/${qs ? '?' + qs : ''}`);
  },
  getMessage: (id: string) => api<Message>(`/inbox/${id}`),
  sendMessage: (data: Partial<Message>) =>
    api<Message>('/inbox/', { method: 'POST', body: JSON.stringify(data) }),
  sendEmail: (data: EmailSendRequest) =>
    api<Message>('/inbox/send-email', { method: 'POST', body: JSON.stringify(data) }),
  uploadAttachment: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api<{ filename: string; url: string; mime_type: string; size: number }>('/inbox/upload-attachment', {
      method: 'POST',
      body: formData,
    });
  },
  markAsRead: (id: string) =>
    api<Message>(`/inbox/${id}/read`, { method: 'PATCH' }),
  linkMessage: (id: string, data: { lead_id?: string; contact_id?: string }) =>
    api<Message>(`/inbox/${id}/link`, { method: 'PATCH', body: JSON.stringify(data) }),
  starMessage: (id: string) =>
    api<Message>(`/inbox/${id}/star`, { method: 'PATCH' }),
  archiveMessage: (id: string) =>
    api<Message>(`/inbox/${id}/archive`, { method: 'PATCH' }),
};


// ─── Gmail Integration API ────────────────────────────────────────────────────
export type GmailIntegration = {
  id?: string;
  organization_id?: string;
  gmail_address?: string;
  is_connected: boolean;
  connected_at?: string;
  provider: string;
  error_message?: string;
  last_synced_at?: string;
  sync_status?: string;
  last_sync_message?: string;
};

export type GmailSyncLog = {
  id: string;
  gmail_address?: string;
  started_at: string;
  completed_at?: string;
  status: string;
  imported_count: number;
  skipped_count: number;
  error_message?: string;
};

export const gmailApi = {
  getStatus: () => api<GmailIntegration>('/gmail/status'),
  getOAuthUrl: () => api<{ url: string }>('/gmail/oauth-url'),
  disconnect: () => api<GmailIntegration>('/gmail/disconnect', { method: 'POST' }),
  testConnection: () => api<{ success: boolean; message: string; gmail_address?: string }>('/gmail/test', { method: 'POST' }),
  syncNow: () => api<{ success: boolean; message: string; last_synced_at?: string }>('/gmail/sync-now', { method: 'POST' }),
  getSyncLogs: () => api<GmailSyncLog[]>('/gmail/sync-logs'),
  getAttachmentData: (messageId: string, attachmentId: string) =>
    api<{ success: boolean; data_base64?: string; error?: string }>(`/gmail/attachments/${messageId}/${attachmentId}`),
};


// ─── Reviews API ──────────────────────────────────────────────────────────────
export type Review = {
  id: string;
  reviewer_name: string;
  reviewer_email?: string;
  rating: number;
  title?: string;
  content?: string;
  source: string;
  status: string;
  is_featured: boolean;
  organization_id: string;
  created_at: string;
};

export const reviewsApi = {
  getReviews: () => api<Review[]>('/reviews/'),
  createReview: (data: Partial<Review>) =>
    api<Review>('/reviews/', { method: 'POST', body: JSON.stringify(data) }),
  updateReview: (id: string, data: Partial<Review>) =>
    api<Review>(`/reviews/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteReview: (id: string) =>
    api(`/reviews/${id}`, { method: 'DELETE' }),
};

// ─── Payments API ─────────────────────────────────────────────────────────────
export type Invoice = {
  id: string;
  number: string;
  amount: number;
  currency: string;
  status: string;
  description?: string;
  due_date?: string;
  paid_at?: string;
  related_entity_type?: string;
  related_entity_id?: string;
  recipient_name?: string;
  recipient_email?: string;
  recipient_phone?: string;
  recipient_company?: string;
  billing_address?: string;
  tax_information?: string;
  organization_id: string;
  created_at: string;
  items?: {
    id: string;
    description: string;
    quantity: number;
    unit_price: number;
    amount: number;
  }[];
};


export type PaymentRecord = {
  id: string;
  invoice_id: string;
  amount: number;
  method: string;
  reference?: string;
  status: string;
  organization_id: string;
  created_at: string;
};

export const paymentsApi = {
  getInvoices: () => api<Invoice[]>('/payments/invoices'),
  createInvoice: (data: Partial<Invoice>) =>
    api<Invoice>('/payments/invoices', { method: 'POST', body: JSON.stringify(data) }),
  updateInvoice: (id: string, data: Partial<Invoice>) =>
    api<Invoice>(`/payments/invoices/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  sendReminder: (id: string) =>
    api<{ status: string; message: string }>(`/payments/invoices/${id}/send-reminder`, { method: 'POST' }),
  triggerAutoReminders: (daysBefore: number = 1) =>
    api<{ status: string; reminded_count: number; days_before: number }>(`/payments/auto-reminders?days_before=${daysBefore}`, { method: 'POST' }),
  deleteInvoice: (id: string) =>
    api(`/payments/invoices/${id}`, { method: 'DELETE' }),
  getPayments: () => api<PaymentRecord[]>('/payments/payments'),
  recordPayment: (data: Partial<PaymentRecord>) =>
    api<PaymentRecord>('/payments/payments', { method: 'POST', body: JSON.stringify(data) }),
};

// ─── Integrations API ─────────────────────────────────────────────────────────
export type Integration = {
  id: string;
  name: string;
  slug: string;
  is_connected: boolean;
  description?: string;
  icon_url?: string;
  organization_id: string;
  created_at: string;
};

export const integrationsApi = {
  getIntegrations: () => api<Integration[]>('/integrations/'),
  toggleIntegration: (id: string, is_connected: boolean) =>
    api<Integration>(`/integrations/${id}/toggle`, { method: 'PATCH', body: JSON.stringify({ is_connected }) }),
};

// ─── Reports API ──────────────────────────────────────────────────────────────
export type ReportsOverview = {
  total_leads: number;
  total_revenue: number;
  pipeline_value: number;
  tasks_completed: number;
  tasks_pending: number;
  invoices_paid?: number;
  invoices_pending?: number;
  leads_by_status: { status: string; count: number }[];
  deals_by_status: { status: string; count: number; value: number }[];
  leads_by_source: { source: string; count: number }[];
};

export const reportsApi = {
  getOverview: () => api<ReportsOverview>('/reports/overview'),
};

// ─── Settings API ─────────────────────────────────────────────────────────────
export type UserProfile = {
  id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  is_active: boolean;
  organization_id: string;
  is_superuser: boolean;
};

export type OrgSettings = {
  id: string;
  name: string;
  domain?: string;
};

export const settingsApi = {
  getProfile: () => api<UserProfile>('/settings/profile'),
  updateProfile: (data: Partial<UserProfile>) =>
    api<UserProfile>('/settings/profile', { method: 'PATCH', body: JSON.stringify(data) }),
  getOrganization: () => api<OrgSettings>('/settings/organization'),
  updateOrganization: (data: Partial<OrgSettings>) =>
    api<OrgSettings>('/settings/organization', { method: 'PATCH', body: JSON.stringify(data) }),
};

// ─── Calendar API ─────────────────────────────────────────────────────────────
export type Appointment = {
  id: string;
  title: string;
  description?: string;
  start_time: string;
  end_time: string;
  status: string;
  location?: string;
  organizer_id: string;
  lead_id?: string;
  contact_id?: string;
  assigned_to_id?: string;
  related_entity_type?: string;
  related_entity_id?: string;
  display_name?: string;
  email?: string;
  phone?: string;
  organization_id: string;
  created_at: string;
  custom_message?: string;
};


export const calendarApi = {
  getAppointments: () => api<Appointment[]>('/calendar/'),
  createAppointment: (data: Partial<Appointment>) =>
    api<Appointment>('/calendar/', { method: 'POST', body: JSON.stringify(data) }),
  updateAppointment: (id: string, data: Partial<Appointment>) =>
    api<Appointment>(`/calendar/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  getMeetingAnalytics: () => api<any>('/calendar/analytics'),
  getMeetingTemplates: () => api<any[]>('/calendar/templates'),
  updateMeetingTemplate: (id: string, data: { subject: string; html_content: string }) =>
    api<any>(`/calendar/templates/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
};

// ─── Automations (Workflow) API ───────────────────────────────────────────────
export type Workflow = {
  id: string;
  name: string;
  description?: string;
  trigger: string;
  is_active: boolean;
  flow_data?: { actions: any[] };
  organization_id: string;
  created_at: string;
};

export const automationsApi = {
  getWorkflows: () => api<Workflow[]>('/workflow/'),
  getWorkflow: (id: string) => api<Workflow>(`/workflow/${id}`),
  createWorkflow: (data: Partial<Workflow>) =>
    api<Workflow>('/workflow/', { method: 'POST', body: JSON.stringify(data) }),
  updateWorkflow: (id: string, data: Partial<Workflow>) =>
    api<Workflow>(`/workflow/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteWorkflow: (id: string) =>
    api(`/workflow/${id}`, { method: 'DELETE' }),
  testWorkflow: (id: string, payload: any) =>
    api<{ message: string; execution_id: string }>(`/workflow/${id}/test`, { method: 'POST', body: JSON.stringify(payload) }),
  getExecutions: () =>
    api<any[]>('/workflow/executions'),
};

// ─── Team Management API ──────────────────────────────────────────────────────
export type TeamMember = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  job_title?: string;
  department: string;
  status: string; // Active / Inactive
  role: string;
  avatar?: string;
  notes?: string;
  user_id?: string;
  is_deleted?: boolean;
  organization_id: string;
  created_at: string;
  updated_at: string;
};

export type TeamMemberCreate = Omit<TeamMember, 'id' | 'user_id' | 'organization_id' | 'created_at' | 'updated_at'>;
export type TeamMemberUpdate = Partial<TeamMemberCreate>;

export const teamApi = {
  getTeamMembers: () => api<TeamMember[]>('/team/'),
  getTeamMember: (id: string) => api<TeamMember>(`/team/${id}`),
  getDepartments: () => api<string[]>('/team/departments'),
  createTeamMember: (data: TeamMemberCreate) =>
    api<TeamMember>('/team/', { method: 'POST', body: JSON.stringify(data) }),
  updateTeamMember: (id: string, data: TeamMemberUpdate) =>
    api<TeamMember>(`/team/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteTeamMember: (id: string) =>
    api(`/team/${id}`, { method: 'DELETE' }),
};

export const performanceApi = {
  getLeaderboard: (sortBy: string = 'revenue') =>
    api<any[]>(`/team/performance/leaderboard?sort_by=${sortBy}`),
  getEmployeePerformance: (memberId: string, startDate?: string, endDate?: string) => {
    const query = new URLSearchParams();
    if (startDate) query.set('start_date', startDate);
    if (endDate) query.set('end_date', endDate);
    const qStr = query.toString();
    return api<any>(`/team/performance/${memberId}${qStr ? `?${qStr}` : ''}`);
  },
  getExportUrl: (memberId: string, format: string = 'csv') =>
    `/api/v1/team/performance/${memberId}/export?format=${format}`,
};
