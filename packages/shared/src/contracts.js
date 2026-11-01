/**
 * API paths and contracts shared across web, mobile, and backend.
 */
export const API_ROUTES = Object.freeze({
  HEALTH: '/api/health',
  LIVENESS: '/api/liveness',
  AUTH: {
    LOGIN: '/api/auth/login',
    ME: '/api/auth/me'
  },
  MACHINES: '/api/machines',
  DATASETS: '/api/datasets',
  ALERTS: '/api/alerts',
  MAINTENANCE: '/api/maintenance'
});

export const DATABASE_STATUS = Object.freeze({
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  ERROR: 'error'
});

