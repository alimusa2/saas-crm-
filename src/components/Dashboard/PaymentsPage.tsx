import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import styles from './PaymentsPage.module.css';
import { paymentsApi, crmApi, contactsApi } from '../../lib/api';
import type { Invoice, Lead, Contact, Company } from '../../lib/api';
import {
  Plus, DollarSign, FileText, CreditCard, X, Search,
  AlertTriangle, CheckCircle2, XCircle, Send, Trash2, RefreshCw, Clock, Printer, Eye
} from 'lucide-react';
import { useAuth } from '../../lib/AuthContext';

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  Draft: { bg: '#F1F5F9', color: '#64748B' },
  Sent: { bg: '#EFF6FF', color: '#2563EB' },
  Paid: { bg: '#ECFDF5', color: '#059669' },
  Overdue: { bg: '#FEF2F2', color: '#DC2626' },
  Failed: { bg: '#FFF1F2', color: '#E11D48' },
  Cancelled: { bg: '#F8FAFC', color: '#475569' },
};

interface ToastMsg {
  id: number;
  type: 'success' | 'error' | 'info';
  message: string;
}

function generateInvoiceNumber(existingInvoices: Invoice[]): string {
  const year = new Date().getFullYear();
  const nextSeq = existingInvoices.length + 1;
  const seqStr = String(nextSeq).padStart(4, '0');
  return `INV-${year}-${seqStr}`;
}

