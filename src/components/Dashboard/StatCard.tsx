import React from 'react';
import styles from './StatCard.module.css';
import { ArrowUp, ArrowDown } from 'lucide-react';
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
}

export const StatCard = ({
  title, value, trend, subtitle, icon, iconBgColor, iconColor, chartData, chartColor
}: StatCardProps) => {
  const isUp = trend >= 0;
  const data = chartData.map((val, i) => ({ name: i, value: val }));

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <div className={styles.iconWrapper} style={{ backgroundColor: iconBgColor, color: iconColor }}>
          {icon}
        </div>
        <div className={styles.title}>{title}</div>
      </div>
      
      <div className={styles.valueContainer}>
        <div className={styles.valueRow}>
          <div className={styles.value}>{value}</div>
          <div className={`${styles.trend} ${isUp ? styles.up : styles.down}`}>
            {isUp ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
            {Math.abs(trend)}%
          </div>
        </div>
        <div className={styles.subtitle}>{subtitle}</div>
      </div>

      <div className={styles.chart}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <Line 
              type="monotone" 
              dataKey="value" 
              stroke={chartColor} 
              strokeWidth={2} 
              dot={false} 
              isAnimationActive={false} 
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
