import React, { useState, useEffect, useCallback } from 'react';
import {
  Plus, Mail, Send, FileText, AlertTriangle, ArrowLeft,
  Trash2, RefreshCw, X, Calendar, CheckCircle2, ChevronRight
} from 'lucide-react';
import styles from './CampaignsPage.module.css';
import { emailApi, campaignsApi } from '../../lib/api';
import type { EmailTemplate, Campaign, CampaignRecipient, CampaignReview, RecipientPreview } from '../../lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

type TabView = 'campaigns' | 'templates';
type StatusFilter = 'ALL' | 'Draft' | 'Scheduled' | 'Sending' | 'Completed' | 'Failed';

type WizardData = {
  id?: string;
  name: string;
  subject: string;
  description: string;
  reply_to: string;
  template_id: string;
  filter_type: string;
  filter_value: string;
  schedule_now: boolean;
  scheduled_for: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function badgeClass(status: string) {
  const map: Record<string, string> = {
    Draft: styles.badgeDraft,
    Scheduled: styles.badgeScheduled,
    Sending: styles.badgeSending,
    Completed: styles.badgeCompleted,
    Cancelled: styles.badgeCancelled,
    Failed: styles.badgeFailed,
    Queued: styles.badgeQueued,
    Sent: styles.badgeSent,
    Skipped: styles.badgeSkipped,
  };
  return `${styles.badge} ${map[status] ?? styles.badgeDraft}`;
}

function fmtDate(d?: string) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export const CampaignsPage = () => {
  const [tab, setTab] = useState<TabView>('campaigns');
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');

  // Detail view
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailCampaign, setDetailCampaign] = useState<Campaign | null>(null);
  const [recipients, setRecipients] = useState<CampaignRecipient[]>([]);
  const [analytics, setAnalytics] = useState<any>(null);

  // Template modal
  const [tmplOpen, setTmplOpen] = useState(false);
  const [newTmpl, setNewTmpl] = useState({ name: '', subject: '', html_content: '' });

  // Campaign wizard
  const [wizardOpen, setWizardOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [wizard, setWizard] = useState<WizardData>({
    name: '', subject: '', description: '', reply_to: '',
    template_id: '', filter_type: 'all_leads', filter_value: '',
    schedule_now: true, scheduled_for: '',
  });

  // Step 3 preview
  const [recipientPreview, setRecipientPreview] = useState<RecipientPreview[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Step 4 review
  const [review, setReview] = useState<CampaignReview | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);

  // ─── Data loading ──────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    try {
      const [t, c] = await Promise.all([emailApi.getTemplates(), campaignsApi.getCampaigns()]);
      setTemplates(t);
      setCampaigns(c);
    } catch { /* silently ignore */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  const loadDetail = useCallback(async (id: string) => {
    try {
      const [c, r, a] = await Promise.all([
        campaignsApi.getCampaign(id),
        campaignsApi.getRecipients(id),
        campaignsApi.getAnalytics(id),
      ]);
      setDetailCampaign(c);
      setRecipients(r);
      setAnalytics(a);
    } catch { /* silently ignore */ }
  }, []);

  useEffect(() => {
    if (!detailId) return;
    loadDetail(detailId);
    
    const isTerminal = ['Completed', 'Completed with Errors', 'Failed', 'Cancelled'].includes(detailCampaign?.status ?? '');
    if (isTerminal) return;

    const t = setInterval(() => {
      loadDetail(detailId);
    }, 2000);
    return () => clearInterval(t);
  }, [detailId, detailCampaign?.status, loadDetail]);

  // Live filter preview in step 3
  useEffect(() => {
    if (!wizardOpen || step !== 3) return;
    setPreviewLoading(true);
    campaignsApi.previewFilter(wizard.filter_type, wizard.filter_value)
      .then(setRecipientPreview)
      .catch(() => setRecipientPreview([]))
      .finally(() => setPreviewLoading(false));
  }, [wizardOpen, step, wizard.filter_type, wizard.filter_value]);

  // ─── Wizard transitions ────────────────────────────────────────────────────

  const openWizard = () => {
    setWizard({ name: '', subject: '', description: '', reply_to: '', template_id: '', filter_type: 'all_leads', filter_value: '', schedule_now: true, scheduled_for: '' });
    setStep(1);
    setReview(null);
    setRecipientPreview([]);
    setWizardOpen(true);
  };

  const nextStep = async () => {
    if (step === 3) {
      // Save draft
      try {
        const created = await campaignsApi.createCampaign({
          name: wizard.name,
          subject: wizard.subject,
          description: wizard.description || undefined,
          template_id: wizard.template_id,
          reply_to: wizard.reply_to || undefined,
          recipient_filter: { type: wizard.filter_type, value: wizard.filter_value || undefined },
          status: 'Draft',
          scheduled_for: (!wizard.schedule_now && wizard.scheduled_for) ? new Date(wizard.scheduled_for).toISOString() : undefined,
        } as any);
        setCampaigns(prev => [created, ...prev]);
        setWizard(w => ({ ...w, id: created.id }));
        // Fetch review
        setReviewLoading(true);
        const rev = await campaignsApi.getReview(created.id);
        setReview(rev);
        setReviewLoading(false);
        setStep(4);
      } catch (e) {
        alert(e instanceof Error ? e.message : 'Failed to save campaign');
      }
      return;
    }
    setStep(s => s + 1);
  };

  const prevStep = () => setStep(s => s - 1);

  const handleQueue = async () => {
    if (!wizard.id) return;
    try {
      if (!wizard.schedule_now && wizard.scheduled_for) {
        const utcScheduledFor = new Date(wizard.scheduled_for).toISOString();
        await campaignsApi.updateCampaign(wizard.id, { status: 'Scheduled', scheduled_for: utcScheduledFor } as any);
      } else {
        await campaignsApi.queueCampaign(wizard.id);
      }
      await load();
      setWizardOpen(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to queue campaign');
    }
  };

  // ─── Template creation ─────────────────────────────────────────────────────

  const handleCreateTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const created = await emailApi.createTemplate(newTmpl);
      setTemplates(prev => [...prev, created]);
      setTmplOpen(false);
      setNewTmpl({ name: '', subject: '', html_content: '' });
    } catch { /* silently ignore */ }
  };

  // ─── Campaign actions ──────────────────────────────────────────────────────

  const handleCancel = async (id: string) => {
    if (!confirm('Cancel this campaign? Pending emails will not be sent.')) return;
    try { await campaignsApi.cancelCampaign(id); loadDetail(id); await load(); } catch { /* silently ignore */ }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const camp = campaigns.find(c => c.id === id) || (detailCampaign?.id === id ? detailCampaign : null);
    const isSending = camp?.status === 'Sending';
    const msg = isSending
      ? 'This campaign is actively sending. Deleting it will cancel remaining queued jobs. Proceed?'
      : 'Delete this campaign? This cannot be undone.';
    if (!confirm(msg)) return;
    try {
      await campaignsApi.deleteCampaign(id);
      setCampaigns(prev => prev.filter(c => c.id !== id));
      if (detailId === id) {
        setDetailId(null);
        setDetailCampaign(null);
      }
    } catch { /* silently ignore */ }
  };

  const handleRetryFailed = async (id: string) => {
    try {
      await campaignsApi.retryCampaign(id);
      loadDetail(id);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to retry failed recipients');
    }
  };

  const handleResume = async (id: string) => {
    try {
      await campaignsApi.resumeCampaign(id);
      loadDetail(id);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to resume campaign');
    }
  };

  // ─── Filtered list ─────────────────────────────────────────────────────────

  const filteredCampaigns = campaigns.filter(c =>
    statusFilter === 'ALL' || c.status.toLowerCase() === statusFilter.toLowerCase()
  );

  const selectedTemplate = templates.find(t => t.id === wizard.template_id);

  // ─── Detail View ───────────────────────────────────────────────────────────

  if (detailId && detailCampaign) {
    return (
      <div className={styles.pageContainer}>
        <button className={styles.backLink} onClick={() => { setDetailId(null); setDetailCampaign(null); }}>
          <ArrowLeft size={14} /> Back to Campaigns
        </button>

        <div className={styles.detailHeader}>
          <div>
            <h1 className={styles.detailTitle}>{detailCampaign.name}</h1>
            <p className={styles.detailSubject}>Subject: <strong>{detailCampaign.subject}</strong></p>
          </div>
          <div className={styles.detailActions}>
            <span className={badgeClass(detailCampaign.status)}>{detailCampaign.status}</span>
            {detailCampaign.status === 'Sending' && (
              <>
                {analytics?.queued_count > 0 && (
                  <button className={styles.btnPrimary} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px' }} onClick={() => handleResume(detailCampaign.id)}>
                    <RefreshCw size={12} /> Resume
                  </button>
                )}
                <button className={styles.btnDanger} style={{ padding: '6px 12px' }} onClick={() => handleCancel(detailCampaign.id)}>
                  Stop Campaign
                </button>
              </>
            )}
            {['Completed', 'Completed with Errors', 'Failed', 'Cancelled'].includes(detailCampaign.status) && 
             (analytics?.failed_count > 0 || analytics?.invalid_count > 0) && (
              <button className={styles.btnPrimary} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px' }} onClick={() => handleRetryFailed(detailCampaign.id)}>
                <RefreshCw size={12} /> Retry Failed
              </button>
            )}
            <button className={styles.btnDanger} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px' }} onClick={(e) => handleDelete(detailCampaign.id, e)} title="Delete">
              <Trash2 size={12} /> Delete
            </button>
          </div>
        </div>

        <div className={styles.statsGrid}>
          {[
            { label: 'Recipients', val: analytics?.recipient_count ?? 0 },
            { label: 'Queued', val: analytics?.queued_count ?? 0 },
            { label: 'Sent', val: analytics?.sent_count ?? 0, color: '#059669' },
            { label: 'Failed', val: analytics?.failed_count ?? 0, color: analytics?.failed_count > 0 ? '#DC2626' : undefined },
            { label: 'Success Rate', val: `${analytics?.success_rate ?? 0}%`, color: '#2563EB' },
          ].map(s => (
            <div key={s.label} className={styles.statCard}>
              <div className={styles.statCardVal} style={s.color ? { color: s.color } : {}}>{s.val}</div>
              <div className={styles.statCardLabel}>{s.label}</div>
            </div>
          ))}
        </div>

        <div className={styles.sectionTitle}>
          Recipient Delivery Log
          <button className={styles.refreshBtn} onClick={() => loadDetail(detailCampaign.id)}>
            <RefreshCw size={13} /> Refresh
          </button>
        </div>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Email Address</th>
                <th>Status</th>
                <th>Sent</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {recipients.length === 0 ? (
                <tr><td colSpan={4} className={styles.noData}>No recipient logs yet. Queue the campaign to begin delivery.</td></tr>
              ) : recipients.map(r => (
                <tr key={r.id}>
                  <td>{r.recipient_email}</td>
                  <td><span className={badgeClass(r.status)}>{r.status}</span></td>
                  <td>{fmtDate(r.sent_at)}</td>
                  <td style={{ color: r.status === 'Failed' ? '#DC2626' : 'var(--text-secondary)', fontSize: '12px' }}>
                    {r.error_message || r.skipped_reason || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // ─── Main View ─────────────────────────────────────────────────────────────

  return (
    <div className={styles.pageContainer}>

      {/* Header */}
      <div className={styles.pageHeader}>
        <div className={styles.pageTitleGroup}>
          <h1>Email Marketing</h1>
          <p>Manage templates and run personalized email campaigns</p>
        </div>
        {tab === 'templates'
          ? <button className={styles.createBtn} onClick={() => setTmplOpen(true)}><Plus size={16} /> New Template</button>
          : <button className={styles.createBtn} onClick={openWizard}><Plus size={16} /> New Campaign</button>
        }
      </div>

      {/* Tabs */}
      <div className={styles.tabsBar}>
        <button className={`${styles.tabBtn} ${tab === 'campaigns' ? styles.active : ''}`} onClick={() => setTab('campaigns')}>Campaigns</button>
        <button className={`${styles.tabBtn} ${tab === 'templates' ? styles.active : ''}`} onClick={() => setTab('templates')}>Templates</button>
      </div>

      {/* Status filters (campaigns tab) */}
      {tab === 'campaigns' && (
        <div className={styles.toolbar}>
          <div className={styles.filterPills}>
            {(['ALL', 'Draft', 'Scheduled', 'Sending', 'Completed', 'Failed'] as StatusFilter[]).map(f => (
              <button key={f} className={`${styles.filterPill} ${statusFilter === f ? styles.active : ''}`} onClick={() => setStatusFilter(f)}>{f}</button>
            ))}
          </div>
        </div>
      )}

      {/* ── Templates grid ── */}
      {tab === 'templates' && (
        <div className={styles.grid}>
          {templates.map(t => (
            <div key={t.id} className={styles.templateCard}>
              <div className={styles.templateCardTop}>
                <div className={styles.templateIcon}><FileText size={16} /></div>
                <div>
                  <div className={styles.templateName}>{t.name}</div>
                  <div className={styles.templateSubject}>{t.subject}</div>
                </div>
              </div>
              <div className={styles.templateBody}>{t.html_content.replace(/<[^>]*>/g, '')}</div>
            </div>
          ))}
          {templates.length === 0 && (
            <div className={styles.emptyState}>
              <div className={styles.emptyIcon}><FileText size={22} /></div>
              <h3>No templates yet</h3>
              <p>Create an email template to use in your campaigns.</p>
            </div>
          )}
        </div>
      )}

      {/* ── Campaigns grid ── */}
      {tab === 'campaigns' && (
        <div className={styles.grid}>
          {filteredCampaigns.map(c => {
            const tpl = templates.find(t => t.id === c.template_id);
            return (
              <div key={c.id} className={styles.card} onClick={() => setDetailId(c.id)}>
                <div className={styles.cardTop}>
                  <div>
                    <div className={styles.cardTitle}>{c.name}</div>
                    <div className={styles.cardSubject}>{c.subject}</div>
                  </div>
                  <span className={badgeClass(c.status)}>{c.status}</span>
                </div>

                {tpl && (
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Mail size={11} /> {tpl.name}
                  </div>
                )}

                <div className={styles.cardMeta}>
                  <div className={styles.cardStats}>
                    <div className={styles.stat}>
                      <span className={styles.statVal}>{c.recipient_count}</span>
                      <span className={styles.statLabel}>Target</span>
                    </div>
                    <div className={styles.stat}>
                      <span className={styles.statVal} style={{ color: '#059669' }}>{c.sent_count}</span>
                      <span className={styles.statLabel}>Sent</span>
                    </div>
                    <div className={styles.stat}>
                      <span className={styles.statVal} style={{ color: c.failed_count > 0 ? '#DC2626' : 'var(--text-main)' }}>{c.failed_count}</span>
                      <span className={styles.statLabel}>Failed</span>
                    </div>
                  </div>
                  <button className={styles.btnDanger} style={{ padding: '5px 8px', fontSize: '12px' }} onClick={e => handleDelete(c.id, e)} title="Delete">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            );
          })}

          {filteredCampaigns.length === 0 && (
            <div className={styles.emptyState}>
              <div className={styles.emptyIcon}><Send size={22} /></div>
              <h3>No campaigns{statusFilter !== 'ALL' ? ` with status "${statusFilter}"` : ''}</h3>
              <p>Create a new campaign to start reaching your contacts.</p>
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════ */}
      {/* Template Modal                                                         */}
      {/* ════════════════════════════════════════════════════════════════════════ */}

      {tmplOpen && (
        <div className={styles.overlay}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <div className={styles.modalTitle}>
                <div className={styles.modalTitleIcon}><FileText size={16} /></div>
                New Email Template
              </div>
              <button className={styles.closeBtn} onClick={() => setTmplOpen(false)}><X size={15} /></button>
            </div>

            <form onSubmit={handleCreateTemplate}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Template Name <span>*</span></label>
                  <input className={styles.input} required placeholder="e.g. Welcome Email" value={newTmpl.name} onChange={e => setNewTmpl({ ...newTmpl, name: e.target.value })} />
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Subject Line <span>*</span></label>
                  <input className={styles.input} required placeholder="e.g. Welcome to GrowthOS!" value={newTmpl.subject} onChange={e => setNewTmpl({ ...newTmpl, subject: e.target.value })} />
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>HTML Content <span>*</span></label>
                  <textarea className={styles.textarea} required placeholder="<p>Hello {{first_name}},</p>&#10;<p>Welcome aboard!</p>" value={newTmpl.html_content} onChange={e => setNewTmpl({ ...newTmpl, html_content: e.target.value })} />
                  <div className={styles.formHint}>Use {'{{first_name}}'}, {'{{last_name}}'}, {'{{email}}'} for personalization.</div>
                </div>
              </div>
              <div className={styles.modalFooter}>
                <button type="button" className={styles.btnSecondary} onClick={() => setTmplOpen(false)}>Cancel</button>
                <button type="submit" className={styles.btnPrimary}><CheckCircle2 size={14} /> Save Template</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════ */}
      {/* Campaign Wizard                                                         */}
      {/* ════════════════════════════════════════════════════════════════════════ */}

      {wizardOpen && (
        <div className={styles.overlay}>
          <div className={`${styles.modal} ${styles.modalWide}`}>

            {/* Modal header */}
            <div className={styles.modalHeader}>
              <div className={styles.modalTitle}>
                <div className={styles.modalTitleIcon}><Send size={16} /></div>
                Create Campaign
              </div>
              <button className={styles.closeBtn} onClick={() => setWizardOpen(false)}><X size={15} /></button>
            </div>

            {/* Step indicator */}
            <div className={styles.steps}>
              {[{ n: 1, label: 'Details' }, { n: 2, label: 'Template' }, { n: 3, label: 'Recipients' }, { n: 4, label: 'Review' }].map((s, i, arr) => (
                <React.Fragment key={s.n}>
                  <div className={`${styles.step} ${step === s.n ? styles.active : ''} ${step > s.n ? styles.done : ''}`}>
                    <div className={styles.stepCircle}>{step > s.n ? <CheckCircle2 size={14} /> : s.n}</div>
                    <span className={styles.stepLabel}>{s.label}</span>
                  </div>
                  {i < arr.length - 1 && <div className={`${styles.stepConnector} ${step > s.n ? styles.done : ''}`} />}
                </React.Fragment>
              ))}
            </div>

            {/* ── Step 1: Details ── */}
            {step === 1 && (
              <div>
                <div className={styles.formGrid}>
                  <div className={`${styles.formGroup} ${styles.formFull}`}>
                    <label className={styles.formLabel}>Campaign Name <span>*</span></label>
                    <input className={styles.input} placeholder="e.g. Summer Promo 2026" value={wizard.name} onChange={e => setWizard(w => ({ ...w, name: e.target.value }))} />
                  </div>
                  <div className={`${styles.formGroup} ${styles.formFull}`}>
                    <label className={styles.formLabel}>Email Subject <span>*</span></label>
                    <input className={styles.input} placeholder="e.g. 20% off this week — {{first_name}}!" value={wizard.subject} onChange={e => setWizard(w => ({ ...w, subject: e.target.value }))} />
                    <div className={styles.formHint}>Use {'{{first_name}}'}, {'{{last_name}}'} for personalization.</div>
                  </div>
                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>Description</label>
                    <input className={styles.input} placeholder="Internal campaign notes" value={wizard.description} onChange={e => setWizard(w => ({ ...w, description: e.target.value }))} />
                  </div>
                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>Reply-To Email</label>
                    <input className={styles.input} type="email" placeholder="support@company.com" value={wizard.reply_to} onChange={e => setWizard(w => ({ ...w, reply_to: e.target.value }))} />
                  </div>
                </div>
              </div>
            )}

            {/* ── Step 2: Template ── */}
            {step === 2 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Select Template <span>*</span></label>
                  <select className={styles.select} value={wizard.template_id} onChange={e => setWizard(w => ({ ...w, template_id: e.target.value }))}>
                    <option value="">— Choose a template —</option>
                    {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                {selectedTemplate && (
                  <div>
                    <div className={styles.templatePreviewLabel}>Preview</div>
                    <div className={styles.templatePreview}
                      dangerouslySetInnerHTML={{ __html: selectedTemplate.html_content }} />
                  </div>
                )}
                {templates.length === 0 && (
                  <div style={{ padding: '16px', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 'var(--radius-md)', fontSize: 13, color: '#92400E' }}>
                    No templates yet. Close this wizard and create a template first.
                  </div>
                )}
              </div>
            )}

            {/* ── Step 3: Recipients ── */}
            {step === 3 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div className={styles.filterRow}>
                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>Audience Filter</label>
                    <select className={styles.select} value={wizard.filter_type} onChange={e => setWizard(w => ({ ...w, filter_type: e.target.value, filter_value: '' }))}>
                      <option value="all_leads">All CRM Leads</option>
                      <option value="all_contacts">All CRM Contacts</option>
                      <option value="pipeline_stage">By Pipeline Stage</option>
                      <option value="tag">By Lead Tag</option>
                      <option value="owner">By Lead Owner</option>
                      <option value="manual">Manual Email List</option>
                    </select>
                  </div>
                  {!['all_leads', 'all_contacts'].includes(wizard.filter_type) && (
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>
                        {wizard.filter_type === 'pipeline_stage' ? 'Stage Name' :
                          wizard.filter_type === 'tag' ? 'Tag Name' :
                          wizard.filter_type === 'owner' ? 'Owner ID' : 'Emails (comma-separated)'}
                      </label>
                      <input className={styles.input} placeholder={
                        wizard.filter_type === 'pipeline_stage' ? 'e.g. Qualified' :
                        wizard.filter_type === 'tag' ? 'e.g. hot-lead' :
                        wizard.filter_type === 'owner' ? 'User ID' : 'a@example.com, b@example.com'
                      } value={wizard.filter_value} onChange={e => setWizard(w => ({ ...w, filter_value: e.target.value }))} />
                    </div>
                  )}
                </div>

                <div className={styles.recipientListWrap}>
                  <div className={styles.recipientListHeader}>
                    <span className={styles.recipientListHeaderTitle}>
                      {previewLoading ? 'Resolving…' : 'Matched Recipients'}
                    </span>
                    {!previewLoading && (
                      <span className={styles.recipientCountBadge}>{recipientPreview.length}</span>
                    )}
                  </div>
                  {recipientPreview.length > 0
                    ? recipientPreview.map((r, i) => (
                      <div key={i} className={styles.recipientRow}>
                        <span className={styles.recipientName}>
                          {r.first_name || r.last_name ? `${r.first_name} ${r.last_name}`.trim() : 'Unnamed Contact'}
                        </span>
                        <span className={styles.recipientEmail}>{r.email}</span>
                      </div>
                    ))
                    : (
                      <div className={styles.emptyRecipients}>
                        <Mail size={22} style={{ opacity: 0.3 }} />
                        {previewLoading ? 'Loading recipients…' : 'No recipients match this filter'}
                      </div>
                    )
                  }
                </div>
              </div>
            )}

            {/* ── Step 4: Review ── */}
            {step === 4 && (
              <div>
                {reviewLoading
                  ? <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-secondary)' }}>Compiling review…</div>
                  : review && (
                    <>
                      {review.warnings.length > 0 && (
                        <div className={styles.warningsList}>
                          {review.warnings.map((w, i) => (
                            <div key={i} className={styles.warningItem}>
                              <AlertTriangle size={14} />
                              {w}
                            </div>
                          ))}
                        </div>
                      )}

                      <div className={styles.reviewCard}>
                        <div className={styles.reviewCardHeader}>Campaign Summary</div>
                        {[
                          { label: 'Sending via', value: review.gmail_account ?? '—' },
                          { label: 'Template', value: review.template_name ?? '—' },
                          { label: 'Recipients Selected', value: (review.recipient_count + (review.duplicate_count || 0)).toLocaleString() },
                          { label: 'Unique Emails', value: review.recipient_count.toLocaleString() },
                          { label: 'Duplicate Emails', value: (review.duplicate_count || 0).toLocaleString() },
                          { label: 'Gmail Connected', value: review.gmail_connected ? '✓ Yes' : '✗ No' },
                        ].map(row => (
                          <div key={row.label} className={styles.reviewRow}>
                            <span className={styles.reviewRowLabel}>{row.label}</span>
                            <span className={styles.reviewRowValue}>{row.value}</span>
                          </div>
                        ))}
                      </div>

                      <div className={styles.scheduleCard}>
                        <div onClick={() => setWizard(w => ({ ...w, schedule_now: true }))}
                          className={`${styles.scheduleOption} ${wizard.schedule_now ? styles.selected : ''}`}>
                          <div className={styles.radioCircle} />
                          <div>
                            <div className={styles.scheduleOptionText}>Send immediately</div>
                            <div className={styles.scheduleOptionSub}>Emails will be queued right now</div>
                          </div>
                        </div>
                        <div onClick={() => setWizard(w => ({ ...w, schedule_now: false }))}
                          className={`${styles.scheduleOption} ${!wizard.schedule_now ? styles.selected : ''}`}>
                          <div className={styles.radioCircle} />
                          <div style={{ flex: 1 }}>
                            <div className={styles.scheduleOptionText}>Schedule for later</div>
                            <div className={styles.scheduleOptionSub}>Pick a date and time</div>
                          </div>
                          {!wizard.schedule_now && (
                            <input type="datetime-local" className={styles.input} style={{ width: 'auto', marginLeft: 8 }}
                              value={wizard.scheduled_for} onChange={e => setWizard(w => ({ ...w, scheduled_for: e.target.value }))} />
                          )}
                        </div>
                      </div>
                    </>
                  )
                }
              </div>
            )}

            {/* Footer */}
            <div className={styles.modalFooter}>
              {step > 1 && step < 4
                ? <button className={styles.btnSecondary} onClick={prevStep}>Back</button>
                : step === 1
                ? <button className={styles.btnSecondary} onClick={() => setWizardOpen(false)}>Cancel</button>
                : null
              }

              {step < 4 ? (
                <button className={styles.btnPrimary}
                  disabled={(step === 1 && (!wizard.name || !wizard.subject)) || (step === 2 && !wizard.template_id)}
                  onClick={nextStep}>
                  Continue <ChevronRight size={14} />
                </button>
              ) : (
                <button className={styles.btnPrimary}
                  disabled={!review?.can_send && wizard.schedule_now}
                  onClick={handleQueue}>
                  {wizard.schedule_now
                    ? <><Send size={14} /> Send Campaign</>
                    : <><Calendar size={14} /> Schedule Campaign</>
                  }
                </button>
              )}
            </div>

          </div>
        </div>
      )}

    </div>
  );
};
