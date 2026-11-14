import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { requireManager } from '../middleware/authorize.js';
import {
  queryAssistant,
  getAuthorizedFactoryContext,
  getDynamicSuggestions
} from '../services/aiAssistant.service.js';
import { Machine } from '../models/Machine.js';
import { User } from '../models/User.js';
import { MaintenanceWorkOrder } from '../models/MaintenanceWorkOrder.js';
import { USER_ROLES, WORK_ORDER_STATUS, WORK_ORDER_PRIORITY } from '@predictive-maintenance/shared';

const router = Router();

// All assistant endpoints require authentication
router.use(authenticate);

/**
 * GET /api/assistant/status
 * Returns current assistant provider status, active scopes, and capabilities.
 */
router.get('/status', async (req, res) => {
  try {
    const hasGemini = Boolean(process.env.GEMINI_API_KEY);
    const hasOpenAI = Boolean(process.env.OPENAI_API_KEY);

    const context = await getAuthorizedFactoryContext(req.user);

    return res.status(200).json({
      success: true,
      provider: {
        configured: hasGemini || hasOpenAI,
        engine: hasGemini ? 'Google Gemini 1.5 Flash' : hasOpenAI ? 'OpenAI GPT-4o-mini' : 'MechGuard Local Grounded Rule Engine',
        status: hasGemini || hasOpenAI ? 'configured_cloud' : 'unconfigured_fallback',
        note: hasGemini || hasOpenAI
          ? 'Cloud LLM provider active with strict factory grounding and general engineering knowledge.'
          : 'Server environment variable GEMINI_API_KEY not configured. Running deterministic local engine grounded on verified database records.'
      },
      supportedModes: hasGemini || hasOpenAI ? ['auto', 'factory', 'general'] : ['auto', 'factory'],
      scope: {
        factoryId: context.factory.id,
        factoryName: context.factory.name,
        userRole: req.user.role,
        isManager: req.user.role === USER_ROLES.FACTORY_MANAGER,
        scopedMachineCount: context.machines.length,
        scopedAlertCount: context.alerts.length,
        scopedWorkOrderCount: context.workOrders.length
      }
    });
  } catch (err) {
    console.error('[AssistantRoute:Status] Error:', err);
    return res.status(500).json({
      error: 'InternalServerError',
      message: 'Failed to retrieve assistant status.'
    });
  }
});

/**
 * GET /api/assistant/suggestions
 * Returns dynamic, page-aware and role-scoped suggestions based on active route and machine.
 */
router.get('/suggestions', async (req, res) => {
  try {
    const route = req.query.route || '';
    const machineCode = req.query.machineCode || null;

    const data = await getDynamicSuggestions(req.user, route, machineCode);
    return res.status(200).json({
      success: true,
      ...data
    });
  } catch (err) {
    console.error('[AssistantRoute:Suggestions] Error:', err);
    return res.status(500).json({
      error: 'InternalServerError',
      message: 'Failed to generate dynamic suggestions.'
    });
  }
});

/**
 * POST /api/assistant/query
 * Answers questions using the signed-in user's authorized factory data.
 * Request body: { query: string, machineCode?: string }
 */
router.post('/query', async (req, res) => {
  try {
    const { query, machineCode, mode } = req.body;

    if (!query || typeof query !== 'string' || !query.trim()) {
      return res.status(400).json({
        error: 'BadRequest',
        message: 'A valid question or prompt query is required.'
      });
    }

    const response = await queryAssistant(req.user, query.trim(), machineCode, mode || 'auto');

    return res.status(200).json({
      success: true,
      ...response
    });
  } catch (err) {
    console.error('[AssistantRoute:Query] Error:', err);
    return res.status(500).json({
      error: 'InternalServerError',
      message: 'Failed to process assistant query: ' + err.message
    });
  }
});

/**
 * POST /api/assistant/draft-work-order
 * Generates a structured work order draft for a machine or alert.
 * Explicitly returns proposal object with `requiresManagerApproval: true`.
 * Note: Does NOT modify database until manager approves via POST /api/work-orders.
 */
router.post('/draft-work-order', async (req, res) => {
  try {
    const { machineCode, alertId } = req.body;
    const prompt = `Draft work order proposal for ${machineCode || 'equipment'}${alertId ? ' referencing alert ' + alertId : ''}`;

    const response = await queryAssistant(req.user, prompt, machineCode);

    if (!response.workOrderDraft) {
      return res.status(404).json({
        error: 'NotFound',
        message: 'Could not generate work order draft for the specified machine or alert in authorized scope.'
      });
    }

    return res.status(200).json({
      success: true,
      proposal: response.workOrderDraft,
      isManager: req.user.role === USER_ROLES.FACTORY_MANAGER,
      requiresManagerApproval: true,
      statusNote: 'Proposal generated. Must be reviewed and submitted by an authorized Factory Manager.'
    });
  } catch (err) {
    console.error('[AssistantRoute:DraftWorkOrder] Error:', err);
    return res.status(500).json({
      error: 'InternalServerError',
      message: 'Failed to generate work order proposal: ' + err.message
    });
  }
});

