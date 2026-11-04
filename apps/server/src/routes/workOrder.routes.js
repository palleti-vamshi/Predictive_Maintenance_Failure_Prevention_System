import { Router } from 'express';
import { MaintenanceWorkOrder } from '../models/MaintenanceWorkOrder.js';
import { Machine } from '../models/Machine.js';
import { User } from '../models/User.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireManager } from '../middleware/authorize.js';
import { WORK_ORDER_STATUS, USER_ROLES } from '@predictive-maintenance/shared';

const router = Router();

// All work order routes require authentication
router.use(authenticate);

/**
 * GET /api/work-orders/eligible-technicians
 * Returns technicians belonging to this factory with their skills, availability, and active workload count.
 */
router.get('/eligible-technicians', async (req, res) => {
  try {
    const factoryId = req.user.factoryId?._id || req.user.factoryId;
    const technicians = await User.find({
      factoryId,
      role: USER_ROLES.TECHNICIAN,
      isActive: true
    })
      .populate('assignedMachines', 'code name status')
      .sort({ fullName: 1 });

    // Calculate active workload (non-completed work orders) for each technician
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

    const result = technicians.map((tech) => {
      const json = tech.toJSON();
      const openCount = workloadMap[tech._id.toString()] || 0;
      return {
        ...json,
        activeWorkload: openCount,
        availabilityStatus: openCount === 0 ? 'available' : openCount < 3 ? 'assigned' : 'high_workload'
      };
    });

    return res.status(200).json({
      count: result.length,
      technicians: result
    });
  } catch (err) {
    console.error('[WorkOrderRoute:EligibleTechnicians] Error:', err);
    return res.status(500).json({
      error: 'InternalServerError',
      message: 'Failed to retrieve eligible technicians.'
    });
  }
});

/**
 * GET /api/work-orders/my-tasks
 * Fast endpoint for logged-in technician to view all tasks assigned to them.
 */
router.get('/my-tasks', async (req, res) => {
  try {
    const factoryId = req.user.factoryId?._id || req.user.factoryId;
    const workOrders = await MaintenanceWorkOrder.find({
      factoryId,
      assignedTechnicianId: req.user._id
    })
      .populate('machineId', 'code name status operationalStatus arrangement')
      .populate('createdById', 'fullName role')
      .sort({ dueDate: 1, createdAt: -1 });

    return res.status(200).json({
      count: workOrders.length,
      workOrders
    });
  } catch (err) {
    console.error('[WorkOrderRoute:MyTasks] Error:', err);
    return res.status(500).json({
      error: 'InternalServerError',
      message: 'Failed to retrieve assigned maintenance work orders.'
    });
  }
});

/**
 * GET /api/work-orders
 * Lists factory-wide work orders. Accessible to managers, or filtered for technicians.
 */
router.get('/', async (req, res) => {
  try {
    const factoryId = req.user.factoryId?._id || req.user.factoryId;
    const { status, priority, machineCode } = req.query;

    const query = { factoryId };

    // Technicians only see their assigned work orders or machines they have access to
    if (req.user.role === USER_ROLES.TECHNICIAN) {
      const assignedMachineIds = (req.user.assignedMachines || []).map((m) => m._id || m);
      query.$or = [
        { assignedTechnicianId: req.user._id },
        { machineId: { $in: assignedMachineIds } }
      ];
    } else if (req.user.role === USER_ROLES.VIEWER) {
      const assignedMachineIds = (req.user.assignedMachines || []).map((m) => m._id || m);
      query.machineId = { $in: assignedMachineIds };
    }

    if (status) {
      query.status = status;
    }
    if (priority) {
      query.priority = priority;
    }

    if (machineCode) {
      const machine = await Machine.findOne({ factoryId, code: machineCode.toUpperCase() });
      if (machine) {
        query.machineId = machine._id;
      }
    }

    const workOrders = await MaintenanceWorkOrder.find(query)
      .populate('machineId', 'code name status operationalStatus arrangement')
      .populate('assignedTechnicianId', 'fullName email role')
      .populate('createdById', 'fullName role')
      .populate('reviewedById', 'fullName role')
      .populate('sourceAlertId', 'title severity status type triggerValue message notes')
      .sort({ dueDate: 1, createdAt: -1 });

    return res.status(200).json({
      count: workOrders.length,
      workOrders
    });
  } catch (err) {
    console.error('[WorkOrderRoute:List] Error:', err);
    return res.status(500).json({
      error: 'InternalServerError',
      message: 'Failed to retrieve maintenance work orders.'
    });
  }
});

/**
 * GET /api/work-orders/:orderId
 * Retrieves detailed work order record with full status history and feedback.
 */