export const PaymentsPage = () => {
  const { user } = useAuth();
  const isAdmin = Boolean(user?.is_superuser || user?.role === 'Admin' || user?.role === 'Owner');

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedInvoiceForPrint, setSelectedInvoiceForPrint] = useState<Invoice | null>(null);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const toastIdRef = useRef(0);

  const handlePrintInvoice = (inv: Invoice, autoPrint: boolean = false) => {
    setSelectedInvoiceForPrint(inv);
    setIsPrintModalOpen(true);
    if (autoPrint) {
      setTimeout(() => {
        window.print();
      }, 300);
    }
  };

  const handlePreviewFormInvoice = (autoPrint: boolean = false) => {
    const currentFormInvoice: Invoice = {
      id: 'draft_' + Date.now(),
      organization_id: 'org_1',
      number: newInvoice.number || generateInvoiceNumber(invoices),
      amount: parseFloat(newInvoice.amount) || 0,
      currency: newInvoice.currency || 'USD',
      description: newInvoice.description || 'Consulting & CRM Services Rendered',
      status: newInvoice.status || 'Sent',
      due_date: newInvoice.due_date || new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
      recipient_name: newInvoice.recipient_name || 'Valued Customer',
      recipient_email: newInvoice.recipient_email || '',
      recipient_phone: newInvoice.recipient_phone || '',
      billing_address: newInvoice.billing_address || '',
      created_at: new Date().toISOString()
    };
    handlePrintInvoice(currentFormInvoice, autoPrint);
  };

  // Filter & Search
  const [activeTab, setActiveTab] = useState<'all' | 'paid' | 'unpaid' | 'overdue' | 'failed'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // CRM Recipient lists
  const [leads, setLeads] = useState<Lead[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [recipientType, setRecipientType] = useState<'lead' | 'contact' | 'company'>('lead');
  const [recipientSearchQuery, setRecipientSearchQuery] = useState('');

  // Form State
  const [newInvoice, setNewInvoice] = useState({
    number: '',
    amount: '',
    currency: 'USD',
    description: '',
    status: 'Sent',
    due_date: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
    related_entity_type: 'lead',
    related_entity_id: '',
    recipient_name: '',
    recipient_email: '',
    recipient_phone: '',
    recipient_company: '',
    billing_address: '',
    tax_information: ''
  });

  const [reminderDaysBefore, setReminderDaysBefore] = useState<number>(() => {
    const saved = localStorage.getItem('crm_reminder_days_before');
    return saved ? parseInt(saved, 10) : 1; // Default 1 day before due date
  });

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'success') => {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);

  const handleAutoRemindersCheck = async (days: number) => {
    try {
      const res = await paymentsApi.triggerAutoReminders(days);
      if (res && res.reminded_count > 0) {
        showToast(`Auto-Reminder System: Dispatched ${res.reminded_count} due date reminder email(s) to unpaid lead(s).`, 'info');
      }
    } catch (e) {
      console.error('Auto reminder check failed:', e);
    }
  };

  useEffect(() => {
    fetchData();
    crmApi.getLeads().then(setLeads).catch(console.error);
    contactsApi.getContacts().then(setContacts).catch(console.error);
    crmApi.getCompanies().then(setCompanies).catch(console.error);
    handleAutoRemindersCheck(reminderDaysBefore);
  }, [reminderDaysBefore]);

  const handleReminderRuleChange = (days: number) => {
    setReminderDaysBefore(days);
    localStorage.setItem('crm_reminder_days_before', String(days));
    const label = days === 0 ? 'On Due Date (Same Day)' : days === 7 ? '1 Week Before Due Date' : `${days} Day(s) Before Due Date`;
    showToast(`Auto-Reminder Rule updated: ${label}`, 'success');
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const inv = await paymentsApi.getInvoices();
      setInvoices(inv);
    } catch (e: any) {
      showToast(e.message || 'Failed to load invoices.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenModal = () => {
    const autoNumber = generateInvoiceNumber(invoices);
    setNewInvoice({
      number: autoNumber,
      amount: '',
      currency: 'USD',
      description: 'Consulting & CRM Services Rendered',
      status: 'Sent',
      due_date: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
      related_entity_type: 'lead',
      related_entity_id: '',
      recipient_name: '',
      recipient_email: '',
      recipient_phone: '',
      recipient_company: '',
      billing_address: '',
      tax_information: ''
    });
    setRecipientType('lead');
    setRecipientSearchQuery('');
    setIsModalOpen(true);
  };

  const handleAutoGenerateId = () => {
    const autoNum = generateInvoiceNumber(invoices);
    setNewInvoice(prev => ({ ...prev, number: autoNum }));
    showToast(`Invoice ID auto-generated: ${autoNum}`, 'info');
  };

  const handleRecipientChange = (entityId: string) => {
    if (recipientType === 'lead') {
      const lead = leads.find(l => l.id === entityId);
      if (lead) {
        setNewInvoice(prev => ({
          ...prev,
          related_entity_type: 'lead',
          related_entity_id: lead.id,
          recipient_name: `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || 'Lead Recipient',
          recipient_email: lead.email || '',
          recipient_phone: lead.phone || '',
          recipient_company: '',
          billing_address: (lead as any).billing_address || '',
          tax_information: (lead as any).tax_information || ''
        }));
      }
    } else if (recipientType === 'contact') {
      const contact = contacts.find(c => c.id === entityId);
      if (contact) {
        setNewInvoice(prev => ({
          ...prev,
          related_entity_type: 'contact',
          related_entity_id: contact.id,
          recipient_name: `${contact.first_name || ''} ${contact.last_name || ''}`.trim() || 'Contact Recipient',
          recipient_email: contact.email || '',
          recipient_phone: contact.phone || '',
          recipient_company: '',
          billing_address: (contact as any).billing_address || '',
          tax_information: (contact as any).tax_information || ''
        }));
      }
    } else if (recipientType === 'company') {
      const comp = companies.find(c => c.id === entityId);
      if (comp) {
        setNewInvoice(prev => ({
          ...prev,
          related_entity_type: 'company',
          related_entity_id: comp.id,
          recipient_name: comp.name,
          recipient_email: '',
          recipient_phone: '',
          recipient_company: comp.name,
          billing_address: comp.address || '',
          tax_information: comp.tax_information || ''
        }));
      }
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newInvoice.amount || parseFloat(newInvoice.amount) <= 0) {
      showToast('Please enter a valid invoice amount.', 'error');
      return;
    }
    if (!newInvoice.related_entity_id) {
      showToast('Please select a recipient lead/contact.', 'error');
      return;
    }

    try {
      const payload = {
        ...newInvoice,
        amount: parseFloat(newInvoice.amount),
        items: [
          {
            description: newInvoice.description || 'Services Rendered',
            quantity: 1.0,
            unit_price: parseFloat(newInvoice.amount)
          }
        ]
      };
      const created = await paymentsApi.createInvoice(payload as any);
      setInvoices([created, ...invoices]);
      setIsModalOpen(false);
      showToast(`Invoice ${created.number} created & email notification sent to lead!`, 'success');
    } catch (e: any) {
      showToast(e.message || 'Failed to create invoice.', 'error');
    }
  };

  const handleMarkPaid = async (inv: Invoice) => {
    try {
      const updated = await paymentsApi.updateInvoice(inv.id, { status: 'Paid' });
      setInvoices(invoices.map(i => i.id === updated.id ? updated : i));
      showToast(`Invoice ${inv.number} marked as Paid. Payment receipt emailed to lead.`, 'success');
    } catch (e: any) {
      showToast(e.message || 'Failed to update invoice.', 'error');
    }
  };

  const handleMarkFailed = async (inv: Invoice) => {
    try {
      const updated = await paymentsApi.updateInvoice(inv.id, { status: 'Failed' });
      setInvoices(invoices.map(i => i.id === updated.id ? updated : i));
      showToast(`Invoice ${inv.number} status marked as Failed. Alert emailed to lead.`, 'info');
    } catch (e: any) {
      showToast(e.message || 'Failed to update invoice status.', 'error');
    }
  };

  const handleSendReminder = async (inv: Invoice) => {
    try {
      await paymentsApi.sendReminder(inv.id);
      showToast(`Payment reminder email sent for Invoice ${inv.number}!`, 'success');
    } catch (e: any) {
      showToast(e.message || 'Failed to send reminder email.', 'error');
    }
  };

  const handleDeleteInvoice = async (inv: Invoice) => {
    if (!window.confirm(`Are you sure you want to delete Invoice ${inv.number}?`)) return;
    try {
      await paymentsApi.deleteInvoice(inv.id);
      setInvoices(invoices.filter(i => i.id !== inv.id));
      showToast(`Invoice ${inv.number} deleted cleanly.`, 'info');
    } catch (e: any) {
      showToast(e.message || 'Failed to delete invoice.', 'error');
    }
  };

  // Metrics Calculations
  const stats = useMemo(() => {
    const todayStr = new Date().toISOString().split('T')[0];

    const paidInvoices = invoices.filter(i => i.status === 'Paid');
    const totalRevenue = paidInvoices.reduce((sum, i) => sum + (i.amount || 0), 0);

    const unpaidInvoices = invoices.filter(i => i.status === 'Draft' || i.status === 'Sent');
    const totalUnpaid = unpaidInvoices.reduce((sum, i) => sum + (i.amount || 0), 0);

    const overdueInvoices = invoices.filter(i => {
      if (i.status === 'Paid' || i.status === 'Cancelled') return false;
      if (i.status === 'Overdue') return true;
      if (i.due_date && i.due_date.split('T')[0] < todayStr) return true;
      return false;
    });
    const totalOverdue = overdueInvoices.reduce((sum, i) => sum + (i.amount || 0), 0);

    const failedInvoices = invoices.filter(i => i.status === 'Failed');
    const totalFailed = failedInvoices.reduce((sum, i) => sum + (i.amount || 0), 0);

    return {
      totalRevenue,
      paidCount: paidInvoices.length,
      totalUnpaid,
      unpaidCount: unpaidInvoices.length,
      totalOverdue,
      overdueCount: overdueInvoices.length,
      totalFailed,
      failedCount: failedInvoices.length,
    };
  }, [invoices]);

  // Tab Filtering & Search
  const filteredInvoices = useMemo(() => {
    const todayStr = new Date().toISOString().split('T')[0];
    return invoices.filter(inv => {
      // Tab filter
      if (activeTab === 'paid' && inv.status !== 'Paid') return false;
      if (activeTab === 'unpaid' && (inv.status === 'Paid' || inv.status === 'Cancelled' || inv.status === 'Failed')) return false;
      if (activeTab === 'overdue') {
        const isOverdue = inv.status === 'Overdue' || (inv.status !== 'Paid' && inv.due_date && inv.due_date.split('T')[0] < todayStr);
        if (!isOverdue) return false;
      }
      if (activeTab === 'failed' && inv.status !== 'Failed') return false;

      // Query Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const numMatch = (inv.number || '').toLowerCase().includes(q);
        const nameMatch = (inv.recipient_name || '').toLowerCase().includes(q);
        const emailMatch = (inv.recipient_email || '').toLowerCase().includes(q);
        if (!numMatch && !nameMatch && !emailMatch) return false;
      }

      return true;
    });
  }, [invoices, activeTab, searchQuery]);

  // Recipient list dropdown filter
  const filteredRecipients = useMemo(() => {
    const q = recipientSearchQuery.toLowerCase();
    if (recipientType === 'lead') {
      return leads.filter(l => `${l.first_name || ''} ${l.last_name || ''} ${l.email || ''}`.toLowerCase().includes(q));
    }
    if (recipientType === 'contact') {
      return contacts.filter(c => `${c.first_name || ''} ${c.last_name || ''} ${c.email || ''}`.toLowerCase().includes(q));
    }
    return companies.filter(c => c.name.toLowerCase().includes(q));
  }, [recipientType, recipientSearchQuery, leads, contacts, companies]);

  return (
    <div className={styles.container}>
      {/* Toast Notification Bar */}
      {toasts.length > 0 && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {toasts.map(t => (
            <div key={t.id} style={{
              background: t.type === 'success' ? '#10B981' : t.type === 'error' ? '#EF4444' : '#3B82F6',
              color: '#FFFFFF', padding: '10px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 600,
              boxShadow: '0 10px 25px rgba(0,0,0,0.15)', display: 'flex', alignItems: 'center', gap: '8px'
            }}>
              {t.type === 'success' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
              <span>{t.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* Header */}
      <div className={styles.header}>
        <div>
          <h1>Payments & Invoicing</h1>
          <p className={styles.subtitle}>Track total revenue, manage invoices & automated lead payment reminders</p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--surface-color)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '7px 14px', fontSize: '13px' }}>
            <Clock size={15} style={{ color: 'var(--primary-color)' }} />
            <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>Auto-Reminder Rule:</span>
            <select
              value={reminderDaysBefore}
              onChange={e => handleReminderRuleChange(parseInt(e.target.value, 10))}
              style={{ border: 'none', background: 'transparent', fontWeight: 700, color: 'var(--primary-color)', cursor: 'pointer', outline: 'none', fontSize: '13px' }}
            >
              <option value={0}>On Due Date (Same Day)</option>
              <option value={1}>1 Day Before Due Date (Default)</option>
              <option value={2}>2 Days Before Due Date</option>
              <option value={3}>3 Days Before Due Date</option>
              <option value={7}>1 Week Before Due Date</option>
            </select>
          </div>

          <button
            className={styles.addBtn}
            title="Print or export printable invoice document"
            onClick={() => {
              if (invoices.length > 0) {
                handlePrintInvoice(invoices[0]);
              } else {
                handlePreviewFormInvoice(false);
              }
            }}
          >
            <Printer size={18} /> Print Invoice
          </button>

          <button className={styles.addBtn} onClick={handleOpenModal}>
            <Plus size={18} /> Create Invoice
          </button>
        </div>
      </div>

      {/* KPI Stats Grid: Total Revenue, Paid, Unpaid, Due Date / Overdue, Failed */}
      <div className={styles.statsRow}>
        <div className={styles.statCard}>
          <div className={styles.statIcon} style={{ background: '#ECFDF5', color: '#059669' }}>
            <DollarSign size={22} />
          </div>
          <div>
            <div className={styles.statValue}>${stats.totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            <div className={styles.statLabel}>Total Revenue</div>
            <div className={styles.statSub}>{stats.paidCount} Paid Invoices</div>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statIcon} style={{ background: '#EFF6FF', color: '#2563EB' }}>
            <Clock size={22} />
          </div>
          <div>
            <div className={styles.statValue}>${stats.totalUnpaid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            <div className={styles.statLabel}>Unpaid / Pending</div>
            <div className={styles.statSub}>{stats.unpaidCount} Pending Invoices</div>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statIcon} style={{ background: '#FEF2F2', color: '#DC2626' }}>
            <AlertTriangle size={22} />
          </div>
          <div>
            <div className={styles.statValue}>${stats.totalOverdue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            <div className={styles.statLabel}>Overdue & Due Soon</div>
            <div className={styles.statSub}>{stats.overdueCount} Past / Approaching Due</div>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statIcon} style={{ background: '#FFF1F2', color: '#E11D48' }}>
            <XCircle size={22} />
          </div>
          <div>
            <div className={styles.statValue}>${stats.totalFailed.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            <div className={styles.statLabel}>Failed Payments</div>
            <div className={styles.statSub}>{stats.failedCount} Failed Attempts</div>
          </div>
        </div>
      </div>

      {/* Toolbar: Status Filter Tabs & Live Search */}
      <div className={styles.toolbar}>
        <div className={styles.filterTabs}>
          <button
            className={`${styles.tabBtn} ${activeTab === 'all' ? styles.activeTab : ''}`}
            onClick={() => setActiveTab('all')}
          >
            All Invoices ({invoices.length})
          </button>
          <button
            className={`${styles.tabBtn} ${activeTab === 'paid' ? styles.activeTab : ''}`}
            onClick={() => setActiveTab('paid')}
          >
            Paid ({stats.paidCount})
          </button>
          <button
            className={`${styles.tabBtn} ${activeTab === 'unpaid' ? styles.activeTab : ''}`}
            onClick={() => setActiveTab('unpaid')}
          >
            Unpaid ({stats.unpaidCount})
          </button>
          <button
            className={`${styles.tabBtn} ${activeTab === 'overdue' ? styles.activeTab : ''}`}
            onClick={() => setActiveTab('overdue')}
          >
            Overdue ({stats.overdueCount})
          </button>
          <button
            className={`${styles.tabBtn} ${activeTab === 'failed' ? styles.activeTab : ''}`}
            onClick={() => setActiveTab('failed')}
          >
            Failed ({stats.failedCount})
          </button>
        </div>

        <div className={styles.searchBox}>
          <Search size={15} className={styles.searchIcon} />
          <input
            type="text"
            className={styles.searchInput}
            placeholder="Search invoice #, recipient, email..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Table Container */}
      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Invoice #</th>
              <th>Recipient Lead</th>
              <th>Description</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Due Date</th>
              <th style={{ textAlign: 'right' }}>Actions & Reminders</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={7} className={styles.emptyRow}>Loading invoices database…</td></tr>
            )}
            {!loading && filteredInvoices.length === 0 && (
              <tr><td colSpan={7} className={styles.emptyRow}>No invoices match your filter criteria.</td></tr>
            )}
            {filteredInvoices.map(inv => {
              const badgeStyle = STATUS_COLORS[inv.status] || STATUS_COLORS.Draft;
              const todayStr = new Date().toISOString().split('T')[0];
              const isOverdue = inv.status === 'Overdue' || (inv.status !== 'Paid' && inv.due_date && inv.due_date.split('T')[0] < todayStr);

              return (
                <tr key={inv.id}>
                  <td className={styles.invoiceNum}>{inv.number}</td>
                  <td>
                    <div style={{ fontWeight: 600, color: '#1E293B' }}>{inv.recipient_name || 'Valued Customer'}</div>
                    {inv.recipient_email && <div style={{ fontSize: '11.5px', color: '#64748B' }}>{inv.recipient_email}</div>}
                  </td>
                  <td>{inv.description || 'Services Rendered'}</td>
                  <td className={styles.amount}>
                    ${(inv.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {inv.currency || 'USD'}
                  </td>
                  <td>
                    <span className={styles.statusBadge} style={{ background: isOverdue ? '#FEF2F2' : badgeStyle.bg, color: isOverdue ? '#DC2626' : badgeStyle.color }}>
                      {isOverdue && inv.status !== 'Paid' ? 'Overdue' : inv.status}
                    </span>
                  </td>
                  <td>
                    {inv.due_date ? (
                      <span style={{ fontSize: '12.5px', color: isOverdue ? '#DC2626' : '#475569', fontWeight: isOverdue ? 700 : 500 }}>
                        {new Date(inv.due_date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                      </span>
                    ) : '—'}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div className={styles.actionGroup} style={{ justifyContent: 'flex-end' }}>
                      <button
                        type="button"
                        className={`${styles.actionBtn} ${styles.printAction}`}
                        title="Print / View Official Invoice"
                        onClick={() => handlePrintInvoice(inv)}
                      >
                        <Printer size={13} /> Print
                      </button>

                      {inv.status === 'Paid' ? (
                        <span style={{ fontSize: '12px', fontWeight: 600, color: '#059669', background: '#ECFDF5', border: '1px solid #A7F3D0', padding: '4px 10px', borderRadius: '6px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          <CheckCircle2 size={13} /> Paid
                        </span>
                      ) : (
                        <>
                          <button
                            type="button"
                            className={`${styles.actionBtn} ${styles.payAction}`}
                            title="Mark Paid & Send Receipt Email"
                            onClick={() => handleMarkPaid(inv)}
                          >
                            <CheckCircle2 size={13} /> Mark Paid
                          </button>

                          {inv.status !== 'Failed' && (
                            <button
                              type="button"
                              className={`${styles.actionBtn} ${styles.failAction}`}
                              title="Mark Payment Failed & Send Failure Alert"
                              onClick={() => handleMarkFailed(inv)}
                            >
                              <XCircle size={13} /> Failed
                            </button>
                          )}
                        </>
                      )}

                      {isAdmin && (
                        <button
                          type="button"
                          className={`${styles.actionBtn} ${styles.deleteAction}`}
                          title="Delete Invoice"
                          onClick={() => handleDeleteInvoice(inv)}
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Create Invoice Modal */}
      {isModalOpen && (
        <div className={styles.modalOverlay} onClick={() => setIsModalOpen(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>Create New Invoice</h2>
              <button type="button" onClick={() => setIsModalOpen(false)}><X size={20} /></button>
            </div>
            <form onSubmit={handleCreate}>
              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label>Invoice Number *</label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      required
                      value={newInvoice.number}
                      onChange={e => setNewInvoice({ ...newInvoice, number: e.target.value })}
                      placeholder="INV-2026-0001"
                      style={{ flex: 1 }}
                    />
                    <button
                      type="button"
                      className={styles.autoGenBtn}
                      onClick={handleAutoGenerateId}
                      title="Auto generate sequential invoice ID"
                    >
                      ⚡ Auto ID
                    </button>
                  </div>
                </div>

                <div className={styles.formGroup}>
                  <label>Amount ($) *</label>
                  <input
                    required
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={newInvoice.amount}
                    onChange={e => setNewInvoice({ ...newInvoice, amount: e.target.value })}
                    placeholder="250.00"
                  />
                </div>
              </div>

              {/* Recipient Selection */}
              <div style={{ border: '1px solid #E2E8F0', borderRadius: '12px', padding: '16px', marginBottom: '16px', background: '#F8FAFC' }}>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#1E293B', marginBottom: '10px' }}>Lead / Recipient Details</div>

                <div className={styles.formRow}>
                  <div className={styles.formGroup}>
                    <label>Recipient Type</label>
                    <select
                      value={recipientType}
                      onChange={e => {
                        const type = e.target.value as 'lead' | 'contact' | 'company';
                        setRecipientType(type);
                        setRecipientSearchQuery('');
                        setNewInvoice(prev => ({
                          ...prev,
                          related_entity_type: type,
                          related_entity_id: '',
                          recipient_name: '',
                          recipient_email: '',
                          recipient_phone: '',
                          recipient_company: '',
                          billing_address: '',
                          tax_information: ''
                        }));
                      }}
                    >
                      <option value="lead">Lead</option>
                      <option value="contact">Contact</option>
                      <option value="company">Company</option>
                    </select>
                  </div>

                  <div className={styles.formGroup}>
                    <label>Search Recipient</label>
                    <input
                      type="text"
                      placeholder="Type name or email..."
                      value={recipientSearchQuery}
                      onChange={e => setRecipientSearchQuery(e.target.value)}
                    />
                  </div>
                </div>

                <div className={styles.formGroup}>
                  <label>Select Recipient Record *</label>
                  <select
                    required
                    value={newInvoice.related_entity_id}
                    onChange={e => handleRecipientChange(e.target.value)}
                  >
                    <option value="">-- Choose Recipient --</option>
                    {filteredRecipients.map(ent => (
                      <option key={ent.id} value={ent.id}>
                        {recipientType === 'company'
                          ? (ent as any).name
                          : `${(ent as any).first_name || ''} ${(ent as any).last_name || ''}`} ({(ent as any).email || 'No email'})
                      </option>
                    ))}
                  </select>
                </div>

                {newInvoice.related_entity_id && (
                  <div style={{ fontSize: '12px', color: '#334155', marginTop: '10px', background: '#FFFFFF', border: '1px solid #E2E8F0', padding: '10px 12px', borderRadius: '8px' }}>
                    <p style={{ margin: '2px 0' }}><strong>Recipient:</strong> {newInvoice.recipient_name}</p>
                    {newInvoice.recipient_email && <p style={{ margin: '2px 0' }}><strong>Email:</strong> {newInvoice.recipient_email} (Invoice will be sent here)</p>}
                    {newInvoice.recipient_phone && <p style={{ margin: '2px 0' }}><strong>Phone:</strong> {newInvoice.recipient_phone}</p>}
                  </div>
                )}
              </div>

              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label>Currency</label>
                  <select value={newInvoice.currency} onChange={e => setNewInvoice({ ...newInvoice, currency: e.target.value })}>
                    {['USD', 'EUR', 'GBP', 'CAD', 'AUD'].map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>

                <div className={styles.formGroup}>
                  <label>Due Date *</label>
                  <input
                    required
                    type="date"
                    value={newInvoice.due_date}
                    onChange={e => setNewInvoice({ ...newInvoice, due_date: e.target.value })}
                  />
                </div>
              </div>

              <div className={styles.formGroup}>
                <label>Description / Line Items</label>
                <textarea
                  rows={2}
                  value={newInvoice.description}
                  onChange={e => setNewInvoice({ ...newInvoice, description: e.target.value })}
                  placeholder="e.g. Monthly CRM Subscription & Onboarding Fee"
                />
              </div>

              <div className={styles.modalActions} style={{ flexWrap: 'wrap', gap: '8px' }}>
                <button type="button" className={styles.cancelBtn} onClick={() => setIsModalOpen(false)}>Cancel</button>
                <button
                  type="button"
                  className={styles.printPreviewBtn}
                  onClick={() => handlePreviewFormInvoice(false)}
                  title="Preview printable invoice document before creating"
                >
                  <Eye size={15} /> Print Preview
                </button>
                <button
                  type="button"
                  className={`${styles.actionBtn} ${styles.printAction}`}
                  style={{ padding: '9px 16px', fontSize: '13.5px' }}
                  onClick={() => handlePreviewFormInvoice(true)}
                  title="Print invoice document"
                >
                  <Printer size={15} /> Print
                </button>
                <button type="submit" className={styles.submitBtn}>Create & Send Invoice Email</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Print / Preview Invoice Modal */}
      {isPrintModalOpen && selectedInvoiceForPrint && (
        <div className={styles.modalOverlay} onClick={() => setIsPrintModalOpen(false)}>
          <div className={styles.printInvoiceModal} onClick={e => e.stopPropagation()}>
            <div className={`${styles.printHeaderBar} ${styles.noPrint}`}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <FileText size={20} style={{ color: 'var(--primary-color)' }} />
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>Official GrowthOS CRM Invoice</h3>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className={styles.printPreviewBtn}
                  onClick={() => {
                    navigator.clipboard.writeText(`${window.location.origin}/invoice/${selectedInvoiceForPrint.number}`);
                    showToast('Public Invoice link copied to clipboard!', 'success');
                  }}
                  title="Copy shareable invoice link"
                >
                  <Send size={14} /> Share Link
                </button>
                {selectedInvoiceForPrint.status !== 'Paid' && (
                  <button
                    type="button"
                    className={`${styles.actionBtn} ${styles.payAction}`}
                    style={{ padding: '7px 14px', fontSize: '13px' }}
                    onClick={() => {
                      handleMarkPaid(selectedInvoiceForPrint);
                      setSelectedInvoiceForPrint({ ...selectedInvoiceForPrint, status: 'Paid' });
                    }}
                  >
                    <CheckCircle2 size={14} /> Mark Paid
                  </button>
                )}
                <button
                  type="button"
                  className={styles.addBtn}
                  style={{ padding: '7px 16px', fontSize: '13px' }}
                  onClick={() => window.print()}
                >
                  <Printer size={15} /> Print
                </button>
                <button
                  type="button"
                  onClick={() => setIsPrintModalOpen(false)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B', fontSize: '20px', padding: '0 4px' }}
                >×</button>
              </div>
            </div>

            {/* Printable Document Body */}
            <div>
              {/* Brand Header */}
              <div className={styles.printBrandHeader}>
                <div>
                  <div className={styles.brandLogoBox}>
                    <div className={styles.brandLogoBadge}>G</div>
                    <div>
                      <div className={styles.brandTitle}>GrowthOS CRM</div>
                      <div style={{ fontSize: '11px', fontWeight: 600, color: '#6366F1', letterSpacing: '0.04em' }}>
                        BY SID INNOVATIONS
                      </div>
                    </div>
                  </div>
                  <div className={styles.brandSubtitle} style={{ marginTop: '8px' }}>
                    Enterprise Customer Relationship & Billing Platform<br />
                    100 Innovation Way, Tech Park, Suite 400 • San Francisco, CA 94105<br />
                    billing@growthos.com • +1 (800) 555-0199 • Tax ID: US-987654321
                  </div>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '24px', fontWeight: 800, color: '#1E293B', letterSpacing: '-0.5px' }}>INVOICE</div>
                  <div className={styles.invoiceNumBadge}>{selectedInvoiceForPrint.number}</div>
                  <div style={{ marginTop: '8px' }}>
                    <span
                      className={styles.statusBadge}
                      style={{
                        background: (STATUS_COLORS[selectedInvoiceForPrint.status] || STATUS_COLORS.Draft).bg,
                        color: (STATUS_COLORS[selectedInvoiceForPrint.status] || STATUS_COLORS.Draft).color,
                        fontSize: '12px',
                        padding: '4px 14px'
                      }}
                    >
                      {selectedInvoiceForPrint.status}
                    </span>
                  </div>
                </div>
              </div>

              {/* Billed To & Dates Grid */}
              <div className={styles.printGrid}>
                <div className={styles.partyCard}>
                  <div className={styles.partyCardTitle}>Billed To (Client / Customer):</div>
                  <div className={styles.partyName}>{selectedInvoiceForPrint.recipient_name || 'Valued Client'}</div>
                  {selectedInvoiceForPrint.recipient_company && (
                    <div className={styles.partyDetail} style={{ fontWeight: 600 }}>{selectedInvoiceForPrint.recipient_company}</div>
                  )}
                  {selectedInvoiceForPrint.recipient_email && (
                    <div className={styles.partyDetail}>✉️ {selectedInvoiceForPrint.recipient_email}</div>
                  )}
                  {selectedInvoiceForPrint.recipient_phone && (
                    <div className={styles.partyDetail}>📞 {selectedInvoiceForPrint.recipient_phone}</div>
                  )}
                  {selectedInvoiceForPrint.billing_address && (
                    <div className={styles.partyDetail} style={{ marginTop: '6px' }}>📍 {selectedInvoiceForPrint.billing_address}</div>
                  )}
                  {selectedInvoiceForPrint.tax_information && (
                    <div className={styles.partyDetail} style={{ fontSize: '11.5px', color: '#64748B', marginTop: '4px' }}>
                      Tax ID / VAT: {selectedInvoiceForPrint.tax_information}
                    </div>
                  )}
                </div>

                <div className={styles.partyCard} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div className={styles.partyCardTitle}>Invoice Metadata & Schedule:</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                    <span style={{ color: '#64748B', fontWeight: 500 }}>Invoice Date:</span>
                    <span style={{ fontWeight: 600, color: '#1E293B' }}>
                      {new Date(selectedInvoiceForPrint.created_at || Date.now()).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                    <span style={{ color: '#64748B', fontWeight: 500 }}>Payment Due Date:</span>
                    <span style={{ fontWeight: 700, color: '#DC2626' }}>
                      {selectedInvoiceForPrint.due_date ? new Date(selectedInvoiceForPrint.due_date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'Due on Receipt'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', borderTop: '1px solid #E2E8F0', paddingTop: '8px' }}>
                    <span style={{ color: '#64748B', fontWeight: 500 }}>Billing Currency:</span>
                    <span style={{ fontWeight: 700, color: '#1E293B' }}>{selectedInvoiceForPrint.currency || 'USD'}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                    <span style={{ color: '#64748B', fontWeight: 500 }}>Payment Status:</span>
                    <span style={{ fontWeight: 700, color: selectedInvoiceForPrint.status === 'Paid' ? '#059669' : '#D97706' }}>
                      {selectedInvoiceForPrint.status}
                    </span>
                  </div>
                </div>
              </div>

              {/* Line Items Table */}
              <div style={{ overflowX: 'auto', marginBottom: '24px' }}>
                <table className={styles.invoiceItemsTable}>
                  <thead>
                    <tr>
                      <th style={{ width: '40px' }}>#</th>
                      <th>Description / Service Line</th>
                      <th style={{ textAlign: 'center', width: '80px' }}>Qty</th>
                      <th style={{ textAlign: 'right', width: '120px' }}>Unit Price</th>
                      <th style={{ textAlign: 'right', width: '120px' }}>Line Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(selectedInvoiceForPrint.items && selectedInvoiceForPrint.items.length > 0 ? selectedInvoiceForPrint.items : [
                      {
                        id: 'item_1',
                        description: selectedInvoiceForPrint.description || 'GrowthOS CRM Subscription & Enterprise Consulting Services',
                        quantity: 1,
                        unit_price: selectedInvoiceForPrint.amount || 0,
                        amount: selectedInvoiceForPrint.amount || 0
                      }
                    ]).map((item, idx) => (
                      <tr key={item.id || idx}>
                        <td style={{ fontWeight: 600, color: '#64748B' }}>{idx + 1}</td>
                        <td style={{ fontWeight: 500 }}>{item.description}</td>
                        <td style={{ textAlign: 'center', fontWeight: 600 }}>{item.quantity}</td>
                        <td style={{ textAlign: 'right' }}>
                          ${(item.unit_price || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>
                          ${((item.quantity || 1) * (item.unit_price || 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Total Calculation Row */}
              <div className={styles.summaryBoxWrapper}>
                <div className={styles.summaryBox}>
                  <div className={styles.summaryRow}>
                    <span>Subtotal:</span>
                    <span>${(selectedInvoiceForPrint.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                  <div className={styles.summaryRow}>
                    <span>Tax (0%):</span>
                    <span>$0.00</span>
                  </div>
                  <div className={styles.summaryRow}>
                    <span>Discount:</span>
                    <span>$0.00</span>
                  </div>
                  <div className={styles.summaryTotalRow}>
                    <span>Total Amount Due:</span>
                    <span>${(selectedInvoiceForPrint.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {selectedInvoiceForPrint.currency || 'USD'}</span>
                  </div>
                </div>
              </div>

              {/* Bank & Payment Information + Terms Block */}
              <div className={styles.bankNotesGrid}>
                <div className={styles.notesBox}>
                  <div style={{ fontWeight: 700, color: '#1E293B', marginBottom: '6px' }}>💳 Remittance & Bank Wire Details:</div>
                  <p style={{ margin: '2px 0' }}><strong>Bank:</strong> Growth National Bank</p>
                  <p style={{ margin: '2px 0' }}><strong>Account Name:</strong> GrowthOS Technologies Inc. / Sid Innovations</p>
                  <p style={{ margin: '2px 0' }}><strong>Account / IBAN:</strong> US89 3704 0044 0532 0130 00</p>
                  <p style={{ margin: '2px 0' }}><strong>SWIFT / BIC:</strong> GROWUS33XXX</p>
                </div>

                <div className={styles.notesBox}>
                  <div style={{ fontWeight: 700, color: '#1E293B', marginBottom: '6px' }}>📝 Notes & Payment Terms:</div>
                  <p style={{ margin: '2px 0' }}>Please reference Invoice Number <strong>{selectedInvoiceForPrint.number}</strong> on all payments.</p>
                  <p style={{ margin: '2px 0' }}>Thank you for choosing GrowthOS CRM for your business operations!</p>
                </div>
              </div>

              {/* Printable Footer */}
              <div style={{ borderTop: '1px solid #E2E8F0', paddingTop: '14px', textAlign: 'center', fontSize: '11.5px', color: '#94A3B8' }}>
                GrowthOS CRM • Official Invoice Document • Generated electronically on {new Date().toLocaleDateString()}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

