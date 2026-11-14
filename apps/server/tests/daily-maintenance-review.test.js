import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import app from '../src/app.js';
import { env } from '../src/config/env.js';
import { TEST_CREDS } from './testCredentials.js';
import { Machine } from '../src/models/Machine.js';
import { Dataset } from '../src/models/Dataset.js';
import { AnalysisRun } from '../src/models/AnalysisRun.js';
import { ModelArtifact } from '../src/models/ModelArtifact.js';
import { Alert } from '../src/models/Alert.js';
import { MaintenanceWorkOrder } from '../src/models/MaintenanceWorkOrder.js';
import { DailyMaintenanceReview } from '../src/models/DailyMaintenanceReview.js';
import { User } from '../src/models/User.js';
import { ALERT_SEVERITIES, ALERT_STATUSES, ALERT_TASK_TYPES } from '@predictive-maintenance/shared';

let server;
let baseUrl;
const createdAlertIds = [];
const createdWorkOrderIds = [];
const createdReviewIds = [];

async function loginUser(email, password) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emailOrUsername: email, password })
  });
  const data = await res.json();
  const setCookie = res.headers.get('set-cookie') || '';
  return { status: res.status, data, setCookie, token: data.sessionToken };
}

test.before(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(env.MONGODB_URI);
  }
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

test.after(async () => {
  // Clean up all created test records
  if (createdAlertIds.length > 0) {
    await Alert.deleteMany({ _id: { $in: createdAlertIds } });
  }
  if (createdWorkOrderIds.length > 0) {
    await MaintenanceWorkOrder.deleteMany({ _id: { $in: createdWorkOrderIds } });
  }
  if (createdReviewIds.length > 0) {
    await DailyMaintenanceReview.deleteMany({ _id: { $in: createdReviewIds } });
  }
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
});

