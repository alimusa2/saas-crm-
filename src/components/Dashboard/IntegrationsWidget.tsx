import React from 'react';
import styles from './IntegrationsWidget.module.css';

const integrations = [
  { id: 1, name: 'Email', icon: <span style={{color: '#EA4335'}}>M</span>, status: 'Connected', isConnected: true },
  { id: 2, name: 'Calendar', icon: <span style={{color: '#4285F4'}}>31</span>, status: 'Connected', isConnected: true },
  { id: 3, name: 'Payments', icon: <span style={{color: '#635BFF'}}>S</span>, status: 'Connected', isConnected: true },
  { id: 4, name: 'WhatsApp', icon: <span style={{color: '#25D366'}}>W</span>, status: 'Coming Soon', isConnected: false },
];

interface IntegrationsWidgetProps {
  onNavigate?: (tab: string) => void;
}

export const IntegrationsWidget: React.FC<IntegrationsWidgetProps> = ({ onNavigate }) => {
  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <h2 className={styles.title}>Integrations</h2>
        <button 
          type="button" 
          className={styles.manage}
          onClick={() => onNavigate?.('Integrations')}
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
        >
          View all / Manage
        </button>
      </div>

      <div className={styles.list}>
        {integrations.map(int => (
          <div key={int.id} className={styles.item}>
            <div className={styles.iconWrapper}>
              {int.icon}
            </div>
            <div className={styles.textStack}>
              <span className={styles.name}>{int.name}</span>
              <span className={`${styles.status} ${int.isConnected ? styles.statusConnected : styles.statusComing}`}>
                {int.status}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
