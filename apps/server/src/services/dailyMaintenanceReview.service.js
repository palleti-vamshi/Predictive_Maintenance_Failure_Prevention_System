import mongoose from 'mongoose';
import {
  DailyMaintenanceReview,
  Alert,
  MaintenanceWorkOrder,
  Machine,
  User
} from '../models/index.js';
import { WORK_ORDER_STATUS, WORK_ORDER_PRIORITY } from '@predictive-maintenance/shared';

/**
 * Normalizes fault/anomaly class names into structured slugs and human labels.
 */
function normalizeFaultType(alert) {
  const raw =
    alert.interval?.predictedClass ||
    alert.triggeringPath ||
    alert.title ||
    'statistical_anomaly';

  const slug = String(raw)
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');

  let label = alert.title || 'Mechanical Anomaly';
  if (slug.includes('gear_tooth') || slug.includes('gear_wear')) {
    label = 'Gear Tooth Wear (Harmonic Mesh Excitation)';
  } else if (slug.includes('clutch')) {
    label = 'Clutch Slippage (Torque Capacity Loss)';
  } else if (slug.includes('bearing') || slug.includes('inner_race') || slug.includes('outer_race')) {
    label = 'Bearing Raceway Degradation (BPFO/BPFI)';
  } else if (slug.includes('lubrication') || slug.includes('lube')) {
    label = 'Gearbox Lubrication Failure (Boundary Friction Surge)';
  } else if (slug.includes('cooling') || slug.includes('thermal')) {
    label = 'Thermal Runaway & Cooling Impairment';
  } else if (slug.includes('misalignment')) {
    label = 'Shaft Angular/Parallel Misalignment';
  } else if (slug.includes('statistical_anomaly') || slug.includes('isolation_forest')) {
    label = 'Out-of-Distribution Vibration Anomaly (Isolation Forest)';
  }

  return { slug, label };
}

/**
 * Extracts and aggregates supporting sensor readings across all alerts in an issue group.
 */
function aggregateSupportingReadings(alertsInGroup) {
  let peakScore = 0;
  let calibratedThreshold = 0;
  let peakVibrationRms = null;
  let peakTemperatureC = null;
  let peakSpeedRpm = null;
  const signalMap = new Map();
  const featureMap = new Map();

  for (const alert of alertsInGroup) {
    if (alert.scores) {
      if (typeof alert.scores.peakScore === 'number' && alert.scores.peakScore > peakScore) {
        peakScore = alert.scores.peakScore;
      }
      if (typeof alert.scores.calibratedThreshold === 'number' && alert.scores.calibratedThreshold > calibratedThreshold) {
        calibratedThreshold = alert.scores.calibratedThreshold;
      }
    }

    if (Array.isArray(alert.contributingSignals)) {
      for (const sig of alert.contributingSignals) {
        if (!sig || !sig.signal) continue;
        const sName = sig.signal.toLowerCase();
        const peakVal = Number(sig.peakValue) || 0;

        if (sName.includes('vib') || sName.includes('accel') || sig.unit === 'mm/s') {
          if (peakVibrationRms === null || peakVal > peakVibrationRms) {
            peakVibrationRms = peakVal;
          }
        }
        if (sName.includes('temp') || sName.includes('thermal') || sig.unit === '°C') {
          if (peakTemperatureC === null || peakVal > peakTemperatureC) {
            peakTemperatureC = peakVal;
          }
        }
        if (sName.includes('speed') || sName.includes('rpm') || sig.unit === 'RPM') {
          if (peakSpeedRpm === null || peakVal > peakSpeedRpm) {
            peakSpeedRpm = peakVal;
          }
        }

        if (!signalMap.has(sig.signal) || peakVal > (signalMap.get(sig.signal).peakValue || 0)) {
          signalMap.set(sig.signal, {
            signal: sig.signal,
            peakValue: peakVal,
            baselineMean: Number(sig.baselineMean) || 0,
            deviationRatio: Number(sig.deviationRatio) || 1,
            unit: sig.unit || 'mm/s'
          });
        }
      }
    }

    if (Array.isArray(alert.contributingFeatures)) {
      for (const feat of alert.contributingFeatures) {
        if (!feat || !feat.feature) continue;
        if (!featureMap.has(feat.feature)) {
          featureMap.set(feat.feature, {
            feature: feat.feature,
            value: Number(feat.value) || 0,
            attribution: Number(feat.attribution) || 0,
            interpretation: feat.interpretation || ''
          });
        }
      }
    }
  }

  return {
    peakScore: Number(peakScore.toFixed(4)),
    calibratedThreshold: Number(calibratedThreshold.toFixed(4)),
    peakVibrationRms: peakVibrationRms !== null ? Number(peakVibrationRms.toFixed(3)) : null,
    peakTemperatureC: peakTemperatureC !== null ? Number(peakTemperatureC.toFixed(1)) : null,
    peakSpeedRpm: peakSpeedRpm !== null ? Number(peakSpeedRpm.toFixed(0)) : null,
    contributingSignals: Array.from(signalMap.values()).slice(0, 8),
    topFeatures: Array.from(featureMap.values()).slice(0, 8)
  };
}

