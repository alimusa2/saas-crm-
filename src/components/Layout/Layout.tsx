import React, { useState, useEffect, useRef } from 'react';
import styles from './Layout.module.css';
import { Sidebar } from '../Sidebar/Sidebar';
import { Header } from '../Header/Header';

interface LayoutProps {
  children: React.ReactNode;
  activeItem: string;
  onSelectItem: (item: string) => void;
}

export const Layout = ({ children, activeItem, onSelectItem }: LayoutProps) => {
  const [isSidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [isMobileOpen, setMobileOpen] = useState(false);

  const handleSelectItem = (item: string) => {
    onSelectItem(item);
    if (window.innerWidth <= 1024) {
      setMobileOpen(false);
    } else if (isSidebarCollapsed) {
      // Expand sidebar when clicking on a component item (HubSpot style)
      setSidebarCollapsed(false);
    }
  };

  const toggleSidebar = () => {
    if (window.innerWidth <= 1024) {
      setMobileOpen(!isMobileOpen);
    } else {
      setSidebarCollapsed(!isSidebarCollapsed);
    }
  };

  return (
    <div className={styles.layout}>
      <Sidebar 
        isOpen={isMobileOpen} 
        isCollapsed={isSidebarCollapsed}
        onClose={() => setMobileOpen(false)} 
        activeItem={activeItem}
        onSelectItem={handleSelectItem}
        onToggleExpand={() => setSidebarCollapsed(!isSidebarCollapsed)}
      />
      
      {/* Overlay for mobile sidebar */}
      {isMobileOpen && (
        <div className={styles.overlay} onClick={() => setMobileOpen(false)}></div>
      )}

      <div className={`${styles.mainContent} ${isSidebarCollapsed ? styles.collapsed : ''}`}>
        <Header onMenuClick={toggleSidebar} onSelectItem={handleSelectItem} compact={activeItem === 'funnels'} />
        <main className={styles.pageContent}>
          {children}
        </main>
      </div>
    </div>
  );
};
