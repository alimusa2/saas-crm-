import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import styles from './CalendarPage.module.css';
import { calendarApi, crmApi, teamApi, pipelineApi } from '../../lib/api';
import type { Appointment, Lead, TeamMember, Stage } from '../../lib/api';
import { Plus, Calendar, Clock, MapPin, X, CheckCircle, XCircle, Search, User, Briefcase, Mail, Phone, Award, Layers } from 'lucide-react';

const STATUS_COLORS: Record<string, string> = {
  Scheduled: '#3B82F6',
  Confirmed: '#10B981',
  Rescheduled: '#8B5CF6',
  Cancelled: '#EF4444',
  Completed: '#10B981',
  'No Show': '#F59E0B',
  Pending: '#6B7280',
};

interface ToastMsg { id: number; type: 'success' | 'error'; message: string; }

const ToastContainer: React.FC<{ toasts: ToastMsg[]; onDismiss: (id: number) => void }> = ({ toasts, onDismiss }) => {
  if (!toasts.length) return null;
  return (
    <div style={{ position: 'fixed', bottom: 28, right: 28, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 10, pointerEvents: 'none' }}>
      {toasts.map(t => (
        <div
          key={t.id}
          onClick={() => onDismiss(t.id)}
          style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '13px 18px',
            borderRadius: 12, fontSize: 13, fontWeight: 500,
            boxShadow: '0 8px 28px rgba(0,0,0,0.14)',
            pointerEvents: 'all', cursor: 'pointer',
            animation: 'calToastIn 0.28s cubic-bezier(0.22,1,0.36,1) both',
            maxWidth: 360,
            background: t.type === 'success' ? '#ECFDF5' : '#FEF2F2',
            color: t.type === 'success' ? '#065F46' : '#991B1B',
            border: `1px solid ${t.type === 'success' ? '#A7F3D0' : '#FECACA'}`,
          }}
        >
          {t.type === 'success'
            ? <CheckCircle size={16} style={{ color: '#059669', flexShrink: 0 }} />
            : <XCircle size={16} style={{ color: '#EF4444', flexShrink: 0 }} />}
          <span>{t.message}</span>
        </div>
      ))}
      <style>{`@keyframes calToastIn { from { opacity:0; transform:translateY(16px) scale(0.96); } to { opacity:1; transform:translateY(0) scale(1); } }`}</style>
    </div>
  );
};