/**
 * Idempotently generates or refreshes a Daily Maintenance Review for a factory and date.
 * Groups alerts by machine and fault type, deduplicates repeat alerts, and computes summaries.
 */
export async function generateDailyMaintenanceReview({
  factoryId,
  reviewDate,
  userId,
  userName,
  userRole = 'factory_manager'
}) {
  if (!factoryId) {
    throw new Error('Factory ID is required to generate a daily maintenance review.');
  }

  const dateStr = reviewDate || new Date().toISOString().split('T')[0];
  const startOfDay = new Date(`${dateStr}T00:00:00.000Z`);
  const endOfDay = new Date(`${dateStr}T23:59:59.999Z`);
  const historyCutoff = new Date(startOfDay.getTime() - 14 * 24 * 60 * 60 * 1000);

  // 1. Check if a report already exists for this exact factory & date
  const existingReview = await DailyMaintenanceReview.findOne({
    factoryId,
    reviewDate: dateStr
  });

  // 2. Fetch current day's alerts, preceding 14-day history, and carryover open alerts
  const [dayAlerts, historicalAlerts, carryoverOpenAlerts] = await Promise.all([
    Alert.find({
      factoryId,
      createdAt: { $gte: startOfDay, $lte: endOfDay }
    })
      .populate('machineId', 'code name type assignedTechnicians')
      .populate('maintenanceWorkOrderId', 'orderNumber status priority')
      .lean(),
    Alert.find({
      factoryId,
      createdAt: { $gte: historyCutoff, $lt: startOfDay }
    })
      .select('machineId interval triggeringPath title severity createdAt')
      .lean(),
    Alert.find({
      factoryId,
      createdAt: { $lt: startOfDay },
      status: { $in: ['open', 'OPEN'] },
      maintenanceWorkOrderId: null
    })
      .populate('machineId', 'code name type assignedTechnicians')
      .lean()
  ]);

  // Merge today's alerts with any carryover open alerts to evaluate complete plant status
  const allEvaluatedAlerts = [...dayAlerts];
  const seenAlertIds = new Set(dayAlerts.map((a) => a._id.toString()));
  for (const co of carryoverOpenAlerts) {
    if (!seenAlertIds.has(co._id.toString())) {
      allEvaluatedAlerts.push(co);
      seenAlertIds.add(co._id.toString());
    }
  }

  // 3. Build Historical Recurrence Lookup Map: Key = `${machineId}_${slug}`
  const historyKeySet = new Set();
  for (const hist of historicalAlerts) {
    const mId = (hist.machineId?._id || hist.machineId)?.toString();
    if (!mId) continue;
    const { slug } = normalizeFaultType(hist);
    historyKeySet.add(`${mId}_${slug}`);
  }

  // 4. Map Existing Decisions if Review Document Exists (preserve manager actions upon refresh)
  const existingDecisionsMap = new Map();
  if (existingReview && Array.isArray(existingReview.issueGroups)) {
    for (const g of existingReview.issueGroups) {
      if (g.groupId && g.managerDecision && g.managerDecision.decision !== 'pending') {
        existingDecisionsMap.set(g.groupId, {
          managerDecision: g.managerDecision,
          linkedWorkOrderId: g.linkedWorkOrderId,
          linkedWorkOrderNumber: g.linkedWorkOrderNumber,
          category: g.category
        });
      }
    }
  }

  // 5. Group alerts by machine and fault type
  const groupsMap = new Map();

  for (const alert of allEvaluatedAlerts) {
    const machineObj = alert.machineId;
    const machineIdStr = (machineObj?._id || machineObj)?.toString() || 'unknown';
    const machineCode = machineObj?.code || 'GB-UNKNOWN';
    const machineName = machineObj?.name || 'Industrial Equipment';

    const { slug, label } = normalizeFaultType(alert);
    const groupKey = `${machineCode}_${slug}`;

    if (!groupsMap.has(groupKey)) {
      groupsMap.set(groupKey, {
        groupId: `IG-${groupKey}`,
        machineId: machineObj?._id || machineObj,
        machineCode,
        machineName,
        faultType: slug,
        faultLabel: label,
        alerts: []
      });
    }

    groupsMap.get(groupKey).alerts.push(alert);
  }

  // 6. Process each issue group
  const issueGroups = [];

  for (const [key, groupData] of groupsMap.entries()) {
    const alerts = groupData.alerts;
    const alertIds = alerts.map((a) => a._id);
    const frequency = alerts.length;

    // First and last occurrence
    const sortedAlerts = [...alerts].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const firstOccurrenceAt = new Date(sortedAlerts[0].createdAt);
    const lastOccurrenceAt = new Date(sortedAlerts[sortedAlerts.length - 1].createdAt);

    // Max severity
    const severities = alerts.map((a) => (a.severity || 'warning').toUpperCase());
    let groupSeverity = 'INFO';
    if (severities.includes('CRITICAL')) {
      groupSeverity = 'CRITICAL';
    } else if (severities.includes('WARNING')) {
      groupSeverity = 'WARNING';
    }

    // Critical urgent flag
    const requiresImmediateAttention = groupSeverity === 'CRITICAL';

    // Supporting sensor readings & evidence features
    const supportingReadings = aggregateSupportingReadings(alerts);

    // Analysis run IDs
    const runIds = Array.from(
      new Set(
        alerts
          .map((a) => a.analysisRunId?._id || a.analysisRunId)
          .filter(Boolean)
          .map((id) => id.toString())
      )
    );

    // Check if any alert is already linked to a work order
    let linkedWorkOrderId = null;
    let linkedWorkOrderNumber = null;
    for (const a of alerts) {
      if (a.maintenanceWorkOrderId) {
        linkedWorkOrderId = a.maintenanceWorkOrderId?._id || a.maintenanceWorkOrderId;
        linkedWorkOrderNumber = a.maintenanceWorkOrderId?.orderNumber || null;
        break;
      }
    }

    // Determine category
    const mIdStr = (groupData.machineId?._id || groupData.machineId)?.toString();
    const hasHistory = historyKeySet.has(`${mIdStr}_${groupData.faultType}`);
    const isCarryover = alerts.every((a) => new Date(a.createdAt) < startOfDay);

    let category = 'new_issue';
    if (linkedWorkOrderId) {
      category = 'already_linked';
    } else if (hasHistory || frequency >= 3) {
      category = 'recurring_issue';
    } else if (isCarryover) {
      category = 'unresolved_item';
    } else {
      category = 'new_issue';
    }

    // Restore existing manager decision if present
    const existing = existingDecisionsMap.get(groupData.groupId);
    let managerDecision = {
      decision: 'pending',
      decisionNote: null,
      decidedAt: null,
      decidedById: null,
      decidedByName: null
    };

    if (existing) {
      managerDecision = existing.managerDecision;
      if (existing.linkedWorkOrderId) {
        linkedWorkOrderId = existing.linkedWorkOrderId;
        linkedWorkOrderNumber = existing.linkedWorkOrderNumber;
        category = 'already_linked';
      }
    }

    issueGroups.push({
      groupId: groupData.groupId,
      machineId: groupData.machineId,
      machineCode: groupData.machineCode,
      machineName: groupData.machineName,
      faultType: groupData.faultType,
      faultLabel: groupData.faultLabel,
      category,
      alertIds,
      frequency,
      firstOccurrenceAt,
      lastOccurrenceAt,
      severity: groupSeverity,
      requiresImmediateAttention,
      supportingReadings,
      analysisRunIds: runIds,
      linkedWorkOrderId,
      linkedWorkOrderNumber,
      managerDecision
    });
  }

  // 7. Compute Summary Aggregates
  const totalAlertsEvaluated = allEvaluatedAlerts.length;
  const totalIssueGroups = issueGroups.length;
  const newIssuesCount = issueGroups.filter((g) => g.category === 'new_issue' && !g.linkedWorkOrderId).length;
  const recurringIssuesCount = issueGroups.filter((g) => g.category === 'recurring_issue' && !g.linkedWorkOrderId).length;
  const unresolvedCount = issueGroups.filter((g) => g.category === 'unresolved_item' && !g.linkedWorkOrderId).length;
  const alreadyLinkedCount = issueGroups.filter((g) => g.category === 'already_linked' || g.linkedWorkOrderId).length;
  const criticalUrgentCount = issueGroups.filter((g) => g.severity === 'CRITICAL').length;
  const warningCount = issueGroups.filter((g) => g.severity === 'WARNING').length;
  const workOrdersCreatedCount = issueGroups.filter((g) => g.managerDecision?.decision === 'work_order_created').length;

  const summary = {
    totalAlertsEvaluated,
    totalIssueGroups,
    newIssuesCount,
    recurringIssuesCount,
    unresolvedCount,
    alreadyLinkedCount,
    criticalUrgentCount,
    warningCount,
    workOrdersCreatedCount
  };

  // 8. Persist or Update Idempotently
  if (existingReview) {
    existingReview.issueGroups = issueGroups;
    existingReview.summary = summary;
    existingReview.auditLog.push({
      action: 'report_refreshed',
      performedById: userId,
      performedByName: userName || 'Factory Manager',
      performedByRole: userRole,
      timestamp: new Date(),
      details: `Refreshed daily maintenance review for ${dateStr}. Evaluated ${totalAlertsEvaluated} alerts across ${totalIssueGroups} issue groups.`,
      metadata: { reviewDate: dateStr, criticalUrgentCount, issueGroupsCount: totalIssueGroups }
    });
    await existingReview.save();
    return existingReview;
  }

  // Generate Report Number: DMR-YYYYMMDD-XXX
  const reportNumber = `DMR-${dateStr.replace(/-/g, '')}-${String(Math.floor(100 + Math.random() * 900))}`;

  const newReview = await DailyMaintenanceReview.create({
    factoryId,
    reviewDate: dateStr,
    reportNumber,
    status: 'in_review',
    generatedAt: new Date(),
    generatedById: userId,
    generatedByName: userName || 'Factory Manager',
    summary,
    issueGroups,
    auditLog: [
      {
        action: 'report_generated',
        performedById: userId,
        performedByName: userName || 'Factory Manager',
        performedByRole: userRole,
        timestamp: new Date(),
        details: `Initial daily maintenance review generated for ${dateStr}. Triaged ${totalAlertsEvaluated} alerts into ${totalIssueGroups} deduplicated issue groups.`,
        metadata: { reviewDate: dateStr, criticalUrgentCount, issueGroupsCount: totalIssueGroups }
      }
    ]
  });

  return newReview;
}