router.get('/:orderId', async (req, res) => {
  try {
    const factoryId = (req.user.factoryId?._id || req.user.factoryId).toString();
    const workOrder = await MaintenanceWorkOrder.findById(req.params.orderId)
      .populate('machineId', 'code name status operationalStatus arrangement stages bearingPositions lubrication')
      .populate('assignedTechnicianId', 'fullName email role')
      .populate('createdById', 'fullName role')
      .populate('reviewedById', 'fullName role')
      .populate('sourceAlertId', 'title severity status type triggerValue message notes');

    if (!workOrder || workOrder.factoryId.toString() !== factoryId) {
      return res.status(404).json({
        error: 'NotFound',
        message: 'Work order not found within your factory scope.'
      });
    }

    // Technicians & Viewers: Verify permission
    if (req.user.role !== USER_ROLES.FACTORY_MANAGER) {
      const isAssignedTech = workOrder.assignedTechnicianId?._id?.toString() === req.user._id.toString();
      const hasMachineAssignment = (req.user.assignedMachines || []).some(
        (m) => (m._id || m).toString() === workOrder.machineId?._id?.toString()
      );

      if (!isAssignedTech && !hasMachineAssignment) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Access denied. You are not assigned to this work order or machine.'
        });
      }
    }

    return res.status(200).json({ workOrder });
  } catch (err) {
    console.error('[WorkOrderRoute:GetById] Error:', err);
    return res.status(500).json({
      error: 'InternalServerError',
      message: 'Failed to retrieve work order.'
    });
  }
});

/**
 * PATCH /api/work-orders/:orderId/status
 * Updates work order status with audit log and feedback notes.
 * - Technicians can transition: accepted, in_progress, completed (with findings/work performed/follow-up).
 * - Only Managers can review/close a work order (reviewed).
 * - Viewers cannot modify work orders (403).
 */
router.patch('/:orderId/status', async (req, res) => {
  try {
    if (req.user.role === USER_ROLES.VIEWER) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Viewer accounts have read-only access and cannot modify work orders.'
      });
    }

    const factoryId = (req.user.factoryId?._id || req.user.factoryId).toString();
    const workOrder = await MaintenanceWorkOrder.findById(req.params.orderId);

    if (!workOrder || workOrder.factoryId.toString() !== factoryId) {
      return res.status(404).json({
        error: 'NotFound',
        message: 'Work order not found within your factory scope.'
      });
    }

    const { status, note, findings, workPerformed, followUpNeeded } = req.body;

    if (!status || !Object.values(WORK_ORDER_STATUS).includes(status)) {
      return res.status(400).json({
        error: 'BadRequest',
        message: `Invalid status. Must be one of: ${Object.values(WORK_ORDER_STATUS).join(', ')}`
      });
    }

    // Role-specific constraints
    if (req.user.role === USER_ROLES.TECHNICIAN) {
      // Must be the assigned technician
      if (workOrder.assignedTechnicianId.toString() !== req.user._id.toString()) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'You can only update status for work orders assigned directly to you.'
        });
      }

      // Technicians cannot mark as reviewed/closed
      if (status === WORK_ORDER_STATUS.REVIEWED) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Only a Factory Manager can perform final review and closure of a work order.'
        });
      }
    }

    // Update technician feedback when provided
    if (findings || workPerformed || followUpNeeded) {
      workOrder.technicianFeedback = {
        findings: findings?.trim() || workOrder.technicianFeedback?.findings || '',
        workPerformed: workPerformed?.trim() || workOrder.technicianFeedback?.workPerformed || '',
        followUpNeeded: followUpNeeded?.trim() || workOrder.technicianFeedback?.followUpNeeded || '',
        submittedAt: new Date()
      };
    }

    // Status-specific timestamps
    if (status === WORK_ORDER_STATUS.COMPLETED && !workOrder.completedAt) {
      workOrder.completedAt = new Date();
    }

    if (status === WORK_ORDER_STATUS.REVIEWED) {
      workOrder.reviewedAt = new Date();
      workOrder.reviewedById = req.user._id;
      if (note) {
        workOrder.reviewNotes = note.trim();
      }
    }

    workOrder.status = status;

    // Record in immutable status history audit log
    workOrder.statusHistory.push({
      status,
      changedById: req.user._id,
      changedByName: req.user.fullName,
      changedByRole: req.user.role,
      timestamp: new Date(),
      note: note?.trim() || `Status updated to ${status}`
    });

    await workOrder.save();

    // Also append an entry to the machine's maintenance notes if completed or reviewed
    if (status === WORK_ORDER_STATUS.COMPLETED || status === WORK_ORDER_STATUS.REVIEWED) {
      const machine = await Machine.findById(workOrder.machineId);
      if (machine) {
        machine.notes.unshift({
          author: `${req.user.fullName} (${req.user.role})`,
          authorId: req.user._id,
          category: status === WORK_ORDER_STATUS.REVIEWED ? 'Manager Review' : 'Work Order Completed',
          content: `[${workOrder.orderNumber}] ${workOrder.title} — ${note || workPerformed || 'Status updated to ' + status}`,
          timestamp: new Date()
        });
        await machine.save();
      }
    }

    return res.status(200).json({
      success: true,
      message: `Work order status updated to "${status}".`,
      workOrder
    });
  } catch (err) {
    console.error('[WorkOrderRoute:UpdateStatus] Error:', err);
    return res.status(500).json({
      error: 'InternalServerError',
      message: 'Failed to update work order status.'
    });
  }
});

