import React, { useEffect, useState } from 'react';
import styles from './LeadsOverviewChart.module.css';
import { ChevronDown } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { crmApi, type Lead } from '../../lib/api';

interface LeadsOverviewChartProps {
  leads?: Lead[];
}

export const LeadsOverviewChart: React.FC<LeadsOverviewChartProps> = ({ leads: propLeads }) => {
  const [chartData, setChartData] = useState<{ name: string; leads: number }[]>([]);

  useEffect(() => {
    const processLeads = (leads: Lead[]) => {
      const daysMap: Record<string, number> = {};
      const dates: { dateStr: string; label: string }[] = [];
      
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];
        const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        dates.push({ dateStr, label });
        daysMap[dateStr] = 0;
      }

      (leads || []).forEach(lead => {
        if (lead.created_at) {
          const dStr = lead.created_at.split('T')[0];
          if (daysMap[dStr] !== undefined) {
            daysMap[dStr] += 1;
          }
        }
      });

      const formatted = dates.map(item => ({
        name: item.label,
        leads: daysMap[item.dateStr] || 0
      }));
      setChartData(formatted);
    };

    if (propLeads) {
      processLeads(propLeads);
    } else {
      crmApi.getLeads(0, 500)
        .then(processLeads)
        .catch(() => setChartData([]));
    }
  }, [propLeads]);


  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <h2 className={styles.title}>Leads Overview</h2>
        <button className={styles.filterBtn}>
          Last 7 Days
          <ChevronDown size={14} />
        </button>
      </div>
      
      <div className={styles.chartContainer}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={chartData}
            margin={{ top: 10, right: 0, left: -20, bottom: 0 }}
          >
            <defs>
              <linearGradient id="colorLeads" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--primary-color)" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="var(--primary-color)" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
            <XAxis 
              dataKey="name" 
              axisLine={false} 
              tickLine={false} 
              tick={{ fontSize: 12, fill: 'var(--text-secondary)' }}
              dy={10}
            />
            <YAxis 
              axisLine={false} 
              tickLine={false} 
              tick={{ fontSize: 12, fill: 'var(--text-secondary)' }}
              allowDecimals={false}
            />
            <Tooltip 
              contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
            />
            <Area 
              type="monotone" 
              dataKey="leads" 
              stroke="var(--primary-color)" 
              strokeWidth={3}
              fillOpacity={1} 
              fill="url(#colorLeads)" 
              activeDot={{ r: 6, strokeWidth: 0, fill: 'var(--primary-color)' }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