/**
 * Creates and assigns a work order from a specific issue group in the daily maintenance review.
 * Links all alerts in the issue group to the work order to prevent duplicate orders.
 */
export async function createWorkOrderForIssueGroup({
  reviewId,
  groupId,
  workOrderData,
  user
}) {
  const factoryId = user.factoryId?._id || user.factoryId;
  const review = await DailyMaintenanceReview.findOne({ _id: reviewId, factoryId });

  if (!review) {
    const error = new Error('Daily maintenance review not found or unauthorized.');
    error.status = 404;
    throw error;
  }

  const group = review.issueGroups.find((g) => g.groupId === groupId || g._id?.toString() === groupId);
  if (!group) {
    const error = new Error(`Issue group "${groupId}" was not found in this maintenance review.`);
    error.status = 404;
    throw error;
  }

  // Prevent duplicate work orders on the same issue group
  if (group.linkedWorkOrderId) {
    const error = new Error(
      `Issue group "${group.faultLabel}" is already linked to work order ${group.linkedWorkOrderNumber || group.linkedWorkOrderId}. Duplicate creation prevented.`
    );
    error.status = 409;
    throw error;
  }

  // Validate technician
  const technicianId = workOrderData.assignedTechnicianId;
  if (!technicianId) {
    const error = new Error('An assigned technician ID is required to create a maintenance work order.');
    error.status = 400;
    throw error;
  }

  const technician = await User.findOne({ _id: technicianId, factoryId, role: 'technician' });
  if (!technician) {
    const error = new Error('Assigned technician not found in this factory.');
    error.status = 400;
    throw error;
  }

  // Check machine access or auto-grant if requested
  const isAssignedToMachine = technician.assignedMachines?.some(
    (m) => m.toString() === group.machineId.toString()
  );

  if (!isAssignedToMachine) {
    if (workOrderData.grantMachineAccess === true) {
      await User.findByIdAndUpdate(technician._id, {
        $addToSet: { assignedMachines: group.machineId }
      });
      await Machine.findByIdAndUpdate(group.machineId, {
        $addToSet: { assignedTechnicians: technician._id }
      });
    } else {
      const error = new Error(
        `Technician ${technician.fullName} is not authorized for machine ${group.machineCode}. Pass grantMachineAccess: true to grant authorization.`
      );
      error.status = 400;
      throw error;
    }
  }

  // Generate unique order number: WO-YYYYMMDD-SEQ
  const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const count = await MaintenanceWorkOrder.countDocuments({ factoryId });
  const orderNumber = `WO-${dateStr}-${String(count + 1).padStart(3, '0')}`;

  const priority = workOrderData.priority || (group.severity === 'CRITICAL' ? WORK_ORDER_PRIORITY.URGENT : WORK_ORDER_PRIORITY.HIGH);
  const dueDate = workOrderData.dueDate ? new Date(workOrderData.dueDate) : new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);

  const title = workOrderData.title || `[DMR] ${group.machineCode} - ${group.faultLabel}`;
  const description =
    workOrderData.description ||
    `End-of-day maintenance assignment generated from review ${review.reportNumber}.\n` +
    `Issue: ${group.faultLabel} (${group.frequency} deduplicated alert instances).\n` +
    `First detected: ${new Date(group.firstOccurrenceAt).toLocaleString()} | Last detected: ${new Date(group.lastOccurrenceAt).toLocaleString()}.\n` +
    `Peak Vibration: ${group.supportingReadings.peakVibrationRms !== null ? group.supportingReadings.peakVibrationRms + ' mm/s' : 'N/A'} | ` +
    `Peak Temperature: ${group.supportingReadings.peakTemperatureC !== null ? group.supportingReadings.peakTemperatureC + ' °C' : 'N/A'}.\n` +
    `Instructions: Inspect component, perform baseline vibration check, and follow equipment-specific LOTO before maintenance.`;

  // Create Work Order
  const newWorkOrder = await MaintenanceWorkOrder.create({
    factoryId,
    machineId: group.machineId,
    orderNumber,
    title,
    description,
    priority,
    status: WORK_ORDER_STATUS.ASSIGNED,
    dueDate,
    assignedTechnicianId: technician._id,
    createdById: user._id,
    sourceAlertId: group.alertIds[0] || null,
    sourceAlertIds: group.alertIds,
    sourceAnalysisRunId: group.analysisRunIds[0] || null,
    maintenanceReviewId: review._id,
    statusHistory: [
      {
        status: WORK_ORDER_STATUS.ASSIGNED,
        changedById: user._id,
        changedByName: user.fullName,
        changedByRole: user.role,
        timestamp: new Date(),
        note: `Created from Daily Maintenance Review ${review.reportNumber} (Issue Group ${group.groupId}).`
      }
    ]
  });

  // Atomically update all alerts in the issue group to link this work order
  await Alert.updateMany(
    { _id: { $in: group.alertIds } },
    {
      $set: {
        maintenanceWorkOrderId: newWorkOrder._id,
        status: 'IN_REVIEW'
      }
    }
  );

  // Update Issue Group in Review Document
  group.category = 'already_linked';
  group.linkedWorkOrderId = newWorkOrder._id;
  group.linkedWorkOrderNumber = newWorkOrder.orderNumber;
  group.managerDecision = {
    decision: 'work_order_created',
    decisionNote: workOrderData.decisionNote || `Assigned to ${technician.fullName} with ${priority.toUpperCase()} priority.`,
    decidedAt: new Date(),
    decidedById: user._id,
    decidedByName: user.fullName
  };

  // Update Summary Counts
  review.summary.alreadyLinkedCount = review.issueGroups.filter((g) => g.category === 'already_linked' || g.linkedWorkOrderId).length;
  review.summary.newIssuesCount = review.issueGroups.filter((g) => g.category === 'new_issue' && !g.linkedWorkOrderId).length;
  review.summary.recurringIssuesCount = review.issueGroups.filter((g) => g.category === 'recurring_issue' && !g.linkedWorkOrderId).length;
  review.summary.unresolvedCount = review.issueGroups.filter((g) => g.category === 'unresolved_item' && !g.linkedWorkOrderId).length;
  review.summary.workOrdersCreatedCount = (review.summary.workOrdersCreatedCount || 0) + 1;

  // Add Audit Trail Record
  review.auditLog.push({
    action: 'work_order_created',
    performedById: user._id,
    performedByName: user.fullName,
    performedByRole: user.role,
    timestamp: new Date(),
    details: `Manager created work order ${newWorkOrder.orderNumber} for issue group "${group.faultLabel}" on machine ${group.machineCode}, assigned to ${technician.fullName}.`,
    metadata: {
      orderNumber: newWorkOrder.orderNumber,
      workOrderId: newWorkOrder._id,
      groupId: group.groupId,
      machineCode: group.machineCode,
      technicianId: technician._id,
      technicianName: technician.fullName,
      alertsLinkedCount: group.alertIds.length
    }
  });

  await review.save();

  return {
    success: true,
    workOrder: newWorkOrder,
    review
  };
}