/**
 * POST /api/assistant/approve-draft-work-order
 * Manager-only endpoint to review, finalize, and officially issue an AI-proposed work order.
 * Strictly enforces human manager approval boundary.
 */
router.post('/approve-draft-work-order', requireManager, async (req, res) => {
  try {
    const factoryId = (req.user.factoryId?._id || req.user.factoryId).toString();
    const payload = req.body.draft || req.body;

    const machineCode = payload.machineCode;
    const title = payload.title;
    const description = payload.description;
    const priority = payload.priority || WORK_ORDER_PRIORITY.MEDIUM;
    let assignedTechnicianId = payload.assignedTechnicianId || payload.suggestedTechnicianId;
    const dueDate = payload.dueDate;
    const sourceAlertId = payload.sourceAlertId;
    const managerNotes = req.body.managerNotes || payload.managerNotes;

    if (!machineCode || !title || !description) {
      return res.status(400).json({
        error: 'BadRequest',
        message: 'machineCode, title, and description are required to issue a work order.'
      });
    }

    // 1. Verify machine belongs to manager's factory
    const machine = await Machine.findOne({ code: machineCode.toUpperCase(), factoryId });
    if (!machine) {
      return res.status(404).json({
        error: 'NotFound',
        message: `Machine "${machineCode}" not found within your factory scope.`
      });
    }

    // 2. Resolve eligible technician if not explicitly provided
    if (!assignedTechnicianId) {
      const defaultTech = await User.findOne({
        factoryId,
        role: USER_ROLES.TECHNICIAN,
        assignedMachines: machine._id,
        isActive: true
      });
      if (defaultTech) {
        assignedTechnicianId = defaultTech._id;
      } else {
        return res.status(400).json({
          error: 'BadRequest',
          message: `Please specify an assignedTechnicianId for machine "${machine.code}".`
        });
      }
    }

    // 3. Verify technician belongs to this factory and is assigned to the machine
    const technician = await User.findOne({
      _id: assignedTechnicianId,
      factoryId,
      role: USER_ROLES.TECHNICIAN
    });

    if (!technician) {
      return res.status(400).json({
        error: 'BadRequest',
        message: 'The selected technician is not an active technician in your factory.'
      });
    }

    const isAssigned = (technician.assignedMachines || []).some(
      (mId) => (mId._id || mId).toString() === machine._id.toString()
    );

    if (!isAssigned) {
      return res.status(400).json({
        error: 'BadRequest',
        message: `Technician "${technician.fullName}" must be assigned to machine "${machine.code}" before receiving a work order.`
      });
    }

    // 3. Create official Work Order
    const orderNumber = `WO-${machine.code}-${Date.now().toString().slice(-4)}`;
    const finalDueDate = dueDate ? new Date(dueDate) : new Date(Date.now() + 72 * 3600 * 1000);

    const workOrder = await MaintenanceWorkOrder.create({
      factoryId,
      machineId: machine._id,
      orderNumber,
      title: title.trim(),
      description: managerNotes ? `${description.trim()}\n\nManager Notes: ${managerNotes.trim()}` : description.trim(),
      priority: priority || WORK_ORDER_PRIORITY.MEDIUM,
      status: WORK_ORDER_STATUS.OPEN,
      dueDate: finalDueDate,
      assignedTechnicianId: technician._id,
      createdById: req.user._id,
      sourceAlertId: sourceAlertId || null,
      statusHistory: [
        {
          status: WORK_ORDER_STATUS.OPEN,
          changedById: req.user._id,
          changedByName: req.user.fullName,
          changedByRole: req.user.role,
          timestamp: new Date(),
          note: `Manager approved and issued AI-drafted work order (${orderNumber}). Assigned to ${technician.fullName}.`
        }
      ]
    });

    // 4. Record to machine notes
    machine.notes.unshift({
      author: `${req.user.fullName} (Manager Approval)`,
      content: `Issued Work Order ${orderNumber}: ${title.trim()}`
    });
    await machine.save();

    return res.status(201).json({
      success: true,
      message: `Work order ${orderNumber} officially approved and issued.`,
      workOrder
    });
  } catch (err) {
    console.error('[AssistantRoute:ApproveDraftWorkOrder] Error:', err);
    return res.status(500).json({
      error: 'InternalServerError',
      message: 'Failed to approve and issue work order: ' + err.message
    });
  }
});

export default router;

