import React, { useState, useEffect, useCallback } from 'react';
import styles from './EmailIntegrationPage.module.css';
import { gmailApi } from '../../lib/api';
import type { GmailIntegration } from '../../lib/api';
import { Mail, CheckCircle, XCircle, RefreshCw, Unlink, Link, Info, AlertCircle } from 'lucide-react';

interface EmailIntegrationPageProps {
  /** If arriving from OAuth callback, pass these to show status banner */
  oauthStatus?: 'success' | 'error' | null;
  oauthMessage?: string;
  oauthEmail?: string;
}

export const EmailIntegrationPage: React.FC<EmailIntegrationPageProps> = ({
  oauthStatus,
  oauthMessage,
  oauthEmail,
}) => {
  const [integration, setIntegration] = useState<GmailIntegration | null>(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const status = await gmailApi.getStatus();
      setIntegration(status);
    } catch (e) {
      setError('Failed to load Gmail integration status.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleConnect = async () => {
    setConnecting(true);
    setError(null);
    try {
      const { url } = await gmailApi.getOAuthUrl();
      // Navigate to Google's OAuth page (same window for proper redirect flow)
      window.location.href = url;
    } catch (e) {
      setError('Failed to initiate Gmail connection. Please try again.');
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!window.confirm('Disconnect your Gmail account? You will not be able to send emails from the Inbox until reconnected.')) return;
    setDisconnecting(true);
    setError(null);
    try {
      const updated = await gmailApi.disconnect();
      setIntegration(updated);
      setTestResult(null);
    } catch (e) {
      setError('Failed to disconnect Gmail. Please try again.');
    } finally {
      setDisconnecting(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await gmailApi.testConnection();
      setTestResult(result);
      if (result.success && result.gmail_address) {
        // Update local state with possibly refreshed email
        setIntegration(prev => prev ? { ...prev, gmail_address: result.gmail_address } : prev);
      }
    } catch (e) {
      setTestResult({ success: false, message: 'Test request failed. Please try again.' });
    } finally {
      setTesting(false);
    }
  };

  const [syncing, setSyncing] = useState(false);

  const handleSyncNow = async () => {
    setSyncing(true);
    setError(null);
    try {
      const res = await gmailApi.syncNow();
      setTestResult({ success: true, message: res.message });
      await fetchStatus();
    } catch (e: any) {
      setError(e.message || 'Sync failed.');
    } finally {
      setSyncing(false);
    }
  };

  const isConnected = integration?.is_connected ?? false;

  const formatDate = (isoDate?: string) => {
    if (!isoDate) return '—';
    return new Date(isoDate).toLocaleString();
  };

  return (
    <div className={styles.container}>
      <div className={styles.pageHeader}>
        <div className={styles.pageHeaderIcon}>
          <Mail size={22} />
        </div>
        <div>
          <h2 className={styles.pageTitle}>Email Integration</h2>
          <p className={styles.pageSubtitle}>
            Connect a Gmail account to send and automatically synchronize incoming emails from Gmail into your CRM Inbox.
          </p>
        </div>
      </div>

      {/* OAuth callback banners */}
      {oauthStatus === 'success' && (
        <div className={`${styles.banner} ${styles.bannerSuccess}`}>
          <CheckCircle size={18} />
          <span>
            Gmail connected successfully{oauthEmail ? ` as ${oauthEmail}` : ''}!
          </span>
        </div>
      )}
      {oauthStatus === 'error' && (
        <div className={`${styles.banner} ${styles.bannerError}`}>
          <XCircle size={18} />
          <span>
            OAuth error: {oauthMessage || 'Connection failed. Please try again.'}
          </span>
        </div>
      )}

      {error && (
        <div className={`${styles.banner} ${styles.bannerError}`}>
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {testResult && (
        <div className={`${styles.banner} ${testResult.success ? styles.bannerSuccess : styles.bannerError}`}>
          {testResult.success ? <CheckCircle size={18} /> : <XCircle size={18} />}
          <span>{testResult.message}</span>
        </div>
      )}

      {loading ? (
        <div className={styles.loadingCard}>
          <RefreshCw size={20} className={styles.spinIcon} />
          <span>Loading Gmail connection status…</span>
        </div>
      ) : (
        <>
          {/* Status Card */}
          <div className={styles.statusCard}>
            <div className={styles.statusLeft}>
              <div className={`${styles.statusIndicator} ${isConnected ? styles.statusConnected : styles.statusDisconnected}`}>
                {isConnected ? <CheckCircle size={20} /> : <XCircle size={20} />}
                <span>{isConnected ? 'Connected' : 'Not Connected'}</span>
              </div>
              {isConnected && integration?.gmail_address && (
                <div className={styles.gmailAddress}>
                  <Mail size={14} />
                  <span>{integration.gmail_address}</span>
                </div>
              )}
              {isConnected && (
                <div style={{ marginTop: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
                  <div><strong>Last Sync Time:</strong> {formatDate(integration?.last_synced_at)}</div>
                  {integration?.last_sync_message && (
                    <div style={{ fontSize: 12, opacity: 0.8, marginTop: 2 }}>{integration.last_sync_message}</div>
                  )}
                </div>
              )}
              {isConnected && integration?.connected_at && (
                <div className={styles.connectedAt}>
                  Connected {formatDate(integration.connected_at)}
                </div>
              )}
              {!isConnected && (
                <p className={styles.notConnectedText}>
                  No Gmail account connected. Click <strong>Connect with Google</strong> below to get started.
                </p>
              )}
            </div>

            <div className={styles.statusActions}>
              {!isConnected ? (
                <button
                  className={styles.connectBtn}
                  onClick={handleConnect}
                  disabled={connecting}
                  id="btn-connect-gmail"
                >
                  <Link size={16} />
                  {connecting ? 'Redirecting to Google…' : 'Connect with Google'}
                </button>
              ) : (
                <div className={styles.actionGroup}>
                  <button
                    className={styles.testBtn}
                    onClick={handleSyncNow}
                    disabled={syncing}
                    id="btn-sync-now-gmail"
                    style={{ background: 'var(--primary-color)', color: 'white', border: 'none' }}
                  >
                    <RefreshCw size={14} className={syncing ? styles.spinIcon : ''} />
                    {syncing ? 'Syncing…' : 'Sync Now'}
                  </button>
                  <button
                    className={styles.testBtn}
                    onClick={handleTest}
                    disabled={testing}
                    id="btn-test-gmail"
                  >
                    <RefreshCw size={14} className={testing ? styles.spinIcon : ''} />
                    {testing ? 'Testing…' : 'Test Connection'}
                  </button>
                  <button
                    className={styles.disconnectBtn}
                    onClick={handleDisconnect}
                    disabled={disconnecting}
                    id="btn-disconnect-gmail"
                  >
                    <Unlink size={14} />
                    {disconnecting ? 'Disconnecting…' : 'Disconnect'}
                  </button>
                </div>
              )}
            </div>
          </div>


          {/* Provider info */}
          <div className={styles.providerCard}>
            <div className={styles.providerHeader}>
              <div className={styles.gmailBadge}>
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.910 1.528-1.145C21.69 2.28 24 3.434 24 5.457z" fill="#EA4335"/>
                </svg>
                Gmail
              </div>
              <span className={styles.providerLabel}>via Google OAuth 2.0</span>
            </div>
            <p className={styles.providerDesc}>
              GrowthOS uses Google's secure OAuth 2.0 protocol to connect your Gmail account.
              Your Gmail password is <strong>never stored</strong>. Access tokens are encrypted at rest.
              You can disconnect at any time.
            </p>
            <div className={styles.scopeList}>
              <div className={styles.scopeItem}><CheckCircle size={12} /> Read your Gmail address &amp; profile</div>
              <div className={styles.scopeItem}><CheckCircle size={12} /> Send emails on your behalf</div>
              <div className={styles.scopeItem}><CheckCircle size={12} /> Read email message IDs for threading</div>
            </div>
          </div>

          {/* Developer setup info */}
          <details className={styles.devInfo}>
            <summary className={styles.devInfoSummary}>
              <Info size={14} /> Developer Setup — Configure Google OAuth Credentials
            </summary>
            <div className={styles.devInfoBody}>
              <p>To enable real Gmail OAuth (not simulation mode), add these values to <code>backend/.env</code>:</p>
              <pre className={styles.codeBlock}>{`# backend/.env
GOOGLE_CLIENT_ID=your_client_id_here.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-your_secret_here
GOOGLE_REDIRECT_URI=http://localhost:8000/api/v1/gmail/callback

# Generate with: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
GMAIL_ENCRYPTION_KEY=your-fernet-key-here`}</pre>
              <p>Then in <a href="https://console.cloud.google.com" target="_blank" rel="noreferrer">Google Cloud Console</a>:</p>
              <ol>
                <li>Create a project → Enable Gmail API</li>
                <li>Create OAuth 2.0 credentials (Web application)</li>
                <li>Add <code>http://localhost:8000/api/v1/gmail/callback</code> as an authorized redirect URI</li>
                <li>Restart the backend server</li>
              </ol>
            </div>
          </details>
        </>
      )}
    </div>
  );
};
