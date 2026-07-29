import React from 'react';
import styles from './QuickActions.module.css';
import { UserPlus, CalendarPlus, CheckSquare, Mail, Filter, Zap } from 'lucide-react';

const actions = [
  { id: 1, label: 'Create Lead', icon: <UserPlus size={20} />, bgColor: '#F3E8FF', color: '#9333EA' },
  { id: 2, label: 'Schedule Appointment', icon: <CalendarPlus size={20} />, bgColor: '#E0F2FE', color: '#0284C7' },
  { id: 3, label: 'Create Task', icon: <CheckSquare size={20} />, bgColor: '#DCFCE7', color: '#16A34A' },
  { id: 4, label: 'Send Email', icon: <Mail size={20} />, bgColor: '#FEF3C7', color: '#D97706' },
  { id: 5, label: 'Build Funnel', icon: <Filter size={20} />, bgColor: '#F5F3FF', color: '#7C3AED' },
  { id: 6, label: 'New Automation', icon: <Zap size={20} />, bgColor: '#FEE2E2', color: '#DC2626' },
];

export const QuickActions = () => {
  return (
    <div className={styles.card}>
      <h2 className={styles.title}>Quick Actions</h2>
      <div className={styles.grid}>
        {actions.map(action => (
          <button key={action.id} className={styles.actionBtn}>
            <div className={styles.iconWrapper} style={{ backgroundColor: action.bgColor, color: action.color }}>
              {action.icon}
            </div>
            <span className={styles.label}>{action.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
};
