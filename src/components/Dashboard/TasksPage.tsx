import React, { useEffect, useState, useMemo } from 'react';
import styles from './TasksPage.module.css';
import { Plus, Trash2, Calendar, CheckSquare, Square, Search, User, X, Briefcase, Tag, Target, Link, ExternalLink } from 'lucide-react';
import { tasksApi, teamApi, crmApi, pipelineApi, settingsApi, type Task, type TeamMember, type Lead, type RelatedLeadSummary } from '../../lib/api';

export const TasksPage = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Advanced metadata lists
  const [departments, setDepartments] = useState<string[]>([]);
  const [leadSources, setLeadSources] = useState<string[]>([]);
  const [leadStatuses, setLeadStatuses] = useState<string[]>([]);
  const [pipelineStages, setPipelineStages] = useState<any[]>([]);
  const [currentUserProfile, setCurrentUserProfile] = useState<any>(null);

  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('Normal');
  const [dueDate, setDueDate] = useState('');
  const [assignedToId, setAssignedToId] = useState('');
  const [department, setDepartment] = useState('');
  const [selectedLeads, setSelectedLeads] = useState<RelatedLeadSummary[]>([]);
  const [showAllMembers, setShowAllMembers] = useState(false);

  // Modal State
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isLeadModalOpen, setIsLeadModalOpen] = useState(false);
  const [activeDetailsTask, setActiveDetailsTask] = useState<Task | null>(null);

  // Lead Modal Query State
  const [leadsList, setLeadsList] = useState<Lead[]>([]);
  const [leadsLoading, setLeadsLoading] = useState(false);
  const [leadSearch, setLeadSearch] = useState('');
  const [leadFilterStage, setLeadFilterStage] = useState('');
  const [leadFilterScore, setLeadFilterScore] = useState('');
  const [leadFilterSource, setLeadFilterSource] = useState('');
  const [leadFilterSalesperson, setLeadFilterSalesperson] = useState('');
  const [leadFilterStatus, setLeadFilterStatus] = useState('');
  const [leadFilterRecency, setLeadFilterRecency] = useState(false);
  const [leadFilterLastActivity, setLeadFilterLastActivity] = useState('');
  const [leadFilterCompany, setLeadFilterCompany] = useState('');
  const [leadsPage, setLeadsPage] = useState(0);
  const [hasMoreLeads, setHasMoreLeads] = useState(true);

  // Filter state (for Task list filtering)
  const [search, setSearch] = useState('');
  const [memberFilter, setMemberFilter] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [dueDateFilter, setDueDateFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  
  // Advanced Task filters
  const [leadFilterText, setLeadFilterText] = useState('');
  const [leadStageFilter, setLeadStageFilter] = useState('');
  const [leadScoreFilterRange, setLeadScoreFilterRange] = useState('');
  const [leadSourceFilterVal, setLeadSourceFilterVal] = useState('');

  const fetchTasks = () => {
    setLoading(true);
    tasksApi.getTasks()
      .then(setTasks)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  const fetchTeamMembers = () => {
    teamApi.getTeamMembers()
      .then(setTeamMembers)
      .catch(e => console.error('Failed to load team members:', e));
  };

  const fetchDepartments = () => {
    teamApi.getDepartments()
      .then(setDepartments)
      .catch(e => console.error('Failed to load departments:', e));
  };

  const fetchLeadSources = () => {
    crmApi.getLeadSources()
      .then(setLeadSources)
      .catch(e => console.error('Failed to load lead sources:', e));
  };

  const fetchLeadStatuses = () => {
    crmApi.getLeadStatuses()
      .then(setLeadStatuses)
      .catch(e => console.error('Failed to load lead statuses:', e));
  };

  const fetchPipelineStages = () => {
    pipelineApi.getAllStages()
      .then(setPipelineStages)
      .catch(e => console.error('Failed to load pipeline stages:', e));
  };

  const fetchProfile = () => {
    settingsApi.getProfile()
      .then(setCurrentUserProfile)
      .catch(e => console.error('Failed to fetch user profile:', e));
  };

  useEffect(() => {
    fetchTasks();
    fetchTeamMembers();
    fetchDepartments();
    fetchLeadSources();
    fetchLeadStatuses();
    fetchPipelineStages();
    fetchProfile();
  }, []);

  // Fetch leads for modal when modal is open or query filters change
  const fetchLeadsForModal = async (page: number, clear: boolean) => {
    setLeadsLoading(true);
    try {
      let scoreMin: number | undefined;
      let scoreMax: number | undefined;
      if (leadFilterScore) {
        const parts = leadFilterScore.split('-');
        scoreMin = Number(parts[0]);
        scoreMax = Number(parts[1]);
      }

      const filters = {
        search: leadSearch || undefined,
        pipeline_stage: leadFilterStage || undefined,
        lead_score_min: scoreMin,
        lead_score_max: scoreMax,
        lead_source: leadFilterSource || undefined,
        assigned_salesperson_id: leadFilterSalesperson || undefined,
        status: leadFilterStatus || undefined,
        recently_created: leadFilterRecency || undefined,
        last_activity_days: leadFilterLastActivity ? Number(leadFilterLastActivity) : undefined,
        company_name: leadFilterCompany || undefined,
      };

      const limit = 20;
      const skip = page * limit;
      const data = await crmApi.getLeads(skip, limit, filters);

      if (clear) {
        setLeadsList(data);
      } else {
        setLeadsList(prev => [...prev, ...data]);
      }
      setLeadsPage(page);
      setHasMoreLeads(data.length === limit);
    } catch (e) {
      console.error('Failed to search leads:', e);
    } finally {
      setLeadsLoading(false);
    }
  };

  useEffect(() => {
    if (isLeadModalOpen) {
      fetchLeadsForModal(0, true);
    }
  }, [
    leadSearch,
    leadFilterStage,
    leadFilterScore,
    leadFilterSource,
    leadFilterStatus,
    leadFilterSalesperson,
    leadFilterCompany,
    leadFilterLastActivity,
    leadFilterRecency,
    isLeadModalOpen
  ]);

  // Determine if user can toggle "Show All Members"
  const currentUserMember = useMemo(() => {
    if (!currentUserProfile || !teamMembers) return null;
    return teamMembers.find(m => m.email.toLowerCase() === currentUserProfile.email.toLowerCase());
  }, [currentUserProfile, teamMembers]);

  const hasPermissionToShowAll = useMemo(() => {
    if (!currentUserMember) return false;
    return currentUserMember.role === 'Admin' || currentUserMember.role === 'Manager';
  }, [currentUserMember]);

  // Filter assignee members based on selected department
  const filteredActiveMembers = useMemo(() => {
    let list = teamMembers.filter(m => m.status === 'Active');
    if (department && !showAllMembers) {
      list = list.filter(m => m.department === department);
    }
    return list;
  }, [teamMembers, department, showAllMembers]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    try {
      await tasksApi.createTask({
        title,
        description: description || undefined,
        priority,
        due_date: dueDate ? new Date(dueDate).toISOString() : undefined,
        is_completed: false,
        assigned_to_id: assignedToId || undefined,
        department: department || undefined,
        lead_ids: selectedLeads.map(l => l.id)
      });
      setTitle('');
      setDescription('');
      setPriority('Normal');
      setDueDate('');
      setAssignedToId('');
      setDepartment('');
      setSelectedLeads([]);
      setShowAllMembers(false);
      setIsCreateModalOpen(false);
      fetchTasks();
    } catch (err: any) {
      alert(err.message || 'Failed to create task');
    }
  };

  const handleToggle = async (task: Task) => {
    try {
      const nextCompleted = !task.is_completed;
      const updated = await tasksApi.updateTask(task.id, { 
        is_completed: nextCompleted,
        status: nextCompleted ? 'Completed' : 'Pending'
      });
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, ...updated } : t));
      if (activeDetailsTask && activeDetailsTask.id === task.id) {
        setActiveDetailsTask(prev => prev ? { ...prev, ...updated } : null);
      }
    } catch (err: any) {
      alert(err.message || 'Failed to toggle task');
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this task?')) return;
    try {
      await tasksApi.deleteTask(id);
      if (activeDetailsTask && activeDetailsTask.id === id) {
        setActiveDetailsTask(null);
      }
      fetchTasks();
    } catch (err: any) {
      alert(err.message || 'Failed to delete task');
    }
  };

  // Filter tasks based on filters and search
  const filteredTasks = tasks.filter(task => {
    const assignedMember = teamMembers.find(m => m.id === task.assigned_to_id);
    
    // Search filter
    if (search) {
      const searchString = `${task.title} ${task.description || ''} ${task.department || ''} ${task.priority} ${task.status} ${
        assignedMember ? `${assignedMember.first_name} ${assignedMember.last_name} ${assignedMember.email} ${assignedMember.department}` : ''
      } ${
        task.related_leads ? task.related_leads.map(l => `${l.first_name} ${l.last_name} ${l.email || ''} ${l.company_name || ''}`).join(' ') : ''
      }`.toLowerCase();
      if (!searchString.includes(search.toLowerCase())) return false;
    }

    // Assignee member filter
    if (memberFilter && task.assigned_to_id !== memberFilter) return false;

    // Department filter
    if (deptFilter && task.department !== deptFilter && (!assignedMember || assignedMember.department !== deptFilter)) return false;

    // Priority filter
    if (priorityFilter && task.priority !== priorityFilter) return false;

    // Status filter
    if (statusFilter === 'Completed' && !task.is_completed) return false;
    if (statusFilter === 'Pending' && task.is_completed) return false;

    // Due date filter
    if (dueDateFilter) {
      if (!task.due_date) return false;
      const d = new Date(task.due_date);
      const today = new Date();
      today.setHours(0,0,0,0);
      const tomorrow = new Date(today);
      tomorrow.setDate(today.getDate() + 1);
      
      const taskTime = d.getTime();
      const todayTime = today.getTime();
      
      if (dueDateFilter === 'Overdue') {
        if (taskTime >= todayTime || task.is_completed) return false;
      } else if (dueDateFilter === 'Today') {
        if (d.toDateString() !== today.toDateString()) return false;
      } else if (dueDateFilter === 'Upcoming') {
        if (taskTime < todayTime) return false;
      }
    }

    // Related Lead filter
    if (leadFilterText) {
      if (!task.related_leads || !task.related_leads.some(l => 
        `${l.first_name} ${l.last_name} ${l.email || ''}`.toLowerCase().includes(leadFilterText.toLowerCase())
      )) return false;
    }

    // Pipeline Stage filter of related leads
    if (leadStageFilter) {
      if (!task.related_leads || !task.related_leads.some(l => l.pipeline_stage === leadStageFilter)) return false;
    }

    // Lead Score filter of related leads
    if (leadScoreFilterRange) {
      const parts = leadScoreFilterRange.split('-');
      const min = Number(parts[0]);
      const max = Number(parts[1]);
      if (!task.related_leads || !task.related_leads.some(l => l.lead_score >= min && l.lead_score <= max)) return false;
    }

    // Lead Source filter of related leads
    if (leadSourceFilterVal) {
      if (!task.related_leads || !task.related_leads.some(l => l.lead_source === leadSourceFilterVal)) return false;
    }

    return true;
  });

  const pendingTasks = filteredTasks.filter(t => !t.is_completed);
  const completedTasks = filteredTasks.filter(t => t.is_completed);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Tasks & Todo</h1>
          <p className={styles.subtitle}>Manage your follow-ups, calls, and daily tasks.</p>
        </div>
        <button className={styles.headerCreateBtn} onClick={() => setIsCreateModalOpen(true)}>
          <Plus size={16} /> Create Task
        </button>
      </div>

      {/* Main Container: Task Lists & Filters (Full Width) */}
      <div className={styles.listContainer}>
          {/* Filters Bar */}
          <div className={styles.filterBar}>
            <div className={styles.searchBox}>
              <Search size={16} />
              <input 
                type="text" 
                placeholder="Search tasks by title, department, assignee, leads..." 
                value={search} 
                onChange={e => setSearch(e.target.value)} 
              />
            </div>
            <div className={styles.filterRowFive}>
              <select value={memberFilter} onChange={e => setMemberFilter(e.target.value)}>
                <option value="">All Assignees</option>
                {teamMembers.map(m => (
                  <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>
                ))}
              </select>
              <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)}>
                <option value="">All Departments</option>
                {departments.map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
              <select value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)}>
                <option value="">All Priorities</option>
                <option value="Low">Low</option>
                <option value="Normal">Normal</option>
                <option value="High">High</option>
              </select>
              <select value={dueDateFilter} onChange={e => setDueDateFilter(e.target.value)}>
                <option value="">All Deadlines</option>
                <option value="Today">Today</option>
                <option value="Upcoming">Upcoming</option>
                <option value="Overdue">Overdue</option>
              </select>
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                <option value="">All Statuses</option>
                <option value="Pending">Pending</option>
                <option value="Completed">Completed</option>
              </select>
            </div>
            <div className={styles.filterRowFour}>
              <input 
                type="text"
                placeholder="Filter by lead name..."
                value={leadFilterText}
                onChange={e => setLeadFilterText(e.target.value)}
              />
              <select value={leadStageFilter} onChange={e => setLeadStageFilter(e.target.value)}>
                <option value="">All Lead Stages</option>
                {pipelineStages.map(s => (
                  <option key={s.id} value={s.name}>{s.name}</option>
                ))}
              </select>
              <select value={leadScoreFilterRange} onChange={e => setLeadScoreFilterRange(e.target.value)}>
                <option value="">All Lead Scores</option>
                <option value="0-20">0 - 20</option>
                <option value="21-40">21 - 40</option>
                <option value="41-60">41 - 60</option>
                <option value="61-80">61 - 80</option>
                <option value="81-100">81 - 100</option>
              </select>
              <select value={leadSourceFilterVal} onChange={e => setLeadSourceFilterVal(e.target.value)}>
                <option value="">All Lead Sources</option>
                {leadSources.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>

          {loading && <div className={styles.stateMsg}>Loading tasks…</div>}
          {error && <div className={styles.errorMsg}>Error loading tasks: {error}</div>}

          {!loading && !error && filteredTasks.length === 0 && (
            <div className={styles.emptyCard}>
              <CheckSquare size={36} className={styles.emptyIcon} />
              <h3>All clear!</h3>
              <p>No tasks matched your current search and filter settings.</p>
            </div>
          )}

          {/* Pending Tasks */}
          {!loading && !error && pendingTasks.length > 0 && (
            <div className={styles.section}>
              <h3 className={styles.sectionHeader}>To Do ({pendingTasks.length})</h3>
              <div className={styles.taskList}>
                {pendingTasks.map(task => {
                  const assignedMember = teamMembers.find(m => m.id === task.assigned_to_id);
                  return (
                    <div key={task.id} className={styles.taskItem}>
                      <button className={styles.checkBtn} onClick={() => handleToggle(task)}>
                        <Square size={20} className={styles.checkboxIcon} />
                      </button>
                      <div className={styles.taskBody} onClick={() => setActiveDetailsTask(task)}>
                        <h4 className={styles.taskTitle}>{task.title}</h4>
                        {task.description && <p className={styles.taskDesc}>{task.description}</p>}
                        <div className={styles.meta}>
                          <span className={`${styles.priority} ${
                            task.priority === 'High' ? styles.priHigh :
                            task.priority === 'Normal' ? styles.priNormal :
                            styles.priLow
                          }`}>
                            {task.priority} Priority
                          </span>
                          {task.due_date && (
                            <span className={styles.dueDate}>
                              <Calendar size={12} />
                              {new Date(task.due_date).toLocaleDateString()}
                            </span>
                          )}
                          {task.department && (
                            <span className={styles.assignedBadge}>
                              <Briefcase size={11} style={{ marginRight: 2 }} />
                              {task.department}
                            </span>
                          )}
                          {assignedMember && (
                            <span className={styles.assignedBadge} title={assignedMember.email}>
                              <User size={11} style={{ marginRight: 2 }} />
                              {assignedMember.first_name} {assignedMember.last_name}
                            </span>
                          )}
                          {task.related_leads && task.related_leads.length > 0 && (
                            <span className={styles.assignedBadge}>
                              <Target size={11} style={{ marginRight: 2 }} />
                              {task.related_leads.length} Related Lead{task.related_leads.length > 1 ? 's' : ''}
                            </span>
                          )}
                        </div>
                      </div>
                      <button className={styles.deleteBtn} onClick={() => handleDelete(task.id)}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Completed Tasks */}
          {!loading && !error && completedTasks.length > 0 && (
            <div className={styles.section}>
              <h3 className={styles.sectionHeader}>Completed ({completedTasks.length})</h3>
              <div className={styles.taskList}>
                {completedTasks.map(task => {
                  const assignedMember = teamMembers.find(m => m.id === task.assigned_to_id);
                  return (
                    <div key={task.id} className={`${styles.taskItem} ${styles.completed}`}>
                      <button className={styles.checkBtn} onClick={() => handleToggle(task)}>
                        <CheckSquare size={20} className={styles.checkboxChecked} />
                      </button>
                      <div className={styles.taskBody} onClick={() => setActiveDetailsTask(task)}>
                        <h4 className={styles.taskTitle}>{task.title}</h4>
                        {task.description && <p className={styles.taskDesc}>{task.description}</p>}
                        <div className={styles.meta}>
                          <span className={styles.completedBadge}>Done</span>
                          {task.department && (
                            <span className={styles.assignedBadge}>{task.department}</span>
                          )}
                          {assignedMember && (
                            <span className={styles.assignedBadge} title={assignedMember.email}>
                              <User size={11} style={{ marginRight: 2 }} />
                              {assignedMember.first_name} {assignedMember.last_name}
                            </span>
                          )}
                        </div>
                      </div>
                      <button className={styles.deleteBtn} onClick={() => handleDelete(task.id)}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

      {/* Create New Task Modal */}
      {isCreateModalOpen && (
        <div className={styles.modalOverlay} onClick={() => setIsCreateModalOpen(false)}>
          <div className={styles.createTaskModal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>Create New Task</h2>
              <button type="button" className={styles.closeBtn} onClick={() => setIsCreateModalOpen(false)}>
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className={styles.modalForm}>
              <div className={styles.formGroup}>
                <label>Task Title *</label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="e.g. Call John Doe at 3 PM"
                />
              </div>

              <div className={styles.formGroup}>
                <label>Description</label>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Details or notes about this task..."
                  rows={3}
                />
              </div>

              <div className={styles.row}>
                <div className={styles.formGroup} style={{ flex: 1 }}>
                  <label>Priority</label>
                  <select value={priority} onChange={e => setPriority(e.target.value)}>
                    <option value="Low">Low</option>
                    <option value="Normal">Normal</option>
                    <option value="High">High</option>
                  </select>
                </div>

                <div className={styles.formGroup} style={{ flex: 1 }}>
                  <label>Due Date</label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={e => setDueDate(e.target.value)}
                  />
                </div>
              </div>

              <div className={styles.formGroup}>
                <label>Department (Optional)</label>
                {departments.length === 0 ? (
                  <div className={styles.noDepts}>No departments available.</div>
                ) : (
                  <select value={department} onChange={e => {
                    setDepartment(e.target.value);
                    if (e.target.value && !showAllMembers) {
                      const member = teamMembers.find(m => m.id === assignedToId);
                      if (member && member.department !== e.target.value) {
                        setAssignedToId('');
                      }
                    }
                  }}>
                    <option value="">None</option>
                    {departments.map(d => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                )}
              </div>

              <div className={styles.formGroup}>
                <label>Assign To</label>
                <select value={assignedToId} onChange={e => setAssignedToId(e.target.value)}>
                  <option value="">Unassigned</option>
                  {filteredActiveMembers.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.first_name} {m.last_name} ({m.department})
                    </option>
                  ))}
                </select>
                {department && hasPermissionToShowAll && (
                  <label className={styles.toggleLabel}>
                    <input
                      type="checkbox"
                      checked={showAllMembers}
                      onChange={e => setShowAllMembers(e.target.checked)}
                    />
                    Show All Members
                  </label>
                )}
              </div>

              <div className={styles.formGroup}>
                <label>Related Leads (Optional)</label>
                <div className={styles.selectedLeadsList}>
                  {selectedLeads.map(lead => (
                    <div key={lead.id} className={styles.selectedLeadCard}>
                      <div className={styles.leadCardInfo}>
                        <strong>{lead.first_name} {lead.last_name}</strong>
                        <span>{lead.email || 'No email'}</span>
                      </div>
                      <button type="button" className={styles.removeLeadBtn} onClick={() => {
                        setSelectedLeads(prev => prev.filter(l => l.id !== lead.id));
                      }}>
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
                <button type="button" className={styles.selectLeadsBtn} onClick={() => setIsLeadModalOpen(true)}>
                  Select Related Leads ({selectedLeads.length})
                </button>
              </div>

              <div className={styles.modalFormActions}>
                <button type="button" className={styles.cancelBtn} onClick={() => setIsCreateModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className={styles.createBtn}>
                  <Plus size={16} />
                  Create Task
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Select Leads Modal */}
      {isLeadModalOpen && (
        <div className={styles.modalOverlay}>
          <div className={styles.leadsModal}>
            <div className={styles.modalHeader}>
              <h2>Select Related Leads</h2>
              <button className={styles.closeBtn} onClick={() => setIsLeadModalOpen(false)}>
                <X size={20} />
              </button>
            </div>
            
            <div className={styles.leadFiltersBox}>
              <input
                type="text"
                placeholder="Search leads by name, email, phone, company..."
                value={leadSearch}
                onChange={e => {
                  setLeadSearch(e.target.value);
                  setLeadsPage(0);
                }}
                className={styles.modalSearchInput}
              />
              <div className={styles.filtersGrid}>
                <select value={leadFilterStage} onChange={e => { setLeadFilterStage(e.target.value); setLeadsPage(0); }}>
                  <option value="">All Pipeline Stages</option>
                  {pipelineStages.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                </select>
                
                <select value={leadFilterScore} onChange={e => { setLeadFilterScore(e.target.value); setLeadsPage(0); }}>
                  <option value="">All Scores</option>
                  <option value="0-20">0 - 20</option>
                  <option value="21-40">21 - 40</option>
                  <option value="41-60">41 - 60</option>
                  <option value="61-80">61 - 80</option>
                  <option value="81-100">81 - 100</option>
                </select>
                
                <select value={leadFilterSource} onChange={e => { setLeadFilterSource(e.target.value); setLeadsPage(0); }}>
                  <option value="">All Sources</option>
                  {leadSources.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                
                <select value={leadFilterStatus} onChange={e => { setLeadFilterStatus(e.target.value); setLeadsPage(0); }}>
                  <option value="">All Statuses</option>
                  {leadStatuses.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                
                <select value={leadFilterSalesperson} onChange={e => { setLeadFilterSalesperson(e.target.value); setLeadsPage(0); }}>
                  <option value="">All Salespeople</option>
                  {teamMembers.map(m => <option key={m.id} value={m.user_id || m.id}>{m.first_name} {m.last_name}</option>)}
                </select>
                
                <input
                  type="text"
                  placeholder="Company name..."
                  value={leadFilterCompany}
                  onChange={e => { setLeadFilterCompany(e.target.value); setLeadsPage(0); }}
                />
                
                <select value={leadFilterLastActivity} onChange={e => { setLeadFilterLastActivity(e.target.value); setLeadsPage(0); }}>
                  <option value="">All Activities</option>
                  <option value="7">Last 7 days</option>
                  <option value="30">Last 30 days</option>
                  <option value="90">Last 90 days</option>
                </select>
                
                <label className={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={leadFilterRecency}
                    onChange={e => { setLeadFilterRecency(e.target.checked); setLeadsPage(0); }}
                  />
                  Recently Created
                </label>
              </div>
            </div>
            
            <div className={styles.modalLeadsList}>
              {leadsLoading && leadsList.length === 0 ? (
                <div className={styles.modalLoading}>Loading leads...</div>
              ) : leadsList.length === 0 ? (
                <div className={styles.modalEmpty}>No leads found matching current filters.</div>
              ) : (
                <>
                  {leadsList.map(lead => {
                    const isChecked = selectedLeads.some(l => l.id === lead.id);
                    return (
                      <label key={lead.id} className={styles.leadModalItem}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={e => {
                            if (e.target.checked) {
                              const summary: RelatedLeadSummary = {
                                id: lead.id,
                                first_name: lead.first_name,
                                last_name: lead.last_name,
                                email: lead.email,
                                phone: lead.phone,
                                lead_score: lead.lead_score,
                                lead_source: lead.lead_source,
                                status: lead.status,
                                pipeline_stage: lead.status, // Fallback status mapped as stage
                                company_name: lead.company_id ? 'Loaded Company' : undefined
                              };
                              setSelectedLeads(prev => [...prev, summary]);
                            } else {
                              setSelectedLeads(prev => prev.filter(l => l.id !== lead.id));
                            }
                          }}
                        />
                        <div className={styles.leadModalItemText}>
                          <strong>{lead.first_name} {lead.last_name}</strong>
                          <span>{lead.email || 'No email'} • Score: {lead.lead_score} • Source: {lead.lead_source || 'Unknown'} • Status: {lead.status}</span>
                        </div>
                      </label>
                    );
                  })}
                  {hasMoreLeads && (
                    <button type="button" className={styles.loadMoreBtn} onClick={() => fetchLeadsForModal(leadsPage + 1, false)} disabled={leadsLoading}>
                      {leadsLoading ? 'Loading more...' : 'Load More'}
                    </button>
                  )}
                </>
              )}
            </div>
            
            <div className={styles.modalActions}>
              <button type="button" className={styles.applyBtn} onClick={() => setIsLeadModalOpen(false)}>Done</button>
            </div>
          </div>
        </div>
      )}

      {/* Task Details Inspection Modal */}
      {activeDetailsTask && (
        <div className={styles.modalOverlay}>
          <div className={styles.taskDetailsModal}>
            <div className={styles.modalHeader}>
              <div>
                <h2>{activeDetailsTask.title}</h2>
                <span className={styles.subtitle}>Task Details</span>
              </div>
              <button className={styles.closeBtn} onClick={() => setActiveDetailsTask(null)}>
                <X size={20} />
              </button>
            </div>
            
            <div className={styles.modalBody}>
              {activeDetailsTask.description && (
                <div className={styles.detailsDesc}>{activeDetailsTask.description}</div>
              )}
              
              <div className={styles.detailsGrid}>
                <div className={styles.detailsItem}>
                  <span>Status</span>
                  <span>
                    <button className={styles.applyBtn} style={{ padding: '4px 12px', fontSize: 12, backgroundColor: activeDetailsTask.is_completed ? 'var(--success-color)' : 'var(--warning-color)' }} onClick={() => handleToggle(activeDetailsTask)}>
                      {activeDetailsTask.is_completed ? 'Completed (Reopen)' : 'Pending (Complete)'}
                    </button>
                  </span>
                </div>
                
                <div className={styles.detailsItem}>
                  <span>Department</span>
                  <span>{activeDetailsTask.department || 'None'}</span>
                </div>

                <div className={styles.detailsItem}>
                  <span>Assigned Member</span>
                  <span>
                    {(() => {
                      const m = teamMembers.find(member => member.id === activeDetailsTask.assigned_to_id);
                      return m ? `${m.first_name} ${m.last_name} (${m.department})` : 'Unassigned';
                    })()}
                  </span>
                </div>

                <div className={styles.detailsItem}>
                  <span>Priority</span>
                  <span>{activeDetailsTask.priority}</span>
                </div>

                <div className={styles.detailsItem}>
                  <span>Due Date</span>
                  <span>{activeDetailsTask.due_date ? new Date(activeDetailsTask.due_date).toLocaleDateString() : 'No due date'}</span>
                </div>
              </div>
              
              <div className={styles.leadsSection}>
                <h3>Related Leads ({activeDetailsTask.related_leads?.length || 0})</h3>
                {(!activeDetailsTask.related_leads || activeDetailsTask.related_leads.length === 0) ? (
                  <div className={styles.noAttachments}>No leads related to this task.</div>
                ) : (
                  <div className={styles.leadsGrid}>
                    {activeDetailsTask.related_leads.map(lead => (
                      <div key={lead.id} className={styles.leadDetailCard}>
                        <div className={styles.leadHeader}>
                          <h4>{lead.first_name} {lead.last_name}</h4>
                          <span className={styles.scoreBadge}>Score: {lead.lead_score}</span>
                        </div>
                        <div className={styles.leadInfoGrid}>
                          <div className={styles.leadInfoItem}>
                            <span>Email</span>
                            <span>{lead.email || 'N/A'}</span>
                          </div>
                          <div className={styles.leadInfoItem}>
                            <span>Phone</span>
                            <span>{lead.phone || 'N/A'}</span>
                          </div>
                          <div className={styles.leadInfoItem}>
                            <span>Company</span>
                            <span>{lead.company_name || 'N/A'}</span>
                          </div>
                          <div className={styles.leadInfoItem}>
                            <span>Stage</span>
                            <span>{lead.pipeline_stage || 'New'}</span>
                          </div>
                          <div className={styles.leadInfoItem}>
                            <span>Status</span>
                            <span>{lead.status}</span>
                          </div>
                          <div className={styles.leadInfoItem}>
                            <span>Salesperson</span>
                            <span>{lead.assigned_salesperson || 'Unassigned'}</span>
                          </div>
                          {lead.last_activity_date && (
                            <div className={styles.leadInfoItem} style={{ gridColumn: 'span 2' }}>
                              <span>Last Activity</span>
                              <span>{new Date(lead.last_activity_date).toLocaleString()}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className={styles.attachmentsSection}>
                <h4>Attachments</h4>
                <div className={styles.noAttachments}>No attachments uploaded.</div>
              </div>
            </div>
            
            <div className={styles.modalActions} style={{ gap: 12 }}>
              <button type="button" className={styles.removeLeadBtn} style={{ padding: '8px 16px', fontSize: 13 }} onClick={() => handleDelete(activeDetailsTask.id)}>
                Delete Task
              </button>
              <button type="button" className={styles.applyBtn} onClick={() => setActiveDetailsTask(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
