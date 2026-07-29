import React, { useState } from 'react';
import styles from './ActiveAutomationsWidget.module.css';
import { FormInput, Mail, Clock, Send, Users, ArrowRight } from 'lucide-react';

const workflow = [
  { id: 1, title: 'New Lead (Form)', type: 'Trigger', icon: <FormInput size={16} />, bgColor: '#EFF6FF', color: '#3B82F6' },
  { id: 2, title: 'Send Welcome Email', type: 'Action', icon: <Mail size={16} />, bgColor: '#F5F3FF', color: '#8B5CF6' },
  { id: 3, title: 'Wait 1 Day', type: 'Delay', icon: <Clock size={16} />, bgColor: '#ECFDF5', color: '#10B981' },
  { id: 4, title: 'Follow Up Email', type: 'Action', icon: <Send size={16} />, bgColor: '#EFF6FF', color: '#3B82F6' },
  { id: 5, title: 'Add to Pipeline', type: 'Action', icon: <Users size={16} />, bgColor: '#F5F3FF', color: '#8B5CF6' },
];

export const ActiveAutomationsWidget = () => {
  const [isActive, setIsActive] = useState(true);

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <h2 className={styles.title}>Active Automations</h2>
        <a href="#" className={styles.viewAll}>View all</a>
      </div>

      <div className={styles.workflow}>
        {workflow.map((node, index) => (
          <React.Fragment key={node.id}>
            <div className={styles.node}>
              <div className={styles.iconWrapper} style={{ backgroundColor: node.bgColor, color: node.color }}>
                {node.icon}
              </div>
              <div className={styles.nodeContent}>
                <span className={styles.nodeTitle}>{node.title}</span>
                <span className={styles.nodeType}>{node.type}</span>
              </div>
            </div>
            {index < workflow.length - 1 && (
              <ArrowRight size={16} className={styles.arrow} />
            )}
          </React.Fragment>
        ))}
        
        <ArrowRight size={16} className={styles.arrow} />
        <div 
          className={`${styles.toggle} ${isActive ? styles.toggleActive : ''}`}
          onClick={() => setIsActive(!isActive)}
        >
          <div className={`${styles.toggleDot} ${isActive ? styles.dotActive : ''}`}></div>
        </div>
      </div>

      <div className={styles.footer}>
        <div className={styles.footerLeft}>
          <div className={`${styles.status} ${!isActive ? styles.statusInactive : ''}`}>
            <div className={`${styles.statusDot} ${!isActive ? styles.dotInactive : ''}`}></div>
            {isActive ? 'Active' : 'Inactive'}
          </div>
          <div>Last run: 2 minutes ago</div>
        </div>
        <div>
          Executed <span className={styles.executed}>124 times</span>
        </div>
      </div>
    </div>
  );
};
