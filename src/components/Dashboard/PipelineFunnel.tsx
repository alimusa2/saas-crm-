import React, { useEffect, useState } from 'react';
import styles from './PipelineFunnel.module.css';
import { ChevronDown } from 'lucide-react';
import { pipelineApi, type Deal, type Pipeline, type Stage } from '../../lib/api';

const COLORS = ['#8B5CF6', '#3B82F6', '#0EA5E9', '#10B981', '#F59E0B', '#F97316'];

interface PipelineFunnelProps {
  deals?: Deal[];
}

export const PipelineFunnel: React.FC<PipelineFunnelProps> = ({ deals: propDeals }) => {
  const [deals, setDeals] = useState<Deal[]>(propDeals || []);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadData() {
      try {
        const [dealsRes, pipelinesRes, stagesRes] = await Promise.all([
          propDeals ? Promise.resolve(propDeals) : pipelineApi.getDeals().catch(() => []),
          pipelineApi.getPipelines().catch(() => []),
          pipelineApi.getAllStages().catch(() => [])
        ]);

        if (!isMounted) return;
        setDeals(Array.isArray(dealsRes) ? dealsRes : []);
        setPipelines(Array.isArray(pipelinesRes) ? pipelinesRes : []);
        setStages(Array.isArray(stagesRes) ? stagesRes : []);
      } catch (err: any) {
        if (isMounted) setError(err.message || 'Failed to load pipeline data');
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadData();

    const interval = setInterval(loadData, 30000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [propDeals]);

  // Deduplicate pipeline list by ID and name for clean dropdown options
  const uniquePipelines = pipelines.filter((p, index, self) =>
    index === self.findIndex(t => t.id === p.id || t.name.trim().toLowerCase() === p.name.trim().toLowerCase())
  );

  // Filter deals based on selected pipeline ID
  const filteredDeals = deals.filter(d => {
    if (selectedPipelineId === 'all') return true;
    const stage = stages.find(s => s.id === d.stage_id);
    if (stage) {
      return stage.pipeline_id === selectedPipelineId;
    }
    return true;
  });

  // Calculate actual counts for each stage in the current selection
  const relevantStages = selectedPipelineId === 'all'
    ? stages
    : stages.filter(s => s.pipeline_id === selectedPipelineId);

  // Consolidate stages by unique stage name to prevent duplicate rows in the legend
  const uniqueStageMap: Record<string, { label: string; value: number }> = {};

  if (relevantStages.length > 0) {
    const sortedStages = [...relevantStages].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    sortedStages.forEach((stage) => {
      const label = stage.name;
      const count = filteredDeals.filter(d => d.stage_id === stage.id || d.status === stage.name).length;
      if (uniqueStageMap[label]) {
        uniqueStageMap[label].value += count;
      } else {
        uniqueStageMap[label] = { label, value: count };
      }
    });
  } else {
    filteredDeals.forEach(d => {
      const label = d.status || 'Lead';
      uniqueStageMap[label] = { label, value: (uniqueStageMap[label]?.value ?? 0) + 1 };
    });
  }

  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const stageItems = Object.values(uniqueStageMap);
  const totalValue = stageItems.reduce((acc, curr) => acc + curr.value, 0);
  const maxValue = Math.max(...stageItems.map(s => s.value), 1);

  // Dynamic stat-based color mapping: colors vary according to stats and stay strictly in sync
  const getStageStatColor = (label: string, value: number, index: number) => {
    const norm = label.toLowerCase().trim();
    let baseColor = COLORS[index % COLORS.length];

    if (norm.includes('won')) baseColor = '#10B981'; // Emerald Green
    else if (norm.includes('lost')) baseColor = '#F59E0B'; // Amber / Orange
    else if (norm.includes('proposal') || norm.includes('quote')) baseColor = '#0EA5E9'; // Sky Blue
    else if (norm.includes('contact') || norm.includes('meeting')) baseColor = '#3B82F6'; // Blue
    else if (norm.includes('lead') || norm.includes('new')) baseColor = '#8B5CF6'; // Purple
    else if (norm.includes('qualif') || norm.includes('discover')) baseColor = '#6366F1'; // Indigo

    if (value === 0) {
      // Zero-stat stages get a distinct slate-gray tone with lower opacity to vary clearly by stats
      return {
        color: '#94A3B8',
        opacity: 0.4,
        isZero: true
      };
    }

    // Scale color opacity/intensity proportional to stat strength (value / maxValue)
    const ratio = maxValue > 0 ? value / maxValue : 1;
    const opacity = Number((0.65 + ratio * 0.35).toFixed(2));

    return {
      color: baseColor,
      opacity,
      isZero: false
    };
  };

  const displayData = stageItems.map((item, i) => {
    const colorInfo = getStageStatColor(item.label, item.value, i);
    const percentage = totalValue > 0 ? Math.round((item.value / totalValue) * 100) : 0;
    return {
      ...item,
      ...colorInfo,
      percentage
    };
  });

  const widthTop = 200;
  const widthBottom = 60;
  const height = 240;
  const gap = 4;
  const segmentsCount = displayData.length || 1;
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
        <div className={styles.filterWrapper}>
          <select 
            value={selectedPipelineId} 
            onChange={(e) => setSelectedPipelineId(e.target.value)} 
            className={styles.filterSelect}
          >
            <option value="all">All Pipelines</option>
            {uniquePipelines.map(p => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <ChevronDown size={14} className={styles.selectArrow} />
        </div>
      </div>

      {loading && <div className={styles.stateMsg}>Loading pipeline…</div>}
      {error && <div className={styles.errorMsg}>⚠ {error}</div>}

      {!loading && !error && displayData.length === 0 && (
        <div className={styles.stateMsg}>No pipeline stages found.</div>
      )}

      {!loading && !error && displayData.length > 0 && (
        <div className={styles.content}>
          <svg viewBox="0 0 200 240" className={styles.funnelSvg}>
            {displayData.map((item, i) => (
              <g key={i}>
                <polygon
                  points={getPoints(i)}
                  fill={item.color}
                  fillOpacity={hoveredIndex === i ? 1 : item.opacity}
                  className={`${styles.polygonSegment} ${hoveredIndex === i ? styles.polygonActive : ''}`}
                  onMouseEnter={() => setHoveredIndex(i)}
                  onMouseLeave={() => setHoveredIndex(null)}
                  style={{
                    transform: hoveredIndex === i ? 'scale(1.02)' : 'scale(1)',
                    transformOrigin: 'center',
                    filter: hoveredIndex === i ? `drop-shadow(0 4px 12px ${item.color}80)` : 'none'
                  }}
                >
                  <title>{`${item.label}: ${item.value} deals (${item.percentage}%)`}</title>
                </polygon>
              </g>
            ))}
          </svg>

          <div className={styles.legend}>
            {displayData.map((item, i) => (
              <div
                key={i}
                className={`${styles.legendItem} ${hoveredIndex === i ? styles.legendItemActive : ''}`}
                onMouseEnter={() => setHoveredIndex(i)}
                onMouseLeave={() => setHoveredIndex(null)}
                style={{
                  backgroundColor: hoveredIndex === i ? `${item.color}15` : 'transparent',
                  borderColor: hoveredIndex === i ? `${item.color}40` : 'transparent'
                }}
              >
                <div className={styles.legendLeft}>
                  <div
                    className={styles.legendDot}
                    style={{
                      backgroundColor: item.color,
                      opacity: item.opacity,
                      transform: hoveredIndex === i ? 'scale(1.3)' : 'scale(1)',
                      boxShadow: hoveredIndex === i ? `0 0 8px ${item.color}` : 'none'
                    }}
                  />
                  <span className={styles.legendLabel}>{item.label}</span>
                </div>
                <div className={styles.legendRight}>
                  <span className={styles.legendPercentage}>({item.percentage}%)</span>
                  <span
                    className={styles.legendValue}
                    style={{ color: item.isZero ? '#94A3B8' : 'inherit' }}
                  >
                    {item.value}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};