/**
 * POST /api/work-orders/:orderId/request-parts
 * Technician requests spare parts, transitioning status to WAITING_FOR_PARTS.
 */
router.post('/:orderId/request-parts', async (req, res) => {
  try {
    const factoryId = (req.user.factoryId?._id || req.user.factoryId).toString();
    const workOrder = await MaintenanceWorkOrder.findById(req.params.orderId);

    if (!workOrder || workOrder.factoryId.toString() !== factoryId) {
      return res.status(404).json({ error: 'NotFound', message: 'Work order not found.' });
    }

    if (req.user.role === USER_ROLES.TECHNICIAN && workOrder.assignedTechnicianId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Forbidden', message: 'Only the assigned technician can request parts.' });
    }

    const { reason } = req.body;
    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: 'BadRequest', message: 'Reason for parts request is required.' });
    }

    workOrder.status = WORK_ORDER_STATUS.WAITING_FOR_PARTS;
    workOrder.approvalRequest = {
      requestType: 'parts',
      reason: reason.trim(),
      requestedAt: new Date(),
      requestedById: req.user._id,
      requestedByName: req.user.fullName,
      status: 'pending'
    };

    workOrder.statusHistory.push({
      status: WORK_ORDER_STATUS.WAITING_FOR_PARTS,
      changedById: req.user._id,
      changedByName: req.user.fullName,
      changedByRole: req.user.role,
      timestamp: new Date(),
      note: `Requested parts: ${reason.trim()}`
    });

    await workOrder.save();

    return res.status(200).json({
      success: true,
      message: 'Parts request submitted. Status updated to Waiting for parts.',
      workOrder
    });
  } catch (err) {
    console.error('[WorkOrderRoute:RequestParts] Error:', err);
    return res.status(500).json({ error: 'InternalServerError', message: 'Failed to submit parts request.' });
  }
});

/**
 * POST /api/work-orders/:orderId/request-approval
 * Technician requests permission to proceed, transitioning status to WAITING_FOR_APPROVAL.
 */
router.post('/:orderId/request-approval', async (req, res) => {
  try {
    const factoryId = (req.user.factoryId?._id || req.user.factoryId).toString();
    const workOrder = await MaintenanceWorkOrder.findById(req.params.orderId);

    if (!workOrder || workOrder.factoryId.toString() !== factoryId) {
      return res.status(404).json({ error: 'NotFound', message: 'Work order not found.' });
    }

    if (req.user.role === USER_ROLES.TECHNICIAN && workOrder.assignedTechnicianId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Forbidden', message: 'Only the assigned technician can request permission.' });
    }

    const { reason } = req.body;
    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: 'BadRequest', message: 'Reason for permission request is required.' });
    }

    workOrder.status = WORK_ORDER_STATUS.WAITING_FOR_APPROVAL;
    workOrder.approvalRequest = {
      requestType: 'permission',
      reason: reason.trim(),
      requestedAt: new Date(),
      requestedById: req.user._id,
      requestedByName: req.user.fullName,
      status: 'pending'
    };

    workOrder.statusHistory.push({
      status: WORK_ORDER_STATUS.WAITING_FOR_APPROVAL,
      changedById: req.user._id,
      changedByName: req.user.fullName,
      changedByRole: req.user.role,
      timestamp: new Date(),
      note: `Requested permission: ${reason.trim()}`
    });

    await workOrder.save();

    return res.status(200).json({
      success: true,
      message: 'Permission request submitted. Status updated to Waiting for approval.',
      workOrder
    });
  } catch (err) {
    console.error('[WorkOrderRoute:RequestApproval] Error:', err);
    return res.status(500).json({ error: 'InternalServerError', message: 'Failed to submit permission request.' });
  }
});

/**
 * POST /api/work-orders/:orderId/decision
 * Manager approves or rejects a parts/permission request.
 */