/**
 * Dismisses or acknowledges an issue group in the review with a documented manager rationale.
 */
export async function dismissIssueGroup({
  reviewId,
  groupId,
  reason,
  user
}) {
  const factoryId = user.factoryId?._id || user.factoryId;
  const review = await DailyMaintenanceReview.findOne({ _id: reviewId, factoryId });

  if (!review) {
    const error = new Error('Daily maintenance review not found or unauthorized.');
    error.status = 404;
    throw error;
  }

  const group = review.issueGroups.find((g) => g.groupId === groupId || g._id?.toString() === groupId);
  if (!group) {
    const error = new Error(`Issue group "${groupId}" was not found in this maintenance review.`);
    error.status = 404;
    throw error;
  }

  if (group.linkedWorkOrderId) {
    const error = new Error('Cannot dismiss an issue group that already has an active linked work order.');
    error.status = 400;
    throw error;
  }

  group.managerDecision = {
    decision: 'dismissed',
    decisionNote: reason || 'Dismissed by manager review (non-critical / planned observation).',
    decidedAt: new Date(),
    decidedById: user._id,
    decidedByName: user.fullName
  };

  // Acknowledge all alerts in the group
  await Alert.updateMany(
    { _id: { $in: group.alertIds } },
    {
      $set: {
        status: 'ACKNOWLEDGED',
        acknowledgedAt: new Date(),
        acknowledgedById: user._id,
        acknowledgedByName: user.fullName
      }
    }
  );

  review.auditLog.push({
    action: 'issue_dismissed',
    performedById: user._id,
    performedByName: user.fullName,
    performedByRole: user.role,
    timestamp: new Date(),
    details: `Manager dismissed issue group "${group.faultLabel}" on machine ${group.machineCode}. Rationale: ${reason || 'None provided.'}`,
    metadata: {
      groupId: group.groupId,
      machineCode: group.machineCode,
      reason
    }
  });

  await review.save();

  return {
    success: true,
    review
  };
}
