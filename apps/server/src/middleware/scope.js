import mongoose from 'mongoose';
import { Machine } from '../models/Machine.js';
import { USER_ROLES } from '@predictive-maintenance/shared';

/**
 * Builds a Mongoose query filter scoped strictly to the user's factory and assigned equipment.
 */
export function buildMachineScopeFilter(user) {
  const factoryId = user.factoryId?._id || user.factoryId;

  // Factory Managers have access to all machines inside their factory
  if (user.role === USER_ROLES.FACTORY_MANAGER) {
    return { factoryId };
  }

  // Technicians and Viewers are strictly restricted to assigned machines
  const assignedIds = (user.assignedMachines || []).map((m) => m._id || m);

  return {
    factoryId,
    _id: { $in: assignedIds }
  };
}

/**
 * Middleware: Verifies that the requested machine belongs to the user's factory
 * and is assigned to the user if the user is a technician or viewer.
 *
 * CRITICAL SECURITY FEATURE:
 * If the machine exists in ANOTHER factory, this middleware returns 404 (Not Found)
 * to prevent leaking the existence of machines across factory boundaries.
 */
export async function requireMachineAccess(req, res, next) {
  try {
    const { codeOrId } = req.params;
    const userFactoryId = req.user.factoryId?._id?.toString() || req.user.factoryId?.toString();

    // Query by code (e.g. 'GB-104') or ObjectId
    let query = { code: codeOrId.toUpperCase() };
    if (mongoose.Types.ObjectId.isValid(codeOrId)) {
      query = { $or: [{ code: codeOrId.toUpperCase() }, { _id: codeOrId }] };
    }

    const machine = await Machine.findOne(query);

    // If machine does not exist OR belongs to a different factory: return 404
    if (!machine || machine.factoryId.toString() !== userFactoryId) {
      return res.status(404).json({
        error: 'NotFound',
        message: 'Requested machine not found within your factory scope.'
      });
    }

    // If user is a technician or viewer, check equipment assignment
    if (req.user.role !== USER_ROLES.FACTORY_MANAGER) {
      const assignedIds = (req.user.assignedMachines || []).map((m) =>
        (m._id || m).toString()
      );

      const hasAssignment = assignedIds.includes(machine._id.toString());
      if (!hasAssignment) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Access denied. You are not assigned to this machine specimen.',
          machineCode: machine.code
        });
      }
    }

    req.machine = machine;
    next();
  } catch (err) {
    console.error('[ScopeMiddleware] Error:', err);
    return res.status(500).json({
      error: 'InternalServerError',
      message: 'Failed to verify machine scope access.'
    });
  }
}

