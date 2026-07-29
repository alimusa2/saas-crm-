import React, { useState, useEffect } from 'react';
import styles from './Sidebar.module.css';
import { 
  LayoutDashboard, Inbox, Users, UserCircle, Filter, 
  CheckSquare, Calendar, GitMerge, FileText, Mail, 
  Settings2, BarChart2, Star, DollarSign, Settings, 
  Grid, ChevronDown, MoreVertical, UserPlus
} from 'lucide-react';
import { useAuth } from '../../lib/AuthContext';
import { inboxApi } from '../../lib/api';

const NAV_ITEMS_BASE = [
  { icon: <LayoutDashboard size={18} />, label: 'Dashboard' },
  { icon: <Inbox size={18} />, label: 'Inbox', isInbox: true },
  { icon: <Users size={18} />, label: 'Leads' },
  { icon: <UserCircle size={18} />, label: 'Contacts' },
  { icon: <UserPlus size={18} />, label: 'Employees / Team' },
  { icon: <Filter size={18} />, label: 'Pipeline' },
  { icon: <CheckSquare size={18} />, label: 'Tasks' },
  { icon: <Calendar size={18} />, label: 'Calendar' },
  { icon: <GitMerge size={18} />, label: 'Funnels' },
  { icon: <FileText size={18} />, label: 'Forms' },
  { icon: <Mail size={18} />, label: 'Email Campaigns' },
  { icon: <Settings2 size={18} />, label: 'Automations' },
  { icon: <BarChart2 size={18} />, label: 'Reports' },
  { icon: <DollarSign size={18} />, label: 'Payments' },
  { icon: <Settings size={18} />, label: 'Settings' },
  { icon: <Grid size={18} />, label: 'Integrations' },
];

interface SidebarProps {
  isOpen: boolean;
  isCollapsed?: boolean;
  onClose: () => void;
  activeItem: string;
  onSelectItem: (item: string) => void;
  onToggleExpand?: () => void;
}

export const Sidebar = ({ isOpen, isCollapsed = false, onClose, activeItem, onSelectItem, onToggleExpand }: SidebarProps) => {
  const { user } = useAuth();
  const [unreadInboxCount, setUnreadInboxCount] = useState<number>(0);

  const firstName = (user?.first_name as string) ?? '';
  const lastName = (user?.last_name as string) ?? '';
  const email = (user?.email as string) ?? '';
  const displayName = [firstName, lastName].filter(Boolean).join(' ') || email || 'User';
  const initials = [(firstName[0] ?? ''), (lastName[0] ?? '')].filter(Boolean).join('').toUpperCase() || '?';

  const isAdmin = Boolean(user?.is_superuser || user?.role === 'Admin' || user?.role === 'Owner');
  const employeeAllowed = ['Dashboard', 'Inbox', 'Leads', 'Contacts', 'Pipeline', 'Tasks', 'Calendar', 'Settings'];

  const navItems = isAdmin 
    ? NAV_ITEMS_BASE 
    : NAV_ITEMS_BASE.filter(item => employeeAllowed.includes(item.label));

  // Real-time unread messages polling
  useEffect(() => {
    const fetchUnreadCount = async () => {
      try {
        const messages = await inboxApi.getMessages();
        if (Array.isArray(messages)) {
          const unread = messages.filter(m => (m as any).read_status === 'unread' || m.is_read === false).length;
          setUnreadInboxCount(unread);
        }
      } catch (err) {
        // Fallback silently if unauthenticated or error
      }
    };

    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <aside className={`${styles.sidebar} ${isOpen ? styles.open : ''} ${isCollapsed ? styles.collapsed : ''}`}>
      <div 
        className={styles.logoContainer}
        onClick={() => {
          if (isCollapsed && onToggleExpand) onToggleExpand();
        }}
        style={{ cursor: isCollapsed ? 'pointer' : 'default' }}
        title={isCollapsed ? "Click to expand sidebar" : undefined}
      >
        <div style={{width: 28, height: 28, backgroundColor: 'var(--primary-color)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0}}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M4 14l6-6 4 4 6-6"/></svg>
        </div>
        {!isCollapsed && <span>GrowthFlow</span>}
      </div>

      <div className={styles.workspaceSelector}>
        <div className={styles.workspaceInfo}>
          <div style={{width: 32, height: 32, backgroundColor: '#FFF5F5', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0}}>
             <div style={{width: 16, height: 16, backgroundColor: '#FF6B6B', borderRadius: '50%'}}></div>
          </div>
          {!isCollapsed && (
            <div>
              <div className={styles.workspaceName}>Acme Digital</div>
              <div className={styles.workspaceRole}>{isAdmin ? 'Workspace Admin' : 'Employee Portal'}</div>
            </div>
          )}
        </div>
        {!isCollapsed && <ChevronDown size={16} color="var(--text-secondary)" />}
      </div>

      <nav className={styles.nav}>
        {navItems.map((item, index) => {
          const badgeValue = item.isInbox ? unreadInboxCount : undefined;
          return (
            <div 
              key={index} 
              className={`${styles.navItem} ${activeItem === item.label ? styles.active : ''} ${isCollapsed ? styles.navItemCollapsed : ''}`}
              onClick={() => {
                onSelectItem(item.label);
                if (window.innerWidth <= 1024) onClose();
              }}
              title={isCollapsed ? item.label : undefined}
            >
              <div className={styles.navItemLeft}>
                {item.icon}
                {!isCollapsed && <span>{item.label}</span>}
              </div>
              {!isCollapsed && badgeValue !== undefined && badgeValue > 0 && (
                <span className={styles.badge}>{badgeValue}</span>
              )}
            </div>
          );
        })}
      </nav>

      {!isCollapsed && isAdmin && (
        <div className={styles.proPlan}>
          <div className={styles.proPlanTitle}>Pro Plan</div>
          <div className={styles.proPlanSubtitle}>Resets in 14 days</div>
          <div className={styles.progressBar}>
            <div className={styles.progressFill}></div>
          </div>
          <div className={styles.progressText}>3,250 / 10,000 emails</div>
          <button className={styles.upgradeBtn} onClick={() => alert('Upgrade clicked!')}>Upgrade Plan</button>
        </div>
      )}

      <div className={styles.userProfile}>
        <div className={styles.userInfo}>
          <div style={{ width: 32, height: 32, backgroundColor: 'var(--primary-color)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '12px', fontWeight: 700, flexShrink: 0 }}>
            {initials}
          </div>
          {!isCollapsed && (
            <div>
              <div className={styles.userName}>{displayName}</div>
              <div className={styles.userRole}>Owner</div>
            </div>
          )}
        </div>
        {!isCollapsed && <MoreVertical size={16} color="var(--text-secondary)" cursor="pointer" />}
      </div>
    </aside>
  );
};
