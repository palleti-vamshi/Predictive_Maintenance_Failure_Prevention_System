import React, { useState, useEffect, useCallback } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { RouterProvider, useRouter } from './router/Router.jsx';
import LoginPage from './pages/LoginPage.jsx';
import Shell from './components/layout/Shell.jsx';
import FactoryOverviewPage from './pages/FactoryOverviewPage.jsx';
import MachinesPage from './pages/MachinesPage.jsx';
import MachineDetailPage from './pages/MachineDetailPage.jsx';
import MaintenancePage from './pages/MaintenancePage.jsx';
import DatasetUploadPage from './pages/DatasetUploadPage.jsx';
import AnalysisResultsPage from './pages/AnalysisResultsPage.jsx';
import AlertsPage from './pages/AlertsPage.jsx';
import ResearchBenchmarkPage from './pages/ResearchBenchmarkPage.jsx';
import AuditTrailPage from './pages/AuditTrailPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import Icon from './components/common/Icon.jsx';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

function RouteSwitch({ apiStatus, onRefreshApi }) {
  const { routeKey } = useRouter();

  switch (routeKey) {
    case 'overview':
      return <FactoryOverviewPage />;
    case 'machines':
      return <MachinesPage />;
    case 'machine_detail':
      return <MachineDetailPage />;
    case 'maintenance':
      return <MaintenancePage />;
    case 'datasets':
      return <DatasetUploadPage />;
    case 'analysis':
      return <AnalysisResultsPage />;
    case 'alerts':
      return <AlertsPage />;
    case 'research':
      return <ResearchBenchmarkPage />;
    case 'audit':
      return <AuditTrailPage />;
    case 'settings':
      return <SettingsPage apiStatus={apiStatus} onRefreshApi={onRefreshApi} />;
    default:
      return <FactoryOverviewPage />;
  }
}

function AuthenticatedApp({ apiStatus, onRefreshApi }) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="session-loading-screen">
        <div className="session-loading-box">
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem' }}>
            <Icon name="brandMark" size={44} color="var(--primary)" />
          </div>
          <div className="session-loading-title">Verifying Factory Authentication...</div>
          <p className="session-loading-sub">Querying secure server session credentials</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return (
    <RouterProvider>
      <Shell apiStatus={apiStatus}>
        <RouteSwitch apiStatus={apiStatus} onRefreshApi={onRefreshApi} />
      </Shell>
    </RouterProvider>
  );
}

export default function App() {
  const [apiStatus, setApiStatus] = useState(null);

  const checkBackendHealth = useCallback(async () => {
    try {
      const url = API_BASE.endsWith('/health') ? API_BASE : `${API_BASE}/health`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setApiStatus(data);
      } else {
        setApiStatus(null);
      }
    } catch {
      setApiStatus(null);
    }
  }, []);

  useEffect(() => {
    checkBackendHealth();
  }, [checkBackendHealth]);

  return (
    <AuthProvider>
      <AuthenticatedApp apiStatus={apiStatus} onRefreshApi={checkBackendHealth} />
    </AuthProvider>
  );
}