test('DMR 1: Repeated alerts are deduplicated into single issue group with frequency, first/last occurrence, and peak readings', async () => {
  const managerLogin = await loginUser(TEST_CREDS.manager.email, TEST_CREDS.manager.password);
  assert.equal(managerLogin.status, 200);

  const factoryId = managerLogin.data.user.factoryId._id || managerLogin.data.user.factoryId;
  const machine = await Machine.findOne({ factoryId, code: 'GB-104' });
  assert.ok(machine, 'Machine GB-104 should exist in factory');

  const dataset = await Dataset.findOne({ factoryId });
  const model = await ModelArtifact.findOne({ factoryId });
  const analysisRun = await AnalysisRun.findOne({ factoryId });

  const testDate = '2026-11-20';
  const baseTime = new Date(`${testDate}T08:00:00.000Z`).getTime();

  // Create 4 repeated alerts on GB-104 for gear_tooth_wear over a 4-hour window
  const alertDocs = [];
  for (let i = 0; i < 4; i++) {
    const alertTime = new Date(baseTime + i * 60 * 60 * 1000);
    const alert = await Alert.create({
      factoryId,
      machineId: machine._id,
      datasetId: dataset?._id || new mongoose.Types.ObjectId(),
      analysisRunId: analysisRun?._id || new mongoose.Types.ObjectId(),
      modelArtifactId: model?._id || new mongoose.Types.ObjectId(),
      modelDetails: {
        modelName: 'Random Forest Gearbox Classifier',
        modelType: 'random_forest',
        version: '1.0.0'
      },
      title: 'Gear Tooth Wear (Harmonic Deviation Detected)',
      severity: ALERT_SEVERITIES.WARNING,
      status: ALERT_STATUSES.OPEN,
      analysisTask: ALERT_TASK_TYPES.FAULT_CLASSIFICATION,
      interval: {
        startIdx: i * 200,
        endIdx: (i + 1) * 200,
        predictedClass: 'gear_tooth_wear'
      },
      scores: {
        peakScore: 0.72 + i * 0.05,
        calibratedThreshold: 0.50
      },
      contributingSignals: [
        {
          signal: 'vibration_input_axial',
          peakValue: 4.2 + i * 0.3,
          baselineMean: 1.5,
          deviationRatio: 2.8,
          unit: 'mm/s'
        },
        {
          signal: 'temperature_sump',
          peakValue: 62.0 + i * 2.0,
          baselineMean: 50.0,
          deviationRatio: 1.24,
          unit: '°C'
        }
      ],
      createdAt: alertTime,
      updatedAt: alertTime
    });
    alertDocs.push(alert);
    createdAlertIds.push(alert._id);
  }

  // Request Daily Maintenance Review generation for testDate
  const reviewRes = await fetch(`${baseUrl}/api/maintenance-reviews/daily?date=${testDate}`, {
    method: 'GET',
    headers: {
      Cookie: managerLogin.setCookie,
      Accept: 'application/json'
    }
  });

  assert.equal(reviewRes.status, 200);
  const reviewBody = await reviewRes.json();
  assert.equal(reviewBody.success, true);
  assert.ok(reviewBody.review);
  createdReviewIds.push(reviewBody.review._id);

  // Verify grouping and deduplication:
  // All 4 alerts must be consolidated into exactly 1 issue group for GB-104 gear_tooth_wear
  const group = reviewBody.review.issueGroups.find(
    (g) => g.machineCode === 'GB-104' && g.faultType.includes('gear_tooth')
  );
  assert.ok(group, 'Should have consolidated issue group for GB-104 gear tooth wear');
  assert.equal(group.frequency, 4, 'Should count 4 repeated alert occurrences');
  assert.equal(group.alertIds.length, 4, 'Should link all 4 alert IDs');

  // Verify first and last occurrence timestamps
  const expectedFirst = new Date(baseTime).toISOString();
  const expectedLast = new Date(baseTime + 3 * 60 * 60 * 1000).toISOString();
  assert.equal(new Date(group.firstOccurrenceAt).toISOString(), expectedFirst);
  assert.equal(new Date(group.lastOccurrenceAt).toISOString(), expectedLast);

  // Verify peak sensor readings aggregated properly
  assert.ok(group.supportingReadings.peakScore >= 0.85, 'Peak score should reflect highest alert score');
  assert.equal(group.supportingReadings.peakVibrationRms, 5.1, 'Peak vibration RMS should be 5.1 mm/s');
  assert.equal(group.supportingReadings.peakTemperatureC, 68.0, 'Peak temperature should be 68.0 °C');
});

