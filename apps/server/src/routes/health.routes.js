import { Router } from 'express';
import { getDatabaseHealth } from '../config/database.js';

const router = Router();

/**
 * Liveness probe: quick check that Express is actively accepting traffic.
 */
router.get('/liveness', (req, res) => {
  res.status(200).json({
    live: true,
    service: 'predictive-maintenance-server',
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

/**
 * Health check: comprehensive server health status distinguishing API reachability from database connectivity.
 * Safe for public diagnostic calls; does not leak secrets or credentials.
 */
router.get('/health', (req, res) => {
  const dbHealth = getDatabaseHealth();
  const isDbConnected = Boolean(dbHealth.hasActiveConnection);

  res.status(200).json({
    status: isDbConnected ? 'healthy' : 'degraded',
    api: {
      status: 'healthy',
      reachable: true,
      service: 'AI-Based Predictive Maintenance System API',
      version: '0.1.0',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString()
    },
    database: {
      status: dbHealth.status,
      connected: isDbConnected,
      readyStateLabel: dbHealth.readyStateLabel,
      hasActiveConnection: isDbConnected,
      databaseName: dbHealth.databaseName,
      host: dbHealth.host,
      note: isDbConnected
        ? 'MongoDB connected and operational.'
        : 'MongoDB is offline or unreachable. The API server remains reachable in degraded mode.'
    },
    service: 'AI-Based Predictive Maintenance System API',
    version: '0.1.0',
    phase: 'Phase 1 - Project Foundation Scaffold',
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    capabilities: {
      webClientSupported: true,
      mobileClientSupported: true,
      targetMachine: 'Industrial Gearbox',
      fileStorageMode: 'local-disk'
    }
  });
});

export default router;

