import React, { useState, useEffect } from 'react';
import styles from './IntegrationsPage.module.css';
import { integrationsApi, api } from '../../lib/api';
import type { Integration } from '../../lib/api';
import { ToggleLeft, ToggleRight, ExternalLink } from 'lucide-react';

export const IntegrationsPage = () => {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchIntegrations(); }, []);

  const fetchIntegrations = async () => {
    setLoading(true);
    try {
      const data = await integrationsApi.getIntegrations();
      setIntegrations(data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const handleConnectGoogle = async () => {
    try {
      const data = await api<{ url: string }>('/gmail/oauth-url');
      if (data && data.url) {
        window.location.href = data.url;
      } else {
        alert('Failed to launch Google OAuth authorization URL.');
      }
    } catch (e: any) {
      console.error(e);
      alert(`Failed to launch Google OAuth: ${e?.message || 'Unauthorized'}`);
    }
  };

  const handleToggle = async (integration: Integration) => {
    if (integration.slug?.includes('google') || integration.name.toLowerCase().includes('google')) {
      if (!integration.is_connected) {
        await handleConnectGoogle();
        return;
      }
    }
    try {
      const updated = await integrationsApi.toggleIntegration(integration.id, !integration.is_connected);
      setIntegrations(integrations.map(i => i.id === updated.id ? updated : i));
    } catch (e) { console.error(e); }
  };

  const handleConfigure = (integration: Integration) => {
    if (integration.slug?.includes('google') || integration.name.toLowerCase().includes('google')) {
      handleConnectGoogle();
    } else {
      alert(`${integration.name} settings.`);
    }
  };

  const connected = integrations.filter(i => i.is_connected).length;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1>Integrations</h1>
          <p className={styles.subtitle}>{connected} of {integrations.length} integrations connected</p>
        </div>
      </div>

      {loading && <div className={styles.stateMsg}>Loading integrations…</div>}

      <div className={styles.grid}>
        {integrations.map(integration => (
          <div key={integration.id} className={`${styles.card} ${integration.is_connected ? styles.connected : ''}`}>
            <div className={styles.cardTop}>
              {integration.icon_url ? (
                <img src={integration.icon_url} alt={integration.name} className={styles.logo} onError={e => { (e.target as HTMLImageElement).style.display='none'; }} />
              ) : (
                <div className={styles.logoPlaceholder}>{integration.name[0]}</div>
              )}
              <button
                className={styles.toggleBtn}
                onClick={() => handleToggle(integration)}
                title={integration.is_connected ? 'Disconnect' : 'Connect'}
              >
                {integration.is_connected
                  ? <ToggleRight size={32} color="#5B48E5" />
                  : <ToggleLeft size={32} color="#D1D5DB" />
                }
              </button>
            </div>
            <h3 className={styles.cardName}>{integration.name}</h3>
            <p className={styles.cardDesc}>{integration.description}</p>
            <div className={styles.cardFooter}>
              <span className={`${styles.status} ${integration.is_connected ? styles.statusConnected : styles.statusDisconnected}`}>
                {integration.is_connected ? '● Connected' : '○ Not connected'}
              </span>
              <button className={styles.configBtn} onClick={() => handleConfigure(integration)}>
                <ExternalLink size={14} /> Configure
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
