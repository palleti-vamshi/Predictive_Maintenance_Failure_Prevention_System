import mongoose from 'mongoose';
import { Machine } from '../models/Machine.js';
import { Alert } from '../models/Alert.js';
import { MaintenanceWorkOrder } from '../models/MaintenanceWorkOrder.js';
import { Dataset } from '../models/Dataset.js';
import { AnalysisRun } from '../models/AnalysisRun.js';
import { USER_ROLES } from '@predictive-maintenance/shared';

/**
 * Generates a short contextual excerpt highlighting the search query.
 */
function createExcerpt(text, query, maxLen = 140) {
  if (!text) return '';
  const str = String(text);
  const qLower = query.toLowerCase();
  const idx = str.toLowerCase().indexOf(qLower);

  if (idx === -1) {
    return str.length > maxLen ? str.slice(0, maxLen - 3) + '...' : str;
  }

  const start = Math.max(0, idx - 40);
  const end = Math.min(str.length, idx + query.length + 80);
  let snippet = str.slice(start, end).trim();
  if (start > 0) snippet = '...' + snippet;
  if (end < str.length) snippet = snippet + '...';
  return snippet;
}

/**
 * Searches across operational records scoped strictly to the authenticated user.
 *
 * @param {Object} user - Authenticated user with factoryId and role
 * @param {string} queryStr - User's search text
 * @param {string} typeFilter - 'all' | 'machines' | 'alerts' | 'workOrders' | 'datasets' | 'analysisRuns'
 * @returns {Promise<Object>} Formatted search results with scoped access guarantees
 */
