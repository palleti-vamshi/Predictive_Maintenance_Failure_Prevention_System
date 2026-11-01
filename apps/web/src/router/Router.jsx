import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const RouterContext = createContext(null);

export const ROUTES = Object.freeze({
  OVERVIEW: '#/',
  MACHINES: '#/machines',
  MACHINE_DETAIL: '#/machines/:id',
  DATASETS_UPLOAD: '#/datasets/upload',
  ANALYSIS: '#/analysis',
  ALERTS: '#/alerts',
  RESEARCH: '#/research',
  SETTINGS: '#/settings'
});

export const NAV_ITEMS = Object.freeze([
  {
    key: 'overview',
    label: 'Factory Overview',
    hash: ROUTES.OVERVIEW,
    icon: '📊',
    description: 'Plant status & machine fleet summary'
  },
  {
    key: 'machines',
    label: 'Machines & Profiles',
    hash: ROUTES.MACHINES,
    icon: '⚙️',
    description: 'Gearbox registry & stage specifications'
  },
  {
    key: 'datasets',
    label: 'Dataset Ingestion',
    hash: ROUTES.DATASETS_UPLOAD,
    icon: '📁',
    description: 'CSV upload, column mapping & validation'
  },
  {
    key: 'analysis',
    label: 'Analysis & Trends',
    hash: ROUTES.ANALYSIS,
    icon: '📈',
    description: 'Vibration & thermal condition trends'
  },
  {
    key: 'alerts',
    label: 'Alerts & Maintenance',
    hash: ROUTES.ALERTS,
    icon: '🚨',
    description: 'Explainable alerts & field technician notes'
  },
  {
    key: 'research',
    label: 'Research Benchmark',
    hash: ROUTES.RESEARCH,
    icon: '🔬',
    description: 'Method comparison & sensitivity explorer'
  },
  {
    key: 'settings',
    label: 'Factory & Access Scope',
    hash: ROUTES.SETTINGS,
    icon: '🏢',
    description: 'Factory scopes, user roles & API config'
  }
]);

export function RouterProvider({ children }) {
  // Normalize current hash
  const getInitialHash = () => {
    const hash = window.location.hash;
    return hash && hash.startsWith('#/') ? hash : '#/';
  };

  const [currentHash, setCurrentHash] = useState(getInitialHash);

  useEffect(() => {
    const handleHashChange = () => {
      const h = window.location.hash;
      setCurrentHash(h && h.startsWith('#/') ? h : '#/');
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const navigate = useCallback((targetHash) => {
    const formatted = targetHash.startsWith('#') ? targetHash : `#${targetHash}`;
    window.location.hash = formatted;
  }, []);

  // Parse route and parameters
  const parseRoute = (hash) => {
    // Check for machine detail pattern: #/machines/GB-104
    const machineMatch = hash.match(/^#\/machines\/([^/?]+)/);
    if (machineMatch) {
      return {
        routeKey: 'machine_detail',
        baseRoute: ROUTES.MACHINE_DETAIL,
        params: { id: decodeURIComponent(machineMatch[1]) }
      };
    }

    if (hash === ROUTES.MACHINES) return { routeKey: 'machines', baseRoute: ROUTES.MACHINES, params: {} };
    if (hash === ROUTES.DATASETS_UPLOAD) return { routeKey: 'datasets', baseRoute: ROUTES.DATASETS_UPLOAD, params: {} };
    if (hash === ROUTES.ANALYSIS) return { routeKey: 'analysis', baseRoute: ROUTES.ANALYSIS, params: {} };
    if (hash === ROUTES.ALERTS) return { routeKey: 'alerts', baseRoute: ROUTES.ALERTS, params: {} };
    if (hash === ROUTES.RESEARCH) return { routeKey: 'research', baseRoute: ROUTES.RESEARCH, params: {} };
    if (hash === ROUTES.SETTINGS) return { routeKey: 'settings', baseRoute: ROUTES.SETTINGS, params: {} };

    // Default to Overview
    return { routeKey: 'overview', baseRoute: ROUTES.OVERVIEW, params: {} };
  };

  const activeRouteInfo = parseRoute(currentHash);

  return (
    <RouterContext.Provider
      value={{
        currentHash,
        routeKey: activeRouteInfo.routeKey,
        params: activeRouteInfo.params,
        navigate
      }}
    >
      {children}
    </RouterContext.Provider>
  );
}

export function useRouter() {
  const context = useContext(RouterContext);
  if (!context) {
    throw new Error('useRouter must be used within a RouterProvider');
  }
  return context;
}

