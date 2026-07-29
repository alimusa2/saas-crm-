import React, { useState, useEffect } from 'react';
import styles from './SettingsPage.module.css';
import { settingsApi } from '../../lib/api';
import type { UserProfile, OrgSettings } from '../../lib/api';
import { User, Building2, Lock, Save, Mail } from 'lucide-react';
import { EmailIntegrationPage } from './EmailIntegrationPage';

export const SettingsPage = () => {
  // Parse query params to see if we just came from Google OAuth redirect
  const query = new URLSearchParams(window.location.search);
  const isOauthCallback = query.get('oauth') === 'gmail';
  const oauthStatus = query.get('status') as 'success' | 'error' | null;
  const oauthMessage = query.get('message') || undefined;
  const oauthEmail = query.get('email') || undefined;

  const [tab, setTab] = useState<'profile' | 'organization' | 'security' | 'email-integration'>(
    isOauthCallback ? 'email-integration' : 'profile'
  );
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [org, setOrg] = useState<OrgSettings | null>(null);
  const [profileEdit, setProfileEdit] = useState({ first_name: '', last_name: '' });
  const [orgEdit, setOrgEdit] = useState({ name: '', domain: '' });
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const [p, o] = await Promise.all([settingsApi.getProfile(), settingsApi.getOrganization()]);
        setProfile(p);
        setOrg(o);
        setProfileEdit({ first_name: p.first_name || '', last_name: p.last_name || '' });
        setOrgEdit({ name: o.name, domain: o.domain || '' });
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    };
    load();

    // Clean up query parameters in URL bar so refreshing doesn't trigger alerts
    if (isOauthCallback) {
      const newUrl = window.location.origin + window.location.pathname;
      window.history.replaceState({}, document.title, newUrl);
    }
  }, [isOauthCallback]);

  const showSaved = () => { setSaved(true); setTimeout(() => setSaved(false), 2500); };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const updated = await settingsApi.updateProfile(profileEdit);
      setProfile(updated);
      showSaved();
    } catch (e) { console.error(e); }
  };

  const handleSaveOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const updated = await settingsApi.updateOrganization(orgEdit);
      setOrg(updated);
      showSaved();
    } catch (e) { console.error(e); }
  };

  if (loading) return <div className={styles.stateMsg}>Loading settings…</div>;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1>Settings</h1>
        <p className={styles.subtitle}>Manage your account and workspace preferences</p>
      </div>

      <div className={styles.layout}>
        <div className={styles.tabNav}>
          <button className={`${styles.tabBtn} ${tab === 'profile' ? styles.active : ''}`} onClick={() => setTab('profile')}>
            <User size={16} /> Profile
          </button>
          <button className={`${styles.tabBtn} ${tab === 'organization' ? styles.active : ''}`} onClick={() => setTab('organization')}>
            <Building2 size={16} /> Organization
          </button>
          <button className={`${styles.tabBtn} ${tab === 'email-integration' ? styles.active : ''}`} onClick={() => setTab('email-integration')}>
            <Mail size={16} /> Email Integration
          </button>
          <button className={`${styles.tabBtn} ${tab === 'security' ? styles.active : ''}`} onClick={() => setTab('security')}>
            <Lock size={16} /> Security
          </button>
        </div>

        <div className={styles.panel}>
          {saved && <div className={styles.savedBanner}><Save size={16} /> Changes saved successfully!</div>}

          {tab === 'profile' && (
            <form onSubmit={handleSaveProfile} className={styles.form}>
              <h2 className={styles.sectionTitle}>Profile Information</h2>
              <div className={styles.avatarRow}>
                <div className={styles.bigAvatar}>
                  {(profileEdit.first_name?.[0] || '?')}{profileEdit.last_name?.[0] || ''}
                </div>
                <div>
                  <p className={styles.avatarName}>{profileEdit.first_name} {profileEdit.last_name}</p>
                  <p className={styles.avatarEmail}>{profile?.email}</p>
                </div>
              </div>
              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label>First Name</label>
                  <input value={profileEdit.first_name} onChange={e => setProfileEdit({ ...profileEdit, first_name: e.target.value })} />
                </div>
                <div className={styles.formGroup}>
                  <label>Last Name</label>
                  <input value={profileEdit.last_name} onChange={e => setProfileEdit({ ...profileEdit, last_name: e.target.value })} />
                </div>
              </div>
              <div className={styles.formGroup}>
                <label>Email Address</label>
                <input value={profile?.email || ''} disabled className={styles.disabled} />
                <span className={styles.hint}>Email cannot be changed here.</span>
              </div>
              <button type="submit" className={styles.saveBtn}><Save size={16} /> Save Profile</button>
            </form>
          )}

          {tab === 'organization' && (
            <form onSubmit={handleSaveOrg} className={styles.form}>
              <h2 className={styles.sectionTitle}>Organization Details</h2>
              <div className={styles.formGroup}>
                <label>Organization Name</label>
                <input value={orgEdit.name} onChange={e => setOrgEdit({ ...orgEdit, name: e.target.value })} placeholder="Acme Corp" />
              </div>
              <div className={styles.formGroup}>
                <label>Domain</label>
                <input value={orgEdit.domain} onChange={e => setOrgEdit({ ...orgEdit, domain: e.target.value })} placeholder="acmecorp.com" />
              </div>
              <button type="submit" className={styles.saveBtn}><Save size={16} /> Save Organization</button>
            </form>
          )}

          {tab === 'email-integration' && (
            <EmailIntegrationPage
              oauthStatus={oauthStatus}
              oauthMessage={oauthMessage}
              oauthEmail={oauthEmail}
            />
          )}

          {tab === 'security' && (
            <div className={styles.form}>
              <h2 className={styles.sectionTitle}>Security</h2>
              <div className={styles.securityItem}>
                <div>
                  <div className={styles.secLabel}>Password</div>
                  <div className={styles.secDesc}>Change your account password</div>
                </div>
                <button className={styles.secBtn} onClick={() => alert('Password change flow coming soon!')}>Change Password</button>
              </div>
              <div className={styles.securityItem}>
                <div>
                  <div className={styles.secLabel}>Two-Factor Authentication</div>
                  <div className={styles.secDesc}>Add an extra layer of security to your account</div>
                </div>
                <button className={styles.secBtn} onClick={() => alert('2FA setup coming soon!')}>Enable 2FA</button>
              </div>
              <div className={styles.securityItem}>
                <div>
                  <div className={styles.secLabel}>Active Sessions</div>
                  <div className={styles.secDesc}>Manage and revoke active login sessions</div>
                </div>
                <button className={styles.secBtn} onClick={() => alert('Session management coming soon!')}>View Sessions</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
