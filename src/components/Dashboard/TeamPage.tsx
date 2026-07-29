import React, { useState, useEffect } from 'react';
import styles from './TeamPage.module.css';
import { teamApi, performanceApi } from '../../lib/api';
import type { TeamMember, TeamMemberCreate } from '../../lib/api';
import { Plus, Search, Mail, Phone, Briefcase, Trash2, Edit2, Shield, User, AlertCircle, X, BarChart2, Download, TrendingUp, CheckSquare, DollarSign, Award, Calendar, Activity } from 'lucide-react';

import { useAuth } from '../../lib/AuthContext';

const DEPARTMENTS = [
  'Sales',
  'Marketing',
  'Development',
  'Design',
  'QA',
  'HR',
  'Finance',
  'Operations',
  'Management',
  'Customer Support',
];

const ROLES = ['Admin', 'Manager', 'Member'];

export const TeamPage = () => {
  const { user } = useAuth();
  const isAdmin = Boolean(
    user?.is_superuser || 
    user?.role === 'Admin' || 
    (user?.role || '').toString().toLowerCase() === 'admin'
  );

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Search & Filter
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  // View State: 'directory' | 'leaderboard'
  const [activeView, setActiveView] = useState<'directory' | 'leaderboard'>('directory');
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [leaderboardSort, setLeaderboardSort] = useState<string>('revenue');
  const [leaderboardLoading, setLeaderboardLoading] = useState<boolean>(false);

  useEffect(() => {
    if (activeView === 'leaderboard') {
      fetchLeaderboard(leaderboardSort);
    }
  }, [activeView, leaderboardSort]);

  const fetchLeaderboard = async (sortBy: string) => {
    setLeaderboardLoading(true);
    try {
      const data = await performanceApi.getLeaderboard(sortBy);
      setLeaderboard(data);
    } catch (err: any) {
      console.error('Failed to fetch leaderboard:', err);
    } finally {
      setLeaderboardLoading(false);
    }
  };
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null);

  // Performance Stats Modal State
  const [isStatsModalOpen, setIsStatsModalOpen] = useState(false);
  const [statsMember, setStatsMember] = useState<TeamMember | null>(null);
  const [statsData, setStatsData] = useState<any>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  const handleOpenStatsModal = async (member: TeamMember) => {
    setStatsMember(member);
    setIsStatsModalOpen(true);
    setStatsLoading(true);
    try {
      const data = await performanceApi.getEmployeePerformance(member.id);
      setStatsData(data);
    } catch (err: any) {
      console.error('Failed to load performance stats:', err);
    } finally {
      setStatsLoading(false);
    }
  };

  // Form State
  const [formData, setFormData] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    job_title: '',
    department: 'Sales',
    status: 'Active',
    role: 'Member',
    notes: '',
  });

  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    fetchMembers();
  }, []);

  const fetchMembers = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await teamApi.getTeamMembers();
      setMembers(data);
    } catch (e: any) {
      setError(e.message || 'Failed to fetch team members');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenAddModal = () => {
    setFormData({
      first_name: '',
      last_name: '',
      email: '',
      phone: '',
      job_title: '',
      department: 'Sales',
      status: 'Active',
      role: 'Member',
      notes: '',
    });
    setFormError(null);
    setIsAddModalOpen(true);
  };

  const handleOpenEditModal = (member: TeamMember) => {
    setEditingMember(member);
    setFormData({
      first_name: member.first_name,
      last_name: member.last_name,
      email: member.email,
      phone: member.phone || '',
      job_title: member.job_title || '',
      department: member.department,
      status: member.status,
      role: member.role,
      notes: member.notes || '',
    });
    setFormError(null);
    setIsEditModalOpen(true);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    // Simple manual email validation check before post
    if (!formData.email.includes('@') || !formData.email.includes('.')) {
      setFormError('Work email must be a valid email address.');
      return;
    }

    try {
      const created = await teamApi.createTeamMember(formData as TeamMemberCreate);
      setMembers([created, ...members]);
      setIsAddModalOpen(false);
    } catch (e: any) {
      setFormError(e.message || 'Failed to create team member');
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMember) return;
    setFormError(null);

    if (!formData.email.includes('@') || !formData.email.includes('.')) {
      setFormError('Work email must be a valid email address.');
      return;
    }

    try {
      const updated = await teamApi.updateTeamMember(editingMember.id, formData);
      setMembers(members.map(m => m.id === editingMember.id ? updated : m));
      setIsEditModalOpen(false);
      setEditingMember(null);
    } catch (e: any) {
      setFormError(e.message || 'Failed to update team member');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to remove this team member? This soft-deletes the record and deactivates the login.')) return;
    try {
      await teamApi.deleteTeamMember(id);
      setMembers(members.filter(m => m.id !== id));
    } catch (e: any) {
      alert(e.message || 'Failed to remove team member');
    }
  };

  const filtered = members.filter(m => {
    const matchesSearch =
      `${m.first_name} ${m.last_name}`.toLowerCase().includes(search.toLowerCase()) ||
      m.email.toLowerCase().includes(search.toLowerCase()) ||
      (m.job_title || '').toLowerCase().includes(search.toLowerCase());

    const matchesDept = deptFilter ? m.department === deptFilter : true;
    const matchesStatus = statusFilter ? m.status === statusFilter : true;

    return matchesSearch && matchesDept && matchesStatus;
  });

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1>Team Management</h1>
          <p className={styles.subtitle}>{members.length} team members registered</p>
        </div>
        {isAdmin && (
          <button className={styles.addBtn} onClick={handleOpenAddModal}>
            <Plus size={18} /> Add Team Member
          </button>
        )}
      </div>

      {/* View Switcher Tabs */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', borderBottom: '1px solid #E5E7EB', paddingBottom: '12px' }}>
        <button
          onClick={() => setActiveView('directory')}
          style={{
            padding: '8px 16px',
            fontSize: '14px',
            fontWeight: 600,
            color: activeView === 'directory' ? '#4F46E5' : '#6B7280',
            backgroundColor: activeView === 'directory' ? '#EEF2FF' : 'transparent',
            border: activeView === 'directory' ? '1px solid #C7D2FE' : '1px solid transparent',
            borderRadius: '6px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}
        >
          <User size={16} /> Team Directory & Stats
        </button>
        {isAdmin && (
          <button
            onClick={() => setActiveView('leaderboard')}
            style={{
              padding: '8px 16px',
              fontSize: '14px',
              fontWeight: 600,
              color: activeView === 'leaderboard' ? '#4F46E5' : '#6B7280',
              backgroundColor: activeView === 'leaderboard' ? '#EEF2FF' : 'transparent',
              border: activeView === 'leaderboard' ? '1px solid #C7D2FE' : '1px solid transparent',
              borderRadius: '6px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <Award size={16} /> Performance Leaderboard
          </button>
        )}
      </div>

      {activeView === 'leaderboard' ? (
        <div style={{ backgroundColor: 'white', border: '1px solid #E5E7EB', borderRadius: '12px', padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 700, margin: 0, color: '#111827' }}>Employee Performance Leaderboard</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '13px', color: '#6B7280' }}>Sort By:</span>
              <select
                value={leaderboardSort}
                onChange={e => setLeaderboardSort(e.target.value)}
                style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid #D1D5DB', fontSize: '13px', backgroundColor: 'white' }}
              >
                <option value="revenue">Revenue Generated ($)</option>
                <option value="deals">Deals Won</option>
                <option value="conversion">Conversion Rate (%)</option>
                <option value="tasks">Tasks Completed</option>
                <option value="meetings">Client Meetings</option>
                <option value="rating">Overall Rating (Score)</option>
              </select>
            </div>
          </div>

          {leaderboardLoading ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#6B7280' }}>Loading leaderboard rankings…</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
                <thead>
                  <tr style={{ backgroundColor: '#F9FAFB', borderBottom: '1px solid #E5E7EB' }}>
                    <th style={{ padding: '12px 16px', fontWeight: 600, color: '#4B5563' }}>Rank</th>
                    <th style={{ padding: '12px 16px', fontWeight: 600, color: '#4B5563' }}>Employee</th>
                    <th style={{ padding: '12px 16px', fontWeight: 600, color: '#4B5563' }}>Department</th>
                    <th style={{ padding: '12px 16px', fontWeight: 600, color: '#4B5563' }}>Revenue</th>
                    <th style={{ padding: '12px 16px', fontWeight: 600, color: '#4B5563' }}>Deals Won</th>
                    <th style={{ padding: '12px 16px', fontWeight: 600, color: '#4B5563' }}>Conversion</th>
                    <th style={{ padding: '12px 16px', fontWeight: 600, color: '#4B5563' }}>Tasks</th>
                    <th style={{ padding: '12px 16px', fontWeight: 600, color: '#4B5563' }}>Meetings</th>
                    <th style={{ padding: '12px 16px', fontWeight: 600, color: '#4B5563' }}>Overall Score</th>
                    <th style={{ padding: '12px 16px', fontWeight: 600, color: '#4B5563' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.map((lb) => {
                    const memberObj = members.find(m => m.id === lb.member_id);
                    return (
                      <tr key={lb.member_id} style={{ borderBottom: '1px solid #F3F4F6' }}>
                        <td style={{ padding: '12px 16px', fontWeight: 700, color: lb.rank === 1 ? '#D97706' : lb.rank === 2 ? '#4B5563' : lb.rank === 3 ? '#92400E' : '#6B7280' }}>
                          {lb.rank === 1 ? '🥇 #1' : lb.rank === 2 ? '🥈 #2' : lb.rank === 3 ? '🥉 #3' : `#${lb.rank}`}
                        </td>
                        <td style={{ padding: '12px 16px', fontWeight: 600, color: '#111827' }}>
                          {lb.name}
                          <div style={{ fontSize: '12px', fontWeight: 400, color: '#6B7280' }}>{lb.role}</div>
                        </td>
                        <td style={{ padding: '12px 16px', color: '#4B5563' }}>{lb.department}</td>
                        <td style={{ padding: '12px 16px', fontWeight: 700, color: '#059669' }}>${(lb.revenue || 0).toLocaleString()}</td>
                        <td style={{ padding: '12px 16px', fontWeight: 600 }}>{lb.won_deals || 0}</td>
                        <td style={{ padding: '12px 16px' }}>{lb.conversion_rate || 0}%</td>
                        <td style={{ padding: '12px 16px' }}>{lb.tasks_completed || 0}</td>
                        <td style={{ padding: '12px 16px' }}>{lb.meetings_completed || 0}</td>
                        <td style={{ padding: '12px 16px', fontWeight: 800, color: '#B45309' }}>⭐ {(lb.performance_rating || 3.0).toFixed(1)}</td>
                        <td style={{ padding: '12px 16px' }}>
                          {memberObj && (
                            <button
                              onClick={() => handleOpenStatsModal(memberObj)}
                              style={{ padding: '4px 10px', fontSize: '12px', fontWeight: 600, color: '#4F46E5', backgroundColor: '#EEF2FF', border: '1px solid #C7D2FE', borderRadius: '4px', cursor: 'pointer' }}
                            >
                              Stats
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className={styles.controlsBar}>
            <div className={styles.searchContainer}>
              <Search size={16} className={styles.searchIcon} />
              <input
                type="text"
                placeholder="Search by name, email or title…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className={styles.searchInput}
              />
            </div>
            <div className={styles.filters}>
              <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)} className={styles.filterSelect}>
                <option value="">All Departments</option>
                {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className={styles.filterSelect}>
                <option value="">All Statuses</option>
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </div>
          </div>
        </>
      )}

      {loading ? (
        <div className={styles.loadingState}>Loading team members…</div>
      ) : (
        <div className={styles.grid}>
          {filtered.map(member => (
            <div key={member.id} className={`${styles.card} ${member.status === 'Inactive' ? styles.inactiveCard : ''}`}>
              <div className={styles.cardHeader}>
                <div className={styles.avatar}>
                  {member.avatar ? (
                    <img src={member.avatar} alt={member.first_name} />
                  ) : (
                    `${member.first_name[0]}${member.last_name[0]}`
                  )}
                </div>
                <span className={`${styles.statusBadge} ${member.status === 'Active' ? styles.statusActive : styles.statusInactive}`}>
                  {member.status}
                </span>
              </div>
              <div className={styles.cardInfo}>
                <h3>{member.first_name} {member.last_name}</h3>
                <div className={styles.jobTitle}>{member.job_title || 'No Job Title'}</div>
                
                <div className={styles.metaRow}><Briefcase size={14} /> <span>{member.department} ({member.role})</span></div>
                <div className={styles.metaRow}><Mail size={14} /> <span>{member.email}</span></div>
                {member.phone && (
                  <div className={styles.metaRow}><Phone size={14} /> <span>{member.phone}</span></div>
                )}
                {member.notes && (
                  <p className={styles.notes}>{member.notes}</p>
                )}
              </div>
              
              <div className={styles.cardActions}>
                {(isAdmin || member.email === user?.email || (member.user_id && (member.user_id === user?.sub || member.user_id === user?.id))) && (
                  <button className={styles.actionBtn} onClick={() => handleOpenStatsModal(member)} title="View Performance Statistics" style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 12px', fontSize: '13px', color: '#4F46E5', backgroundColor: '#EEF2FF', border: '1px solid #C7D2FE', borderRadius: '6px' }}>
                    <BarChart2 size={14} /> My Stats
                  </button>
                )}
                {isAdmin && (
                  <>
                    <button className={styles.actionBtn} onClick={() => handleOpenEditModal(member)} title="Edit Member">
                      <Edit2 size={14} />
                    </button>
                    <button className={`${styles.actionBtn} ${styles.deleteBtn}`} onClick={() => handleDelete(member.id)} title="Delete Member">
                      <Trash2 size={14} />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}

          {filtered.length === 0 && (
            <div className={styles.emptyState}>
              <User size={48} style={{ opacity: 0.2, marginBottom: 12 }} />
              <h3>No team members found</h3>
              <p>Add a new employee or adjust filters to view results.</p>
            </div>
          )}
        </div>
      )}

      {/* Add Modal */}
      {isAddModalOpen && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <h2>Add Team Member</h2>
              <button className={styles.closeBtn} onClick={() => setIsAddModalOpen(false)}><X size={20} /></button>
            </div>
            {formError && <div className={styles.formError}><AlertCircle size={16} /> {formError}</div>}
            <form onSubmit={handleCreate}>
              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label>First Name *</label>
                  <input required value={formData.first_name} onChange={e => setFormData({ ...formData, first_name: e.target.value })} placeholder="John" />
                </div>
                <div className={styles.formGroup}>
                  <label>Last Name *</label>
                  <input required value={formData.last_name} onChange={e => setFormData({ ...formData, last_name: e.target.value })} placeholder="Doe" />
                </div>
              </div>
              <div className={styles.formGroup}>
                <label>Work Email *</label>
                <input required type="email" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} placeholder="john@company.com" />
              </div>
              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label>Phone</label>
                  <input value={formData.phone} onChange={e => setFormData({ ...formData, phone: e.target.value })} placeholder="+1 (555) 000-0000" />
                </div>
                <div className={styles.formGroup}>
                  <label>Job Title</label>
                  <input value={formData.job_title} onChange={e => setFormData({ ...formData, job_title: e.target.value })} placeholder="Sales Exec" />
                </div>
              </div>
              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label>Department *</label>
                  <select value={formData.department} onChange={e => setFormData({ ...formData, department: e.target.value })}>
                    {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div className={styles.formGroup}>
                  <label>Role *</label>
                  <select value={formData.role} onChange={e => setFormData({ ...formData, role: e.target.value })}>
                    {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              </div>
              <div className={styles.formGroup}>
                <label>Status *</label>
                <select value={formData.status} onChange={e => setFormData({ ...formData, status: e.target.value })}>
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                </select>
              </div>
              <div className={styles.formGroup}>
                <label>Notes</label>
                <textarea value={formData.notes} onChange={e => setFormData({ ...formData, notes: e.target.value })} placeholder="Additional information..." rows={2} />
              </div>
              <div className={styles.modalActions}>
                <button type="button" className={styles.cancelBtn} onClick={() => setIsAddModalOpen(false)}>Cancel</button>
                <button type="submit" className={styles.submitBtn}>Add Member</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {isEditModalOpen && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <h2>Edit Team Member</h2>
              <button className={styles.closeBtn} onClick={() => setIsEditModalOpen(false)}><X size={20} /></button>
            </div>
            {formError && <div className={styles.formError}><AlertCircle size={16} /> {formError}</div>}
            <form onSubmit={handleUpdate}>
              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label>First Name *</label>
                  <input required value={formData.first_name} onChange={e => setFormData({ ...formData, first_name: e.target.value })} />
                </div>
                <div className={styles.formGroup}>
                  <label>Last Name *</label>
                  <input required value={formData.last_name} onChange={e => setFormData({ ...formData, last_name: e.target.value })} />
                </div>
              </div>
              <div className={styles.formGroup}>
                <label>Work Email *</label>
                <input required type="email" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} />
              </div>
              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label>Phone</label>
                  <input value={formData.phone} onChange={e => setFormData({ ...formData, phone: e.target.value })} />
                </div>
                <div className={styles.formGroup}>
                  <label>Job Title</label>
                  <input value={formData.job_title} onChange={e => setFormData({ ...formData, job_title: e.target.value })} />
                </div>
              </div>
              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label>Department *</label>
                  <select value={formData.department} onChange={e => setFormData({ ...formData, department: e.target.value })}>
                    {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div className={styles.formGroup}>
                  <label>Role *</label>
                  <select value={formData.role} onChange={e => setFormData({ ...formData, role: e.target.value })}>
                    {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              </div>
              <div className={styles.formGroup}>
                <label>Status *</label>
                <select value={formData.status} onChange={e => setFormData({ ...formData, status: e.target.value })}>
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                </select>
              </div>
              <div className={styles.formGroup}>
                <label>Notes</label>
                <textarea value={formData.notes} onChange={e => setFormData({ ...formData, notes: e.target.value })} rows={2} />
              </div>
              <div className={styles.modalActions}>
                <button type="button" className={styles.cancelBtn} onClick={() => setIsEditModalOpen(false)}>Cancel</button>
                <button type="submit" className={styles.submitBtn}>Save Changes</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Employee Performance Statistics Modal */}
      {isStatsModalOpen && statsMember && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal} style={{ maxWidth: '680px', width: '90%' }}>
            <div className={styles.modalHeader}>
              <div>
                <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '20px' }}>
                  <Award size={22} style={{ color: '#4F46E5' }} />
                  {statsMember.first_name} {statsMember.last_name}'s Performance
                </h2>
                <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#6B7280' }}>
                  {statsMember.job_title || 'Team Member'} • {statsMember.department} Department
                </p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <a
                  href={performanceApi.getExportUrl(statsMember.id)}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 12px',
                    fontSize: '13px',
                    fontWeight: 600,
                    color: '#4F46E5',
                    backgroundColor: '#EEF2FF',
                    border: '1px solid #C7D2FE',
                    borderRadius: '6px',
                    textDecoration: 'none'
                  }}
                >
                  <Download size={14} /> Export CSV
                </a>
                <button className={styles.closeBtn} onClick={() => setIsStatsModalOpen(false)}><X size={20} /></button>
              </div>
            </div>

            {statsLoading ? (
              <div style={{ padding: '40px', textAlign: 'center', color: '#6B7280', fontSize: '14px' }}>
                Loading performance metrics…
              </div>
            ) : statsData ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginTop: '16px' }}>
                {/* KPI Grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '12px' }}>
                  <div style={{ padding: '12px 14px', backgroundColor: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: '8px' }}>
                    <div style={{ fontSize: '12px', color: '#6B7280', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <DollarSign size={13} style={{ color: '#10B981' }} /> Revenue
                    </div>
                    <div style={{ fontSize: '20px', fontWeight: 700, color: '#111827', marginTop: '4px' }}>
                      ${(statsData.revenue_generated || 0).toLocaleString()}
                    </div>
                  </div>

                  <div style={{ padding: '12px 14px', backgroundColor: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: '8px' }}>
                    <div style={{ fontSize: '12px', color: '#6B7280', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <TrendingUp size={13} style={{ color: '#4F46E5' }} /> Deals Won
                    </div>
                    <div style={{ fontSize: '20px', fontWeight: 700, color: '#111827', marginTop: '4px' }}>
                      {statsData.deals_won || 0}
                    </div>
                  </div>

                  <div style={{ padding: '12px 14px', backgroundColor: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: '8px' }}>
                    <div style={{ fontSize: '12px', color: '#6B7280', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Award size={13} style={{ color: '#F59E0B' }} /> Conversion Rate
                    </div>
                    <div style={{ fontSize: '20px', fontWeight: 700, color: '#111827', marginTop: '4px' }}>
                      {statsData.conversion_rate || 0}%
                    </div>
                  </div>

                  <div style={{ padding: '12px 14px', backgroundColor: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: '8px' }}>
                    <div style={{ fontSize: '12px', color: '#6B7280', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <User size={13} style={{ color: '#3B82F6' }} /> Assigned Leads
                    </div>
                    <div style={{ fontSize: '20px', fontWeight: 700, color: '#111827', marginTop: '4px' }}>
                      {statsData.assigned_leads || 0}
                    </div>
                  </div>

                  <div style={{ padding: '12px 14px', backgroundColor: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: '8px' }}>
                    <div style={{ fontSize: '12px', color: '#6B7280', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <CheckSquare size={13} style={{ color: '#8B5CF6' }} /> Tasks Done
                    </div>
                    <div style={{ fontSize: '20px', fontWeight: 700, color: '#111827', marginTop: '4px' }}>
                      {statsData.tasks_completed || 0}
                    </div>
                  </div>

                  <div style={{ padding: '12px 14px', backgroundColor: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: '8px' }}>
                    <div style={{ fontSize: '12px', color: '#6B7280', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Calendar size={13} style={{ color: '#EC4899' }} /> Meetings Done
                    </div>
                    <div style={{ fontSize: '20px', fontWeight: 700, color: '#111827', marginTop: '4px' }}>
                      {statsData.meetings_completed || 0}
                    </div>
                  </div>
                </div>

                {/* Rating Card */}
                <div style={{ padding: '14px 16px', backgroundColor: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <span style={{ fontSize: '14px', fontWeight: 700, color: '#92400E' }}>Overall Performance Score</span>
                      <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: '#B45309' }}>Dynamically weighted across deals, conversion rate, task SLA, and client meetings</p>
                    </div>
                    <div style={{ fontSize: '24px', fontWeight: 800, color: '#78350F' }}>
                      ⭐ {(statsData.overall_score ?? statsData.performance_rating ?? statsData.rating ?? 3.0).toFixed(1)} <span style={{ fontSize: '13px', fontWeight: 400 }}>/ 5.0</span>
                    </div>
                  </div>

                  {statsData.score_breakdown && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginTop: '12px', paddingTop: '10px', borderTop: '1px dashed #F59E0B' }}>
                      <div style={{ fontSize: '11px', color: '#B45309' }}>
                        <div>Deals (35%)</div>
                        <div style={{ fontWeight: 700, fontSize: '13px', color: '#78350F' }}>{statsData.score_breakdown.deal_score}/5.0</div>
                      </div>
                      <div style={{ fontSize: '11px', color: '#B45309' }}>
                        <div>Conversion (25%)</div>
                        <div style={{ fontWeight: 700, fontSize: '13px', color: '#78350F' }}>{statsData.score_breakdown.conversion_score}/5.0</div>
                      </div>
                      <div style={{ fontSize: '11px', color: '#B45309' }}>
                        <div>Task SLA (20%)</div>
                        <div style={{ fontWeight: 700, fontSize: '13px', color: '#78350F' }}>{statsData.score_breakdown.task_score}/5.0</div>
                      </div>
                      <div style={{ fontSize: '11px', color: '#B45309' }}>
                        <div>Meetings (20%)</div>
                        <div style={{ fontWeight: 700, fontSize: '13px', color: '#78350F' }}>{statsData.score_breakdown.meeting_score}/5.0</div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Activity Log / Timeline */}
                {((statsData.timeline && statsData.timeline.length > 0) || (statsData.activities && statsData.activities.length > 0)) && (
                  <div>
                    <h3 style={{ fontSize: '14px', fontWeight: 600, margin: '0 0 10px 0', color: '#374151', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Activity size={15} /> Recent Activity History
                    </h3>
                    <div style={{ maxHeight: '180px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {(statsData.timeline || statsData.activities).map((act: any, idx: number) => (
                        <div key={idx} style={{ padding: '10px 12px', backgroundColor: '#F3F4F6', borderRadius: '6px', fontSize: '13px' }}>
                          <div style={{ fontWeight: 600, color: '#1F2937' }}>{act.title || act.action_type || act.type}</div>
                          {act.details && <div style={{ color: '#4B5563', marginTop: '2px' }}>{act.details}</div>}
                          {act.created_at && <div style={{ color: '#9CA3AF', fontSize: '11px', marginTop: '4px' }}>{new Date(act.created_at).toLocaleString()}</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ padding: '20px', textAlign: 'center', color: '#EF4444' }}>
                Failed to load employee performance statistics.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
