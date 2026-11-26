import React, { useState, useEffect } from 'react';
import { API_BASE } from '../../lib/api';
import { formsApi } from '../../lib/api';
import type { Form, FormField } from '../../lib/api';
import { getFormTheme } from './FormBuilderModal';

interface PublicFormPageProps {
  formId: string;
}

export const PublicFormPage: React.FC<PublicFormPageProps> = ({ formId }) => {
  const [form, setForm] = useState<Form | null>(null);
  const [fields, setFields] = useState<FormField[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const theme = getFormTheme(formId);
  
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    fetchFormData();
  }, [formId]);

  const fetchFormData = async () => {
    try {
      setLoading(true);
      const BASE = API_BASE;
      const [formResp, fieldsResp] = await Promise.all([
        fetch(`${BASE}/forms/public/${formId}`).then(r => r.ok ? r.json() : Promise.reject('Form not found')),
        fetch(`${BASE}/forms/public/${formId}/fields`).then(r => r.ok ? r.json() : []),
      ]);
      setForm(formResp);
      setFields(fieldsResp);
    } catch (err: any) {
      console.error('Failed to load form', err);
      setError('Form not found or unavailable.');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (fieldId: string, value: string) => {
    setFormData(prev => ({ ...prev, [fieldId]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);

    try {
      // Build responses array
      const responses = fields.map(field => ({
        form_field_id: field.id,
        value: formData[field.id] || ''
      }));

      // Search for utm_source in the query params to map into form_data automatically
      const params = new URLSearchParams(window.location.search);
      const utm_source = params.get('utm_source');
      const step_id = params.get('step'); // For funnel tracking context
      
      const submitPayload = {
        responses,
        visitor_id: localStorage.getItem('visitor_id') || `v_${Math.random().toString(36).substring(7)}`,
        utm_source: utm_source || undefined,
        metadata: {
          step_id: step_id || undefined,
          url: window.location.href
        }
      };

      const BASE = API_BASE;
      const submitResp = await fetch(`${BASE}/forms/${formId}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(submitPayload),
      });
      if (!submitResp.ok) {
        const err = await submitResp.json().catch(() => ({}));
        throw new Error(err.detail || 'Submission failed');
      }
      setSubmitted(true);
    } catch (err: any) {
      setError(err.message || 'An error occurred while submitting the form.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', marginTop: '100px', fontFamily: 'Inter, sans-serif' }}>Loading form...</div>;
  }

  if (error && !form) {
    return <div style={{ display: 'flex', justifyContent: 'center', marginTop: '100px', color: 'red', fontFamily: 'Inter, sans-serif' }}>{error}</div>;
  }

  if (submitted) {
    return (
      <div style={{ maxWidth: '600px', margin: '100px auto', padding: '40px', textAlign: 'center', border: '1px solid #E5E7EB', borderRadius: '8px', fontFamily: 'Inter, sans-serif', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}>
        <h2 style={{ color: '#10B981', marginBottom: '16px' }}>Thank you!</h2>
        <p style={{ color: '#4B5563' }}>Your submission has been received.</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '600px', margin: '60px auto', padding: '32px', border: `1.5px solid ${theme.formBorderColor}`, borderRadius: (theme as any).formBorderRadius || '16px', fontFamily: 'Inter, sans-serif', backgroundColor: theme.formBgColor, boxShadow: theme.formShadow === 'elevation' ? '0 20px 30px -10px rgba(0,0,0,0.15)' : '0 10px 25px -5px rgba(0,0,0,0.08)' }}>
      <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '8px', color: theme.labelColor }}>{form?.title}</h1>
      {form?.description && <p style={{ color: '#6B7280', marginBottom: '24px', fontSize: '15px' }}>{form.description}</p>}
      
      {error && <div style={{ padding: '12px', backgroundColor: '#FEE2E2', color: '#B91C1C', borderRadius: '6px', marginBottom: '20px', fontSize: '14px' }}>{error}</div>}
      
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {fields.map(field => (
          <div key={field.id} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: theme.labelFontSize, fontWeight: theme.labelFontWeight as any, color: theme.labelColor }}>
              {field.label || field.name} {field.is_required && <span style={{ color: '#EF4444' }}>*</span>}
            </label>
            {field.field_type === 'textarea' ? (
              <textarea
                required={field.is_required}
                value={formData[field.id] || ''}
                onChange={e => handleInputChange(field.id, e.target.value)}
                style={{ padding: '10px 12px', border: `1.5px solid ${theme.inputBorderColor}`, borderRadius: theme.inputBorderRadius, fontSize: theme.inputFontSize, color: theme.inputTextColor, background: theme.inputBgColor, minHeight: '100px', outline: 'none', fontFamily: 'inherit' }}
              />
            ) : field.field_type === 'checkbox' ? (
              <input
                type="checkbox"
                required={field.is_required}
                checked={formData[field.id] === 'true'}
                onChange={e => handleInputChange(field.id, e.target.checked ? 'true' : 'false')}
                style={{ width: '18px', height: '18px', cursor: 'pointer' }}
              />
            ) : (
              <input
                type={field.field_type === 'email' ? 'email' : field.field_type === 'number' ? 'number' : field.field_type === 'phone' ? 'tel' : 'text'}
                required={field.is_required}
                value={formData[field.id] || ''}
                onChange={e => handleInputChange(field.id, e.target.value)}
                style={{ padding: '10px 12px', border: `1.5px solid ${theme.inputBorderColor}`, borderRadius: theme.inputBorderRadius, fontSize: theme.inputFontSize, color: theme.inputTextColor, background: theme.inputBgColor, outline: 'none', fontFamily: 'inherit' }}
              />
            )}
          </div>
        ))}

        <button 
          type="submit" 
          disabled={isSubmitting || fields.length === 0}
          style={{ 
            marginTop: '10px', 
            padding: '12px 20px', 
            backgroundColor: isSubmitting ? '#9CA3AF' : theme.btnBgColor, 
            color: theme.btnTextColor, 
            border: 'none', 
            borderRadius: theme.btnBorderRadius, 
            fontSize: theme.btnFontSize, 
            fontWeight: theme.btnFontWeight as any, 
            cursor: isSubmitting ? 'not-allowed' : 'pointer',
            transition: 'all 0.2s ease',
            boxShadow: '0 4px 12px rgba(0,0,0,0.12)'
          }}
        >
          {isSubmitting ? 'Submitting...' : (theme.submitText || 'Submit')}
        </button>
      </form>
      {fields.length === 0 && <p style={{ color: '#9CA3AF', fontSize: '14px', marginTop: '16px', textAlign: 'center' }}>This form has no fields.</p>}
    </div>
  );
};
