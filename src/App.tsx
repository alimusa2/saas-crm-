import React, { useState } from 'react';
import { Layout } from './components/Layout/Layout';
import { DashboardPage } from './components/Dashboard/DashboardPage';
import { LoginPage } from './components/Auth/LoginPage';
import { AuthProvider, useAuth } from './lib/AuthContext';

// Original page components
import { LeadsPage } from './components/Dashboard/LeadsPage';
import { TasksPage } from './components/Dashboard/TasksPage';
import { PipelinePage } from './components/Dashboard/PipelinePage';
import { FormsPage } from './components/Dashboard/FormsPage';
import { FunnelsPage } from './components/Dashboard/FunnelsPage';


// New page components
import { InboxPage } from './components/Dashboard/InboxPage';
import { ContactsPage } from './components/Dashboard/ContactsPage';
import { CalendarPage } from './components/Dashboard/CalendarPage';
import { AutomationsPage } from './components/Dashboard/AutomationsPage';
import { ReportsPage } from './components/Dashboard/ReportsPage';
import { PaymentsPage } from './components/Dashboard/PaymentsPage';
import { SettingsPage } from './components/Dashboard/SettingsPage';
import { IntegrationsPage } from './components/Dashboard/IntegrationsPage';
import { TeamPage } from './components/Dashboard/TeamPage';
import { CampaignsPage } from './components/Dashboard/CampaignsPage';



function AppContent() {
  const { user, isLoggedIn, loading } = useAuth();
  const isAdmin = Boolean(user?.is_superuser || user?.role === 'Admin' || user?.role === 'Owner');

  const [activeTab, setActiveTab] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('oauth') === 'gmail' || window.location.pathname.includes('/settings')) {
      return 'Settings';
    }
    return 'Dashboard';
  });

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'Inter, sans-serif', color: '#6B7280' }}>
        Loading GrowthOS…
      </div>
    );
  }

  if (!isLoggedIn) {
    return <LoginPage />;
  }

  const renderContent = () => {
    // Role-based Route Protection
    const adminOnlyTabs = ['Team', 'Employees', 'Employees / Team', 'Employee Performance', 'Automations', 'Email Campaigns', 'Reports', 'Integrations'];
    if (!isAdmin && adminOnlyTabs.includes(activeTab)) {
      return (
        <div style={{ padding: '60px 24px', textAlign: 'center', fontFamily: 'Inter, sans-serif' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>🔒</div>
          <h2 style={{ fontSize: '22px', fontWeight: 700, color: '#1E293B', marginBottom: '8px' }}>403 Forbidden - Access Restricted</h2>
          <p style={{ color: '#64748B', fontSize: '14px', maxWidth: '460px', margin: '0 auto 24px', lineHeight: 1.5 }}>
            This administrative module is restricted. Your employee portal account does not have permission to view or manage this section.
          </p>
          <button 
            onClick={() => setActiveTab('Dashboard')}
            style={{ padding: '10px 20px', backgroundColor: 'var(--primary-color)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}
          >
            Return to My Dashboard
          </button>
        </div>
      );
    }

    switch (activeTab) {
      case 'Dashboard':
        return <DashboardPage onNavigate={setActiveTab} />;
      case 'Inbox':
        return <InboxPage />;
      case 'Leads':
        return <LeadsPage />;
      case 'Contacts':
        return <ContactsPage />;
      case 'Team':
      case 'Employees':
      case 'Employees / Team':
      case 'Employee Performance':
        return <TeamPage />;

      case 'Pipeline':
        return <PipelinePage />;
      case 'Tasks':
        return <TasksPage />;
      case 'Calendar':
        return <CalendarPage />;
      case 'Funnels':
        return <FunnelsPage />;
      case 'Forms':
        return <FormsPage />;
      case 'Email Campaigns':
        return <CampaignsPage />;
      case 'Automations':
        return <AutomationsPage />;
      case 'Reports':
        return <ReportsPage />;
      case 'Payments':
        return <PaymentsPage />;
      case 'Settings':
        return <SettingsPage />;
      case 'Integrations':
        return <IntegrationsPage />;
      default:
        return (
          <div style={{ padding: '24px', fontFamily: 'Inter, sans-serif' }}>
            <h2 style={{ fontSize: '20px', fontWeight: 600 }}>{activeTab} Page</h2>
            <p style={{ color: '#6B7280', marginTop: '8px', fontSize: '14px' }}>This section is currently under development.</p>
          </div>
        );
    }
  };

  return (
    <Layout activeItem={activeTab} onSelectItem={setActiveTab}>
      {renderContent()}
    </Layout>
  );
}

import { PublicFormPage } from './components/Dashboard/PublicFormPage';
import { PublicFunnelPage } from './components/Dashboard/PublicFunnelPage';

function App() {
  const path = window.location.pathname;
  if (path.startsWith('/f/')) {
    const formId = path.split('/f/')[1];
    return <PublicFormPage formId={formId} />;
  }
  if (path.startsWith('/funnel/') || path.startsWith('/funnels/')) {
    const funnelId = path.startsWith('/funnel/') ? path.split('/funnel/')[1] : path.split('/funnels/')[1];
    return <PublicFunnelPage funnelId={funnelId} />;
  }

  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;
