import { Router } from 'express';
import { User } from '../models/User.js';
import { Machine } from '../models/Machine.js';
import { MaintenanceWorkOrder } from '../models/MaintenanceWorkOrder.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireManager } from '../middleware/authorize.js';
import { WORK_ORDER_STATUS } from '@predictive-maintenance/shared';

const router = Router();

// All admin routes require authentication and factory_manager role
router.use(authenticate);
router.use(requireManager);

/**
 * GET /api/admin/factory-users
 * Lists user accounts belonging exclusively to the authenticated manager's factory.
 * Includes technician skills, availability, and active workload counts.
 */
router.get('/factory-users', async (req, res) => {
  try {
    const factoryId = req.user.factoryId?._id || req.user.factoryId;
    const users = await User.find({ factoryId })
      .populate('assignedMachines', 'code name status')
      .populate('assignedSites', 'name code')
      .sort({ fullName: 1 });

    const activeTasksByTech = await MaintenanceWorkOrder.aggregate([
      {
        $match: {
          factoryId,
          status: { $nin: [WORK_ORDER_STATUS.COMPLETED, WORK_ORDER_STATUS.REVIEWED] }
        }
      },
      {
        $group: {
          _id: '$assignedTechnicianId',
          count: { $sum: 1 }
        }
      }
    ]);

    const workloadMap = {};
    activeTasksByTech.forEach((t) => {
      workloadMap[t._id.toString()] = t.count;
    });

    const enrichedUsers = users.map((u) => {
      const json = u.toJSON();
      const openCount = workloadMap[u._id.toString()] || 0;
      return {
        ...json,
        activeWorkload: openCount,
        availabilityStatus: openCount === 0 ? 'available' : openCount < 3 ? 'assigned' : 'high_workload'
      };
    });

    return res.status(200).json({
      factoryId,
      count: enrichedUsers.length,
      users: enrichedUsers
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

