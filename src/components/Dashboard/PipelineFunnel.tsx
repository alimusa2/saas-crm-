import React, { useEffect, useState } from 'react';
import styles from './PipelineFunnel.module.css';
import { ChevronDown } from 'lucide-react';
import { pipelineApi } from '../../lib/api';
import type { Deal } from '../../lib/api';


const COLORS = ['#8B5CF6', '#3B82F6', '#0EA5E9', '#10B981', '#F59E0B', '#F97316'];

interface PipelineFunnelProps {
  deals?: Deal[];
}

export const PipelineFunnel: React.FC<PipelineFunnelProps> = ({ deals: propDeals }) => {
  const [deals, setDeals] = useState<Deal[]>(propDeals || []);
  const [loading, setLoading] = useState(!propDeals);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (propDeals) {
      setDeals(propDeals);
      setLoading(false);
    } else {
      const fetchDeals = () => {
        pipelineApi.getDeals()
          .then(setDeals)
          .catch(e => setError(e.message))
          .finally(() => setLoading(false));
      };

      fetchDeals();
      const interval = setInterval(fetchDeals, 30000);
      return () => clearInterval(interval);
    }
  }, [propDeals]);


  // Group deals by status to build funnel segments
  const statusGroups: Record<string, number> = {};
  deals.forEach(d => {
    statusGroups[d.status] = (statusGroups[d.status] ?? 0) + 1;
  });
  const funnelData = Object.entries(statusGroups).map(([label, value], i) => ({
    label,
    value,
    color: COLORS[i % COLORS.length],
  }));

  // Fall back to a placeholder when no real data yet
  const displayData = funnelData.length > 0
    ? funnelData
    : [
        { label: 'New Lead', value: 0, color: '#8B5CF6' },
        { label: 'Contacted', value: 0, color: '#3B82F6' },
        { label: 'Proposal', value: 0, color: '#10B981' },
        { label: 'Won', value: 0, color: '#F97316' },
      ];

  const widthTop = 200;
  const widthBottom = 60;
  const height = 240;
  const gap = 4;
  const segmentsCount = displayData.length;
  const segmentHeight = (height - gap * (segmentsCount - 1)) / segmentsCount;

  const getPoints = (index: number) => {
    const yTop = index * (segmentHeight + gap);
    const yBottom = yTop + segmentHeight;
    const wTop = widthTop - ((widthTop - widthBottom) / height) * yTop;
    const wBottom = widthTop - ((widthTop - widthBottom) / height) * yBottom;
    const xTopLeft = (widthTop - wTop) / 2;
    const xTopRight = xTopLeft + wTop;
    const xBottomLeft = (widthTop - wBottom) / 2;
    const xBottomRight = xBottomLeft + wBottom;
    return `${xTopLeft},${yTop} ${xTopRight},${yTop} ${xBottomRight},${yBottom} ${xBottomLeft},${yBottom}`;
  };

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <h2 className={styles.title}>Pipeline Overview</h2>
        <button className={styles.filterBtn}>
          Sales Pipeline
          <ChevronDown size={14} />
        </button>
      </div>

      {loading && <div className={styles.stateMsg}>Loading pipeline…</div>}
      {error && <div className={styles.errorMsg}>⚠ {error}</div>}

      {!loading && !error && (
        <div className={styles.content}>
          <svg viewBox="0 0 200 240" className={styles.funnelSvg}>
            {displayData.map((item, i) => (
              <polygon key={i} points={getPoints(i)} fill={item.color} />
            ))}
          </svg>

          <div className={styles.legend}>
            {displayData.map((item, i) => (
              <div key={i} className={styles.legendItem}>
                <div className={styles.legendLeft}>
                  <div className={styles.legendDot} style={{ backgroundColor: item.color }} />
                  {item.label}
                </div>
                <div className={styles.legendValue}>{item.value}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

