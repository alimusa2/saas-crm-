import React from 'react';
import styles from './StatCard.module.css';
import { ArrowUp, ArrowDown, ArrowUpRight } from 'lucide-react';
import { LineChart, Line, ResponsiveContainer } from 'recharts';

export interface StatCardProps {
  title: string;
  value: string;
  trend: number;
  subtitle: string;
  icon: React.ReactNode;
  iconBgColor: string;
  iconColor: string;
  chartData: number[];
  chartColor: string;
  isPrimary?: boolean;
  onClick?: () => void;
}

export const StatCard = ({
  title, value, trend, subtitle, icon, iconBgColor, iconColor, chartData, chartColor, isPrimary = false, onClick
}: StatCardProps) => {
  const isUp = trend >= 0;
  const data = chartData.map((val, i) => ({ name: i, value: val }));

  return (
    <div 
      className={`${styles.card} ${isPrimary ? styles.primaryCard : ''}`}
      onClick={onClick}
      style={{ cursor: onClick ? 'pointer' : 'default' }}
      title={onClick ? `View ${title}` : undefined}
    >
      <div className={styles.topRow}>
        <div className={styles.header}>
          <div className={styles.iconWrapper} style={{ 
            backgroundColor: isPrimary ? 'rgba(255, 255, 255, 0.2)' : iconBgColor, 
            color: isPrimary ? '#FFFFFF' : iconColor 
          }}>
            {icon}
          </div>
          <div className={`${styles.title} ${isPrimary ? styles.primaryText : ''}`}>{title}</div>
        </div>
        <div 
          className={`${styles.actionBtn} ${isPrimary ? styles.primaryActionBtn : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onClick?.();
          }}
          title="Open module"
        >
          <ArrowUpRight size={16} />
        </div>
      </div>
      
      <div className={styles.valueContainer}>
        <div className={styles.valueRow}>
          <div className={`${styles.value} ${isPrimary ? styles.primaryValue : ''}`}>{value}</div>
          <div className={`${styles.trend} ${isPrimary ? styles.primaryTrend : (isUp ? styles.up : styles.down)}`}>
            {isUp ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
            {Math.abs(trend)}%
          </div>
        </div>
        <div className={`${styles.subtitle} ${isPrimary ? styles.primarySubtitle : ''}`}>{subtitle}</div>
      </div>

      <div className={styles.chart}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <Line 
              type="monotone" 
              dataKey="value" 
              stroke={isPrimary ? '#FFFFFF' : chartColor} 
              strokeWidth={2.5} 
              dot={false} 
              isAnimationActive={false} 
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

