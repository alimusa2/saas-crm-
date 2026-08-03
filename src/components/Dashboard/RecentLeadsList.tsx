import React, { useEffect, useState } from 'react';
import styles from './RecentLeadsList.module.css';
import { crmApi, type Lead } from '../../lib/api';

function getInitials(first: string, last: string) {
  return `${first?.[0] ?? ''}${last?.[0] ?? ''}`.toUpperCase();
}

function formatDate(iso: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

interface RecentLeadsListProps {
  initialLeads?: Lead[];
  onNavigate?: (tab: string) => void;
}

export const RecentLeadsList: React.FC<RecentLeadsListProps> = ({ initialLeads, onNavigate }) => {
  const [leads, setLeads] = useState<Lead[]>(initialLeads ? initialLeads.slice(0, 5) : []);
  const [loading, setLoading] = useState(!initialLeads);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialLeads) {
      setLeads(initialLeads.slice(0, 5));
      setLoading(false);
    } else {
      crmApi.getLeads(0, 5)
        .then(setLeads)
        .catch(e => setError(e.message))
        .finally(() => setLoading(false));
    }
  }, [initialLeads]);


  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <h2 className={styles.title}>Recent Leads</h2>
        <button 
          type="button" 
          className={styles.viewAll}
          onClick={() => onNavigate?.('Leads')}
        >
          View all
        </button>
      </div>

      <div className={styles.table}>
        {loading && <div className={styles.stateMsg}>Loading leads…</div>}
        {error && <div className={styles.errorMsg}>⚠️ {error}</div>}
        {!loading && !error && leads.length === 0 && (
          <div className={styles.stateMsg}>No leads yet. Create your first lead!</div>
        )}
        {leads.map(lead => (
          <div key={lead.id} className={styles.row}>
            {/* Cell 1: Avatar + Name & Email Stack */}
            <div className={styles.nameCell}>
              <div className={styles.avatar}>
                {getInitials(lead.first_name, lead.last_name)}
              </div>
              <div className={styles.nameGroup}>
                <span className={styles.name}>{lead.first_name} {lead.last_name}</span>
                {lead.email && <span className={styles.emailText}>{lead.email}</span>}
              </div>
            </div>

            {/* Cell 2: Date */}
            <div className={styles.dateCell}>{formatDate(lead.created_at)}</div>

            {/* Cell 3: Status Badge */}
            <div className={styles.badgeCell}>
              <span className={`${styles.badge} ${
                lead.status === 'New' ? styles.badgeNew :
                lead.status === 'Contacted' ? styles.badgeContacted :
                styles.badgeQualified
              }`}>
                {lead.status}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
