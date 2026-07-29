import React, { useEffect, useState } from 'react';
import styles from './FunnelsList.module.css';
import { funnelsApi } from '../../lib/api';
import type { Funnel } from '../../lib/api';
import { Globe } from 'lucide-react';

export const FunnelsList = () => {
  const [funnels, setFunnels] = useState<Funnel[]>([]);

  useEffect(() => {
    funnelsApi.getFunnels()
      .then(data => setFunnels(data.slice(0, 5)))
      .catch(() => {});
  }, []);

  if (funnels.length === 0) {
    return (
      <div className={styles.card}>
        <div className={styles.header}>
          <h2 className={styles.title}>Top Funnels</h2>
        </div>
        <div className={styles.empty}>
          <p>No funnels created yet.</p>
        </div>
      </div>
    );
  }

  const published = funnels.filter(f => f.status === 'Published');
  const total = funnels.length;

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <h2 className={styles.title}>Your Funnels</h2>
        <span className={styles.badge}>{published.length} live</span>
      </div>

      <div className={styles.list}>
        {funnels.map(funnel => (
          <div key={funnel.id} className={styles.item}>
            <div className={styles.itemLeft}>
              {funnel.status === 'Published' && <Globe size={12} className={styles.globeIcon} />}
              <div className={styles.name}>{funnel.name}</div>
            </div>
            <span className={`${styles.statusPill} ${funnel.status === 'Published' ? styles.live : styles.draft}`}>
              {funnel.status}
            </span>
          </div>
        ))}
      </div>

      <div className={styles.footer}>
        <span>{total} funnel{total !== 1 ? 's' : ''} total</span>
      </div>
    </div>
  );
};