export const CalendarPage = () => {
  const [activeTab, setActiveTab] = useState<'calendar' | 'analytics' | 'templates'>('calendar');
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const toastIdRef = useRef(0);

  // CRM Lists
  const [leads, setLeads] = useState<Lead[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);
  const [pipelineStages, setPipelineStages] = useState<Stage[]>([]);

  // Search & Filtering form creation
  const [teamSearchQuery, setTeamSearchQuery] = useState('');
  const [leadSearchQuery, setLeadSearchQuery] = useState('');

  // Form State
  const defaultAppt = {
    title: '',
    description: '',
    start_time: '',
    end_time: '',
    location: '',
    status: 'Scheduled',
    assigned_to_id: '',
    lead_id: '',
  };
  const [newAppt, setNewAppt] = useState(defaultAppt);

  // Transition status modal state
  const [transitionTarget, setTransitionTarget] = useState<{ appt: Appointment; nextStatus: string } | null>(null);
  const [customTransitionMessage, setCustomTransitionMessage] = useState('');

  // Analytics Stats State
  const [analytics, setAnalytics] = useState<any>(null);

  // Templates Editor State
  const [templates, setTemplates] = useState<any[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [templateSubject, setTemplateSubject] = useState('');
  const [templateBody, setTemplateBody] = useState('');

  // Search & Filters state for Calendar list view
  const [listSearch, setListSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterAssignee, setFilterAssignee] = useState('');
  const [filterDepartment, setFilterDepartment] = useState('');
  const [filterLead, setFilterLead] = useState('');
  const [filterStage, setFilterStage] = useState('');
  const [filterScoreRange, setFilterScoreRange] = useState('');
  const [filterSource, setFilterSource] = useState('');
  const [filterDateRange, setFilterDateRange] = useState('');

  // Toast Helpers
  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4500);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const fetchAppointments = async () => {
    setLoading(true);
    try {
      const data = await calendarApi.getAppointments();
      setAppointments(data);
    } catch (e: any) {
      showToast(e.message || 'Failed to load appointments.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const fetchAnalytics = async () => {
    try {
      const data = await calendarApi.getMeetingAnalytics();
      setAnalytics(data);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchTemplates = async () => {
    try {
      const data = await calendarApi.getMeetingTemplates();
      setTemplates(data);
      if (data.length > 0) {
        handleSelectTemplate(data[0].id, data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchAppointments();
    crmApi.getLeads().then(setLeads).catch(console.error);
    teamApi.getTeamMembers().then(setTeamMembers).catch(console.error);
    teamApi.getDepartments().then(setDepartments).catch(console.error);
    pipelineApi.getAllStages().then(setPipelineStages).catch(console.error);

    const handleApptUpdate = () => {
      fetchAppointments();
      crmApi.getLeads().then(setLeads).catch(console.error);
    };
    window.addEventListener('appointment-updated', handleApptUpdate);
    return () => window.removeEventListener('appointment-updated', handleApptUpdate);
  }, []);

  useEffect(() => {
    if (activeTab === 'analytics') {
      fetchAnalytics();
    } else if (activeTab === 'templates') {
      fetchTemplates();
    }
  }, [activeTab]);

  const handleSelectTemplate = (id: string, list = templates) => {
    const t = list.find(item => item.id === id);
    if (t) {
      setSelectedTemplateId(id);
      setTemplateSubject(t.subject);
      setTemplateBody(t.html_content);
    }
  };

  const handleSaveTemplate = async () => {
    if (!selectedTemplateId) return;
    try {
      await calendarApi.updateMeetingTemplate(selectedTemplateId, {
        subject: templateSubject,
        html_content: templateBody
      });
      showToast('Template updated successfully!');
      // reload
      const data = await calendarApi.getMeetingTemplates();
      setTemplates(data);
    } catch (e: any) {
      showToast(e.message || 'Failed to update template.', 'error');
    }
  };

  // Autocomplete / Search filters inside creator
  const filteredCreatorTeam = useMemo(() => {
    return teamMembers.filter(t => 
      t.status === 'Active' && 
      `${t.first_name} ${t.last_name} ${t.department} ${t.role}`.toLowerCase().includes(teamSearchQuery.toLowerCase())
    );
  }, [teamMembers, teamSearchQuery]);

  const filteredCreatorLeads = useMemo(() => {
    return leads.filter(l => 
      `${l.first_name} ${l.last_name} ${l.email || ''} ${l.phone || ''}`.toLowerCase().includes(leadSearchQuery.toLowerCase())
    );
  }, [leads, leadSearchQuery]);

  const selectedLeadDetails = useMemo(() => {
    if (!newAppt.lead_id) return null;
    const l = leads.find(item => item.id === newAppt.lead_id);
    if (!l) return null;

    // Find assigned salesperson name
    const salesperson = teamMembers.find(t => t.user_id === l.owner_id || t.id === l.owner_id);
    const stage = pipelineStages.find(s => s.name === l.status);

    return {
      name: `${l.first_name} ${l.last_name}`,
      email: l.email || 'No email',
      phone: l.phone || 'No phone',
      company: l.company_id ? 'Yes' : 'None', // Company info
      stage: stage ? stage.name : l.status || 'New',
      score: l.lead_score,
      salesperson: salesperson ? `${salesperson.first_name} ${salesperson.last_name}` : 'Unassigned',
    };
  }, [leads, newAppt.lead_id, teamMembers, pipelineStages]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    if (!newAppt.title.trim()) {
      showToast('Meeting title is required.', 'error');
      return;
    }
    if (!newAppt.assigned_to_id) {
      showToast('Meeting With (Team Member) is required.', 'error');
      return;
    }
    if (!newAppt.start_time || !newAppt.end_time) {
      showToast('Start and End time are required.', 'error');
      return;
    }
    if (new Date(newAppt.start_time) >= new Date(newAppt.end_time)) {
      showToast('End time must be after Start time.', 'error');
      return;
    }

    setSubmitting(true);
    try {
      const created = await calendarApi.createAppointment(newAppt);
      setAppointments(prev => [created, ...prev]);
      setIsModalOpen(false);
      setNewAppt(defaultAppt);
      setTeamSearchQuery('');
      setLeadSearchQuery('');
      showToast(`Meeting "${created.title}" scheduled successfully!`);
    } catch (e: any) {
      showToast(e.message || 'Failed to schedule meeting.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const triggerStatusChangePrompt = (appt: Appointment, nextStatus: string) => {
    setTransitionTarget({ appt, nextStatus });
    setCustomTransitionMessage('');
  };

  const handleConfirmStatusChange = async () => {
    if (!transitionTarget) return;
    const { appt, nextStatus } = transitionTarget;
    try {
      const updated = await calendarApi.updateAppointment(appt.id, {
        status: nextStatus,
        custom_message: customTransitionMessage || undefined
      });
      setAppointments(prev => prev.map(a => a.id === updated.id ? updated : a));
      showToast(`Status of "${appt.title}" changed to ${nextStatus}.`);
      setTransitionTarget(null);
      if (activeTab === 'analytics') fetchAnalytics();
    } catch (e: any) {
      showToast(e.message || 'Failed to change status.', 'error');
    }
  };

  // Filter list matching
  const filteredAppointments = useMemo(() => {
    return appointments.filter(appt => {
      const member = teamMembers.find(m => m.id === appt.assigned_to_id);
      const lead = leads.find(l => l.id === appt.lead_id);
      
      // Search
      if (listSearch) {
        const query = listSearch.toLowerCase();
        const memberName = member ? `${member.first_name} ${member.last_name}` : '';
        const leadName = lead ? `${lead.first_name} ${lead.last_name}` : '';
        const match = 
          appt.title.toLowerCase().includes(query) ||
          (appt.description && appt.description.toLowerCase().includes(query)) ||
          (appt.location && appt.location.toLowerCase().includes(query)) ||
          memberName.toLowerCase().includes(query) ||
          leadName.toLowerCase().includes(query) ||
          (member && member.department.toLowerCase().includes(query)) ||
          appt.status.toLowerCase().includes(query);
        if (!match) return false;
      }

      // Status
      if (filterStatus && appt.status !== filterStatus) return false;

      // Assigned Team Member
      if (filterAssignee && appt.assigned_to_id !== filterAssignee) return false;

      // Department
      if (filterDepartment && (!member || member.department !== filterDepartment)) return false;

      // Related Lead
      if (filterLead && appt.lead_id !== filterLead) return false;

      // Pipeline Stage
      if (filterStage && (!lead || lead.status !== filterStage)) return false;

      // Lead Score Range
      if (filterScoreRange) {
        if (!lead) return false;
        const [min, max] = filterScoreRange.split('-').map(Number);
        if (lead.lead_score < min || lead.lead_score > max) return false;
      }

      // Lead Source
      if (filterSource && (!lead || lead.lead_source !== filterSource)) return false;

      // Date Range filter
      if (filterDateRange) {
        const d = new Date(appt.start_time);
        const today = new Date();
        today.setHours(0,0,0,0);
        
        if (filterDateRange === 'Today') {
          if (d.toDateString() !== today.toDateString()) return false;
        } else if (filterDateRange === 'This Week') {
          const sunday = new Date(today);
          sunday.setDate(today.getDate() - today.getDay());
          const saturday = new Date(sunday);
          saturday.setDate(sunday.getDate() + 6);
          saturday.setHours(23,59,59,999);
          if (d < sunday || d > saturday) return false;
        } else if (filterDateRange === 'Upcoming') {
          if (d < new Date()) return false;
        } else if (filterDateRange === 'Past') {
          if (d >= new Date()) return false;
        }
      }

      return true;
    });
  }, [appointments, listSearch, filterStatus, filterAssignee, filterDepartment, filterLead, filterStage, filterScoreRange, filterSource, filterDateRange, teamMembers, leads]);

  const grouped = useMemo(() => {
    return filteredAppointments.reduce<Record<string, Appointment[]>>((acc, appt) => {
      const date = new Date(appt.start_time).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
      if (!acc[date]) acc[date] = [];
      acc[date].push(appt);
      return acc;
    }, {});
  }, [filteredAppointments]);

  return (
    <div className={styles.container}>
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Meetings & Calendar</h1>
          <p className={styles.subtitle}>Track client meetings, lifecycle states, and team assignments.</p>
        </div>
        <button className={styles.addBtn} onClick={() => setIsModalOpen(true)}>
          <Plus size={18} /> Book Meeting
        </button>
      </div>

      {/* Tab Navigation */}
      <div className={styles.tabsContainer}>
        <button className={`${styles.tabButton} ${activeTab === 'calendar' ? styles.activeTab : ''}`} onClick={() => setActiveTab('calendar')}>
          Calendar List
        </button>
        <button className={`${styles.tabButton} ${activeTab === 'analytics' ? styles.activeTab : ''}`} onClick={() => setActiveTab('analytics')}>
          Meeting Analytics
        </button>
        <button className={`${styles.tabButton} ${activeTab === 'templates' ? styles.activeTab : ''}`} onClick={() => setActiveTab('templates')}>
          Email Templates
        </button>
      </div>

      {/* TABS CONTENT */}
      {activeTab === 'calendar' && (
        <>
          {/* Filters Bar */}
          <div className={styles.filtersBar}>
            <div className={styles.searchBox}>
              <Search size={16} />
              <input
                type="text"
                placeholder="Search meetings by title, department, assignee, lead..."
                value={listSearch}
                onChange={e => setListSearch(e.target.value)}
              />
            </div>
            <div className={styles.filtersGrid}>
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                <option value="">All Statuses</option>
                {Object.keys(STATUS_COLORS).map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              
              <select value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)}>
                <option value="">All Assignees</option>
                {teamMembers.map(t => <option key={t.id} value={t.id}>{t.first_name} {t.last_name}</option>)}
              </select>

              <select value={filterDepartment} onChange={e => setFilterDepartment(e.target.value)}>
                <option value="">All Departments</option>
                {departments.map(d => <option key={d} value={d}>{d}</option>)}
              </select>

              <select value={filterLead} onChange={e => setFilterLead(e.target.value)}>
                <option value="">All Leads</option>
                {leads.map(l => <option key={l.id} value={l.id}>{l.first_name} {l.last_name}</option>)}
              </select>

              <select value={filterStage} onChange={e => setFilterStage(e.target.value)}>
                <option value="">All Lead Stages</option>
                {pipelineStages.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
              </select>

              <select value={filterScoreRange} onChange={e => setFilterScoreRange(e.target.value)}>
                <option value="">All Lead Scores</option>
                <option value="0-20">0 - 20</option>
                <option value="21-40">21 - 40</option>
                <option value="41-60">41 - 60</option>
                <option value="61-80">61 - 80</option>
                <option value="81-100">81 - 100</option>
              </select>

              <select value={filterDateRange} onChange={e => setFilterDateRange(e.target.value)}>
                <option value="">All Dates</option>
                <option value="Today">Today</option>
                <option value="This Week">This Week</option>
                <option value="Upcoming">Upcoming</option>
                <option value="Past">Past</option>
              </select>
            </div>
          </div>

          {loading && <div className={styles.stateMsg}>Loading meetings…</div>}

          {!loading && filteredAppointments.length === 0 && (
            <div className={styles.emptyState}>
              <Calendar size={56} style={{ opacity: 0.2, marginBottom: 16 }} />
              <h3>No meetings scheduled</h3>
              <p>Try adjusting your search filters or click "Book Meeting" to schedule one.</p>
            </div>
          )}

          {!loading && Object.entries(grouped).map(([date, appts]) => (
            <div key={date} className={styles.dayGroup}>
              <div className={styles.dayLabel}>{date}</div>
              <div className={styles.apptList}>
                {appts.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()).map(appt => {
                  const assignedMember = teamMembers.find(m => m.id === appt.assigned_to_id);
                  const relatedLeadObj = leads.find(l => l.id === appt.lead_id);
                  return (
                    <div key={appt.id} className={styles.apptCard} style={{ borderLeftColor: STATUS_COLORS[appt.status] || '#6B7280' }}>
                      <div className={styles.apptMain}>
                        <h3 className={styles.apptTitle}>{appt.title}</h3>
                        {appt.description && <p className={styles.apptDesc}>{appt.description}</p>}
                        <div className={styles.apptMeta}>
                          <span><Clock size={13} /> {new Date(appt.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} – {new Date(appt.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          {appt.location && (
                            appt.location.includes('meet.google.com') ? (
                              <a
                                href={appt.location}
                                target="_blank"
                                rel="noreferrer"
                                title="Launch room as Host Admin to admit waiting customers"
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '5px',
                                  color: '#4F46E5',
                                  fontWeight: 700,
                                  textDecoration: 'none',
                                  background: '#EEF2FF',
                                  padding: '4px 12px',
                                  borderRadius: '6px',
                                  border: '1px solid #C7D2FE',
                                  fontSize: '12px'
                                }}
                              >
                                👑 Start & Host Meeting (Admin) →
                              </a>
                            ) : (
                              <span><MapPin size={13} /> {appt.location}</span>
                            )
                          )}
                          {assignedMember && (
                            <span title={assignedMember.email}>
                              <Briefcase size={13} style={{ marginRight: 3 }} /> {assignedMember.first_name} {assignedMember.last_name} ({assignedMember.department})
                            </span>
                          )}
                          {relatedLeadObj && (
                            <span>
                              👤 Lead: {relatedLeadObj.first_name} {relatedLeadObj.last_name}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className={styles.apptActions}>
                        <select
                          className={styles.statusSelect}
                          value={appt.status}
                          style={{ borderColor: STATUS_COLORS[appt.status] || '#6B7280', color: STATUS_COLORS[appt.status] || '#6B7280' }}
                          onChange={e => triggerStatusChangePrompt(appt, e.target.value)}
                        >
                          {Object.keys(STATUS_COLORS).map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </>
      )}

      {activeTab === 'analytics' && analytics && (
        <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
          {/* Key Analytics Metrics */}
          <div className={styles.statsGrid}>
            <div className={styles.statCard}>
              <span className={styles.statNumber}>{analytics.completed_meetings}</span>
              <span className={styles.statLabel}>Completed</span>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statNumber}>{analytics.cancelled_meetings}</span>
              <span className={styles.statLabel}>Cancelled</span>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statNumber}>{analytics.no_shows}</span>
              <span className={styles.statLabel}>No Shows</span>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statNumber}>{(analytics.average_completion_rate * 100).toFixed(0)}%</span>
              <span className={styles.statLabel}>Completion Rate</span>
            </div>
          </div>

          <div className={styles.analyticsGrid}>
            {/* Department stats */}
            <div className={styles.analyticsCard}>
              <h3>Meetings by Department</h3>
              <div className={styles.distributionList}>
                {Object.entries(analytics.by_department).map(([dept, count]) => (
                  <div key={dept} className={styles.distributionItem}>
                    <span>{dept}</span>
                    <span>{count as number}</span>
                  </div>
                ))}
                {Object.keys(analytics.by_department).length === 0 && <p style={{ fontSize: 13, color: 'gray' }}>No data available</p>}
              </div>
            </div>

            {/* Salesperson stats */}
            <div className={styles.analyticsCard}>
              <h3>Meetings by Team Member</h3>
              <div className={styles.distributionList}>
                {Object.entries(analytics.by_team_member).map(([name, count]) => (
                  <div key={name} className={styles.distributionItem}>
                    <span>{name}</span>
                    <span>{count as number}</span>
                  </div>
                ))}
                {Object.keys(analytics.by_team_member).length === 0 && <p style={{ fontSize: 13, color: 'gray' }}>No data available</p>}
              </div>
            </div>

            {/* Status distribution */}
            <div className={styles.analyticsCard}>
              <h3>Meetings by Status</h3>
              <div className={styles.distributionList}>
                {Object.entries(analytics.by_status).map(([status, count]) => (
                  <div key={status} className={styles.distributionItem}>
                    <span>{status}</span>
                    <span>{count as number}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Lead source stats */}
            <div className={styles.analyticsCard}>
              <h3>Meetings by Lead Source</h3>
              <div className={styles.distributionList}>
                {Object.entries(analytics.by_lead_source).map(([source, count]) => (
                  <div key={source} className={styles.distributionItem}>
                    <span>{source}</span>
                    <span>{count as number}</span>
                  </div>
                ))}
                {Object.keys(analytics.by_lead_source).length === 0 && <p style={{ fontSize: 13, color: 'gray' }}>No data available</p>}
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'templates' && templates.length > 0 && (
        <div className={styles.editorBox} style={{ animation: 'fadeIn 0.3s ease-out' }}>
          <div className={styles.formGroup}>
            <label>Select Template</label>
            <select className={styles.templateSelect} value={selectedTemplateId} onChange={e => handleSelectTemplate(e.target.value)}>
              {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>

          <div className={styles.formGroup}>
            <label>Subject Template</label>
            <input
              type="text"
              value={templateSubject}
              onChange={e => setTemplateSubject(e.target.value)}
              placeholder="Template Subject"
            />
          </div>

          <div className={styles.formGroup}>
            <label>HTML Content Template</label>
            <textarea
              value={templateBody}
              onChange={e => setTemplateBody(e.target.value)}
              placeholder="HTML Body Template"
              rows={12}
              style={{ fontFamily: 'monospace', fontSize: 13 }}
            />
          </div>

          <div className={styles.variablesHint}>
            <strong>Supported dynamic variables:</strong><br/>
            <code>{`{{meeting_title}}, {{meeting_date}}, {{meeting_time}}, {{meeting_duration}}, {{meeting_location}}, {{meeting_link}}, {{team_member_name}}, {{lead_name}}, {{lead_email}}, {{lead_phone}}, {{lead_company}}, {{pipeline_stage}}, {{lead_score}}, {{organizer}}, {{custom_message}}`}</code>
          </div>

          <div className={styles.modalActions}>
            <button className={styles.submitBtn} onClick={handleSaveTemplate}>
              Save Template Changes
            </button>
          </div>
        </div>
      )}

      {/* Book Meeting Modal */}
      {isModalOpen && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <h2>Book New Meeting</h2>
              <button onClick={() => setIsModalOpen(false)}><X size={20} /></button>
            </div>
            <form onSubmit={handleCreate}>
              <div className={styles.formGroup}>
                <label>Meeting Title *</label>
                <input
                  required
                  value={newAppt.title}
                  onChange={e => setNewAppt({ ...newAppt, title: e.target.value })}
                  placeholder="e.g. Kickoff Call / Discovery Session"
                />
              </div>
              <div className={styles.formGroup}>
                <label>Description</label>
                <textarea
                  value={newAppt.description}
                  onChange={e => setNewAppt({ ...newAppt, description: e.target.value })}
                  placeholder="Describe meeting agenda, objectives…"
                  rows={2}
                />
              </div>

              {/* MEETING WITH: TEAM MEMBER (REQUIRED) */}
              <div style={{ border: '1px solid var(--border-color)', borderRadius: 8, padding: 14, marginBottom: 14, background: '#f8fafc' }}>
                <h3 style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-main)', marginTop: 0, marginBottom: 8 }}>Meeting With (Team Member) *</h3>
                
                <div className={styles.formGroup}>
                  <input
                    type="text"
                    placeholder="Search active team members..."
                    value={teamSearchQuery}
                    onChange={e => setTeamSearchQuery(e.target.value)}
                    style={{ padding: '6px 10px', fontSize: 12, marginBottom: 6 }}
                  />
                  <select
                    required
                    value={newAppt.assigned_to_id}
                    onChange={e => setNewAppt({ ...newAppt, assigned_to_id: e.target.value })}
                    style={{ fontSize: 13 }}
                  >
                    <option value="">-- Choose Assigned Team Member --</option>
                    {filteredCreatorTeam.map(t => (
                      <option key={t.id} value={t.id}>
                        {t.first_name} {t.last_name} ({t.department} - {t.role})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* RELATED LEAD (OPTIONAL) */}
              <div style={{ border: '1px solid var(--border-color)', borderRadius: 8, padding: 14, marginBottom: 14, background: '#f8fafc' }}>
                <h3 style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-main)', marginTop: 0, marginBottom: 8 }}>Related Lead (Optional)</h3>
                
                <div className={styles.formGroup}>
                  <input
                    type="text"
                    placeholder="Search leads by name, email, phone..."
                    value={leadSearchQuery}
                    onChange={e => setLeadSearchQuery(e.target.value)}
                    style={{ padding: '6px 10px', fontSize: 12, marginBottom: 6 }}
                  />
                  <select
                    value={newAppt.lead_id}
                    onChange={e => setNewAppt({ ...newAppt, lead_id: e.target.value })}
                    style={{ fontSize: 13 }}
                  >
                    <option value="">-- None / Select Related Lead --</option>
                    {filteredCreatorLeads.map(l => (
                      <option key={l.id} value={l.id}>
                        {l.first_name} {l.last_name} ({l.email || 'No email'})
                      </option>
                    ))}
                  </select>
                </div>

                {/* READ ONLY SUMMARY CARD */}
                {selectedLeadDetails && (
                  <div className={styles.leadSummaryCard}>
                    <h4>{selectedLeadDetails.name}</h4>
                    <div className={styles.leadCardGrid}>
                      <span>Email: <strong>{selectedLeadDetails.email}</strong></span>
                      <span>Phone: <strong>{selectedLeadDetails.phone}</strong></span>
                      <span>Stage: <strong>{selectedLeadDetails.stage}</strong></span>
                      <span>Score: <strong>{selectedLeadDetails.score}</strong></span>
                      <span style={{ gridColumn: 'span 2' }}>Salesperson: <strong>{selectedLeadDetails.salesperson}</strong></span>
                    </div>
                  </div>
                )}
              </div>

              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label>Start Time *</label>
                  <input
                    required
                    type="datetime-local"
                    value={newAppt.start_time}
                    onChange={e => setNewAppt({ ...newAppt, start_time: e.target.value })}
                  />
                </div>
                <div className={styles.formGroup}>
                  <label>End Time *</label>
                  <input
                    required
                    type="datetime-local"
                    value={newAppt.end_time}
                    min={newAppt.start_time || undefined}
                    onChange={e => setNewAppt({ ...newAppt, end_time: e.target.value })}
                  />
                </div>
              </div>

              <div className={styles.formGroup}>
                <label>Location / Meeting Link</label>
                <input
                  value={newAppt.location}
                  onChange={e => setNewAppt({ ...newAppt, location: e.target.value })}
                  placeholder="e.g. Zoom Link / Conference Room"
                />
              </div>

              <div className={styles.modalActions}>
                <button
                  type="button"
                  className={styles.cancelBtn}
                  onClick={() => setIsModalOpen(false)}
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={styles.submitBtn}
                  disabled={submitting}
                >
                  {submitting ? 'Scheduling…' : 'Schedule Meeting'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Transition Confirmation Modal (Custom Message Prompt) */}
      {transitionTarget && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal} style={{ width: 440 }}>
            <div className={styles.modalHeader}>
              <h2>Confirm Status Change</h2>
              <button onClick={() => setTransitionTarget(null)}><X size={20} /></button>
            </div>
            <div className={styles.formGroup}>
              <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 12 }}>
                Are you sure you want to change the status of <strong>{transitionTarget.appt.title}</strong> to <strong>{transitionTarget.nextStatus}</strong>?
              </p>
              <label>Additional Context / Instructions (Optional)</label>
              <textarea
                value={customTransitionMessage}
                onChange={e => setCustomTransitionMessage(e.target.value)}
                placeholder="Injected into email template (e.g. reschedule reason, kickoff instructions)..."
                rows={3}
              />
            </div>
            <div className={styles.modalActions}>
              <button className={styles.cancelBtn} onClick={() => setTransitionTarget(null)}>
                Cancel
              </button>
              <button className={styles.submitBtn} onClick={handleConfirmStatusChange}>
                Confirm Change
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
