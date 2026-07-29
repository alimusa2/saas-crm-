import React, { useState, useEffect } from 'react';
import styles from './FormsPage.module.css';
import { formsApi } from '../../lib/api';
import { X, Plus, Trash2, Sliders, List, Eye } from 'lucide-react';
import type { FormField } from '../../lib/api';

interface FormBuilderModalProps {
  formId: string;
  formTitle: string;
  onClose: () => void;
}

export interface FormThemeConfig {
  labelFontSize: string;
  labelColor: string;
  labelFontWeight: string;
  inputFontSize: string;
  inputTextColor: string;
  inputBgColor: string;
  inputBorderColor: string;
  inputBorderRadius: string;
  submitText: string;
  btnFontSize: string;
  btnTextColor: string;
  btnBgColor: string;
  btnFontWeight: string;
  btnBorderRadius: string;
  formBgColor: string;
  formBorderColor: string;
  formShadow: string;
}

export const defaultFormTheme: FormThemeConfig = {
  labelFontSize: '13px',
  labelColor: '#1F2937',
  labelFontWeight: '600',
  inputFontSize: '14px',
  inputTextColor: '#111827',
  inputBgColor: '#FFFFFF',
  inputBorderColor: '#D1D5DB',
  inputBorderRadius: '8px',
  submitText: 'Submit Form',
  btnFontSize: '15px',
  btnTextColor: '#FFFFFF',
  btnBgColor: '#4F46E5',
  btnFontWeight: '700',
  btnBorderRadius: '8px',
  formBgColor: '#FFFFFF',
  formBorderColor: '#E5E7EB',
  formShadow: 'soft'
};

export const getFormTheme = (formId: string): FormThemeConfig => {
  try {
    const saved = localStorage.getItem(`crm_form_theme_${formId}`);
    if (saved) return { ...defaultFormTheme, ...JSON.parse(saved) };
  } catch {}
  return defaultFormTheme;
};

