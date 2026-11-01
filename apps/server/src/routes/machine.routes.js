import { Router } from 'express';
import { Machine } from '../models/Machine.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireMachineAccess, buildMachineScopeFilter } from '../middleware/scope.js';
import { requireTechnicianOrManager } from '../middleware/authorize.js';

const router = Router();

// All machine routes require authentication
router.use(authenticate);

/**
 * GET /api/machines
 * Returns machines strictly scoped to the user's factory and assigned equipment.
 * - Factory Manager: All machines within their factory
 * - Technician & Viewer: Only assigned machines within their factory
 */
router.get('/', async (req, res) => {
  try {
    const scopeFilter = buildMachineScopeFilter(req.user);
    const machines = await Machine.find(scopeFilter)
      .populate('siteId', 'name code')
      .populate('factoryId', 'name code')
      .sort({ code: 1 });

    return res.status(200).json({
      count: machines.length,
      machines
    });
  } catch (err) {
    console.error('[MachineRoute:List] Error:', err);
    return res.status(500).json({
      error: 'InternalServerError',
      message: 'Failed to retrieve scoped machine list.'
    });
  }
});

/**
 * GET /api/machines/:codeOrId
 * Retrieves single machine profile.
 * Handled by requireMachineAccess:
 * - Returns 404 if machine does not exist OR is in another factory (no cross-factory leaking).
 * - Returns 403 if technician/viewer is not assigned.
 */
router.get('/:codeOrId', requireMachineAccess, async (req, res) => {
  return res.status(200).json({
    machine: req.machine
  });
});

/**
 * POST /api/machines/:codeOrId/notes
 * Adds a field maintenance note to the machine record.
 * - Requires Manager or assigned Technician role.
 * - Viewers are rejected with 403 Forbidden.
 */
router.post(
  '/:codeOrId/notes',
  requireTechnicianOrManager,
  requireMachineAccess,
  async (req, res) => {
    try {
      const { content, category } = req.body;

      if (!content || !content.trim()) {
        return res.status(400).json({
          error: 'BadRequest',
          message: 'Note content is required.'
        });
      }

      const note = {
        author: `${req.user.fullName} (${req.user.role})`,
        authorId: req.user._id,
        category: category || 'Field Observation',
        content: content.trim(),
        timestamp: new Date()
      };

      req.machine.notes.unshift(note);
      await req.machine.save();

      return res.status(201).json({
        success: true,
        message: 'Maintenance note recorded successfully.',
        note: req.machine.notes[0],
        machineCode: req.machine.code
      });
    } catch (err) {
      console.error('[MachineRoute:AddNote] Error:', err);
      return res.status(500).json({
        error: 'InternalServerError',
        message: 'Failed to record maintenance note.'
      });
    }
  }
);

export default router;

