import React, { useState, useEffect } from 'react';
import styles from './FormsPage.module.css';
import { formsApi } from '../../lib/api';
import type { Form } from '../../lib/api';
import { Plus, Settings, Code, FileText, Eye } from 'lucide-react';
import { FormBuilderModal } from './FormBuilderModal';

export const FormsPage = () => {
  const [forms, setForms] = useState<Form[]>([]);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newForm, setNewForm] = useState({ title: '', description: '' });
  const [selectedForm, setSelectedForm] = useState<Form | null>(null);
  const [selectedFormBuilder, setSelectedFormBuilder] = useState<Form | null>(null);

  useEffect(() => {
    fetchForms();
  }, []);

  const fetchForms = async () => {
    try {
      const data = await formsApi.getForms();
      setForms(data);
    } catch (err) {
      console.error('Failed to fetch forms:', err);
    }
  };

  const handleCreateForm = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const created = await formsApi.createForm(newForm);
      setForms([...forms, created]);
      setIsCreateModalOpen(false);
      setNewForm({ title: '', description: '' });
    } catch (err) {
      console.error('Failed to create form:', err);
    }
  };

  return (
    <div className={styles.pageContainer}>
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <h1>Forms & Lead Capture</h1>
          <p>Design, manage, and embed interactive lead capture forms for your funnels.</p>
        </div>
        <button className={styles.createBtn} onClick={() => setIsCreateModalOpen(true)}>
          <Plus size={18} />
          Create Form
        </button>
      </div>

      <div className={styles.formsGrid}>
        {forms.map(form => (
          <div key={form.id} className={styles.formCard}>
            <div className={styles.formHeader}>
              <h3>{form.title}</h3>
              <span className={`${styles.statusBadge} ${form.is_active ? styles.active : styles.inactive}`}>
                <span className={styles.statusDot} />
                {form.is_active ? 'Active' : 'Draft'}
              </span>
            </div>
            <p className={styles.formDesc}>{form.description || 'No description provided.'}</p>
            
            <div className={styles.formActions}>
              <button className={`${styles.actionBtn} ${styles.primaryAction}`} onClick={() => setSelectedFormBuilder(form)} title="Configure Form Fields">
                <Settings size={15} /> Edit Fields
              </button>
              <a
                className={styles.actionBtn}
                href={`${window.location.origin}/f/${form.id}`}
                target="_blank"
                rel="noopener noreferrer"
                title="Preview Form"
                style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              >
                <Eye size={13} /> Open Form
              </a>
              <button className={styles.actionBtn} onClick={() => setSelectedForm(form)} title="Get Embed Snippet">
                <Code size={15} /> Embed Code
              </button>
            </div>
          </div>
        ))}

        {forms.length === 0 && (
          <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '48px', color: '#6B7280' }}>
            <FileText size={48} style={{ margin: '0 auto 16px', opacity: 0.5 }} />
            <h3>No forms created yet</h3>
            <p>Create your first form to start capturing leads automatically.</p>
          </div>
        )}
      </div>

      {isCreateModalOpen && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalContent}>
            <h2>Create New Form</h2>
            <form onSubmit={handleCreateForm}>
              <div className={styles.formGroup}>
                <label>Form Title</label>
                <input 
                  type="text" 
                  required
                  placeholder="e.g. Website Contact Form"
                  value={newForm.title}
                  onChange={e => setNewForm({...newForm, title: e.target.value})}
                />
              </div>
              <div className={styles.formGroup}>
                <label>Description</label>
                <textarea 
                  placeholder="Optional description"
                  value={newForm.description}
                  onChange={e => setNewForm({...newForm, description: e.target.value})}
                />
              </div>
              <div className={styles.modalActions}>
                <button type="button" className={styles.cancelBtn} onClick={() => setIsCreateModalOpen(false)}>Cancel</button>
                <button type="submit" className={styles.createBtn}>Create Form</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {selectedFormBuilder && (
        <FormBuilderModal 
          formId={selectedFormBuilder.id}
          formTitle={selectedFormBuilder.title}
          onClose={() => setSelectedFormBuilder(null)}
        />
      )}

      {selectedForm && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalContent}>
            <h2>Embed Form: {selectedForm.title}</h2>
            <p>Copy and paste this HTML code into your website.</p>
            <textarea 
              readOnly
              style={{ width: '100%', height: '150px', marginTop: '10px', padding: '10px', fontFamily: 'monospace', borderRadius: '4px', border: '1px solid #E5E7EB' }}
              value={`<iframe src="${window.location.origin}/f/${selectedForm.id}" width="100%" height="500" frameborder="0"></iframe>`}
            />
            <div className={styles.modalActions} style={{ marginTop: '20px' }}>
              <button className={styles.actionBtn} onClick={() => setSelectedForm(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
