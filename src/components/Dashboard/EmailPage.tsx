import React, { useState, useEffect } from 'react';
import styles from './EmailPage.module.css';
import { emailApi } from '../../lib/api';
import type { EmailTemplate, EmailCampaign } from '../../lib/api';
import { Plus, Mail, Send, FileText } from 'lucide-react';

export const EmailPage = () => {
  const [activeTab, setActiveTab] = useState<'templates' | 'campaigns'>('templates');
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [campaigns, setCampaigns] = useState<EmailCampaign[]>([]);
  
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [newTemplate, setNewTemplate] = useState({ name: '', subject: '', html_content: '' });

  const [isCampaignModalOpen, setIsCampaignModalOpen] = useState(false);
  const [newCampaign, setNewCampaign] = useState({ name: '', template_id: '', status: 'draft' });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [tData, cData] = await Promise.all([
        emailApi.getTemplates(),
        emailApi.getCampaigns()
      ]);
      setTemplates(tData);
      setCampaigns(cData);
    } catch (err) {
      console.error('Failed to fetch email data:', err);
    }
  };

  const handleCreateTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const created = await emailApi.createTemplate(newTemplate);
      setTemplates([...templates, created]);
      setIsTemplateModalOpen(false);
      setNewTemplate({ name: '', subject: '', html_content: '' });
    } catch (err) {
      console.error('Failed to create template:', err);
    }
  };

  const handleCreateCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const created = await emailApi.createCampaign(newCampaign);
      setCampaigns([...campaigns, created]);
      setIsCampaignModalOpen(false);
      setNewCampaign({ name: '', template_id: '', status: 'draft' });
    } catch (err) {
      console.error('Failed to create campaign:', err);
    }
  };

  return (
    <div className={styles.pageContainer}>
      <div className={styles.header}>
        <h1>Email Marketing</h1>
        {activeTab === 'templates' ? (
          <button className={styles.createBtn} onClick={() => setIsTemplateModalOpen(true)}>
            <Plus size={18} />
            Create Template
          </button>
        ) : (
          <button className={styles.createBtn} onClick={() => setIsCampaignModalOpen(true)}>
            <Plus size={18} />
            Create Campaign
          </button>
        )}
      </div>

      <div className={styles.tabsContainer}>
        <button 
          className={`${styles.tabBtn} ${activeTab === 'templates' ? styles.active : ''}`}
          onClick={() => setActiveTab('templates')}
        >
          Templates
        </button>
        <button 
          className={`${styles.tabBtn} ${activeTab === 'campaigns' ? styles.active : ''}`}
          onClick={() => setActiveTab('campaigns')}
        >
          Campaigns
        </button>
      </div>

      <div className={styles.grid}>
        {activeTab === 'templates' && templates.map(template => (
          <div key={template.id} className={styles.card}>
            <div className={styles.cardHeader}>
              <h3>{template.name}</h3>
              <Mail size={18} color="var(--text-secondary)" />
            </div>
            <p className={styles.cardDesc}><strong>Subject:</strong> {template.subject}</p>
            <p className={styles.cardDesc} style={{ fontSize: '12px', opacity: 0.7 }}>
              {template.html_content.substring(0, 80)}...
            </p>
          </div>
        ))}

        {activeTab === 'campaigns' && campaigns.map(campaign => {
          const tpl = templates.find(t => t.id === campaign.template_id);
          return (
            <div key={campaign.id} className={styles.card}>
              <div className={styles.cardHeader}>
                <h3>{campaign.name}</h3>
                <span className={`${styles.statusBadge} ${styles[campaign.status.toLowerCase()] || styles.draft}`}>
                  {campaign.status}
                </span>
              </div>
              <p className={styles.cardDesc}><strong>Template:</strong> {tpl?.name || 'Unknown'}</p>
            </div>
          )
        })}

        {activeTab === 'templates' && templates.length === 0 && (
          <div className={styles.emptyState}>
            <FileText size={48} style={{ margin: '0 auto 16px', opacity: 0.5 }} />
            <h3>No templates yet</h3>
            <p>Create an email template to use in your campaigns.</p>
          </div>
        )}

        {activeTab === 'campaigns' && campaigns.length === 0 && (
          <div className={styles.emptyState}>
            <Send size={48} style={{ margin: '0 auto 16px', opacity: 0.5 }} />
            <h3>No campaigns yet</h3>
            <p>Start sending emails to your leads by creating a campaign.</p>
          </div>
        )}
      </div>

      {isTemplateModalOpen && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalContent}>
            <h2>Create New Template</h2>
            <form onSubmit={handleCreateTemplate}>
              <div className={styles.formGroup}>
                <label>Template Name</label>
                <input 
                  type="text" 
                  required
                  placeholder="e.g. Welcome Email"
                  value={newTemplate.name}
                  onChange={e => setNewTemplate({...newTemplate, name: e.target.value})}
                />
              </div>
              <div className={styles.formGroup}>
                <label>Email Subject</label>
                <input 
                  type="text" 
                  required
                  placeholder="e.g. Welcome to GrowthOS!"
                  value={newTemplate.subject}
                  onChange={e => setNewTemplate({...newTemplate, subject: e.target.value})}
                />
              </div>
              <div className={styles.formGroup}>
                <label>HTML Content</label>
                <textarea 
                  required
                  placeholder="<p>Hello there...</p>"
                  value={newTemplate.html_content}
                  onChange={e => setNewTemplate({...newTemplate, html_content: e.target.value})}
                />
              </div>
              <div className={styles.modalActions}>
                <button type="button" className={styles.cancelBtn} onClick={() => setIsTemplateModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className={styles.submitBtn}>
                  Create Template
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isCampaignModalOpen && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalContent}>
            <h2>Create New Campaign</h2>
            <form onSubmit={handleCreateCampaign}>
              <div className={styles.formGroup}>
                <label>Campaign Name</label>
                <input 
                  type="text" 
                  required
                  placeholder="e.g. Onboarding Drip - Email 1"
                  value={newCampaign.name}
                  onChange={e => setNewCampaign({...newCampaign, name: e.target.value})}
                />
              </div>
              <div className={styles.formGroup}>
                <label>Select Template</label>
                <select 
                  required
                  value={newCampaign.template_id}
                  onChange={e => setNewCampaign({...newCampaign, template_id: e.target.value})}
                >
                  <option value="" disabled>Select a template</option>
                  {templates.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
              <div className={styles.formGroup}>
                <label>Status</label>
                <select 
                  value={newCampaign.status}
                  onChange={e => setNewCampaign({...newCampaign, status: e.target.value})}
                >
                  <option value="draft">Draft</option>
                  <option value="active">Active</option>
                  <option value="sent">Sent</option>
                </select>
              </div>
              <div className={styles.modalActions}>
                <button type="button" className={styles.cancelBtn} onClick={() => setIsCampaignModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className={styles.submitBtn}>
                  Create Campaign
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
