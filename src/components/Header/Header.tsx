import React, { useState, useEffect, useRef } from 'react';
import styles from './Header.module.css';
import { 
  Menu, Search, Bell, HelpCircle, Plus, CheckCircle, 
  AlertTriangle, AlertCircle, Clock, CheckSquare, X, 
  UserPlus, Calendar as CalendarIcon, FileText, Settings2, Users
} from 'lucide-react';
import { 
  notificationsApi, crmApi, contactsApi, tasksApi, calendarApi, paymentsApi 
} from '../../lib/api';
import type { 
  Notification, Lead, Contact, Task, Appointment, Invoice 
} from '../../lib/api';

interface HeaderProps {
  onMenuClick: () => void;
  onSelectItem?: (item: string) => void;
  compact?: boolean;
}

export const Header = ({ onMenuClick, onSelectItem, compact }: HeaderProps) => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showCreateDropdown, setShowCreateDropdown] = useState(false);
  const [showQuickCreateModal, setShowQuickCreateModal] = useState<'lead' | 'contact' | 'task' | 'appointment' | 'invoice' | null>(null);

  // Search states
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loadingSearchData, setLoadingSearchData] = useState(false);

  // Form states
  const [leadForm, setLeadForm] = useState({ first_name: '', last_name: '', email: '', phone: '', status: 'New' });
  const [contactForm, setContactForm] = useState({ first_name: '', last_name: '', email: '', phone: '' });
  const [taskForm, setTaskForm] = useState({ title: '', description: '', due_date: '', priority: 'Normal', status: 'Pending' });
  const [apptForm, setApptForm] = useState({ title: '', description: '', start_time: '', end_time: '', location: '', status: 'Booked' });
  const [invoiceForm, setInvoiceForm] = useState({ number: '', amount: '', currency: 'USD', description: '' });

  const dropdownRef = useRef<HTMLDivElement>(null);
  const createDropdownRef = useRef<HTMLDivElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchNotifications();

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (dropdownRef.current && !dropdownRef.current.contains(target)) {
        setShowDropdown(false);
      }
      if (createDropdownRef.current && !createDropdownRef.current.contains(target)) {
        setShowCreateDropdown(false);
      }
      if (searchContainerRef.current && !searchContainerRef.current.contains(target)) {
        setShowSearchDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);

    // Ctrl + K listener
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const fetchNotifications = async () => {
    try {
      const data = await notificationsApi.getNotifications();
      setNotifications(data);
    } catch (err) {
      console.error('Failed to fetch notifications', err);
    }
  };

  const handleMarkAsRead = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await notificationsApi.markAsRead(id);
      setNotifications(notifications.map(n => n.id === id ? { ...n, is_read: true } : n));
    } catch (err) {
      console.error(err);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await notificationsApi.markAllAsRead();
      setNotifications(notifications.map(n => ({ ...n, is_read: true })));
    } catch (err) {
      console.error(err);
    }
  };

  const preloadSearchData = async () => {
    if (leads.length > 0 || loadingSearchData) return;
    setLoadingSearchData(true);
    try {
      const [l, c, t] = await Promise.all([
        crmApi.getLeads(),
        contactsApi.getContacts(),
        tasksApi.getTasks()
      ]);
      setLeads(l);
      setContacts(c);
      setTasks(t);
    } catch (err) {
      console.error('Failed to load search data', err);
    } finally {
      setLoadingSearchData(false);
    }
  };

  const handleSearchFocus = () => {
    preloadSearchData();
    setShowSearchDropdown(true);
  };

  // Filter search results
  const query = searchQuery.toLowerCase().trim();
  const filteredLeads = query ? leads.filter(l => 
    `${l.first_name} ${l.last_name} ${l.email || ''}`.toLowerCase().includes(query)
  ).slice(0, 3) : [];

  const filteredContacts = query ? contacts.filter(c => 
    `${c.first_name} ${c.last_name} ${c.email || ''}`.toLowerCase().includes(query)
  ).slice(0, 3) : [];

  const filteredTasks = query ? tasks.filter(t => 
    t.title.toLowerCase().includes(query) || (t.description && t.description.toLowerCase().includes(query))
  ).slice(0, 3) : [];

  const handleResultClick = (tab: string) => {
    if (onSelectItem) {
      onSelectItem(tab);
    }
    setShowSearchDropdown(false);
    setSearchQuery('');
  };

  const [isSubmitting, setIsSubmitting] = useState(false);

  // Quick Create submissions
  const handleCreateLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      await crmApi.createLead(leadForm);
      alert('Lead created successfully!');
      setShowQuickCreateModal(null);
      setLeadForm({ first_name: '', last_name: '', email: '', phone: '', status: 'New' });
      if (onSelectItem) onSelectItem('Leads');
    } catch (err: any) {
      alert(`Error creating Lead: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      await contactsApi.createContact(contactForm);
      alert('Contact created successfully!');
      setShowQuickCreateModal(null);
      setContactForm({ first_name: '', last_name: '', email: '', phone: '' });
      if (onSelectItem) onSelectItem('Contacts');
    } catch (err: any) {
      alert(`Error creating Contact: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await tasksApi.createTask(taskForm);
      alert('Task created successfully!');
      setShowQuickCreateModal(null);
      setTaskForm({ title: '', description: '', due_date: '', priority: 'Normal', status: 'Pending' });
      if (onSelectItem) onSelectItem('Tasks');
    } catch (err: any) {
      alert(`Error creating Task: ${err.message}`);
    }
  };

  const handleCreateAppt = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await calendarApi.createAppointment(apptForm);
      alert('Appointment scheduled successfully!');
      setShowQuickCreateModal(null);
      setApptForm({ title: '', description: '', start_time: '', end_time: '', location: '', status: 'Booked' });
      if (onSelectItem) onSelectItem('Calendar');
    } catch (err: any) {
      alert(`Error creating Appointment: ${err.message}`);
    }
  };

  const handleCreateInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await paymentsApi.createInvoice({ ...invoiceForm, amount: parseFloat(invoiceForm.amount) });
      alert('Invoice created successfully!');
      setShowQuickCreateModal(null);
      setInvoiceForm({ number: '', amount: '', currency: 'USD', description: '' });
      if (onSelectItem) onSelectItem('Payments');
    } catch (err: any) {
      alert(`Error creating Invoice: ${err.message}`);
    }
  };

  const unreadCount = notifications.filter(n => !n.is_read).length;

  const getIcon = (type: string) => {
    switch(type) {
      case 'Success': return <CheckCircle size={16} />;
      case 'Warning': return <AlertTriangle size={16} />;
      case 'Error': return <AlertCircle size={16} />;
      case 'Reminder': return <Clock size={16} />;
      case 'Task': return <CheckSquare size={16} />;
      default: return <Bell size={16} />;
    }
  };

  return (
    <header className={`${styles.header} ${compact ? styles.compactHeader : ''}`}>
      <div className={styles.left}>
        <button className={styles.menuBtn} onClick={onMenuClick}>
          <Menu size={24} />
        </button>
      </div>

      <div className={styles.right}>
        {/* Search Container */}
        <div className={styles.searchContainer} ref={searchContainerRef}>
          <Search size={16} className={styles.searchIcon} />
          <input 
            type="text" 
            placeholder="Search anything..." 
            className={styles.searchInput}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onFocus={handleSearchFocus}
            ref={searchInputRef}
          />
          <span className={styles.searchShortcut}>Ctrl + K</span>

          {showSearchDropdown && (
            <div className={styles.searchDropdown}>
              {loadingSearchData && <div className={styles.noResults}>Loading suggestions...</div>}
              {!loadingSearchData && !query && (
                <div className={styles.noResults}>Start typing to search leads, contacts, or tasks</div>
              )}
              {!loadingSearchData && query && (
                <>
                  {filteredLeads.length > 0 && (
                    <div className={styles.searchSection}>
                      <div className={styles.searchSectionTitle}>Leads</div>
                      {filteredLeads.map(l => (
                        <button key={l.id} className={styles.searchResultItem} onClick={() => handleResultClick('Leads')}>
                          <span className={styles.searchResultTitle}>{l.first_name} {l.last_name}</span>
                          {l.email && <span className={styles.searchResultSubtitle}>{l.email}</span>}
                        </button>
                      ))}
                    </div>
                  )}

                  {filteredContacts.length > 0 && (
                    <div className={styles.searchSection}>
                      <div className={styles.searchSectionTitle}>Contacts</div>
                      {filteredContacts.map(c => (
                        <button key={c.id} className={styles.searchResultItem} onClick={() => handleResultClick('Contacts')}>
                          <span className={styles.searchResultTitle}>{c.first_name} {c.last_name}</span>
                          {c.email && <span className={styles.searchResultSubtitle}>{c.email}</span>}
                        </button>
                      ))}
                    </div>
                  )}

                  {filteredTasks.length > 0 && (
                    <div className={styles.searchSection}>
                      <div className={styles.searchSectionTitle}>Tasks</div>
                      {filteredTasks.map(t => (
                        <button key={t.id} className={styles.searchResultItem} onClick={() => handleResultClick('Tasks')}>
                          <span className={styles.searchResultTitle}>{t.title}</span>
                          {t.description && <span className={styles.searchResultSubtitle}>{t.description}</span>}
                        </button>
                      ))}
                    </div>
                  )}

                  {filteredLeads.length === 0 && filteredContacts.length === 0 && filteredTasks.length === 0 && (
                    <div className={styles.noResults}>No matches found for "{searchQuery}"</div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Notifications */}
        <div className={styles.dropdownContainer} ref={dropdownRef}>
          <button className={styles.iconBtn} onClick={() => setShowDropdown(!showDropdown)}>
            <Bell size={20} />
            {unreadCount > 0 && <span className={styles.notificationBadge}></span>}
          </button>
          
          {showDropdown && (
            <div className={styles.dropdownMenu}>
              <div className={styles.dropdownHeader}>
                <h3>Notifications</h3>
                {unreadCount > 0 && (
                  <button className={styles.markReadBtn} onClick={handleMarkAllRead}>
                    Mark all as read
                  </button>
                )}
              </div>
              <div className={styles.dropdownList}>
                {notifications.length === 0 ? (
                  <div className={styles.emptyState}>No notifications yet</div>
                ) : (
                  notifications.map(notif => (
                    <div 
                      key={notif.id} 
                      className={`${styles.notificationItem} ${!notif.is_read ? styles.unread : ''}`}
                      onClick={(e) => {
                        if (!notif.is_read) handleMarkAsRead(notif.id, e);
                      }}
                    >
                      <div className={`${styles.notifIcon} ${styles[notif.type] || ''}`}>
                        {getIcon(notif.type)}
                      </div>
                      <div className={styles.notifContent}>
                        <h4 className={styles.notifTitle}>{notif.title}</h4>
                        {notif.content && <p className={styles.notifText}>{notif.content}</p>}
                        <span className={styles.notifTime}>
                          {new Date(notif.created_at).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        <button className={styles.iconBtn} onClick={() => alert('Quick Help: Use the Search bar to find any lead or task, or click Create New to launch forms instantly.')}>
          <HelpCircle size={20} />
        </button>

        {/* Create New Dropdown */}
        <div className={styles.dropdownContainer} ref={createDropdownRef}>
          <button className={styles.createBtn} onClick={() => setShowCreateDropdown(!showCreateDropdown)}>
            <Plus size={18} />
            <span className={styles.createBtnText}>Create New</span>
          </button>

          {showCreateDropdown && (
            <div className={styles.createDropdown}>
              <button className={styles.createDropdownItem} onClick={() => { setShowQuickCreateModal('lead'); setShowCreateDropdown(false); }}>
                <Users size={14} /> New Lead
              </button>
              <button className={styles.createDropdownItem} onClick={() => { setShowQuickCreateModal('contact'); setShowCreateDropdown(false); }}>
                <UserPlus size={14} /> New Contact
              </button>
              <button className={styles.createDropdownItem} onClick={() => { setShowQuickCreateModal('task'); setShowCreateDropdown(false); }}>
                <CheckSquare size={14} /> New Task
              </button>
              <button className={styles.createDropdownItem} onClick={() => { setShowQuickCreateModal('appointment'); setShowCreateDropdown(false); }}>
                <CalendarIcon size={14} /> New Appointment
              </button>
              <button className={styles.createDropdownItem} onClick={() => { setShowQuickCreateModal('invoice'); setShowCreateDropdown(false); }}>
                <FileText size={14} /> New Invoice
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Quick Create Modals */}
      {showQuickCreateModal === 'lead' && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <h2>Create New Lead</h2>
              <button className={styles.modalCloseBtn} onClick={() => setShowQuickCreateModal(null)}><X size={18} /></button>
            </div>
            <form onSubmit={handleCreateLead}>
              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label>First Name *</label>
                  <input required value={leadForm.first_name} onChange={e => setLeadForm({ ...leadForm, first_name: e.target.value })} placeholder="John" />
                </div>
                <div className={styles.formGroup}>
                  <label>Last Name *</label>
                  <input required value={leadForm.last_name} onChange={e => setLeadForm({ ...leadForm, last_name: e.target.value })} placeholder="Doe" />
                </div>
              </div>
              <div className={styles.formGroup}>
                <label>Email Address</label>
                <input type="email" value={leadForm.email} onChange={e => setLeadForm({ ...leadForm, email: e.target.value })} placeholder="john.doe@example.com" />
              </div>
              <div className={styles.formGroup}>
                <label>Phone Number</label>
                <input value={leadForm.phone} onChange={e => setLeadForm({ ...leadForm, phone: e.target.value })} placeholder="+1 (555) 000-0000" />
              </div>
              <div className={styles.modalActions}>
                <button type="button" className={styles.cancelBtn} onClick={() => setShowQuickCreateModal(null)}>Cancel</button>
                <button type="submit" className={styles.submitBtn} disabled={isSubmitting}>Save Lead</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showQuickCreateModal === 'contact' && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <h2>Create New Contact</h2>
              <button className={styles.modalCloseBtn} onClick={() => setShowQuickCreateModal(null)}><X size={18} /></button>
            </div>
            <form onSubmit={handleCreateContact}>
              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label>First Name *</label>
                  <input required value={contactForm.first_name} onChange={e => setContactForm({ ...contactForm, first_name: e.target.value })} placeholder="Jane" />
                </div>
                <div className={styles.formGroup}>
                  <label>Last Name *</label>
                  <input required value={contactForm.last_name} onChange={e => setContactForm({ ...contactForm, last_name: e.target.value })} placeholder="Doe" />
                </div>
              </div>
              <div className={styles.formGroup}>
                <label>Email Address</label>
                <input type="email" value={contactForm.email} onChange={e => setContactForm({ ...contactForm, email: e.target.value })} placeholder="jane.doe@example.com" />
              </div>
              <div className={styles.formGroup}>
                <label>Phone Number</label>
                <input value={contactForm.phone} onChange={e => setContactForm({ ...contactForm, phone: e.target.value })} placeholder="+1 (555) 000-0000" />
              </div>
              <div className={styles.modalActions}>
                <button type="button" className={styles.cancelBtn} onClick={() => setShowQuickCreateModal(null)}>Cancel</button>
                <button type="submit" className={styles.submitBtn} disabled={isSubmitting}>Save Contact</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showQuickCreateModal === 'task' && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <h2>Create New Task</h2>
              <button className={styles.modalCloseBtn} onClick={() => setShowQuickCreateModal(null)}><X size={18} /></button>
            </div>
            <form onSubmit={handleCreateTask}>
              <div className={styles.formGroup}>
                <label>Task Title *</label>
                <input required value={taskForm.title} onChange={e => setTaskForm({ ...taskForm, title: e.target.value })} placeholder="e.g. Schedule onboarding call" />
              </div>
              <div className={styles.formGroup}>
                <label>Description</label>
                <textarea rows={3} value={taskForm.description} onChange={e => setTaskForm({ ...taskForm, description: e.target.value })} placeholder="Brief details about the task..." />
              </div>
              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label>Priority</label>
                  <select value={taskForm.priority} onChange={e => setTaskForm({ ...taskForm, priority: e.target.value })}>
                    <option>High</option>
                    <option>Normal</option>
                    <option>Low</option>
                  </select>
                </div>
                <div className={styles.formGroup}>
                  <label>Due Date</label>
                  <input type="date" value={taskForm.due_date} onChange={e => setTaskForm({ ...taskForm, due_date: e.target.value })} />
                </div>
              </div>
              <div className={styles.modalActions}>
                <button type="button" className={styles.cancelBtn} onClick={() => setShowQuickCreateModal(null)}>Cancel</button>
                <button type="submit" className={styles.submitBtn} disabled={isSubmitting}>Save Task</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showQuickCreateModal === 'appointment' && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <h2>Schedule Appointment</h2>
              <button className={styles.modalCloseBtn} onClick={() => setShowQuickCreateModal(null)}><X size={18} /></button>
            </div>
            <form onSubmit={handleCreateAppt}>
              <div className={styles.formGroup}>
                <label>Title *</label>
                <input required value={apptForm.title} onChange={e => setApptForm({ ...apptForm, title: e.target.value })} placeholder="Sales Demo Call" />
              </div>
              <div className={styles.formGroup}>
                <label>Description</label>
                <textarea rows={2} value={apptForm.description} onChange={e => setApptForm({ ...apptForm, description: e.target.value })} placeholder="Agenda or notes..." />
              </div>
              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label>Start Time *</label>
                  <input required type="datetime-local" value={apptForm.start_time} onChange={e => setApptForm({ ...apptForm, start_time: e.target.value })} />
                </div>
                <div className={styles.formGroup}>
                  <label>End Time *</label>
                  <input required type="datetime-local" value={apptForm.end_time} onChange={e => setApptForm({ ...apptForm, end_time: e.target.value })} />
                </div>
              </div>
              <div className={styles.formGroup}>
                <label>Location</label>
                <input value={apptForm.location} onChange={e => setApptForm({ ...apptForm, location: e.target.value })} placeholder="Zoom link or office address" />
              </div>
              <div className={styles.modalActions}>
                <button type="button" className={styles.cancelBtn} onClick={() => setShowQuickCreateModal(null)}>Cancel</button>
                <button type="submit" className={styles.submitBtn}>Schedule</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showQuickCreateModal === 'invoice' && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <h2>Create Quick Invoice</h2>
              <button className={styles.modalCloseBtn} onClick={() => setShowQuickCreateModal(null)}><X size={18} /></button>
            </div>
            <form onSubmit={handleCreateInvoice}>
              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label>Invoice Number *</label>
                  <input required value={invoiceForm.number} onChange={e => setInvoiceForm({ ...invoiceForm, number: e.target.value })} placeholder="INV-2026-01" />
                </div>
                <div className={styles.formGroup}>
                  <label>Amount ($) *</label>
                  <input required type="number" min="0" step="0.01" value={invoiceForm.amount} onChange={e => setInvoiceForm({ ...invoiceForm, amount: e.target.value })} placeholder="0.00" />
                </div>
              </div>
              <div className={styles.formGroup}>
                <label>Description</label>
                <textarea rows={2} value={invoiceForm.description} onChange={e => setInvoiceForm({ ...invoiceForm, description: e.target.value })} placeholder="Product or services details..." />
              </div>
              <div className={styles.modalActions}>
                <button type="button" className={styles.cancelBtn} onClick={() => setShowQuickCreateModal(null)}>Cancel</button>
                <button type="submit" className={styles.submitBtn}>Create Invoice</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </header>
  );
};