export async function searchOperationalRecords(user, queryStr, typeFilter = 'all', options = {}) {
  if (!queryStr || typeof queryStr !== 'string' || !queryStr.trim()) {
    return {
      query: '',
      total: 0,
      counts: { all: 0, machines: 0, alerts: 0, workOrders: 0, datasets: 0, analysisRuns: 0 },
      results: [],
      searchMethod: 'Indexed Operational Record Search (Factory Scoped)',
      factoryContext: {
        id: user.factoryId?._id || user.factoryId,
        name: user.factoryId?.name || 'Assigned Factory'
      }
    };
  }

  const q = queryStr.trim();
  const escapedQ = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escapedQ, 'i');

  const factoryId = (user.factoryId?._id || user.factoryId).toString();
  const isManager = user.role === USER_ROLES.FACTORY_MANAGER;
  const assignedMachineIds = (user.assignedMachines || []).map((m) =>
    (m._id || m).toString()
  );

  // Common scope filters
  const machineBaseScope = { factoryId };
  if (!isManager) {
    machineBaseScope._id = { $in: assignedMachineIds };
  }

  // Resolve target machine ID if machineCode filter is provided
  let filteredMachineId = null;
  if (options.machineCode) {
    const matchedMachine = await Machine.findOne({
      factoryId,
      code: new RegExp(`^${options.machineCode.trim()}$`, 'i')
    });
    if (matchedMachine) {
      filteredMachineId = matchedMachine._id;
    }
  }

  // Build date filter if provided
  const dateFilter = {};
  if (options.dateFrom) {
    const dFrom = new Date(options.dateFrom);
    if (!isNaN(dFrom.getTime())) dateFilter.$gte = dFrom;
  }
  if (options.dateTo) {
    const dTo = new Date(options.dateTo);
    if (!isNaN(dTo.getTime())) dateFilter.$lte = dTo;
  }
  const hasDateFilter = Object.keys(dateFilter).length > 0;

  const results = [];
  const counts = { all: 0, machines: 0, alerts: 0, workOrders: 0, datasets: 0, analysisRuns: 0 };

  // 1. Search Machines
  if (typeFilter === 'all' || typeFilter === 'machines') {
    const machineQuery = {
      ...machineBaseScope,
      $or: [
        { code: regex },
        { name: regex },
        { type: regex },
        { status: regex },
        { manufacturer: regex },
        { modelNumber: regex },
        { location: regex }
      ]
    };

    if (options.status) {
      machineQuery.status = new RegExp(options.status.trim(), 'i');
    }
    if (filteredMachineId) {
      machineQuery._id = filteredMachineId;
    }
    if (hasDateFilter) {
      machineQuery.updatedAt = dateFilter;
    }

    const machines = await Machine.find(machineQuery)
      .select('code name status type location manufacturer modelNumber operationalStatus updatedAt')
      .limit(15);

    counts.machines = machines.length;
    for (const m of machines) {
      const matchField = [m.code, m.name, m.type, m.manufacturer, m.location]
        .find((f) => f && f.toLowerCase().includes(q.toLowerCase())) || m.name;

      results.push({
        id: m._id.toString(),
        resultType: 'machine',
        title: `${m.code} — ${m.name}`,
        subtitle: `${m.type || 'Equipment'} • Location: ${m.location || 'Plant Floor'}`,
        badge: {
          label: (m.status || 'healthy').toUpperCase(),
          variant: m.status === 'critical' ? 'critical' : m.status === 'warning' ? 'warning' : 'healthy'
        },
        excerpt: createExcerpt(`${m.name} (${m.code}). Status: ${m.status}. ${m.manufacturer || ''} ${m.modelNumber || ''}`, q),
        date: m.updatedAt,
        url: `#/machines/${m.code}`,
        factory: {
          id: factoryId,
          name: user.factoryId?.name || 'Local Plant'
        }
      });
    }
  }

  // 2. Search Alerts
  if (typeFilter === 'all' || typeFilter === 'alerts') {
    const alertQuery = {
      factoryId,
      $or: [
        { code: regex },
        { title: regex },
        { description: regex },
        { failureType: regex },
        { severity: regex },
        { status: regex },
        { notes: regex }
      ]
    };

    if (filteredMachineId) {
      alertQuery.machineId = filteredMachineId;
    } else if (!isManager) {
      alertQuery.machineId = { $in: assignedMachineIds };
    }

    if (options.status) {
      alertQuery.severity = new RegExp(options.status.trim(), 'i');
    }
    if (hasDateFilter) {
      alertQuery.createdAt = dateFilter;
    }

    const alerts = await Alert.find(alertQuery)
      .populate('machineId', 'code name status')
      .sort({ createdAt: -1 })
      .limit(15);

    counts.alerts = alerts.length;
    for (const a of alerts) {
      results.push({
        id: a._id.toString(),
        resultType: 'alert',
        title: `${a.code || 'ALERT'} — ${a.title}`,
        subtitle: `Machine: ${a.machineId?.code || 'N/A'} • Failure Type: ${a.failureType || 'Anomaly'}`,
        badge: {
          label: (a.severity || 'info').toUpperCase(),
          variant: a.severity === 'critical' ? 'critical' : a.severity === 'warning' ? 'warning' : 'neutral'
        },
        excerpt: createExcerpt(`${a.title}: ${a.description || ''} ${a.notes || ''}`, q),
        date: a.createdAt,
        url: `#/alerts`,
        factory: {
          id: factoryId,
          name: user.factoryId?.name || 'Local Plant'
        }
      });
    }
  }

  // 3. Search Maintenance Work Orders
  if (typeFilter === 'all' || typeFilter === 'workOrders') {
    const woQuery = {
      factoryId,
      $or: [
        { orderNumber: regex },
        { title: regex },
        { description: regex },
        { priority: regex },
        { status: regex },
        { findings: regex },
        { workPerformed: regex }
      ]
    };

    if (filteredMachineId) {
      woQuery.machineId = filteredMachineId;
    }
    if (options.status) {
      woQuery.status = new RegExp(options.status.trim(), 'i');
    }
    if (hasDateFilter) {
      woQuery.createdAt = dateFilter;
    }

    if (user.role === USER_ROLES.TECHNICIAN) {
      woQuery.assignedTechnicianId = user._id;
    } else if (user.role === USER_ROLES.VIEWER && assignedMachineIds.length > 0) {
      woQuery.machineId = { $in: assignedMachineIds };
    }

    const workOrders = await MaintenanceWorkOrder.find(woQuery)
      .populate('machineId', 'code name status')
      .populate('assignedTechnicianId', 'fullName email')
      .sort({ createdAt: -1 })
      .limit(15);

    counts.workOrders = workOrders.length;
    for (const wo of workOrders) {
      results.push({
        id: wo._id.toString(),
        resultType: 'workOrder',
        title: `${wo.orderNumber || 'WO'} — ${wo.title}`,
        subtitle: `Machine: ${wo.machineId?.code || 'N/A'} • Assigned: ${wo.assignedTechnicianId?.fullName || 'Unassigned'}`,
        badge: {
          label: (wo.status || 'open').replace('_', ' ').toUpperCase(),
          variant: wo.priority === 'critical' ? 'critical' : wo.priority === 'high' ? 'warning' : 'neutral'
        },
        excerpt: createExcerpt(`${wo.title}. ${wo.description || ''} Findings: ${wo.findings || ''} Work: ${wo.workPerformed || ''}`, q),
        date: wo.createdAt,
        url: `#/maintenance`,
        factory: {
          id: factoryId,
          name: user.factoryId?.name || 'Local Plant'
        }
      });
    }
  }

  // 4. Search Datasets
  if (typeFilter === 'all' || typeFilter === 'datasets') {
    const datasetQuery = {
      $and: [
        { $or: [{ factoryId }, { isReference: true }] },
        {
          $or: [
            { name: regex },
            { filename: regex },
            { machineType: regex },
            { domain: regex },
            { provenance: regex },
            { status: regex }
          ]
        }
      ]
    };

    const datasets = await Dataset.find(datasetQuery)
      .select('name filename machineType domain provenance status rowCount createdAt isReference')
      .sort({ createdAt: -1 })
      .limit(10);

    counts.datasets = datasets.length;
    for (const d of datasets) {
      results.push({
        id: d._id.toString(),
        resultType: 'dataset',
        title: d.name,
        subtitle: `${d.machineType || d.domain || 'Operational'} • ${d.provenance || 'Uploaded CSV'} • ${d.rowCount || 0} rows`,
        badge: {
          label: (d.status || 'ready').toUpperCase(),
          variant: d.status === 'ready' || d.status === 'confirmed' ? 'healthy' : 'neutral'
        },
        excerpt: createExcerpt(`${d.name} (${d.filename || ''}). Domain: ${d.domain || d.machineType}. Provenance: ${d.provenance || ''}`, q),
        date: d.createdAt,
        url: `#/datasets/upload`,
        factory: {
          id: factoryId,
          name: d.isReference ? 'Global Reference Catalog' : (user.factoryId?.name || 'Local Plant')
        }
      });
    }
  }

  // 5. Search Analysis Runs
  if (typeFilter === 'all' || typeFilter === 'analysisRuns') {
    const runQuery = {
      factoryId,
      $or: [
        { runId: regex },
        { notes: regex },
        { anomalyStatus: regex },
        { predictedClass: regex },
        { machineCode: regex }
      ]
    };

    if (filteredMachineId) {
      runQuery.machineId = filteredMachineId;
    }
    if (options.status) {
      runQuery.anomalyStatus = new RegExp(options.status.trim(), 'i');
    }
    if (hasDateFilter) {
      runQuery.createdAt = dateFilter;
    }

    if (!isManager) {
      runQuery.machineId = { $in: assignedMachineIds };
    }

    const runs = await AnalysisRun.find(runQuery)
      .populate('machineId', 'code name status')
      .sort({ createdAt: -1 })
      .limit(10);

    counts.analysisRuns = runs.length;
    for (const r of runs) {
      results.push({
        id: r._id.toString(),
        resultType: 'analysisRun',
        title: `${r.runId || 'RUN'} — ${r.machineId?.code || r.machineCode || 'Machine'} Analysis`,
        subtitle: `Class: ${r.predictedClass || 'N/A'} • Anomaly: ${r.anomalyStatus || 'Normal'}`,
        badge: {
          label: (r.anomalyStatus || r.status || 'completed').toUpperCase(),
          variant: r.anomalyStatus === 'anomaly' ? 'warning' : 'healthy'
        },
        excerpt: createExcerpt(`Run ${r.runId}. Machine: ${r.machineId?.code || r.machineCode}. Prediction: ${r.predictedClass}. Anomaly: ${r.anomalyStatus}. ${r.notes || ''}`, q),
        date: r.createdAt,
        url: `#/analysis`,
        factory: {
          id: factoryId,
          name: user.factoryId?.name || 'Local Plant'
        }
      });
    }
  }

  counts.all = results.length;

  return {
    query: q,
    total: results.length,
    counts,
    results,
    searchMethod: 'Indexed Operational Record Search (Factory Scoped)',
    factoryContext: {
      id: factoryId,
      name: user.factoryId?.name || 'Assigned Factory'
    }
  };
}

