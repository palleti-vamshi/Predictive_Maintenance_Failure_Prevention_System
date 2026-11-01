import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const RouterContext = createContext(null);

export const ROUTES = Object.freeze({
  OVERVIEW: '#/',
  MACHINES: '#/machines',
  MACHINE_DETAIL: '#/machines/:id',
  MAINTENANCE: '#/maintenance',
  DATASETS_UPLOAD: '#/datasets/upload',
  ANALYSIS: '#/analysis',
  ALERTS: '#/alerts',
  RESEARCH: '#/research',
  SETTINGS: '#/settings'
});

export const NAV_ITEMS = Object.freeze([
  {
    key: 'overview',
    label: 'Overview',
    hash: ROUTES.OVERVIEW,
    icon: 'dashboard',
    description: 'Fleet condition & critical alerts'
  },
  {
    key: 'machines',
    label: 'Machines',
    hash: ROUTES.MACHINES,
    icon: 'machine',
    description: 'Transmission registry & kinematics'
  },
  {
    key: 'maintenance',
    label: 'Maintenance',
    hash: ROUTES.MAINTENANCE,
    icon: 'wrench',
    description: 'Lifecycle dispatch & work reports'
  },
  {
    key: 'alerts',
    label: 'Alerts & Anomalies',
    hash: ROUTES.ALERTS,
    icon: 'alert',
    description: 'Evidence-based alerts & actions'
  },
  {
    key: 'datasets',
    label: 'Dataset Ingestion',
    hash: ROUTES.DATASETS_UPLOAD,
    icon: 'dataset',
    description: 'Signal validation & profiling'
  },
  {
    key: 'analysis',
    label: 'Analysis & Trends',
    hash: ROUTES.ANALYSIS,
    icon: 'analysis',
    description: 'Multi-signal regime trends'
  },
  {
    key: 'research',
    label: 'Research Benchmark',
    hash: ROUTES.RESEARCH,
    icon: 'research',
    description: 'Reference datasets & evaluation'
  },
  {
    key: 'settings',
    label: 'Factory Scope',
    hash: ROUTES.SETTINGS,
    icon: 'settings',
    description: 'Access scopes & system config'
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
    // Separate path from query string: e.g. #/alerts?severity=critical -> [ '#/alerts', 'severity=critical' ]
    const [pathPart, queryPart] = hash.split('?');
    const queryParams = {};
    if (queryPart) {
      const searchParams = new URLSearchParams(queryPart);
      for (const [key, val] of searchParams.entries()) {
        queryParams[key] = val;
      }
    }

    // Check for machine detail pattern: #/machines/GB-104
    const machineMatch = pathPart.match(/^#\/machines\/([^/?]+)/);
    if (machineMatch) {
      return {
        routeKey: 'machine_detail',
        baseRoute: ROUTES.MACHINE_DETAIL,
        params: { id: decodeURIComponent(machineMatch[1]) },
        queryParams
      };
    }

    if (pathPart === ROUTES.MACHINES) return { routeKey: 'machines', baseRoute: ROUTES.MACHINES, params: {}, queryParams };
    if (pathPart === ROUTES.MAINTENANCE) return { routeKey: 'maintenance', baseRoute: ROUTES.MAINTENANCE, params: {}, queryParams };
    if (pathPart === ROUTES.DATASETS_UPLOAD) return { routeKey: 'datasets', baseRoute: ROUTES.DATASETS_UPLOAD, params: {}, queryParams };
    if (pathPart === ROUTES.ANALYSIS) return { routeKey: 'analysis', baseRoute: ROUTES.ANALYSIS, params: {}, queryParams };
    if (pathPart === ROUTES.ALERTS) return { routeKey: 'alerts', baseRoute: ROUTES.ALERTS, params: {}, queryParams };
    if (pathPart === ROUTES.RESEARCH) return { routeKey: 'research', baseRoute: ROUTES.RESEARCH, params: {}, queryParams };
    if (pathPart === ROUTES.SETTINGS) return { routeKey: 'settings', baseRoute: ROUTES.SETTINGS, params: {}, queryParams };

    // Default to Overview
    return { routeKey: 'overview', baseRoute: ROUTES.OVERVIEW, params: {}, queryParams };
  };

  const activeRouteInfo = parseRoute(currentHash);

  return (
    <RouterContext.Provider
      value={{
        currentHash,
        routeKey: activeRouteInfo.routeKey,
        params: activeRouteInfo.params,
        queryParams: activeRouteInfo.queryParams,
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

