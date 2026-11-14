import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { searchOperationalRecords } from '../services/operationalSearch.service.js';

const router = Router();

// All search endpoints require authentication
router.use(authenticate);

/**
 * GET /api/search
 * Natural language / scoped text search across operational records:
 * machines, alerts, work orders, datasets, and analysis runs.
 *
 * Query params:
 *   q: search string
 *   type: 'all' | 'machines' | 'alerts' | 'workOrders' | 'datasets' | 'analysisRuns'
 */
router.get('/', async (req, res) => {
  try {
    const q = req.query.q || '';
    const type = req.query.type || 'all';
    const status = req.query.status || null;
    const machineCode = req.query.machineCode || null;
    const dateFrom = req.query.dateFrom || null;
    const dateTo = req.query.dateTo || null;

    const results = await searchOperationalRecords(req.user, String(q), String(type), {
      status,
      machineCode,
      dateFrom,
      dateTo
    });

    return res.status(200).json({
      success: true,
      ...results
    });
  } catch (err) {
    console.error('[SearchRoute] Error:', err);
    return res.status(500).json({
      error: 'InternalServerError',
      message: 'Failed to execute operational search.'
    });
  }
});

export default router;

