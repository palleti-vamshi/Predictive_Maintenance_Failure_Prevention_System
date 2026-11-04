import { Router } from 'express';
import { User } from '../models/User.js';
import { Machine } from '../models/Machine.js';
import { MaintenanceWorkOrder } from '../models/MaintenanceWorkOrder.js';
import { Alert } from '../models/Alert.js';
import { AnalysisRun } from '../models/AnalysisRun.js';
import { Dataset } from '../models/Dataset.js';
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

/**
 * GET /api/admin/audit-trail
 * Aggregates all operational actions across the factory into an immutable chronological audit trail.
 * Includes dataset uploads, ML analysis executions, alert acknowledgements,
 * technician observations, work order creation, status transitions, and approvals.
 */
router.get('/audit-trail', async (req, res) => {
  try {
    const factoryId = req.user.factoryId?._id || req.user.factoryId;

    const [workOrders, alerts, analysisRuns, datasets] = await Promise.all([
      MaintenanceWorkOrder.find({ factoryId })
        .populate('machineId', 'code name type')
        .populate('assignedTechnicianId', 'fullName role')
        .populate('createdById', 'fullName role')
        .lean(),
      Alert.find({ factoryId })
        .populate('machineId', 'code name type')
        .lean(),
      AnalysisRun.find({ factoryId })
        .populate('machineId', 'code name type')
        .lean(),
      Dataset.find({ factoryId })
        .populate('machineId', 'code name type')
        .lean()
    ]);

    const events = [];

    // 1. Work Orders & Status Transitions
    for (const wo of workOrders) {
      const machineLabel = wo.machineId?.code || 'Equipment';

      // Creation event
      events.push({
        id: `wo_create_${wo._id}`,
        timestamp: wo.createdAt,
        type: 'work_order_created',
        category: 'Maintenance',
        actor: wo.createdById?.fullName || 'Factory Manager',
        role: wo.createdById?.role || 'factory_manager',
        target: machineLabel,
        title: `Work Order Created: ${wo.orderNumber}`,
        description: `${wo.title} (${wo.priority} priority) assigned to ${wo.assignedTechnicianId?.fullName || 'Technician'}.`,
        metadata: { orderNumber: wo.orderNumber, status: wo.status, priority: wo.priority }
      });

      // Status history transitions
      if (Array.isArray(wo.statusHistory)) {
        for (const sh of wo.statusHistory) {
          events.push({
            id: `wo_sh_${sh._id || Math.random()}`,
            timestamp: sh.timestamp,
            type: 'maintenance_status_change',
            category: 'Maintenance',
            actor: sh.changedByName || 'Authorized User',
            role: sh.changedByRole || 'operations',
            target: machineLabel,
            title: `Work Order ${wo.orderNumber}: Status -> ${sh.status}`,
            description: sh.note ? `Note: ${sh.note}` : `Work order transitioned to status "${sh.status}".`,
            metadata: { orderNumber: wo.orderNumber, status: sh.status }
          });
        }
      }

      // Parts / Permission Approval Requests
      if (wo.approvalRequest && wo.approvalRequest.requestedAt) {
        events.push({
          id: `wo_req_${wo._id}`,
          timestamp: wo.approvalRequest.requestedAt,
          type: 'approval_requested',
          category: 'Approvals',
          actor: wo.approvalRequest.requestedByName || 'Field Technician',
          role: 'technician',
          target: machineLabel,
          title: `Work Order ${wo.orderNumber}: ${wo.approvalRequest.requestType?.toUpperCase()} Requested`,
          description: `Reason: ${wo.approvalRequest.reason || 'No description provided.'}`,
          metadata: { orderNumber: wo.orderNumber, requestType: wo.approvalRequest.requestType }
        });

        if (wo.approvalRequest.decidedAt) {
          events.push({
            id: `wo_dec_${wo._id}`,
            timestamp: wo.approvalRequest.decidedAt,
            type: 'approval_decision',
            category: 'Approvals',
            actor: wo.approvalRequest.decidedByName || 'Factory Manager',
            role: 'factory_manager',
            target: machineLabel,
            title: `Work Order ${wo.orderNumber}: Request ${wo.approvalRequest.status?.toUpperCase()}`,
            description: `Decision note: ${wo.approvalRequest.decisionNote || 'No review notes recorded.'}`,
            metadata: { orderNumber: wo.orderNumber, decision: wo.approvalRequest.status }
          });
        }
      }
    }

    // 2. Evidence Alerts & Observations
    for (const al of alerts) {
      const machineLabel = al.machineId?.code || 'Equipment';

      if (al.isAcknowledged && al.acknowledgedAt) {
        events.push({
          id: `al_ack_${al._id}`,
          timestamp: al.acknowledgedAt,
          type: 'alert_acknowledged',
          category: 'Alerts',
          actor: al.acknowledgedByName || 'Authorized Operator',
          role: 'operations',
          target: machineLabel,
          title: `Alert Acknowledged: ${al.title}`,
          description: `Severity: ${al.severity}. Signals: ${(al.supportingSignals || []).join(', ') || 'Multi-signal'}.`,
          metadata: { alertId: al._id, severity: al.severity }
        });
      }

      if (Array.isArray(al.technicianObservations)) {
        for (const obs of al.technicianObservations) {
          events.push({
            id: `al_obs_${obs._id || Math.random()}`,
            timestamp: obs.loggedAt,
            type: 'observation_logged',
            category: 'Alerts',
            actor: obs.technicianName || 'Technician',
            role: 'technician',
            target: machineLabel,
            title: `Field Observation: ${al.title}`,
            description: obs.note,
            metadata: { alertId: al._id }
          });
        }
      }
    }

    // 3. Analysis Runs
    for (const ar of analysisRuns) {
      const machineLabel = ar.machineId?.code || 'Equipment';
      events.push({
        id: `ar_${ar._id}`,
        timestamp: ar.createdAt,
        type: 'analysis_run_completed',
        category: 'Analytics',
        actor: 'Predictive ML Engine',
        role: 'system',
        target: machineLabel,
        title: `Analysis Run: ${ar.modelName || 'Model Execution'}`,
        description: `Analyzed ${ar.datasetTitle || 'Dataset'} (${ar.summaryMetrics?.totalWindowsAnalyzed || 0} sliding windows, ${ar.summaryMetrics?.anomalyRatePct || 0}% anomaly rate).`,
        metadata: { runId: ar._id, modelType: ar.modelType }
      });
    }

    // 4. Dataset Uploads
    for (const ds of datasets) {
      const machineLabel = ds.machineId?.code || 'Catalog / Fleet';
      events.push({
        id: `ds_${ds._id}`,
        timestamp: ds.createdAt,
        type: 'dataset_uploaded',
        category: 'Ingestion',
        actor: 'Plant Engineer',
        role: 'operations',
        target: machineLabel,
        title: `Dataset Ingested: ${ds.title || ds.originalFilename}`,
        description: `Ingested ${ds.rowCount || 0} rows across ${ds.columnMappings?.length || 0} mapped sensor channels. Provenance: ${ds.provenanceCategory}.`,
        metadata: { datasetId: ds._id, modality: ds.modality }
      });
    }

    // Sort descending by chronological timestamp
    events.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    return res.status(200).json({
      factoryId,
      count: events.length,
      auditEvents: events
    });
  } catch (err) {
    console.error('[AdminRoute:AuditTrail] Error:', err);
    return res.status(500).json({
      error: 'InternalServerError',
      message: 'Failed to retrieve factory audit trail.'
    });
  }
});

export default router;

