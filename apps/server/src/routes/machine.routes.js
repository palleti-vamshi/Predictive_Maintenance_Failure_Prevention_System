import { Router } from 'express';
import mongoose from 'mongoose';
import { Machine } from '../models/Machine.js';
import { Site } from '../models/Site.js';
import { User } from '../models/User.js';
import { MaintenanceWorkOrder } from '../models/MaintenanceWorkOrder.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireMachineAccess, buildMachineScopeFilter } from '../middleware/scope.js';
import { requireManager, requireTechnicianOrManager } from '../middleware/authorize.js';
import {
  USER_ROLES,
  OPERATIONAL_STATUS,
  WORK_ORDER_PRIORITY,
  WORK_ORDER_STATUS,
  MACHINE_TYPES,
  INDUSTRIES
} from '@predictive-maintenance/shared';

const router = Router();

// All machine routes require authentication
router.use(authenticate);

/**
 * GET /api/machines
 * Returns machines strictly scoped to the user's factory and assigned equipment.
 * - Factory Manager: All machines within their factory
 * - Technician & Viewer: Only assigned machines within their factory
 * Supports query filters: siteId, operationalStatus, includeDecommissioned
 */
router.get('/', async (req, res) => {
  try {
    const scopeFilter = buildMachineScopeFilter(req.user);
    const { siteId, operationalStatus, includeDecommissioned } = req.query;

    const query = { ...scopeFilter };

    if (includeDecommissioned !== 'true') {
      query.isDecommissioned = { $ne: true };
    }

    if (siteId) {
      query.siteId = siteId;
    }

    if (operationalStatus) {
      query.operationalStatus = operationalStatus;
    }

    const machines = await Machine.find(query)
      .populate('siteId', 'name code area')
      .populate('factoryId', 'name code location')
      .populate('assignedTechnicians', 'fullName email role')
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
 * POST /api/machines
 * Manager-only endpoint to create a new industrial gearbox profile.
 */
router.post('/', requireManager, async (req, res) => {
  try {
    const factoryId = req.user.factoryId?._id || req.user.factoryId;
    const {
      code,
      name,
      type,
      industry,
      operatingContext,
      siteId,
      manufacturer,
      model,
      serialNumber,
      arrangement,
      stageCount,
      stages,
      gearRatio,
      ratedSpeedRpm,
      ratedTorqueNm,
      bearingPositions,
      lubrication,
      monitoredSignals,
      assignedTechnicians
    } = req.body;

    // 1. Mandatory Identity Validations
    if (!code || !code.trim() || !name || !name.trim() || !siteId) {
      return res.status(400).json({
        error: 'BadRequest',
        message: 'Machine code, machine name, and site ID are required.'
      });
    }

    const formattedCode = code.trim().toUpperCase();

    // 2. Validate Site belongs to the manager's factory
    const site = await Site.findById(siteId);
    if (!site || site.factoryId.toString() !== factoryId.toString()) {
      return res.status(400).json({
        error: 'BadRequest',
        message: 'The referenced site does not exist or does not belong to your factory.'
      });
    }

    // 3. Unique Machine Code check within the factory
    const duplicate = await Machine.findOne({ factoryId, code: formattedCode });
    if (duplicate) {
      return res.status(409).json({
        error: 'Conflict',
        message: `A machine with code "${formattedCode}" already exists in your factory.`
      });
    }

    // 4. Validate Stages if provided
    let validatedStages = [];
    if (Array.isArray(stages) && stages.length > 0) {
      for (const stg of stages) {
        if (!stg.type || !stg.type.trim() || !stg.ratio || !stg.ratio.trim()) {
          return res.status(400).json({
            error: 'BadRequest',
            message: 'Each gear stage must have a non-empty type and reduction ratio.'
          });
        }
        validatedStages.push({
          stage: Number(stg.stage) || validatedStages.length + 1,
          type: stg.type.trim(),
          ratio: stg.ratio.trim(),
          teethPinion: stg.teethPinion ? Number(stg.teethPinion) : undefined,
          teethGear: stg.teethGear ? Number(stg.teethGear) : undefined,
          conditionNotes: stg.conditionNotes?.trim() || ''
        });
      }
    }

    // 5. Validate Engineering Metrics
    if (ratedSpeedRpm !== undefined && (isNaN(ratedSpeedRpm) || Number(ratedSpeedRpm) <= 0)) {
      return res.status(400).json({
        error: 'BadRequest',
        message: 'Rated input speed (RPM) must be a positive number.'
      });
    }

    if (ratedTorqueNm !== undefined && (isNaN(ratedTorqueNm) || Number(ratedTorqueNm) <= 0)) {
      return res.status(400).json({
        error: 'BadRequest',
        message: 'Rated torque (Nm) must be a positive number.'
      });
    }

    // 6. Validate Assigned Technicians belong to manager's factory
    let validTechnicianIds = [];
    if (Array.isArray(assignedTechnicians) && assignedTechnicians.length > 0) {
      const techUsers = await User.find({
        _id: { $in: assignedTechnicians },
        factoryId,
        role: USER_ROLES.TECHNICIAN
      });

      if (techUsers.length !== assignedTechnicians.length) {
        return res.status(400).json({
          error: 'BadRequest',
          message: 'One or more assigned technicians are invalid, inactive, or belong to another factory.'
        });
      }
      validTechnicianIds = techUsers.map((u) => u._id);
    }

    // 7. Create Machine Record
    const machine = await Machine.create({
      factoryId,
      siteId,
      code: formattedCode,
      name: name.trim(),
      type: type && Object.values(MACHINE_TYPES).includes(type) ? type : MACHINE_TYPES.GEARBOX,
      industry: industry && Object.values(INDUSTRIES).includes(industry) ? industry : INDUSTRIES.MANUFACTURING,
      operatingContext: operatingContext?.trim() || '',
      manufacturer: manufacturer?.trim() || '',
      model: model?.trim() || '',
      serialNumber: serialNumber?.trim() || '',
      operationalStatus: OPERATIONAL_STATUS.OPERATIONAL,
      status: 'healthy',
      isDecommissioned: false,
      arrangement: arrangement?.trim() || 'Helical-Planetary',
      stageCount: validatedStages.length > 0 ? validatedStages.length : Number(stageCount) || 1,
      stages: validatedStages,
      gearRatio: gearRatio?.trim() || '',
      ratedSpeedRpm: ratedSpeedRpm ? Number(ratedSpeedRpm) : undefined,
      ratedTorqueNm: ratedTorqueNm ? Number(ratedTorqueNm) : undefined,
      bearingPositions: Array.isArray(bearingPositions) ? bearingPositions : [],
      lubrication: lubrication || {},
      lubricantType: lubrication?.oilType || '',
      monitoredSignals: Array.isArray(monitoredSignals) ? monitoredSignals : [],
      assignedTechnicians: validTechnicianIds,
      notes: [
        {
          author: `${req.user.fullName} (${req.user.role})`,
          authorId: req.user._id,
          category: 'Commissioning',
          content: 'Machine specimen commissioned into active factory registry.',
          timestamp: new Date()
        }
      ]
    });

    // 8. Synchronize technician assignments on User models
    if (validTechnicianIds.length > 0) {
      await User.updateMany(
        { _id: { $in: validTechnicianIds } },
        { $addToSet: { assignedMachines: machine._id } }
      );
    }

    const populatedMachine = await Machine.findById(machine._id)
      .populate('siteId', 'name code')
      .populate('assignedTechnicians', 'fullName email role');

    return res.status(201).json({
      success: true,
      message: `Gearbox specimen "${machine.code}" created successfully.`,
      machine: populatedMachine
    });
  } catch (err) {
    console.error('[MachineRoute:Create] Error:', err);
    return res.status(500).json({
      error: 'InternalServerError',
      message: 'Failed to create machine.'
    });
  }
});

/**
 * GET /api/machines/:codeOrId
 * Retrieves detailed gearbox profile. Handled by requireMachineAccess.
 */
router.get('/:codeOrId', requireMachineAccess, async (req, res) => {
  const machine = await Machine.findById(req.machine._id)
    .populate('siteId', 'name code area description')
    .populate('factoryId', 'name code location')
    .populate('assignedTechnicians', 'fullName email role');

  return res.status(200).json({ machine });
});

/**
 * PUT /api/machines/:codeOrId
 * Manager-only endpoint to update machine profile specifications.
 */
router.put('/:codeOrId', requireManager, requireMachineAccess, async (req, res) => {
  try {
    const machine = req.machine;
    const factoryId = req.user.factoryId?._id || req.user.factoryId;

    if (machine.isDecommissioned && req.body.operationalStatus !== OPERATIONAL_STATUS.OPERATIONAL) {
      return res.status(400).json({
        error: 'BadRequest',
        message: 'Cannot modify a decommissioned machine. Restore commissioning status first.'
      });
    }

    const {
      name,
      siteId,
      manufacturer,
      model,
      serialNumber,
      arrangement,
      gearRatio,
      ratedSpeedRpm,
      ratedTorqueNm,
      stages,
      bearingPositions,
      lubrication,
      operationalStatus
    } = req.body;

    if (name && name.trim()) machine.name = name.trim();
    if (manufacturer !== undefined) machine.manufacturer = manufacturer.trim();
    if (model !== undefined) machine.model = model.trim();
    if (serialNumber !== undefined) machine.serialNumber = serialNumber.trim();
    if (arrangement !== undefined) machine.arrangement = arrangement.trim();
    if (gearRatio !== undefined) machine.gearRatio = gearRatio.trim();

    if (siteId && siteId !== machine.siteId.toString()) {
      const site = await Site.findById(siteId);
      if (!site || site.factoryId.toString() !== factoryId.toString()) {
        return res.status(400).json({
          error: 'BadRequest',
          message: 'The referenced site does not belong to your factory.'
        });
      }
      machine.siteId = siteId;
    }

    if (ratedSpeedRpm !== undefined) {
      if (isNaN(ratedSpeedRpm) || Number(ratedSpeedRpm) <= 0) {
        return res.status(400).json({
          error: 'BadRequest',
          message: 'Rated input speed (RPM) must be a positive number.'
        });
      }
      machine.ratedSpeedRpm = Number(ratedSpeedRpm);
    }

    if (ratedTorqueNm !== undefined) {
      if (isNaN(ratedTorqueNm) || Number(ratedTorqueNm) <= 0) {
        return res.status(400).json({
          error: 'BadRequest',
          message: 'Rated torque (Nm) must be a positive number.'
        });
      }
      machine.ratedTorqueNm = Number(ratedTorqueNm);
    }

    if (Array.isArray(stages)) {
      machine.stages = stages.map((stg, i) => ({
        stage: Number(stg.stage) || i + 1,
        type: stg.type.trim(),
        ratio: stg.ratio.trim(),
        teethPinion: stg.teethPinion ? Number(stg.teethPinion) : undefined,
        teethGear: stg.teethGear ? Number(stg.teethGear) : undefined,
        conditionNotes: stg.conditionNotes?.trim() || ''
      }));
      machine.stageCount = machine.stages.length;
    }

    if (Array.isArray(bearingPositions)) {
      machine.bearingPositions = bearingPositions;
    }

    if (lubrication) {
      machine.lubrication = lubrication;
      if (lubrication.oilType) {
        machine.lubricantType = lubrication.oilType;
      }
    }

    if (operationalStatus && Object.values(OPERATIONAL_STATUS).includes(operationalStatus)) {
      machine.operationalStatus = operationalStatus;
      if (operationalStatus === OPERATIONAL_STATUS.OPERATIONAL) {
        machine.isDecommissioned = false;
        machine.decommissionedAt = undefined;
        machine.decommissionReason = undefined;
      }
    }

    await machine.save();

    const populatedMachine = await Machine.findById(machine._id)
      .populate('siteId', 'name code area')
      .populate('assignedTechnicians', 'fullName email role');

    return res.status(200).json({
      success: true,
      message: `Machine "${machine.code}" updated successfully.`,
      machine: populatedMachine
    });
  } catch (err) {
    console.error('[MachineRoute:Update] Error:', err);
    return res.status(500).json({
      error: 'InternalServerError',
      message: 'Failed to update machine.'
    });
  }
});

/**
 * POST /api/machines/:codeOrId/decommission
 * Manager-only endpoint to soft-decommission a machine.
 * Keeps all historical telemetry definitions, notes, and maintenance records intact,
 * while preventing new operational usage.
 */
router.post('/:codeOrId/decommission', requireManager, requireMachineAccess, async (req, res) => {
  try {
    const machine = req.machine;
    const { reason } = req.body;

    if (machine.isDecommissioned) {
      return res.status(400).json({
        error: 'BadRequest',
        message: `Machine "${machine.code}" is already decommissioned.`
      });
    }

    machine.isDecommissioned = true;
    machine.operationalStatus = OPERATIONAL_STATUS.DECOMMISSIONED;
    machine.decommissionedAt = new Date();
    machine.decommissionReason = reason?.trim() || 'Decommissioned by Factory Manager';

    machine.notes.unshift({
      author: `${req.user.fullName} (${req.user.role})`,
      authorId: req.user._id,
      category: 'Decommissioning',
      content: `Machine soft-decommissioned: ${machine.decommissionReason}`,
      timestamp: new Date()
    });

    await machine.save();

    return res.status(200).json({
      success: true,
      message: `Machine "${machine.code}" has been soft-decommissioned.`,
      machine
    });
  } catch (err) {
    console.error('[MachineRoute:Decommission] Error:', err);
    return res.status(500).json({
      error: 'InternalServerError',
      message: 'Failed to decommission machine.'
    });
  }
});

/**
 * POST /api/machines/:codeOrId/assign
 * Manager-only endpoint to assign or reassign technicians to a machine.
 * Validates that all technicians belong to the manager's factory.
 */
router.post('/:codeOrId/assign', requireManager, requireMachineAccess, async (req, res) => {
  try {
    const machine = req.machine;
    const factoryId = req.user.factoryId?._id || req.user.factoryId;
    const { technicianIds } = req.body;

    if (!Array.isArray(technicianIds)) {
      return res.status(400).json({
        error: 'BadRequest',
        message: 'technicianIds must be an array of user IDs.'
      });
    }

    // Verify all technicians belong to the same factory and have role technician
    if (technicianIds.length > 0) {
      const validTechs = await User.find({
        _id: { $in: technicianIds },
        factoryId,
        role: USER_ROLES.TECHNICIAN
      });

      if (validTechs.length !== technicianIds.length) {
        return res.status(400).json({
          error: 'BadRequest',
          message: 'One or more technician IDs are invalid, belong to another factory, or lack the technician role.'
        });
      }
    }

    // 1. Remove machine from users previously assigned but no longer in the list
    await User.updateMany(
      { factoryId, assignedMachines: machine._id, _id: { $nin: technicianIds } },
      { $pull: { assignedMachines: machine._id } }
    );

    // 2. Add machine to newly assigned technicians
    if (technicianIds.length > 0) {
      await User.updateMany(
        { _id: { $in: technicianIds } },
        { $addToSet: { assignedMachines: machine._id } }
      );
    }

    machine.assignedTechnicians = technicianIds;
    await machine.save();

    const populatedMachine = await Machine.findById(machine._id)
      .populate('siteId', 'name code')
      .populate('assignedTechnicians', 'fullName email role');

    return res.status(200).json({
      success: true,
      message: `Technician assignments updated for machine "${machine.code}".`,
      assignedTechnicians: populatedMachine.assignedTechnicians
    });
  } catch (err) {
    console.error('[MachineRoute:AssignTechnicians] Error:', err);
    return res.status(500).json({
      error: 'InternalServerError',
      message: 'Failed to update technician assignments.'
    });
  }
});

/**
 * GET /api/machines/:codeOrId/work-orders
 * Lists all maintenance work orders for this machine.
 * Handled by requireMachineAccess.
 */
router.get('/:codeOrId/work-orders', requireMachineAccess, async (req, res) => {
  try {
    const machine = req.machine;
    const workOrders = await MaintenanceWorkOrder.find({ machineId: machine._id })
      .populate('assignedTechnicianId', 'fullName email role')
      .populate('createdById', 'fullName role')
      .populate('reviewedById', 'fullName role')
      .sort({ createdAt: -1 });

    return res.status(200).json({
      count: workOrders.length,
      workOrders
    });
  } catch (err) {
    console.error('[MachineRoute:ListWorkOrders] Error:', err);
    return res.status(500).json({
      error: 'InternalServerError',
      message: 'Failed to retrieve machine work orders.'
    });
  }
});

/**
 * POST /api/machines/:codeOrId/work-orders
 * Manager-only endpoint to create and assign a maintenance work order.
 * CRITICAL ENFORCEMENT:
 * - Checks that the technician belongs to the same factory.
 * - Checks that the technician has access to the machine.
 * - Never create tasks automatically from AI warnings.
 */
router.post(
  '/:codeOrId/work-orders',
  requireManager,
  requireMachineAccess,
  async (req, res) => {
    try {
      const machine = req.machine;
      const factoryId = req.user.factoryId?._id || req.user.factoryId;

      if (machine.isDecommissioned) {
        return res.status(400).json({
          error: 'BadRequest',
          message: `Cannot assign maintenance work orders to decommissioned machine "${machine.code}".`
        });
      }

      const { title, description, priority, dueDate, assignedTechnicianId } = req.body;

      if (!title || !title.trim() || !description || !description.trim() || !dueDate || !assignedTechnicianId) {
        return res.status(400).json({
          error: 'BadRequest',
          message: 'Title, task description, due date, and assigned technician are required.'
        });
      }

      if (priority && !Object.values(WORK_ORDER_PRIORITY).includes(priority)) {
        return res.status(400).json({
          error: 'BadRequest',
          message: `Priority must be one of: ${Object.values(WORK_ORDER_PRIORITY).join(', ')}`
        });
      }

      // 1. Verify technician exists and belongs to this factory
      const technician = await User.findById(assignedTechnicianId);
      if (!technician || technician.factoryId.toString() !== factoryId.toString()) {
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

      // 3. Generate unique order number: WO-<code>-<timestampSlice>
      const orderNumber = `WO-${machine.code}-${Date.now().toString().slice(-4)}`;

      // 4. Create Work Order
      const workOrder = await MaintenanceWorkOrder.create({
        factoryId,
        machineId: machine._id,
        orderNumber,
        title: title.trim(),
        description: description.trim(),
        priority: priority || WORK_ORDER_PRIORITY.MEDIUM,
        status: WORK_ORDER_STATUS.OPEN,
        dueDate: new Date(dueDate),
        assignedTechnicianId: technician._id,
        createdById: req.user._id,
        sourceAlertId: req.body.sourceAlertId || null,
        sourceAnalysisRunId: req.body.sourceAnalysisRunId || null,
        statusHistory: [
          {
            status: WORK_ORDER_STATUS.OPEN,
            changedById: req.user._id,
            changedByName: req.user.fullName,
            changedByRole: req.user.role,
            timestamp: new Date(),
            note: 'Work order created and assigned'
          }
        ]
      });

      // 5. Append note to machine history
      machine.notes.unshift({
        author: `${req.user.fullName} (${req.user.role})`,
        authorId: req.user._id,
        category: 'Work Order Created',
        content: `Assigned [${orderNumber}] "${title}" to ${technician.fullName} (Priority: ${priority || 'medium'}).`,
        timestamp: new Date()
      });
      await machine.save();

      const populatedWorkOrder = await MaintenanceWorkOrder.findById(workOrder._id)
        .populate('machineId', 'code name status')
        .populate('assignedTechnicianId', 'fullName email role')
        .populate('createdById', 'fullName role');

      return res.status(201).json({
        success: true,
        message: `Work order "${orderNumber}" created and assigned.`,
        workOrder: populatedWorkOrder
      });
    } catch (err) {
      console.error('[MachineRoute:CreateWorkOrder] Error:', err);
      return res.status(500).json({
        error: 'InternalServerError',
        message: 'Failed to create work order.'
      });
    }
  }
);

/**
 * POST /api/machines/:codeOrId/notes
 * Adds a field maintenance observation to the machine record.
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
