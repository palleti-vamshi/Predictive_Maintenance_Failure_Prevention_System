/**
 * Shared Design System Tokens
 * Industrial condition-monitoring palette with high-contrast, accessible status semantics.
 */
export const THEME_COLORS = Object.freeze({
  // Base backgrounds
  bgPrimary: '#0b1120',
  bgSurface: '#131d33',
  bgSurfaceElevated: '#1a2744',
  bgSurfaceSubtle: '#0f172a',
  bgInput: '#0a0f1d',

  // Borders
  borderSubtle: '#1e293b',
  borderStrong: '#334155',
  borderAccent: '#0284c7',

  // Typography
  textPrimary: '#f8fafc',
  textSecondary: '#94a3b8',
  textMuted: '#64748b',
  textAccent: '#38bdf8',

  // Functional Status Colors
  statusHealthy: '#10b981',
  statusHealthyBg: 'rgba(16, 185, 129, 0.12)',
  statusHealthyBorder: 'rgba(16, 185, 129, 0.35)',

  statusWarning: '#f59e0b',
  statusWarningBg: 'rgba(245, 158, 11, 0.12)',
  statusWarningBorder: 'rgba(245, 158, 11, 0.35)',

  statusCritical: '#f43f5e',
  statusCriticalBg: 'rgba(244, 63, 94, 0.12)',
  statusCriticalBorder: 'rgba(244, 63, 94, 0.35)',

  statusInfo: '#0ea5e9',
  statusInfoBg: 'rgba(14, 165, 233, 0.12)',
  statusInfoBorder: 'rgba(14, 165, 233, 0.35)',

  // Explicit Demo & Simulation Color
  statusDemo: '#a855f7',
  statusDemoBg: 'rgba(168, 85, 247, 0.14)',
  statusDemoBorder: 'rgba(168, 85, 247, 0.4)'
});

export const STATUS_LABELS = Object.freeze({
  HEALTHY: 'Healthy / Nominal',
  WARNING: 'Warning / Attention',
  CRITICAL: 'Critical / Action Required',
  INFO: 'Informational',
  DEMO: 'DEMO / SIMULATED'
});

