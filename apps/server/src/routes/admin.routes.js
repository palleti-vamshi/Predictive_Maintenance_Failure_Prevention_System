import { Router } from 'express';
import { User } from '../models/User.js';
import { Machine } from '../models/Machine.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireManager } from '../middleware/authorize.js';

const router = Router();

// All admin routes require authentication and factory_manager role
router.use(authenticate);
router.use(requireManager);

/**
 * GET /api/admin/factory-users
 * Lists user accounts belonging exclusively to the authenticated manager's factory.
 * Accessible only by factory_manager.
 */
router.get('/factory-users', async (req, res) => {
  try {
    const factoryId = req.user.factoryId?._id || req.user.factoryId;
    const users = await User.find({ factoryId })
      .populate('assignedMachines', 'code name status')
      .populate('assignedSites', 'name code')
      .sort({ fullName: 1 });

    return res.status(200).json({
      factoryId,
      count: users.length,
      users: users.map((u) => u.toJSON())
    });
  } catch (err) {
    console.error('[AdminRoute:FactoryUsers] Error:', err);
    return res.status(500).json({
      error: 'InternalServerError',
      message: 'Failed to retrieve factory users.'
    });
  }
});

/**
 * GET /api/admin/factory-summary
 * Summary metrics of factory assets and users.
 */
router.get('/factory-summary', async (req, res) => {
  try {
    const factoryId = req.user.factoryId?._id || req.user.factoryId;
    const userCount = await User.countDocuments({ factoryId });
    const machineCount = await Machine.countDocuments({ factoryId });

    return res.status(200).json({
      factoryId,
      metrics: {
        totalUsers: userCount,
        totalMachines: machineCount
      }
    });
  } catch (err) {
    console.error('[AdminRoute:Summary] Error:', err);
    return res.status(500).json({
      error: 'InternalServerError',
      message: 'Failed to retrieve factory summary.'
    });
  }
});

export default router;

