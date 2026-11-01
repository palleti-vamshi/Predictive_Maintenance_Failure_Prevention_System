import { Router } from 'express';
import mongoose from 'mongoose';
import { Alert } from '../models/Alert.js';
import { Machine } from '../models/Machine.js';
import { User } from '../models/User.js';
import { MaintenanceWorkOrder } from '../models/MaintenanceWorkOrder.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireManager } from '../middleware/authorize.js';
import {
  ALERT_STATUSES,
  ALERT_SEVERITIES,
  WORK_ORDER_STATUS,
  WORK_ORDER_PRIORITY,
  USER_ROLES
} from '@predictive-maintenance/shared';

const router = Router();

// All alert routes require authentication
router.use(authenticate);

/**
 * GET /api/alerts
 * Lists alerts scoped to user's factory.
 * Query filters: machineId, severity, status, analysisRunId.
 */
router.get('/', async (req, res) => {
  try {
    const userFactoryId = (req.user.factoryId?._id || req.user.factoryId).toString();
    const { machineId, severity, status, analysisRunId } = req.query;

    const query = { factoryId: userFactoryId };

    if (machineId) {
      query.machineId = machineId;
    }
    if (severity) {
      query.severity = severity;
    }
    if (status) {
      query.status = status;
    }
    if (analysisRunId) {
      query.analysisRunId = analysisRunId;
    }

    // Role scoping: Technicians and Viewers can only view alerts for assigned machines
    if (req.user.role !== USER_ROLES.FACTORY_MANAGER) {
      const assignedMachineIds = (req.user.assignedMachines || []).map((m) => m._id || m);
      if (query.machineId) {
        if (!assignedMachineIds.map((id) => id.toString()).includes(query.machineId.toString())) {
          return res.status(403).json({
            error: 'Forbidden',
            message: 'Access denied. You do not have permissions for this machine.'
          });
        }
      } else {
        query.machineId = { $in: assignedMachineIds };
      }
    }

    const alerts = await Alert.find(query)
      .populate('machineId', 'code name status operationalStatus')
      .populate('datasetId', 'title datasetType')
      .populate('analysisRunId', 'modelName modelType status createdAt')
      .populate('maintenanceWorkOrderId', 'orderNumber status priority')
      .sort({ createdAt: -1 });

    return res.status(200).json({
      count: alerts.length,
      alerts
    });
  } catch (err) {
    console.error('[AlertRoute:List] Error:', err);
    return res.status(500).json({
      error: 'InternalServerError',
      message: 'Failed to retrieve alerts.'
    });
  }
});

/**
 * GET /api/alerts/:id
 * Retrieves full evidence-based alert record with SHAP attributions and trend excerpts.
 */
router.get('/:id', async (req, res) => {
  try {
    const userFactoryId = (req.user.factoryId?._id || req.user.factoryId).toString();
    const alert = await Alert.findById(req.params.id)
      .populate('machineId', 'code name status operationalStatus arrangement stages')
      .populate('datasetId', 'title datasetType columns checksumSha256')
      .populate('analysisRunId', 'modelName modelType modelVersion summary configuration')
      .populate('modelArtifactId', 'name modelType version metrics')
      .populate('maintenanceWorkOrderId', 'orderNumber status priority dueDate assignedTechnicianId')
      .populate('technicianObservations.technicianId', 'fullName role')
      .populate('acknowledgedById', 'fullName role');

    if (!alert || alert.factoryId.toString() !== userFactoryId) {
      return res.status(404).json({
        error: 'NotFound',
        message: 'Alert not found within your factory scope.'
      });
    }

    // Role-based machine access check
    if (req.user.role !== USER_ROLES.FACTORY_MANAGER) {
      const assignedMachineIds = (req.user.assignedMachines || []).map((m) => (m._id || m).toString());
      if (!assignedMachineIds.includes(alert.machineId?._id?.toString())) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Access denied. You do not have permissions for this machine.'
        });
      }
    }

    return res.status(200).json({ alert });
  } catch (err) {
    console.error('[AlertRoute:GetById] Error:', err);
    return res.status(500).json({
      error: 'InternalServerError',
      message: 'Failed to retrieve alert.'
    });
  }
});

/**
 * POST /api/alerts/:id/acknowledge
 * Technicians or Managers acknowledge an open alert.
 * Leaves the original analysis run and baseline metrics immutable.
 */
router.post('/:id/acknowledge', async (req, res) => {
  try {
    if (req.user.role === USER_ROLES.VIEWER) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Viewers have read-only access and cannot acknowledge alerts.'
      });
    }

    const userFactoryId = (req.user.factoryId?._id || req.user.factoryId).toString();
    const alert = await Alert.findById(req.params.id);

    if (!alert || alert.factoryId.toString() !== userFactoryId) {
      return res.status(404).json({
        error: 'NotFound',
        message: 'Alert not found within your factory scope.'
      });
    }

    if (alert.status === ALERT_STATUSES.ACKNOWLEDGED) {
      return res.status(200).json({
        message: 'Alert is already acknowledged.',
        alert
      });
    }

    alert.status = ALERT_STATUSES.ACKNOWLEDGED;
    alert.acknowledgedAt = new Date();
    alert.acknowledgedById = req.user._id;
    alert.acknowledgedByName = req.user.fullName;

    await alert.save();

    return res.status(200).json({
      success: true,
      message: 'Alert acknowledged.',
      alert
    });
  } catch (err) {
    console.error('[AlertRoute:Acknowledge] Error:', err);
    return res.status(500).json({
      error: 'InternalServerError',
      message: 'Failed to acknowledge alert.'
    });
  }
});

