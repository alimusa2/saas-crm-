import React, { useState, useEffect, useMemo } from 'react';
import styles from './ReportsPage.module.css';
import { reportsApi } from '../../lib/api';
import type { ReportsOverview } from '../../lib/api';
import {
  BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import {
  TrendingUp, DollarSign, Users, CheckSquare, Download, RefreshCw, Calendar, FileSpreadsheet, CreditCard
} from 'lucide-react';

const COLORS = ['#4F46E5', '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];

export const ReportsPage = () => {
  const [data, setData] = useState<ReportsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<string>('30days');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const overview = await reportsApi.getOverview();
      setData(overview);
    } catch (e: any) {
      setError(e.message || 'Failed to load reports overview.');
    } finally {
      setLoading(false);
    }
  };

  const handleExportCSV = () => {
    if (!data) return;
    setExporting(true);
    try {
      const csvRows = [
        ['Metric', 'Value'],
        ['Total Leads', data.total_leads],
        ['Total Revenue ($)', data.total_revenue],
        ['Pipeline Value ($)', data.pipeline_value],
        ['Tasks Completed', data.tasks_completed],
        ['Tasks Pending', data.tasks_pending],
        ['Paid Invoices', data.invoices_paid || 0],
        ['Pending Invoices', data.invoices_pending || 0],
        [],
        ['Lead Status', 'Count'],
        ...data.leads_by_status.map(l => [l.status, l.count]),
        [],
        ['Deal Status', 'Count', 'Value ($)'],
        ...data.deals_by_status.map(d => [d.status, d.count, d.value]),
        [],
        ['Lead Source', 'Count'],
        ...data.leads_by_source.map(s => [s.source, s.count]),
      ];

      const csvContent = 'data:text/csv;charset=utf-8,' + csvRows.map(e => e.join(',')).join('\n');
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement('a');
      link.setAttribute('href', encodedUri);
      link.setAttribute('download', `CRM_Performance_Report_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error('Failed to export report CSV:', err);
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.stateMsg}>
          <RefreshCw size={24} className="spin" style={{ animation: 'spin 1s linear infinite', marginBottom: 12 }} />
          <div>Aggregating CRM analytics and revenue reports…</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.container}>
        <div className={styles.errorMsg}>
          <p>Failed to load report analytics: {error}</p>
          <button className={styles.actionBtn} onClick={fetchData}>
            <RefreshCw size={14} /> Retry Loading
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const totalTasks = (data.tasks_completed || 0) + (data.tasks_pending || 0);
  const taskPct = totalTasks > 0 ? Math.round((data.tasks_completed / totalTasks) * 100) : 100;

  const statCards = [
    {
      label: 'Total Revenue',
      value: `$${(data.total_revenue || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      sub: `${data.invoices_paid || 0} Paid Invoices + Won Deals`,
      icon: <DollarSign size={22} />,
      color: '#10B981',
      bgColor: '#ECFDF5'
    },
    {
      label: 'Pipeline Value',
      value: `$${(data.pipeline_value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      sub: 'Active Pipeline Opportunities',
      icon: <TrendingUp size={22} />,
      color: '#3B82F6',
      bgColor: '#EFF6FF'
    },
    {
      label: 'Total Leads',
      value: (data.total_leads || 0).toLocaleString(),
      sub: `${data.leads_by_status.length} Active Lead Pipeline Stages`,
      icon: <Users size={22} />,
      color: '#4F46E5',
      bgColor: '#EEF2FF'
    },
    {
      label: 'Tasks Completed',
      value: `${data.tasks_completed || 0} / ${totalTasks}`,
      sub: `${taskPct}% Completion Rate`,
      icon: <CheckSquare size={22} />,
      color: '#F59E0B',
      bgColor: '#FEF3C7'
    },
  ];

  return (
    <div className={styles.container}>
      {/* Page Header Toolbar */}
      <div className={styles.header}>
        <div>
          <h1>Reports & Analytics</h1>
          <p className={styles.subtitle}>Comprehensive CRM revenue performance, lead acquisition, and task efficiency</p>
        </div>

        <div className={styles.actionsGroup}>
          <select
            className={styles.selectControl}
            value={timeRange}
            onChange={e => setTimeRange(e.target.value)}
          >
            <option value="7days">Last 7 Days</option>
            <option value="30days">Last 30 Days</option>
            <option value="90days">Last 90 Days</option>
            <option value="year">This Year</option>
            <option value="all">All Time</option>
          </select>

          <button type="button" className={styles.actionBtn} onClick={fetchData} title="Refresh analytics dataset">
            <RefreshCw size={14} /> Refresh
          </button>

          <button type="button" className={`${styles.actionBtn} ${styles.primaryBtn}`} onClick={handleExportCSV} disabled={exporting}>
            <FileSpreadsheet size={15} /> {exporting ? 'Exporting…' : 'Export CSV Report'}
          </button>
        </div>
      </div>

      {/* Stats KPI Grid */}
      <div className={styles.statsRow}>
        {statCards.map((card, i) => (
          <div key={i} className={styles.statCard}>
            <div className={styles.statIcon} style={{ background: card.bgColor, color: card.color }}>
              {card.icon}
            </div>
            <div>
              <div className={styles.statValue}>{card.value}</div>
              <div className={styles.statLabel}>{card.label}</div>
              <div className={styles.statSub}>{card.sub}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Analytics Charts Grid */}
      <div className={styles.chartsGrid}>
        {/* Leads by Status */}
        <div className={styles.chartCard}>
          <div className={styles.chartHeader}>
            <h3>Leads by Stage</h3>
            <span className={styles.chartBadge}>Conversion Funnel</span>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={data.leads_by_status} margin={{ top: 10, right: 20, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
              <XAxis dataKey="status" tick={{ fontSize: 12, fill: '#64748B' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: '#64748B' }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: '#1E293B', color: '#FFFFFF', borderRadius: '8px', border: 'none', fontSize: '12px' }}
                itemStyle={{ color: '#FFFFFF' }}
              />
              <Bar dataKey="count" fill="#4F46E5" radius={[6, 6, 0, 0]} name="Leads" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Deals by Status */}
        <div className={styles.chartCard}>
          <div className={styles.chartHeader}>
            <h3>Deals Value by Stage</h3>
            <span className={styles.chartBadge}>Pipeline Value</span>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={data.deals_by_status} margin={{ top: 10, right: 20, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
              <XAxis dataKey="status" tick={{ fontSize: 12, fill: '#64748B' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: '#64748B' }} axisLine={false} tickLine={false} />
              <Tooltip
                formatter={(v: any) => [`$${Number(v || 0).toLocaleString()}`, 'Pipeline Value']}
                contentStyle={{ background: '#1E293B', color: '#FFFFFF', borderRadius: '8px', border: 'none', fontSize: '12px' }}
                itemStyle={{ color: '#10B981' }}
              />
              <Bar dataKey="value" fill="#10B981" radius={[6, 6, 0, 0]} name="Value ($)" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Leads by Source */}
        <div className={styles.chartCard}>
          <div className={styles.chartHeader}>
            <h3>Lead Acquisition Channels</h3>
            <span className={styles.chartBadge}>Attribution</span>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={data.leads_by_source}
                dataKey="count"
                nameKey="source"
                cx="50%"
                cy="50%"
                innerRadius={55}
                outerRadius={90}
                paddingAngle={4}
                label={({ name, percent }: any) => `${name || ''} (${((percent || 0) * 100).toFixed(0)}%)`}
                labelLine={false}
              >
                {data.leads_by_source.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ background: '#1E293B', color: '#FFFFFF', borderRadius: '8px', border: 'none', fontSize: '12px' }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Task Completion Progress */}
        <div className={styles.chartCard}>
          <div className={styles.chartHeader}>
            <h3>Task Completion Efficiency</h3>
            <span className={styles.chartBadge}>Productivity</span>
          </div>
          <div className={styles.taskStats}>
            <div className={styles.taskRing}>
              <svg viewBox="0 0 100 100" className={styles.ringChart}>
                <circle cx="50" cy="50" r="40" fill="none" stroke="#F1F5F9" strokeWidth="12" />
                <circle
                  cx="50" cy="50" r="40" fill="none"
                  stroke="#10B981" strokeWidth="12"
                  strokeDasharray={`${(taskPct / 100) * 251.2} 251.2`}
                  strokeLinecap="round"
                  transform="rotate(-90 50 50)"
                />
              </svg>
              <div className={styles.ringLabel}>
                <span className={styles.ringPct}>{taskPct}%</span>
                <span className={styles.ringText}>Completed</span>
              </div>
            </div>

            <div className={styles.taskBreakdown}>
              <div className={styles.taskStat}>
                <span className={styles.dot} style={{ background: '#10B981' }} />
                <span>Completed Tasks: <strong>{data.tasks_completed}</strong></span>
              </div>
              <div className={styles.taskStat}>
                <span className={styles.dot} style={{ background: '#F59E0B' }} />
                <span>Pending Tasks: <strong>{data.tasks_pending}</strong></span>
              </div>
              <div className={styles.taskStat} style={{ marginTop: 8, fontSize: '13px', color: '#64748B' }}>
                <CreditCard size={15} style={{ color: '#4F46E5' }} />
                <span>Paid Invoices: <strong>{data.invoices_paid || 0}</strong></span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