test('DMR 2: Report generation is idempotent for a factory and date (retries update instead of creating duplicates)', async () => {
  const managerLogin = await loginUser(TEST_CREDS.manager.email, TEST_CREDS.manager.password);
  const testDate = '2026-11-20';

  // First call: GET /daily
  const res1 = await fetch(`${baseUrl}/api/maintenance-reviews/daily?date=${testDate}`, {
    method: 'GET',
    headers: { Cookie: managerLogin.setCookie, Accept: 'application/json' }
  });
  assert.equal(res1.status, 200);
  const data1 = await res1.json();
  const id1 = data1.review._id;

  // Second call: POST /generate (explicit retry)
  const res2 = await fetch(`${baseUrl}/api/maintenance-reviews/generate`, {
    method: 'POST',
    headers: {
      Cookie: managerLogin.setCookie,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({ date: testDate })
  });
  assert.equal(res2.status, 200);
  const data2 = await res2.json();
  const id2 = data2.review._id;

  // Document IDs must match exactly
  assert.equal(id1, id2, 'Idempotent report generation must reuse the exact same report document');

  // Verify database count for this factory & date is strictly 1
  const countInDb = await DailyMaintenanceReview.countDocuments({
    factoryId: managerLogin.data.user.factoryId._id || managerLogin.data.user.factoryId,
    reviewDate: testDate
  });
  assert.equal(countInDb, 1, 'Only 1 document should exist in MongoDB for the factory and date');
});

test('DMR 3: Daily maintenance summary separates new issues, recurring issues, unresolved items, and already-linked items', async () => {
  const managerLogin = await loginUser(TEST_CREDS.manager.email, TEST_CREDS.manager.password);
  const factoryId = managerLogin.data.user.factoryId._id || managerLogin.data.user.factoryId;
  const machine = await Machine.findOne({ factoryId, code: 'GB-104' });
  const testDate = '2026-11-21';

  // 1. Create a historical alert 3 days prior (for recurrence check)
  const priorTime = new Date('2026-11-18T10:00:00.000Z');
  const histAlert = await Alert.create({
    factoryId,
    machineId: machine._id,
    datasetId: new mongoose.Types.ObjectId(),
    analysisRunId: new mongoose.Types.ObjectId(),
    modelArtifactId: new mongoose.Types.ObjectId(),
    modelDetails: { modelName: 'Random Forest Gearbox Classifier', modelType: 'random_forest', version: '1.0.0' },
    title: 'Clutch Slippage Detected',
    severity: ALERT_SEVERITIES.WARNING,
    status: ALERT_STATUSES.OPEN,
    analysisTask: ALERT_TASK_TYPES.FAULT_CLASSIFICATION,
    interval: { startIdx: 0, endIdx: 100, predictedClass: 'clutch_slippage' },
    scores: { peakScore: 0.65, calibratedThreshold: 0.50 },
    createdAt: priorTime,
    updatedAt: priorTime
  });
  createdAlertIds.push(histAlert._id);

  // 2. Create today's Clutch Slippage alert (should be classified as recurring_issue because of prior history)
  const todayRecurTime = new Date('2026-11-21T09:00:00.000Z');
  const todayRecurAlert = await Alert.create({
    factoryId,
    machineId: machine._id,
    datasetId: new mongoose.Types.ObjectId(),
    analysisRunId: new mongoose.Types.ObjectId(),
    modelArtifactId: new mongoose.Types.ObjectId(),
    modelDetails: { modelName: 'Random Forest Gearbox Classifier', modelType: 'random_forest', version: '1.0.0' },
    title: 'Clutch Slippage Detected',
    severity: ALERT_SEVERITIES.WARNING,
    status: ALERT_STATUSES.OPEN,
    analysisTask: ALERT_TASK_TYPES.FAULT_CLASSIFICATION,
    interval: { startIdx: 0, endIdx: 100, predictedClass: 'clutch_slippage' },
    scores: { peakScore: 0.70, calibratedThreshold: 0.50 },
    createdAt: todayRecurTime,
    updatedAt: todayRecurTime
  });
  createdAlertIds.push(todayRecurAlert._id);

  // 3. Create a brand new issue today: Bearing Outer Race Fault (should be classified as new_issue)
  const todayNewTime = new Date('2026-11-21T11:00:00.000Z');
  const todayNewAlert = await Alert.create({
    factoryId,
    machineId: machine._id,
    datasetId: new mongoose.Types.ObjectId(),
    analysisRunId: new mongoose.Types.ObjectId(),
    modelArtifactId: new mongoose.Types.ObjectId(),
    modelDetails: { modelName: 'Random Forest Gearbox Classifier', modelType: 'random_forest', version: '1.0.0' },
    title: 'Bearing Outer Race Impact Fault (BPFO)',
    severity: ALERT_SEVERITIES.WARNING,
    status: ALERT_STATUSES.OPEN,
    analysisTask: ALERT_TASK_TYPES.FAULT_CLASSIFICATION,
    interval: { startIdx: 0, endIdx: 100, predictedClass: 'bearing_bpfo' },
    scores: { peakScore: 0.78, calibratedThreshold: 0.50 },
    createdAt: todayNewTime,
    updatedAt: todayNewTime
  });
  createdAlertIds.push(todayNewAlert._id);

  // Generate review for 2026-11-21
  const res = await fetch(`${baseUrl}/api/maintenance-reviews/daily?date=${testDate}`, {
    method: 'GET',
    headers: { Cookie: managerLogin.setCookie, Accept: 'application/json' }
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  createdReviewIds.push(body.review._id);

  const recurGroup = body.review.issueGroups.find((g) => g.faultType.includes('clutch'));
  assert.ok(recurGroup, 'Should find clutch group');
  assert.equal(recurGroup.category, 'recurring_issue', 'Clutch issue must be categorized as recurring_issue');

  const newGroup = body.review.issueGroups.find((g) => g.faultType.includes('bearing'));
  assert.ok(newGroup, 'Should find bearing group');
  assert.equal(newGroup.category, 'new_issue', 'Bearing issue must be categorized as new_issue');

  assert.ok(body.review.summary.newIssuesCount >= 1);
  assert.ok(body.review.summary.recurringIssuesCount >= 1);
});

test('DMR 4: Urgent and critical alerts remain immediately visible and trigger active safety escalation', async () => {
  const managerLogin = await loginUser(TEST_CREDS.manager.email, TEST_CREDS.manager.password);
  const factoryId = managerLogin.data.user.factoryId._id || managerLogin.data.user.factoryId;
  const machine = await Machine.findOne({ factoryId, code: 'GB-104' });
  const testDate = '2026-11-22';

  // Create a CRITICAL alert
  const critAlert = await Alert.create({
    factoryId,
    machineId: machine._id,
    datasetId: new mongoose.Types.ObjectId(),
    analysisRunId: new mongoose.Types.ObjectId(),
    modelArtifactId: new mongoose.Types.ObjectId(),
    modelDetails: { modelName: 'Isolation Forest Anomaly Detector', modelType: 'isolation_forest', version: '1.0.0' },
    title: 'Severe Gearbox Lubrication Starvation & Thermal Runaway',
    severity: ALERT_SEVERITIES.CRITICAL,
    status: ALERT_STATUSES.OPEN,
    analysisTask: ALERT_TASK_TYPES.ANOMALY_DETECTION,
    interval: { startIdx: 0, endIdx: 100, predictedClass: 'thermal_runaway' },
    scores: { peakScore: 0.96, calibratedThreshold: 0.50 },
    contributingSignals: [
      { signal: 'temperature_sump', peakValue: 104.5, baselineMean: 55.0, deviationRatio: 1.9, unit: '°C' }
    ],
    createdAt: new Date(`${testDate}T14:00:00.000Z`)
  });
  createdAlertIds.push(critAlert._id);

  // 1. Verify Real-time Immediate Visibility via /api/alerts:
  // Must return immediately without needing end-of-day review generation
  const realTimeAlertsRes = await fetch(`${baseUrl}/api/alerts?severity=critical`, {
    headers: { Cookie: managerLogin.setCookie, Accept: 'application/json' }
  });
  assert.equal(realTimeAlertsRes.status, 200);
  const realTimeAlertsBody = await realTimeAlertsRes.json();
  const foundInRealtime = realTimeAlertsBody.alerts.some((a) => a._id.toString() === critAlert._id.toString());
  assert.ok(foundInRealtime, 'Critical alert must be immediately visible on the real-time condition alert feed');

  // 2. Verify End-of-Day Review flags immediate safety escalation banner
  const reviewRes = await fetch(`${baseUrl}/api/maintenance-reviews/daily?date=${testDate}`, {
    headers: { Cookie: managerLogin.setCookie, Accept: 'application/json' }
  });
  assert.equal(reviewRes.status, 200);
  const reviewBody = await reviewRes.json();
  createdReviewIds.push(reviewBody.review._id);

  assert.equal(reviewBody.urgentEscalationActive, true, 'Urgent escalation flag must be true');
  assert.ok(reviewBody.urgentNotice.includes('Immediate safety escalation'), 'Must include urgent escalation notice');

  const critGroup = reviewBody.review.issueGroups.find((g) => g.severity === 'CRITICAL');
  assert.ok(critGroup, 'Must have critical issue group');
  assert.equal(critGroup.requiresImmediateAttention, true, 'Group must be marked requiresImmediateAttention');
});

test('DMR 5: Manager reviews issue group, creates work order, links all alerts, and prevents duplicate work orders (409)', async () => {
  const managerLogin = await loginUser(TEST_CREDS.manager.email, TEST_CREDS.manager.password);
  const factoryId = managerLogin.data.user.factoryId._id || managerLogin.data.user.factoryId;
  const tech = await User.findOne({ factoryId, role: 'technician' });
  assert.ok(tech, 'Technician must exist in factory');

  const testDate = '2026-11-20';
  const getReview = await fetch(`${baseUrl}/api/maintenance-reviews/daily?date=${testDate}`, {
    headers: { Cookie: managerLogin.setCookie, Accept: 'application/json' }
  });
  const reviewData = await getReview.json();
  const reviewId = reviewData.review._id;

  const targetGroup = reviewData.review.issueGroups.find((g) => g.category !== 'already_linked');
  assert.ok(targetGroup, 'Should find unlinked issue group from test 1');

  // Create Work Order for this group
  const createRes = await fetch(`${baseUrl}/api/maintenance-reviews/${reviewId}/create-work-order`, {
    method: 'POST',
    headers: {
      Cookie: managerLogin.setCookie,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({
      groupId: targetGroup.groupId,
      assignedTechnicianId: tech._id.toString(),
      priority: 'high',
      grantMachineAccess: true,
      decisionNote: `Assigned to ${tech.fullName} to measure gear tooth backlash and inspect mesh profile.`
    })
  });

  assert.equal(createRes.status, 201);
  const createBody = await createRes.json();
  assert.equal(createBody.success, true);
  assert.ok(createBody.workOrder);
  createdWorkOrderIds.push(createBody.workOrder._id);

  // Verify Work Order fields
  assert.equal(createBody.workOrder.maintenanceReviewId.toString(), reviewId.toString());
  assert.equal(createBody.workOrder.assignedTechnicianId.toString(), tech._id.toString());
  assert.ok(createBody.workOrder.sourceAlertIds.length >= 1);

  // Verify that all alerts in the group now have maintenanceWorkOrderId set
  const updatedAlerts = await Alert.find({ _id: { $in: targetGroup.alertIds } });
  for (const a of updatedAlerts) {
    assert.equal(
      a.maintenanceWorkOrderId.toString(),
      createBody.workOrder._id.toString(),
      'Every alert in the issue group must link to the created work order'
    );
  }

  // ATTEMPT DUPLICATE CREATION: Must reject with HTTP 409 Conflict
  const dupRes = await fetch(`${baseUrl}/api/maintenance-reviews/${reviewId}/create-work-order`, {
    method: 'POST',
    headers: {
      Cookie: managerLogin.setCookie,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({
      groupId: targetGroup.groupId,
      assignedTechnicianId: tech._id.toString(),
      priority: 'high'
    })
  });

  assert.equal(dupRes.status, 409, 'Duplicate work order creation on same issue group must return 409 Conflict');
  const dupBody = await dupRes.json();
  assert.ok(dupBody.message.includes('already linked'), 'Error message must state issue group is already linked');
});

test('DMR 6: Audit trail records report generation, manager decisions, and assignments', async () => {
  const managerLogin = await loginUser(TEST_CREDS.manager.email, TEST_CREDS.manager.password);

  const auditRes = await fetch(`${baseUrl}/api/admin/audit-trail`, {
    headers: { Cookie: managerLogin.setCookie, Accept: 'application/json' }
  });

  assert.equal(auditRes.status, 200);
  const auditBody = await auditRes.json();
  assert.ok(Array.isArray(auditBody.auditEvents));

  const dmrGenEvent = auditBody.auditEvents.find((e) => e.type === 'daily_review_generated');
  assert.ok(dmrGenEvent, 'Audit trail must contain daily_review_generated event');
  assert.ok(dmrGenEvent.title.includes('Daily Maintenance Review'));

  const dmrDecisionEvent = auditBody.auditEvents.find((e) => e.type === 'work_order_created' && e.category === 'Maintenance Review');
  assert.ok(dmrDecisionEvent, 'Audit trail must contain manager review decision event');
  assert.ok(/created work order/i.test(dmrDecisionEvent.description));
});