/**
 * POST /api/alerts/:id/observations
 * Technicians or Managers log field observation notes on an alert.
 * Appends to technicianObservations array without altering baseline analysis outputs.
 */
router.post('/:id/observations', async (req, res) => {
  try {
    if (req.user.role === USER_ROLES.VIEWER) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Viewers have read-only access and cannot record observations.'
      });
    }

    const { note } = req.body;
    if (!note || typeof note !== 'string' || !note.trim()) {
      return res.status(400).json({
        error: 'ValidationError',
        message: 'Observation note text is required.'
      });
    }

    const userFactoryId = (req.user.factoryId?._id || req.user.factoryId).toString();
    const alert = await Alert.findById(req.params.id);

    if (!alert || alert.factoryId.toString() !== userFactoryId) {
      return res.status(404).json({
        error: 'NotFound',
        message: 'Alert not found within your factory scope.'
      });
    }

    alert.technicianObservations.push({
      technicianId: req.user._id,
      technicianName: req.user.fullName,
      note: note.trim(),
      loggedAt: new Date()
    });

    await alert.save();

    return res.status(200).json({
      success: true,
      message: 'Technician observation note recorded.',
      alert
    });
  } catch (err) {
    console.error('[AlertRoute:Observations] Error:', err);
    return res.status(500).json({
      error: 'InternalServerError',
      message: 'Failed to add technician observation note.'
    });
  }
});

/**
 * POST /api/alerts/:id/work-order
 * Explicitly creates a MaintenanceWorkOrder from an evidence-based alert.
 * Enforces manager role, factory scoping, and technician-machine assignment.
 */
router.post('/:id/work-order', requireManager, async (req, res) => {
  try {
    const userFactoryId = (req.user.factoryId?._id || req.user.factoryId).toString();
    const { title, description, priority, dueDate, assignedTechnicianId } = req.body;

    const alert = await Alert.findById(req.params.id);
    if (!alert || alert.factoryId.toString() !== userFactoryId) {
      return res.status(404).json({
        error: 'NotFound',
        message: 'Alert not found within your factory scope.'
      });
    }

    if (alert.maintenanceWorkOrderId) {
      return res.status(400).json({
        error: 'BadRequest',
        message: 'A maintenance work order has already been created for this alert.'
      });
    }

    if (!title || !description || !dueDate || !assignedTechnicianId) {
      return res.status(400).json({
        error: 'ValidationError',
        message: 'title, description, dueDate, and assignedTechnicianId are required.'
      });
    }

    const machine = await Machine.findById(alert.machineId);
    if (!machine) {
      return res.status(404).json({
        error: 'NotFound',
        message: 'Machine associated with this alert was not found.'
      });
    }

    // 1. Verify assigned technician exists, belongs to same factory, and has technician role
    const technician = await User.findById(assignedTechnicianId);
    if (!technician || technician.factoryId.toString() !== userFactoryId) {
      return res.status(400).json({
        error: 'BadRequest',
        message: 'Assigned technician does not exist or belongs to another factory.'
      });
    }

    if (technician.role !== USER_ROLES.TECHNICIAN) {
      return res.status(400).json({
        error: 'BadRequest',
        message: 'Work orders can only be assigned to users with the technician role.'
      });
    }

    // 2. Verify technician has access to the machine
    const isAssigned = (technician.assignedMachines || []).some(
      (m) => (m._id || m).toString() === machine._id.toString()
    );

    if (!isAssigned) {
      return res.status(400).json({
        error: 'BadRequest',
        message: `Technician "${technician.fullName}" must be assigned to machine "${machine.code}" before receiving a work order.`
      });
    }

    // 3. Generate Order Number
    const orderNumber = `WO-${machine.code}-${Date.now().toString().slice(-4)}`;

    // 4. Create MaintenanceWorkOrder
    const workOrder = await MaintenanceWorkOrder.create({
      factoryId: userFactoryId,
      machineId: machine._id,
      orderNumber,
      title: title.trim(),
      description: description.trim(),
      priority: priority || WORK_ORDER_PRIORITY.HIGH,
      status: WORK_ORDER_STATUS.OPEN,
      dueDate: new Date(dueDate),
      assignedTechnicianId: technician._id,
      createdById: req.user._id,
      sourceAlertId: alert._id,
      sourceAnalysisRunId: alert.analysisRunId,
      statusHistory: [
        {
          status: WORK_ORDER_STATUS.OPEN,
          changedById: req.user._id,
          changedByName: req.user.fullName,
          changedByRole: req.user.role,
          timestamp: new Date(),
          note: `Work order created from Alert: ${alert.title}`
        }
      ]
    });

    // 5. Link Alert to Work Order
    alert.maintenanceWorkOrderId = workOrder._id;
    await alert.save();

    // 6. Append note to machine history
    machine.notes.unshift({
      author: `${req.user.fullName} (${req.user.role})`,
      authorId: req.user._id,
      category: 'Work Order Created from Alert',
      content: `Created [${orderNumber}] "${title}" from alert "${alert.title}" (Assigned: ${technician.fullName}).`,
      timestamp: new Date()
    });
    await machine.save();

    const populatedWorkOrder = await MaintenanceWorkOrder.findById(workOrder._id)
      .populate('machineId', 'code name status')
      .populate('assignedTechnicianId', 'fullName email role')
      .populate('createdById', 'fullName role');

    return res.status(201).json({
      success: true,
      message: `Work order "${orderNumber}" created and linked to alert.`,
      workOrder: populatedWorkOrder
    });
  } catch (err) {
    console.error('[AlertRoute:CreateWorkOrder] Error:', err);
    return res.status(500).json({
      error: 'InternalServerError',
      message: err.message || 'Failed to create work order from alert.'
    });
  }
});

export default router;

