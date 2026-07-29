import React, { useEffect, useState, useMemo } from 'react';
import styles from './LeadsPage.module.css';
import { Plus, Edit2, Trash2, X, Search, Filter, Upload, CheckCircle, AlertTriangle, Download, RefreshCw, Calendar, Award } from 'lucide-react';
import { crmApi, settingsApi, type Lead } from '../../lib/api';

export const LeadsPage = () => {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [duplicateLeadData, setDuplicateLeadData] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);

  useEffect(() => {
    settingsApi.getProfile()
      .then(p => setProfile(p))
      .catch(e => console.error("Failed to load profile:", e));
  }, []);

  // Form states
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [status, setStatus] = useState('New');
  const [priority, setPriority] = useState('Normal');
  const [source, setSource] = useState('Website');
  const [score, setScore] = useState(50);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [priorityFilter, setPriorityFilter] = useState('All');
  const [scoreFilterMin, setScoreFilterMin] = useState('');
  const [scoreFilterMax, setScoreFilterMax] = useState('');
  
  // Sort State
  const [sortBy, setSortBy] = useState<'ScoreDesc' | 'ScoreAsc' | 'Recent' | 'Active'>('Recent');

  // Import Wizard State
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importStep, setImportStep] = useState(1);
  const [fileName, setFileName] = useState('');
  const [fileBase64, setFileBase64] = useState('');
  const [fileHeaders, setFileHeaders] = useState<string[]>([]);
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [duplicateHandling, setDuplicateHandling] = useState<'Skip' | 'Update' | 'Merge' | 'Create'>('Skip');
  const [runAutomations, setRunAutomations] = useState(false);
  const [validationResult, setValidationResult] = useState<{ total_records: number; valid_records: number; invalid_records: number; warnings: string[] } | null>(null);
  const [importJob, setImportJob] = useState<any>(null);
  const [isValidating, setIsValidating] = useState(false);

  // Export State
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<'csv' | 'xlsx'>('csv');
  const [isExporting, setIsExporting] = useState(false);

  // Details & Scoring Override State
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [overrideScoreVal, setOverrideScoreVal] = useState<number>(50);

  const fetchLeads = () => {
    setLoading(true);
    crmApi.getLeads()
      .then(setLeads)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchLeads();
  }, []);

  const openAddModal = () => {
    setEditingLead(null);
    setFirstName('');
    setLastName('');
    setEmail('');
    setPhone('');
    setStatus('New');
    setPriority('Normal');
    setSource('Website');
    setScore(50);
    setIsModalOpen(true);
  };

  const openEditModal = (lead: Lead) => {
    setEditingLead(lead);
    setFirstName(lead.first_name);
    setLastName(lead.last_name);
    setEmail(lead.email ?? '');
    setPhone(lead.phone ?? '');
    setStatus(lead.status);
    setPriority(lead.priority);
    setSource(lead.lead_source ?? 'Website');
    setScore(lead.lead_score);
    setIsModalOpen(true);
  };

  const openDetailsModal = (lead: Lead) => {
    setSelectedLead(lead);
    setOverrideScoreVal(lead.lead_score);
    setIsDetailsOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    
    const payload = {
      first_name: firstName,
      last_name: lastName,
      email: email || undefined,
      phone: phone || undefined,
      status,
      priority,
      lead_source: source,
      lead_score: Number(score)
    };

    try {
      if (editingLead) {
        await crmApi.updateLead(editingLead.id, payload);
      } else {
        await crmApi.createLead(payload);
      }
      setIsModalOpen(false);
      fetchLeads();
    } catch (err: any) {
      if (err.status === 409 && err.detail?.existing_lead) {
        setDuplicateLeadData({
          existing: err.detail.existing_lead,
          payload: payload
        });
      } else {
        alert(err.message || 'Failed to save lead');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this lead?')) return;
    try {
      await crmApi.deleteLead(id);
      fetchLeads();
    } catch (err: any) {
      alert(err.message || 'Failed to delete lead');
    }
  };

  // --- Import File Handler ---
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (evt) => {
      const content = evt.target?.result as string;
      const base64 = content.split(',')[1];
      setFileBase64(base64);

      // Guess basic column headers from CSV / chunk
      const text = atob(base64).slice(0, 8000);
      const lines = text.split('\n');
      if (lines.length > 0) {
        const cols = lines[0].split(',').map(c => c.trim().replace(/^["']|["']$/g, ''));
        setFileHeaders(cols);

        // Auto-match headers
        const suggested: Record<string, string> = {};
        const crmFields = ["First Name", "Last Name", "Email", "Phone", "Company", "Lead Status", "Priority", "Score"];
        crmFields.forEach(f => {
          const match = cols.find(c => c.toLowerCase() === f.toLowerCase() || c.toLowerCase().replace(/\s/g, '') === f.toLowerCase().replace(/\s/g, ''));
          if (match) suggested[f] = match;
        });
        setMappings(suggested);
      }
      setImportStep(2);
    };
    reader.readAsDataURL(file);
  };

  const handleValidateMapping = async () => {
    setIsValidating(true);
    try {
      const res = await crmApi.validateImport({
        filename: fileName,
        file_content_base64: fileBase64,
        field_mapping: mappings,
      });
      setValidationResult(res);
      setImportStep(4);
    } catch (err: any) {
      alert(err.message || 'Validation request failed.');
    } finally {
      setIsValidating(false);
    }
  };

  const handleStartImport = async () => {
    try {
      const job = await crmApi.startImport({
        filename: fileName,
        file_content_base64: fileBase64,
        field_mapping: mappings,
        duplicate_handling: duplicateHandling,
        run_automations: runAutomations,
      });
      setImportJob(job);
      setImportStep(5);

      // Poll progress
      const poller = setInterval(async () => {
        try {
          const jobs = await crmApi.getImportJobs();
          const current = jobs.find((j: any) => j.id === job.id);
          if (current) {
            setImportJob(current);
            if (current.status === 'Completed' || current.status === 'Failed') {
              clearInterval(poller);
              fetchLeads();
            }
          }
        } catch {
          clearInterval(poller);
        }
      }, 2000);
    } catch (err: any) {
      alert(err.message || 'Failed to start import.');
    }
  };

  // --- Export Handler ---
  const handleStartExport = async () => {
    setIsExporting(true);
    try {
      const job = await crmApi.startExport({
        filters: {
          status: statusFilter === 'All' ? undefined : statusFilter,
          priority: priorityFilter === 'All' ? undefined : priorityFilter,
          score_min: scoreFilterMin || undefined,
          score_max: scoreFilterMax || undefined,
        },
        format: exportFormat,
      });

      // Poll progress
      const poller = setInterval(async () => {
        try {
          const jobs = await crmApi.getExportJobs();
          const current = jobs.find((j: any) => j.id === job.id);
          if (current) {
            if (current.status === 'Completed') {
              clearInterval(poller);
              setIsExporting(false);
              setIsExportOpen(false);
              // Open file in browser for download
              const downloadUrl = 'http://localhost:8000/api/v1' + current.file_path;
              window.open(downloadUrl, '_blank');
            } else if (current.status === 'Failed') {
              clearInterval(poller);
              setIsExporting(false);
              alert('Export compilation failed.');
            }
          }
        } catch {
          clearInterval(poller);
          setIsExporting(false);
        }
      }, 2000);
    } catch (err: any) {
      alert(err.message || 'Failed to initialize export.');
      setIsExporting(false);
    }
  };

  // --- Score Overrides ---
  const handleOverrideScore = async () => {
    if (!selectedLead) return;
    try {
      const updated = await crmApi.overrideScore(selectedLead.id, overrideScoreVal);
      setSelectedLead(updated);
      fetchLeads();
      alert('Score successfully overridden.');
    } catch (err: any) {
      alert(err.message || 'Override failed.');
    }
  };

  const handleResetScore = async () => {
    if (!selectedLead) return;
    try {
      const updated = await crmApi.resetScore(selectedLead.id);
      setSelectedLead(updated);
      setOverrideScoreVal(updated.lead_score);
      fetchLeads();
      alert('Score successfully reset to automatic tracking.');
    } catch (err: any) {
      alert(err.message || 'Reset failed.');
    }
  };

  // Filter & Sort leads
  const filteredLeads = useMemo(() => {
    let result = leads.filter(lead => {
      const fullName = `${lead.first_name} ${lead.last_name}`.toLowerCase();
      const matchesSearch = fullName.includes(searchQuery.toLowerCase()) || 
                            (lead.email && lead.email.toLowerCase().includes(searchQuery.toLowerCase()));
      const matchesStatus = statusFilter === 'All' || lead.status === statusFilter;
      const matchesPriority = priorityFilter === 'All' || lead.priority === priorityFilter;
      const matchesMin = !scoreFilterMin || lead.lead_score >= Number(scoreFilterMin);
      const matchesMax = !scoreFilterMax || lead.lead_score <= Number(scoreFilterMax);
      return matchesSearch && matchesStatus && matchesPriority && matchesMin && matchesMax;
    });

    if (sortBy === 'ScoreDesc') {
      result.sort((a, b) => b.lead_score - a.lead_score);
    } else if (sortBy === 'ScoreAsc') {
      result.sort((a, b) => a.lead_score - b.lead_score);
    } else if (sortBy === 'Recent') {
      result.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    } else if (sortBy === 'Active') {
      result.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    }
    return result;
  }, [leads, searchQuery, statusFilter, priorityFilter, scoreFilterMin, scoreFilterMax, sortBy]);

  // Decode score history from JSON string
  const scoreHistoryTimeline = useMemo(() => {
    if (!selectedLead?.score_history) return [];
    try {
      const parsed = JSON.parse(selectedLead.score_history);
      return Array.isArray(parsed) ? parsed.reverse() : [];
    } catch {
      return [];
    }
  }, [selectedLead]);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Leads Management</h1>
          <p className={styles.subtitle}>Track, import, export, and score your prospective organization leads.</p>
        </div>
        <div className={styles.btnRow}>
          <button className={styles.secondaryBtn} onClick={() => setIsImportOpen(true)}>
            <Upload size={16} /> Import
          </button>
          <button className={styles.secondaryBtn} onClick={() => setIsExportOpen(true)}>
            <Download size={16} /> Export
          </button>
          <button className={styles.addBtn} onClick={openAddModal}>
            <Plus size={18} /> Add Lead
          </button>
        </div>
      </div>

      {/* Control bar */}
      <div className={styles.controls}>
        <div className={styles.searchBox}>
          <Search size={18} className={styles.searchIcon} />
          <input
            type="text"
            placeholder="Search by name or email..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className={styles.searchInput}
          />
        </div>
        <div className={styles.filterGroup}>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className={styles.selectFilter}
          >
            <option value="All">All Statuses</option>
            <option value="New">New</option>
            <option value="Contacted">Contacted</option>
            <option value="Interested">Interested</option>
            <option value="Qualified">Qualified</option>
            <option value="Lost">Lost</option>
          </select>

          <select
            value={priorityFilter}
            onChange={e => setPriorityFilter(e.target.value)}
            className={styles.selectFilter}
          >
            <option value="All">All Priorities</option>
            <option value="High">High</option>
            <option value="Normal">Normal</option>
            <option value="Low">Low</option>
          </select>

          <input
            type="number"
            placeholder="Min Score"
            value={scoreFilterMin}
            onChange={e => setScoreFilterMin(e.target.value)}
            className={styles.scoreInput}
          />

          <input
            type="number"
            placeholder="Max Score"
            value={scoreFilterMax}
            onChange={e => setScoreFilterMax(e.target.value)}
            className={styles.scoreInput}
          />

          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value as any)}
            className={styles.selectFilter}
          >
            <option value="ScoreDesc">Highest Score</option>
            <option value="ScoreAsc">Lowest Score</option>
            <option value="Recent">Recently Created</option>
            <option value="Active">Most Active</option>
          </select>
        </div>
      </div>

      {/* Table view */}
      <div className={styles.tableCard}>
        {loading && <div className={styles.stateMsg}>Loading leads list…</div>}
        {error && <div className={styles.errorMsg}>Error: {error}</div>}
        {!loading && !error && filteredLeads.length === 0 && (
          <div className={styles.stateMsg}>No leads found matching criteria.</div>
        )}
        {!loading && !error && filteredLeads.length > 0 && (
          <div className={styles.responsiveTable}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Source</th>
                  <th>Score</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredLeads.map(lead => (
                  <tr key={lead.id} className={styles.tr}>
                    <td className={styles.tdName}>
                      <div className={styles.avatar}>
                        {lead.first_name[0]}{lead.last_name[0]}
                      </div>
                      <span className={styles.boldName}>{lead.first_name} {lead.last_name}</span>
                    </td>
                    <td className={styles.tdEmail}>{lead.email || '—'}</td>
                    <td className={styles.tdPhone}>{lead.phone || '—'}</td>
                    <td>{lead.lead_source || '—'}</td>
                    <td>
                      <span 
                        style={{ cursor: 'pointer' }}
                        className={`${styles.scoreTag} ${
                          lead.lead_score >= 80 ? styles.scoreHigh :
                          lead.lead_score >= 50 ? styles.scoreMedium :
                          styles.scoreLow
                        }`}
                        onClick={() => openDetailsModal(lead)}
                        title="Click to view scoring history & edit overrides"
                      >
                        {lead.lead_score} {lead.is_score_manual && '• Manual'}
                      </span>
                    </td>
                    <td>
                      <span className={`${styles.priorityTag} ${
                        lead.priority === 'High' ? styles.priHigh :
                        lead.priority === 'Normal' ? styles.priNormal :
                        styles.priLow
                      }`}>
                        {lead.priority}
                      </span>
                    </td>
                    <td>
                      <span className={`${styles.statusBadge} ${
                        lead.status === 'New' ? styles.badgeNew :
                        lead.status === 'Contacted' ? styles.badgeContacted :
                        lead.status === 'Interested' ? styles.badgeInterested :
                        lead.status === 'Qualified' ? styles.badgeQualified :
                        styles.badgeLost
                      }`}>
                        {lead.status}
                      </span>
                    </td>
                    <td className={styles.tdActions}>
                      <button className={styles.actionBtn} onClick={() => openDetailsModal(lead)} title="Scoring Details">
                        <Award size={16} />
                      </button>
                      <button className={styles.actionBtn} onClick={() => openEditModal(lead)} title="Edit">
                        <Edit2 size={16} />
                      </button>
                      <button className={`${styles.actionBtn} ${styles.deleteBtn}`} onClick={() => handleDelete(lead.id)} title="Delete">
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Import Wizard Modal */}
      {isImportOpen && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal} style={{ maxWidth: 640 }}>
            <div className={styles.modalHeader}>
              <h2>Import Leads Wizard</h2>
              <button className={styles.closeBtn} onClick={() => { setIsImportOpen(false); setImportStep(1); }}>
                <X size={20} />
              </button>
            </div>
            <div className={styles.form}>
              <div className={styles.wizardStepIndicator}>
                <div className={`${styles.stepDot} ${importStep >= 1 ? styles.stepDotActive : ''}`}>
                  <span className={styles.stepNum}>1</span> Upload
                </div>
                <div className={`${styles.stepDot} ${importStep >= 2 ? styles.stepDotActive : ''}`}>
                  <span className={styles.stepNum}>2</span> Mappings
                </div>
                <div className={`${styles.stepDot} ${importStep >= 3 ? styles.stepDotActive : ''}`}>
                  <span className={styles.stepNum}>3</span> Options
                </div>
                <div className={`${styles.stepDot} ${importStep >= 4 ? styles.stepDotActive : ''}`}>
                  <span className={styles.stepNum}>4</span> Validate
                </div>
                <div className={`${styles.stepDot} ${importStep >= 5 ? styles.stepDotActive : ''}`}>
                  <span className={styles.stepNum}>5</span> Progress
                </div>
              </div>

              {importStep === 1 && (
                <div className={styles.formGroup}>
                  <label>Select CSV or XLSX Excel File</label>
                  <div className={styles.uploadZone} onClick={() => document.getElementById('importFile')?.click()}>
                    <Upload size={32} style={{ margin: '0 auto 12px', color: 'var(--text-secondary)' }} />
                    <p>Drag file here or click to browse</p>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Supports .csv, .xlsx</span>
                  </div>
                  <input
                    id="importFile"
                    type="file"
                    accept=".csv,.xlsx"
                    style={{ display: 'none' }}
                    onChange={handleFileChange}
                  />
                </div>
              )}

              {importStep === 2 && (
                <div className={styles.formGroup}>
                  <label>Map CSV Header Columns to CRM Fields</label>
                  <table className={styles.mapTable}>
                    <thead>
                      <tr>
                        <th>CRM Lead Field</th>
                        <th>Imported File Header</th>
                      </tr>
                    </thead>
                    <tbody>
                      {["First Name", "Last Name", "Email", "Phone", "Company", "Lead Status", "Priority"].map(field => (
                        <tr key={field}>
                          <td><strong>{field}</strong></td>
                          <td>
                            <select
                              value={mappings[field] || ''}
                              onChange={e => setMappings(prev => ({ ...prev, [field]: e.target.value }))}
                              className={styles.mapSelect}
                            >
                              <option value="">-- Do Not Import --</option>
                              {fileHeaders.map(h => (
                                <option key={h} value={h}>{h}</option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className={styles.formActions}>
                    <button className={styles.submitBtn} onClick={() => setImportStep(3)}>Next</button>
                  </div>
                </div>
              )}

              {importStep === 3 && (
                <div className={styles.form}>
                  <div className={styles.formGroup}>
                    <label>Duplicate Handling Strategy</label>
                    <select
                      value={duplicateHandling}
                      onChange={e => setDuplicateHandling(e.target.value as any)}
                    >
                      <option value="Skip">Skip duplicates (Ignore email matches)</option>
                      <option value="Update">Overwrite / Update existing Leads</option>
                      <option value="Merge">Merge (Only populate empty fields)</option>
                      <option value="Create">Create duplicate records (Admins only)</option>
                    </select>
                  </div>

                  <div className={styles.formGroup} style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      id="runAutomationsCheck"
                      checked={runAutomations}
                      onChange={e => setRunAutomations(e.target.checked)}
                      style={{ cursor: 'pointer' }}
                    />
                    <label htmlFor="runAutomationsCheck" style={{ cursor: 'pointer' }}>
                      Run Automation rules after import (Email campaigns, webhooks)
                    </label>
                  </div>

                  <div className={styles.formActions}>
                    <button className={styles.cancelBtn} onClick={() => setImportStep(2)}>Back</button>
                    <button className={styles.submitBtn} onClick={handleValidateMapping} disabled={isValidating}>
                      {isValidating ? 'Validating...' : 'Validate Import File'}
                    </button>
                  </div>
                </div>
              )}

              {importStep === 4 && validationResult && (
                <div className={styles.form}>
                  <h3>Pre-Import Validation Result</h3>
                  <div className={styles.scoreRow}>
                    <div className={styles.scoreItem}>
                      <div className={styles.scoreVal}>{validationResult.total_records}</div>
                      <div className={styles.scoreLabel}>Total Records</div>
                    </div>
                    <div className={styles.scoreItem}>
                      <div className={styles.scoreVal} style={{ color: 'var(--success-color)' }}>
                        {validationResult.valid_records}
                      </div>
                      <div className={styles.scoreLabel}>Valid Records</div>
                    </div>
                    <div className={styles.scoreItem}>
                      <div className={styles.scoreVal} style={{ color: 'var(--danger-color)' }}>
                        {validationResult.invalid_records}
                      </div>
                      <div className={styles.scoreLabel}>With Warnings</div>
                    </div>
                  </div>

                  {validationResult.warnings.length > 0 && (
                    <div className={styles.formGroup}>
                      <label>Warnings List</label>
                      <div className={styles.warningBox}>
                        {validationResult.warnings.map((w, idx) => (
                          <div key={idx} style={{ marginBottom: 4 }}><AlertTriangle size={12} style={{ display: 'inline', marginRight: 4 }} /> {w}</div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className={styles.formActions}>
                    <button className={styles.cancelBtn} onClick={() => setImportStep(3)}>Back</button>
                    <button className={styles.submitBtn} onClick={handleStartImport}>
                      Start background import job
                    </button>
                  </div>
                </div>
              )}

              {importStep === 5 && importJob && (
                <div className={styles.form} style={{ textAlign: 'center', padding: '30px 10px' }}>
                  <RefreshCw size={40} className={styles.refreshIcon} style={{ margin: '0 auto 16px', animation: 'spin 2s linear infinite', color: 'var(--primary-color)' }} />
                  <h3>Job Status: {importJob.status}</h3>
                  <p style={{ color: 'var(--text-secondary)', marginTop: 8 }}>
                    Processing in the background. Close this modal anytime safely.
                  </p>

                  <div className={styles.scoreRow} style={{ marginTop: 20 }}>
                    <div className={styles.scoreItem}>
                      <div className={styles.scoreVal}>{importJob.imported_count}</div>
                      <div className={styles.scoreLabel}>Imported</div>
                    </div>
                    <div className={styles.scoreItem}>
                      <div className={styles.scoreVal}>{importJob.updated_count}</div>
                      <div className={styles.scoreLabel}>Updated</div>
                    </div>
                    <div className={styles.scoreItem}>
                      <div className={styles.scoreVal}>{importJob.skipped_count}</div>
                      <div className={styles.scoreLabel}>Skipped</div>
                    </div>
                  </div>

                  {(importJob.status === 'Completed' || importJob.status === 'Failed') && (
                    <div className={styles.formActions} style={{ justifyContent: 'center', marginTop: 24 }}>
                      <button className={styles.submitBtn} onClick={() => { setIsImportOpen(false); setImportStep(1); }}>
                        Finish
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Export Dialog Modal */}
      {isExportOpen && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <h2>Export Leads Database</h2>
              <button className={styles.closeBtn} onClick={() => setIsExportOpen(false)}>
                <X size={20} />
              </button>
            </div>
            <div className={styles.form}>
              <div className={styles.formGroup}>
                <label>Export Format</label>
                <select
                  value={exportFormat}
                  onChange={e => setExportFormat(e.target.value as any)}
                >
                  <option value="csv">CSV (Comma-separated values)</option>
                  <option value="xlsx">Excel File (.xlsx)</option>
                </select>
              </div>

              <div className={styles.formGroup} style={{ backgroundColor: '#F8FAFC', padding: 12, borderRadius: 8 }}>
                <label>Active Filters to apply</label>
                <ul style={{ fontSize: 13, color: 'var(--text-secondary)', marginLeft: 16, marginTop: 4 }}>
                  <li>Lead Status: {statusFilter}</li>
                  <li>Lead Priority: {priorityFilter}</li>
                  {scoreFilterMin && <li>Minimum Score: {scoreFilterMin}</li>}
                  {scoreFilterMax && <li>Maximum Score: {scoreFilterMax}</li>}
                </ul>
              </div>

              <div className={styles.formActions}>
                <button className={styles.cancelBtn} onClick={() => setIsExportOpen(false)}>
                  Cancel
                </button>
                <button className={styles.submitBtn} onClick={handleStartExport} disabled={isExporting}>
                  {isExporting ? 'Generating file...' : 'Compile and Download'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Details & Scoring Timeline Modal */}
      {isDetailsOpen && selectedLead && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal} style={{ maxWidth: 600 }}>
            <div className={styles.modalHeader}>
              <h2>Lead Profile & Scoring Engine</h2>
              <button className={styles.closeBtn} onClick={() => setIsDetailsOpen(false)}>
                <X size={20} />
              </button>
            </div>
            <div className={styles.leadDetailContainer}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div className={styles.avatar} style={{ width: 48, height: 48, fontSize: 16 }}>
                  {selectedLead.first_name[0]}{selectedLead.last_name[0]}
                </div>
                <div>
                  <h3 style={{ fontSize: 18, fontWeight: 700 }}>{selectedLead.first_name} {selectedLead.last_name}</h3>
                  <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{selectedLead.email || 'No email'}</p>
                </div>
              </div>

              <div className={styles.scoreRow}>
                <div className={styles.scoreItem}>
                  <div className={styles.scoreVal}>{selectedLead.lead_score}</div>
                  <div className={styles.scoreLabel}>Final score</div>
                </div>
                <div className={styles.scoreItem}>
                  <div className={styles.scoreVal}>{selectedLead.automatic_score || 0}</div>
                  <div className={styles.scoreLabel}>Automatic component</div>
                </div>
                <div className={styles.scoreItem}>
                  <div className={styles.scoreVal}>{selectedLead.manual_score !== null ? selectedLead.manual_score : '—'}</div>
                  <div className={styles.scoreLabel}>Manual override</div>
                </div>
              </div>

              <div className={styles.formGroup}>
                <label>Score Source</label>
                <p style={{ fontSize: 14 }}>
                  Currently running via: <strong>{selectedLead.score_source || 'Automatic'} scoring</strong>
                  {selectedLead.is_score_manual && (
                    <span 
                      className={styles.scoreResetLink}
                      onClick={handleResetScore}
                    >
                      Re-enable automatic tracking
                    </span>
                  )}
                </p>
              </div>

              <div className={styles.formGroup}>
                <label>Manual Override Settings</label>
                <div className={styles.overrideBox}>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={overrideScoreVal}
                    onChange={e => setOverrideScoreVal(Number(e.target.value))}
                    className={styles.overrideInput}
                  />
                  <button className={styles.submitBtn} onClick={handleOverrideScore}>
                    Apply manual score
                  </button>
                </div>
              </div>

              <div className={styles.formGroup}>
                <label>Score Change Timeline History</label>
                {scoreHistoryTimeline.length === 0 ? (
                  <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>No scoring actions logged yet.</p>
                ) : (
                  <div className={styles.historyTimeline}>
                    {scoreHistoryTimeline.map((item: any, idx: number) => (
                      <div key={idx} className={styles.timelineItem}>
                        <div className={styles.timelineContent}>
                          <strong>{item.event}</strong>: {item.detail} (Delta: <span style={{ color: item.delta >= 0 ? 'var(--success-color)' : 'var(--danger-color)' }}>{item.delta >= 0 ? '+' : ''}{item.delta}</span>)
                          <div className={styles.timelineMeta}>
                            Score: {item.final_score} ({item.source}) • {new Date(item.timestamp).toLocaleString()}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit/Create Modal Dialog */}
      {isModalOpen && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <h2>{editingLead ? 'Edit Lead' : 'Add New Lead'}</h2>
              <button className={styles.closeBtn} onClick={() => setIsModalOpen(false)}>
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleSubmit} className={styles.form}>
              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label>First Name</label>
                  <input
                    type="text"
                    required
                    value={firstName}
                    onChange={e => setFirstName(e.target.value)}
                    placeholder="e.g. John"
                  />
                </div>
                <div className={styles.formGroup}>
                  <label>Last Name</label>
                  <input
                    type="text"
                    required
                    value={lastName}
                    onChange={e => setLastName(e.target.value)}
                    placeholder="e.g. Doe"
                  />
                </div>
              </div>

              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label>Email Address</label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="john@company.com"
                  />
                </div>
                <div className={styles.formGroup}>
                  <label>Phone Number</label>
                  <input
                    type="text"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    placeholder="+1 (555) 019-2834"
                  />
                </div>
              </div>

              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label>Status</label>
                  <select value={status} onChange={e => setStatus(e.target.value)}>
                    <option value="New">New</option>
                    <option value="Contacted">Contacted</option>
                    <option value="Interested">Interested</option>
                    <option value="Qualified">Qualified</option>
                    <option value="Lost">Lost</option>
                  </select>
                </div>
                <div className={styles.formGroup}>
                  <label>Priority</label>
                  <select value={priority} onChange={e => setPriority(e.target.value)}>
                    <option value="Low">Low</option>
                    <option value="Normal">Normal</option>
                    <option value="High">High</option>
                  </select>
                </div>
              </div>

              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label>Lead Source</label>
                  <select value={source} onChange={e => setSource(e.target.value)}>
                    <option value="Website">Website</option>
                    <option value="Referral">Referral</option>
                    <option value="Cold Call">Cold Call</option>
                    <option value="LinkedIn">LinkedIn</option>
                    <option value="Google Search">Google Search</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div className={styles.formGroup}>
                  <label>Manual Lead Score ({score})</label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={score}
                    onChange={e => setScore(Number(e.target.value))}
                  />
                </div>
              </div>

              <div className={styles.formActions}>
                <button type="button" className={styles.cancelBtn} onClick={() => setIsModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className={styles.submitBtn} disabled={isSubmitting}>
                  {editingLead ? 'Update Lead' : 'Create Lead'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {duplicateLeadData && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal} style={{ maxWidth: 550 }}>
            <div className={styles.modalHeader}>
              <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#d97706' }}>
                <AlertTriangle size={24} /> Duplicate Lead Detected
              </h2>
              <button className={styles.closeBtn} onClick={() => setDuplicateLeadData(null)}>
                <X size={20} />
              </button>
            </div>
            <div className={styles.form} style={{ padding: '20px' }}>
              <p style={{ marginBottom: 16, color: 'var(--text-secondary)' }}>
                A Lead with the email <strong>{duplicateLeadData.existing.email}</strong> already exists in your Organization.
              </p>
              
              <div style={{
                background: '#f8fafc',
                border: '1px solid var(--border-color)',
                borderRadius: 8,
                padding: 16,
                marginBottom: 20,
                fontSize: 14
              }}>
                <div style={{ fontWeight: 600, borderBottom: '1px solid var(--border-color)', paddingBottom: 8, marginBottom: 8 }}>
                  Existing Lead Details
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div><strong>Name:</strong> {duplicateLeadData.existing.first_name} {duplicateLeadData.existing.last_name}</div>
                  <div><strong>Pipeline Stage:</strong> {duplicateLeadData.existing.pipeline_stage || '—'}</div>
                  <div><strong>Owner:</strong> {duplicateLeadData.existing.owner ? `${duplicateLeadData.existing.owner.first_name} ${duplicateLeadData.existing.owner.last_name}` : 'Unassigned'}</div>
                  <div><strong>Created:</strong> {new Date(duplicateLeadData.existing.created_at).toLocaleDateString()}</div>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <button
                  type="button"
                  style={{
                    background: 'var(--primary-color)',
                    color: 'white',
                    border: 'none',
                    padding: '10px 16px',
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontWeight: 600
                  }}
                  onClick={() => {
                    setDuplicateLeadData(null);
                    setIsModalOpen(false);
                    const existingLeadObj = leads.find(l => l.id === duplicateLeadData.existing.id);
                    if (existingLeadObj) {
                      openDetailsModal(existingLeadObj);
                    } else {
                      crmApi.getLeads().then(list => {
                        const l = list.find(x => x.id === duplicateLeadData.existing.id);
                        if (l) openDetailsModal(l);
                      });
                    }
                  }}
                >
                  View Existing Lead
                </button>

                <button
                  type="button"
                  style={{
                    background: '#059669',
                    color: 'white',
                    border: 'none',
                    padding: '10px 16px',
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontWeight: 600
                  }}
                  onClick={async () => {
                    if (window.confirm("Overwrite existing lead's fields with the new data?")) {
                      try {
                        setIsSubmitting(true);
                        await crmApi.updateLead(duplicateLeadData.existing.id, duplicateLeadData.payload);
                        setDuplicateLeadData(null);
                        setIsModalOpen(false);
                        fetchLeads();
                        alert("Lead updated successfully!");
                      } catch (err: any) {
                        alert(err.message || "Failed to update lead");
                      } finally {
                        setIsSubmitting(false);
                      }
                    }
                  }}
                >
                  Update Existing Lead (Overwrite)
                </button>

                <button
                  type="button"
                  style={{
                    background: '#2563eb',
                    color: 'white',
                    border: 'none',
                    padding: '10px 16px',
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontWeight: 600
                  }}
                  onClick={async () => {
                    if (window.confirm("Merge empty fields of the existing lead with the new data?")) {
                      try {
                        setIsSubmitting(true);
                        await crmApi.mergeLead(duplicateLeadData.existing.id, duplicateLeadData.payload);
                        setDuplicateLeadData(null);
                        setIsModalOpen(false);
                        fetchLeads();
                        alert("Lead merged successfully!");
                      } catch (err: any) {
                        alert(err.message || "Failed to merge lead");
                      } finally {
                        setIsSubmitting(false);
                      }
                    }
                  }}
                >
                  Merge Information
                </button>

                {profile?.is_superuser && (
                  <button
                    type="button"
                    style={{
                      background: '#dc2626',
                      color: 'white',
                      border: 'none',
                      padding: '10px 16px',
                      borderRadius: 6,
                      cursor: 'pointer',
                      fontWeight: 600
                    }}
                    onClick={async () => {
                      if (window.confirm("Create a duplicate lead (Admin Override)?")) {
                        try {
                          setIsSubmitting(true);
                          await crmApi.createLead(duplicateLeadData.payload, true);
                          setDuplicateLeadData(null);
                          setIsModalOpen(false);
                          fetchLeads();
                          alert("Duplicate Lead created successfully!");
                        } catch (err: any) {
                          alert(err.message || "Failed to override duplicate");
                        } finally {
                          setIsSubmitting(false);
                        }
                      }
                    }}
                  >
                    Create Duplicate (Admin Only)
                  </button>
                )}

                <button
                  type="button"
                  style={{
                    background: '#e2e8f0',
                    color: '#475569',
                    border: 'none',
                    padding: '10px 16px',
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontWeight: 600
                  }}
                  onClick={() => setDuplicateLeadData(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