export const FormBuilderModal: React.FC<FormBuilderModalProps> = ({ formId, formTitle, onClose }) => {
  const [activeTab, setActiveTab] = useState<'fields' | 'style' | 'preview'>('fields');
  const [fields, setFields] = useState<FormField[]>([]);
  const [loading, setLoading] = useState(false);
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldType, setNewFieldType] = useState('text');
  const [newFieldRequired, setNewFieldRequired] = useState(false);

  // Form theme state
  const [theme, setTheme] = useState<FormThemeConfig>(() => getFormTheme(formId));

  useEffect(() => {
    fetchFields();
  }, [formId]);

  useEffect(() => {
    localStorage.setItem(`crm_form_theme_${formId}`, JSON.stringify(theme));
  }, [theme, formId]);

  const fetchFields = async () => {
    try {
      setLoading(true);
      const data = await formsApi.getFields(formId);
      setFields(data);
    } catch (err) {
      console.error('Failed to fetch fields:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddField = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFieldName.trim()) return;

    const label = newFieldName;
    const name = newFieldName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/(^_+|_+$)/g, '');

    try {
      await formsApi.createField(formId, {
        name: name || 'field',
        label: label,
        field_type: newFieldType,
        is_required: newFieldRequired,
        order: fields.length + 1
      });
      setNewFieldName('');
      setNewFieldType('text');
      setNewFieldRequired(false);
      fetchFields();
    } catch (err: any) {
      alert(`Error creating field: ${err.message}`);
    }
  };

  const handleDeleteField = async (fieldId: string) => {
    if (!window.confirm('Are you sure you want to delete this field?')) return;
    try {
      await formsApi.deleteField(formId, fieldId);
      fetchFields();
    } catch (err: any) {
      alert(`Error deleting field: ${err.message}`);
    }
  };

  const updateTheme = (key: keyof FormThemeConfig, val: string) => {
    setTheme(prev => ({ ...prev, [key]: val }));
  };

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modalContent} style={{ maxWidth: '680px', width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
        {/* Modal Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#1E293B' }}>Edit Form: {formTitle}</h2>
            <p style={{ margin: '2px 0 0', fontSize: '13px', color: '#64748B' }}>Customize fields, typography, colors, and layout</p>
          </div>
          <button className={styles.actionBtn} onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: '6px' }}>
            <X size={20} />
          </button>
        </div>

        {/* Modal Navigation Tabs */}
        <div style={{ display: 'flex', borderBottom: '2px solid #E2E8F0', marginBottom: '1.5rem', gap: '8px' }}>
          <button
            type="button"
            onClick={() => setActiveTab('fields')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '10px 16px',
              fontWeight: 600,
              fontSize: '14px',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              color: activeTab === 'fields' ? '#4F46E5' : '#64748B',
              borderBottom: activeTab === 'fields' ? '2.5px solid #4F46E5' : '2.5px solid transparent',
              marginBottom: '-2px',
              transition: 'all 0.15s ease'
            }}
          >
            <List size={16} /> Fields ({fields.length})
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('style')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '10px 16px',
              fontWeight: 600,
              fontSize: '14px',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              color: activeTab === 'style' ? '#4F46E5' : '#64748B',
              borderBottom: activeTab === 'style' ? '2.5px solid #4F46E5' : '2.5px solid transparent',
              marginBottom: '-2px',
              transition: 'all 0.15s ease'
            }}
          >
            <Sliders size={16} /> Style & Formatting
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('preview')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '10px 16px',
              fontWeight: 600,
              fontSize: '14px',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              color: activeTab === 'preview' ? '#4F46E5' : '#64748B',
              borderBottom: activeTab === 'preview' ? '2.5px solid #4F46E5' : '2.5px solid transparent',
              marginBottom: '-2px',
              transition: 'all 0.15s ease'
            }}
          >
            <Eye size={16} /> Live Preview
          </button>
        </div>

        {/* TAB 1: FIELDS MANAGEMENT */}
        {activeTab === 'fields' && (
          <div>
            {loading ? (
              <p style={{ color: '#64748B' }}>Loading fields...</p>
            ) : (
              <div style={{ marginBottom: '2rem' }}>
                <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#1E293B', marginBottom: '12px' }}>Current Form Fields</h3>
                {fields.length === 0 ? (
                  <p style={{ color: '#6B7280', fontSize: '14px' }}>No fields added yet. Add one below.</p>
                ) : (
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {fields.map(field => (
                      <li key={field.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '8px' }}>
                        <div>
                          <strong style={{ fontSize: '14px', color: '#1E293B' }}>{field.label || field.name}</strong>{' '}
                          <span style={{ color: '#64748B', fontSize: '0.85rem' }}>({field.name} - {field.field_type})</span>
                          {field.is_required && <span style={{ color: '#EF4444', marginLeft: '6px', fontWeight: 700 }}>* Required</span>}
                        </div>
                        <button
                          onClick={() => handleDeleteField(field.id)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#EF4444', padding: '6px', borderRadius: '6px', display: 'flex', alignItems: 'center' }}
                          title="Delete Field"
                        >
                          <Trash2 size={16} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div style={{ borderTop: '1px solid #E2E8F0', paddingTop: '1.25rem' }}>
              <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#1E293B', marginBottom: '12px' }}>Add New Field</h3>
              <form onSubmit={handleAddField} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div className={styles.formGroup}>
                  <label style={{ fontSize: '13px', fontWeight: 600, color: '#374151' }}>Field Name / Label (e.g. Email)</label>
                  <input 
                    type="text" 
                    required 
                    value={newFieldName} 
                    onChange={e => setNewFieldName(e.target.value)} 
                    placeholder="Field Label"
                    style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #CBD5E1', fontSize: '14px' }}
                  />
                </div>
                <div className={styles.formGroup}>
                  <label style={{ fontSize: '13px', fontWeight: 600, color: '#374151' }}>Field Type</label>
                  <select value={newFieldType} onChange={e => setNewFieldType(e.target.value)} style={{ width: '100%', padding: '10px 12px', borderRadius: '8px', border: '1px solid #CBD5E1', fontSize: '14px', background: '#fff' }}>
                    <option value="text">Text</option>
                    <option value="email">Email</option>
                    <option value="phone">Phone</option>
                    <option value="number">Number</option>
                    <option value="textarea">Textarea</option>
                    <option value="checkbox">Checkbox</option>
                  </select>
                </div>
                <div className={styles.formGroup} style={{ flexDirection: 'row', alignItems: 'center', gap: '8px', display: 'flex' }}>
                  <input 
                    type="checkbox" 
                    checked={newFieldRequired} 
                    onChange={e => setNewFieldRequired(e.target.checked)} 
                    id="req"
                    style={{ width: 'auto', margin: 0, cursor: 'pointer', flexShrink: 0 }}
                  />
                  <label htmlFor="req" style={{ marginBottom: 0, cursor: 'pointer', fontWeight: 500, fontSize: '13px', color: '#374151' }}>Required Field</label>
                </div>
                <button type="submit" className={styles.createBtn} style={{ marginTop: '8px', alignSelf: 'flex-start', padding: '10px 20px', borderRadius: '8px', background: '#4F46E5', color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Plus size={16} /> Add Field
                </button>
              </form>
            </div>
          </div>
        )}

        {/* TAB 2: STYLE & FORMATTING CUSTOMIZATION */}
        {activeTab === 'style' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {/* Label Formatting */}
            <div style={{ background: '#F8FAFC', padding: '16px', borderRadius: '12px', border: '1px solid #E2E8F0' }}>
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#4F46E5', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '12px' }}>Label Formatting & Typography</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '4px' }}>Edit Label Font Size</label>
                  <select value={theme.labelFontSize} onChange={e => updateTheme('labelFontSize', e.target.value)} style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '13px', background: '#fff' }}>
                    <option value="11px">11px (Compact)</option>
                    <option value="12px">12px (Small)</option>
                    <option value="13px">13px (Normal)</option>
                    <option value="14px">14px (Medium)</option>
                    <option value="16px">16px (Large)</option>
                    <option value="18px">18px (XL)</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '4px' }}>Edit Label Font Colour</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input type="color" value={theme.labelColor} onChange={e => updateTheme('labelColor', e.target.value)} style={{ width: '36px', height: '36px', border: '1px solid #CBD5E1', borderRadius: '6px', padding: '2px', cursor: 'pointer' }} />
                    <input type="text" value={theme.labelColor} onChange={e => updateTheme('labelColor', e.target.value)} style={{ flex: 1, padding: '8px', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '13px' }} />
                  </div>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '4px' }}>Label Font Weight</label>
                  <select value={theme.labelFontWeight} onChange={e => updateTheme('labelFontWeight', e.target.value)} style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '13px', background: '#fff' }}>
                    <option value="400">Normal (400)</option>
                    <option value="500">Medium (500)</option>
                    <option value="600">Semi-Bold (600)</option>
                    <option value="700">Bold (700)</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Input Fields Formatting */}
            <div style={{ background: '#F8FAFC', padding: '16px', borderRadius: '12px', border: '1px solid #E2E8F0' }}>
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#4F46E5', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '12px' }}>Input Fields Formatting</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '4px' }}>Edit Input Font Size</label>
                  <select value={theme.inputFontSize} onChange={e => updateTheme('inputFontSize', e.target.value)} style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '13px', background: '#fff' }}>
                    <option value="12px">12px (Compact)</option>
                    <option value="13px">13px (Small)</option>
                    <option value="14px">14px (Normal)</option>
                    <option value="16px">16px (Large)</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '4px' }}>Edit Input Text Colour</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input type="color" value={theme.inputTextColor} onChange={e => updateTheme('inputTextColor', e.target.value)} style={{ width: '36px', height: '36px', border: '1px solid #CBD5E1', borderRadius: '6px', padding: '2px', cursor: 'pointer' }} />
                    <input type="text" value={theme.inputTextColor} onChange={e => updateTheme('inputTextColor', e.target.value)} style={{ flex: 1, padding: '8px', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '13px' }} />
                  </div>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '4px' }}>Edit Input Background Colour</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input type="color" value={theme.inputBgColor} onChange={e => updateTheme('inputBgColor', e.target.value)} style={{ width: '36px', height: '36px', border: '1px solid #CBD5E1', borderRadius: '6px', padding: '2px', cursor: 'pointer' }} />
                    <input type="text" value={theme.inputBgColor} onChange={e => updateTheme('inputBgColor', e.target.value)} style={{ flex: 1, padding: '8px', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '13px' }} />
                  </div>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '4px' }}>Edit Input Border Colour</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input type="color" value={theme.inputBorderColor} onChange={e => updateTheme('inputBorderColor', e.target.value)} style={{ width: '36px', height: '36px', border: '1px solid #CBD5E1', borderRadius: '6px', padding: '2px', cursor: 'pointer' }} />
                    <input type="text" value={theme.inputBorderColor} onChange={e => updateTheme('inputBorderColor', e.target.value)} style={{ flex: 1, padding: '8px', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '13px' }} />
                  </div>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '4px' }}>Input Border Radius</label>
                  <select value={theme.inputBorderRadius} onChange={e => updateTheme('inputBorderRadius', e.target.value)} style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '13px', background: '#fff' }}>
                    <option value="4px">4px (Sharp)</option>
                    <option value="8px">8px (Rounded)</option>
                    <option value="12px">12px (Smooth)</option>
                    <option value="24px">24px (Pill)</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Button Formatting */}
            <div style={{ background: '#F8FAFC', padding: '16px', borderRadius: '12px', border: '1px solid #E2E8F0' }}>
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#4F46E5', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '12px' }}>Submit Button Formatting</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '4px' }}>Button Label Text</label>
                  <input type="text" value={theme.submitText} onChange={e => updateTheme('submitText', e.target.value)} style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '13px' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '4px' }}>Edit Button Font Size</label>
                  <select value={theme.btnFontSize} onChange={e => updateTheme('btnFontSize', e.target.value)} style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '13px', background: '#fff' }}>
                    <option value="13px">13px (Small)</option>
                    <option value="14px">14px (Medium)</option>
                    <option value="15px">15px (Normal)</option>
                    <option value="16px">16px (Large)</option>
                    <option value="18px">18px (XL)</option>
                    <option value="20px">20px (Huge)</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '4px' }}>Edit Button Text Colour</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input type="color" value={theme.btnTextColor} onChange={e => updateTheme('btnTextColor', e.target.value)} style={{ width: '36px', height: '36px', border: '1px solid #CBD5E1', borderRadius: '6px', padding: '2px', cursor: 'pointer' }} />
                    <input type="text" value={theme.btnTextColor} onChange={e => updateTheme('btnTextColor', e.target.value)} style={{ flex: 1, padding: '8px', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '13px' }} />
                  </div>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '4px' }}>Edit Button Background Colour</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input type="color" value={theme.btnBgColor} onChange={e => updateTheme('btnBgColor', e.target.value)} style={{ width: '36px', height: '36px', border: '1px solid #CBD5E1', borderRadius: '6px', padding: '2px', cursor: 'pointer' }} />
                    <input type="text" value={theme.btnBgColor} onChange={e => updateTheme('btnBgColor', e.target.value)} style={{ flex: 1, padding: '8px', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '13px' }} />
                  </div>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '4px' }}>Button Border Radius</label>
                  <select value={theme.btnBorderRadius} onChange={e => updateTheme('btnBorderRadius', e.target.value)} style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '13px', background: '#fff' }}>
                    <option value="4px">4px (Sharp)</option>
                    <option value="8px">8px (Rounded)</option>
                    <option value="12px">12px (Smooth)</option>
                    <option value="24px">24px (Pill)</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Card & Background Styling */}
            <div style={{ background: '#F8FAFC', padding: '16px', borderRadius: '12px', border: '1px solid #E2E8F0' }}>
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#4F46E5', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '12px' }}>Card Container Formatting</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '4px' }}>Card Background Colour</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input type="color" value={theme.formBgColor} onChange={e => updateTheme('formBgColor', e.target.value)} style={{ width: '36px', height: '36px', border: '1px solid #CBD5E1', borderRadius: '6px', padding: '2px', cursor: 'pointer' }} />
                    <input type="text" value={theme.formBgColor} onChange={e => updateTheme('formBgColor', e.target.value)} style={{ flex: 1, padding: '8px', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '13px' }} />
                  </div>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '4px' }}>Card Border Colour</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input type="color" value={theme.formBorderColor} onChange={e => updateTheme('formBorderColor', e.target.value)} style={{ width: '36px', height: '36px', border: '1px solid #CBD5E1', borderRadius: '6px', padding: '2px', cursor: 'pointer' }} />
                    <input type="text" value={theme.formBorderColor} onChange={e => updateTheme('formBorderColor', e.target.value)} style={{ flex: 1, padding: '8px', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '13px' }} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: LIVE PREVIEW */}
        {activeTab === 'preview' && (
          <div style={{ padding: '20px', background: '#F1F5F9', borderRadius: '16px', display: 'flex', justifyContent: 'center' }}>
            <div style={{
              width: '100%',
              maxWidth: '480px',
              background: theme.formBgColor,
              border: `1.5px solid ${theme.formBorderColor}`,
              borderRadius: '16px',
              padding: '24px',
              boxShadow: theme.formShadow === 'elevation' ? '0 20px 25px -5px rgba(0,0,0,0.1)' : '0 10px 15px -3px rgba(0,0,0,0.05)',
              boxSizing: 'border-box'
            }}>
              <h3 style={{ margin: '0 0 16px 0', fontSize: '18px', fontWeight: 700, color: theme.labelColor, textAlign: 'center' }}>{formTitle}</h3>
              <form onSubmit={e => e.preventDefault()} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {fields.length === 0 ? (
                  <p style={{ textAlign: 'center', color: '#64748B', fontSize: '13px' }}>No fields configured yet. Add fields under the Fields tab.</p>
                ) : (
                  fields.map(f => (
                    <div key={f.id} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: theme.labelFontSize, fontWeight: theme.labelFontWeight as any, color: theme.labelColor }}>
                        {f.label || f.name}{f.is_required && <span style={{ color: '#EF4444' }}> *</span>}
                      </label>
                      {f.field_type === 'textarea' ? (
                        <textarea disabled placeholder={f.label || f.name} style={{ padding: '10px 12px', fontSize: theme.inputFontSize, color: theme.inputTextColor, background: theme.inputBgColor, border: `1.5px solid ${theme.inputBorderColor}`, borderRadius: theme.inputBorderRadius, minHeight: '80px', resize: 'vertical' }} />
                      ) : (
                        <input disabled placeholder={f.label || f.name} style={{ padding: '10px 12px', fontSize: theme.inputFontSize, color: theme.inputTextColor, background: theme.inputBgColor, border: `1.5px solid ${theme.inputBorderColor}`, borderRadius: theme.inputBorderRadius }} />
                      )}
                    </div>
                  ))
                )}
                <button
                  type="button"
                  style={{
                    marginTop: '8px',
                    padding: '12px 16px',
                    background: theme.btnBgColor,
                    color: theme.btnTextColor,
                    fontSize: theme.btnFontSize,
                    fontWeight: theme.btnFontWeight as any,
                    borderRadius: theme.btnBorderRadius,
                    border: 'none',
                    cursor: 'pointer',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                    transition: 'all 0.2s ease'
                  }}
                >
                  {theme.submitText || 'Submit Form'}
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