router.post('/:orderId/decision', requireManager, async (req, res) => {
  try {
    const factoryId = (req.user.factoryId?._id || req.user.factoryId).toString();
    const workOrder = await MaintenanceWorkOrder.findById(req.params.orderId);

    if (!workOrder || workOrder.factoryId.toString() !== factoryId) {
      return res.status(404).json({ error: 'NotFound', message: 'Work order not found.' });
    }

    const { decision, decisionNote } = req.body;
    if (!['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({ error: 'BadRequest', message: 'Decision must be "approved" or "rejected".' });
    }

    if (workOrder.approvalRequest) {
      workOrder.approvalRequest.status = decision;
      workOrder.approvalRequest.decisionNote = decisionNote?.trim() || '';
      workOrder.approvalRequest.decidedAt = new Date();
      workOrder.approvalRequest.decidedById = req.user._id;
      workOrder.approvalRequest.decidedByName = req.user.fullName;
    }

    // Both approval and rejection resume task to IN_PROGRESS with documented decision note
    workOrder.status = WORK_ORDER_STATUS.IN_PROGRESS;

    workOrder.statusHistory.push({
      status: WORK_ORDER_STATUS.IN_PROGRESS,
      changedById: req.user._id,
      changedByName: req.user.fullName,
      changedByRole: req.user.role,
      timestamp: new Date(),
      note: `Request ${decision.toUpperCase()} by Manager: ${decisionNote?.trim() || 'No note provided'}`
    });

    await workOrder.save();

    return res.status(200).json({
      success: true,
      message: `Request was ${decision}. Task resumed to In Progress.`,
      workOrder
    });
  } catch (err) {
    console.error('[WorkOrderRoute:Decision] Error:', err);
    return res.status(500).json({ error: 'InternalServerError', message: 'Failed to record decision.' });
  }
});

/**
 * POST /api/work-orders/:orderId/submit-work
 * Technician submits completed work report for manager review.
 */
router.post('/:orderId/submit-work', async (req, res) => {
  try {
    const factoryId = (req.user.factoryId?._id || req.user.factoryId).toString();
    const workOrder = await MaintenanceWorkOrder.findById(req.params.orderId);

    if (!workOrder || workOrder.factoryId.toString() !== factoryId) {
      return res.status(404).json({ error: 'NotFound', message: 'Work order not found.' });
    }

    if (req.user.role === USER_ROLES.TECHNICIAN && workOrder.assignedTechnicianId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Forbidden', message: 'Only the assigned technician can submit work.' });
    }

    const { findings, workPerformed, followUpNeeded } = req.body;

    workOrder.technicianFeedback = {
      findings: findings?.trim() || '',
      workPerformed: workPerformed?.trim() || '',
      followUpNeeded: followUpNeeded?.trim() || '',
      submittedAt: new Date()
    };

    workOrder.status = WORK_ORDER_STATUS.WORK_SUBMITTED;

    workOrder.statusHistory.push({
      status: WORK_ORDER_STATUS.WORK_SUBMITTED,
      changedById: req.user._id,
      changedByName: req.user.fullName,
      changedByRole: req.user.role,
      timestamp: new Date(),
      note: `Work report submitted for manager review: ${workPerformed?.trim() || 'Work completed'}`
    });

    await workOrder.save();

    return res.status(200).json({
      success: true,
      message: 'Work report submitted for manager review.',
      workOrder
    });
  } catch (err) {
    console.error('[WorkOrderRoute:SubmitWork] Error:', err);
    return res.status(500).json({ error: 'InternalServerError', message: 'Failed to submit work report.' });
  }
});

/**
 * POST /api/work-orders/:orderId/return-clarification
 * Manager returns submitted work to technician for clarification.
 */
router.post('/:orderId/return-clarification', requireManager, async (req, res) => {
  try {
    const factoryId = (req.user.factoryId?._id || req.user.factoryId).toString();
    const workOrder = await MaintenanceWorkOrder.findById(req.params.orderId);

    if (!workOrder || workOrder.factoryId.toString() !== factoryId) {
      return res.status(404).json({ error: 'NotFound', message: 'Work order not found.' });
    }

    const { clarificationNote } = req.body;
    if (!clarificationNote || !clarificationNote.trim()) {
      return res.status(400).json({ error: 'BadRequest', message: 'Clarification note is required.' });
    }

    workOrder.status = WORK_ORDER_STATUS.IN_PROGRESS;

    workOrder.statusHistory.push({
      status: WORK_ORDER_STATUS.IN_PROGRESS,
      changedById: req.user._id,
      changedByName: req.user.fullName,
      changedByRole: req.user.role,
      timestamp: new Date(),
      note: `Returned for clarification by Manager: ${clarificationNote.trim()}`
    });

    await workOrder.save();

    return res.status(200).json({
      success: true,
      message: 'Work order returned to technician for clarification.',
      workOrder
    });
  } catch (err) {
    console.error('[WorkOrderRoute:ReturnClarification] Error:', err);
    return res.status(500).json({ error: 'InternalServerError', message: 'Failed to return work order.' });
  }
});

export default router;
