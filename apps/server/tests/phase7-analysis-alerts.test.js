import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import app from '../src/app.js';
import { AnalysisRun } from '../src/models/AnalysisRun.js';
import { Alert } from '../src/models/Alert.js';
import { ModelArtifact } from '../src/models/ModelArtifact.js';
import { Dataset } from '../src/models/Dataset.js';
import { Machine } from '../src/models/Machine.js';
import { MaintenanceWorkOrder } from '../src/models/MaintenanceWorkOrder.js';
import {
  ANALYSIS_RUN_STATUS,
  ALERT_STATUSES,
  ALERT_SEVERITIES,
  WORK_ORDER_STATUS,
  WORK_ORDER_PRIORITY
} from '@predictive-maintenance/shared';
import { TEST_CREDS } from './testCredentials.js';

let server;
let baseUrl;

test.before(async () => {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/predictive_maintenance');
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
});

async function loginUser(email, password) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emailOrUsername: email, password })
  });
  const data = await res.json();
  return { status: res.status, data, token: data.sessionToken };
}

test('Pre-flight Rejection: Incompatible dataset and model combinations return 400 with explanation', async () => {
  const { token } = await loginUser(TEST_CREDS.manager.email, TEST_CREDS.manager.password);

  // Find CWRU bearing dataset (vibration_drive_end, vibration_fan_end)
  const cwruDs = await Dataset.findOne({ title: /CWRU/i });
  assert.ok(cwruDs, 'CWRU reference dataset must exist');

  // Find Gearbox Random Forest model (expects gear vibration signals like vibration_input_axial, radial)
  const rfGearModel = await ModelArtifact.findOne({ name: /Random Forest Gear Fault Classifier/i });
  assert.ok(rfGearModel, 'RF gear model must exist');

  const machineGB104 = await Machine.findOne({ code: 'GB-104' });
  assert.ok(machineGB104, 'GB-104 machine must exist');

  // Attempt to run analysis on CWRU bearing dataset with Gearbox model
  const runRes = await fetch(`${baseUrl}/api/analysis-runs`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      datasetId: cwruDs._id,
      modelArtifactId: rfGearModel._id,
      machineId: machineGB104._id,
      sync: true
    })
  });

  assert.equal(runRes.status, 400);
  const runData = await runRes.json();
  assert.ok(runData.error.includes('Incompatible') || runData.message.includes('Incompatible'));
  assert.ok(
    runData.message.includes('do not match') || runData.message.includes('produce'),
    'Error message must clearly explain signal incompatibility without silent coercion'
  );
});

test('Cross-Factory Isolation: Chennai user cannot view or run analysis on Pune assets', async () => {
  const { token: clevelandToken } = await loginUser(TEST_CREDS.chennaiManager.email, TEST_CREDS.chennaiManager.password);

  const machineGB104 = await Machine.findOne({ code: 'GB-104' });
  const rfGearModel = await ModelArtifact.findOne({ name: /Random Forest Gear Fault Classifier/i });
  const opDs = await Dataset.findOne({ title: /GB-104 Extruder/i });

  // Attempt to initiate analysis run across factory boundary
  const createRes = await fetch(`${baseUrl}/api/analysis-runs`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${clevelandToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      datasetId: opDs._id,
      modelArtifactId: rfGearModel._id,
      machineId: machineGB104._id
    })
  });
  assert.equal(createRes.status, 404, 'Accessing machine outside authorized factory must return 404');

  // Attempt to view seeded analysis run by ID
  const seededRun = await AnalysisRun.findOne({ machineId: machineGB104._id });
  if (seededRun) {
    const getRes = await fetch(`${baseUrl}/api/analysis-runs/${seededRun._id}`, {
      headers: { Authorization: `Bearer ${clevelandToken}` }
    });
    assert.equal(getRes.status, 404, 'Detroit analysis run must return 404 to Cleveland user');
  }
});

test('Verified Analysis Run Execution & Immutability: Run outputs frozen with provenance', async () => {
  const { token } = await loginUser(TEST_CREDS.manager.email, TEST_CREDS.manager.password);

  const machineGB104 = await Machine.findOne({ code: 'GB-104' });
  const isoModel = await ModelArtifact.findOne({ modelType: 'isolation_forest' });
  const opDs = await Dataset.findOne({ title: /GB-104 Extruder/i });

  // Trigger analysis run
  const res = await fetch(`${baseUrl}/api/analysis-runs`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      datasetId: opDs._id,
      modelArtifactId: isoModel._id,
      machineId: machineGB104._id,
      configuration: {
        windowSize: 16,
        overlapRatio: 0.5
      },
      sync: true
    })
  });

  assert.equal(res.status, 201);
  const { analysisRun } = await res.json();

  assert.equal(analysisRun.status, ANALYSIS_RUN_STATUS.COMPLETED);
  assert.equal(analysisRun.isImmutable, true, 'Analysis run must be marked immutable');
  assert.ok(analysisRun.fileChecksumSha256, 'Dataset SHA256 checksum must be preserved');
  assert.ok(analysisRun.featurePipelineVersion, 'Pipeline version must be recorded');
  assert.ok(Array.isArray(analysisRun.intervals), 'Intervals must be an array');
  assert.ok(analysisRun.summary.totalWindows > 0, 'Total windows must be > 0');

  // Verify intervals contain required physical and SHAP evidence
  if (analysisRun.intervals.length > 0) {
    const intv = analysisRun.intervals[0];
    assert.ok(intv.start_time !== undefined, 'Start time should be present');
    assert.ok(intv.score > 0, 'Anomaly score must be positive');
    assert.ok(intv.calibrated_threshold !== undefined && intv.calibrated_threshold !== null, 'Calibrated threshold must be recorded');
    assert.ok(intv.disclaimer, 'Scientific disclaimer must be present');
    assert.ok(
      intv.disclaimer.includes('statistical') || intv.disclaimer.includes('prediction'),
      'Disclaimer must clarify statistical nature of prediction'
    );
  }
});

test('Evidence-Based Alerts: Verified intervals serialize contributing signals, SHAP, and disclaimers', async () => {
  const { token } = await loginUser(TEST_CREDS.tech.email, TEST_CREDS.tech.password);

  // Retrieve alert list
  const listRes = await fetch(`${baseUrl}/api/alerts`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(listRes.status, 200);
  const { alerts } = await listRes.json();
  assert.ok(alerts.length > 0, 'Seeded alerts must exist');

  const alertId = alerts[0]._id;

  // Retrieve full alert record
  const getRes = await fetch(`${baseUrl}/api/alerts/${alertId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(getRes.status, 200);
  const { alert } = await getRes.json();

  // 1. Context and sample range
  assert.ok(alert.machineId, 'Machine context must be present');
  assert.ok(alert.interval.startIdx !== undefined, 'Interval start sample index must be recorded');
  assert.ok(alert.interval.endIdx !== undefined, 'Interval end sample index must be recorded');

  // 2. Calibrated decision threshold & scores
  assert.ok(alert.scores.peakScore !== null && alert.scores.peakScore !== undefined, 'Peak score must be recorded');
  assert.ok(alert.scores.calibratedThreshold !== null && alert.scores.calibratedThreshold !== undefined, 'Calibrated decision threshold must be recorded');
  assert.equal(alert.scores.isCalibrated, true, 'Threshold must be marked calibrated');

  // 3. Contributing physical signals
  assert.ok(Array.isArray(alert.contributingSignals), 'Contributing signals must be an array');
  if (alert.contributingSignals.length > 0) {
    const cs = alert.contributingSignals[0];
    assert.ok(cs.signal, 'Signal name must be populated');
    assert.ok(cs.baselineMean !== undefined, 'Baseline mean must be populated');
    assert.ok(cs.deviationRatio !== undefined, 'Deviation ratio must be populated');
  }

  // 4. Contributing features and SHAP attribution
  assert.ok(Array.isArray(alert.contributingFeatures), 'Contributing features must be an array');
  assert.ok(alert.shapAttribution, 'SHAP attribution object must be present');
  assert.ok(
    alert.shapAttribution.explainerType,
    'SHAP explainer type must be documented'
  );

  // 5. Scientific limitations and data sufficiency
  assert.ok(alert.dataQuality.sufficiencyScore > 0, 'Data sufficiency score must be > 0');
  assert.ok(Array.isArray(alert.limitations) && alert.limitations.length > 0, 'Limitations must be stated');
  assert.ok(alert.severityNote, 'Severity note disclaimer must be present');
});

test('Technician Interaction: Acknowledge alert and log observation notes without altering analysis', async () => {
  const { token: techToken } = await loginUser(TEST_CREDS.tech.email, TEST_CREDS.tech.password);

  const alerts = await Alert.find({ status: ALERT_STATUSES.OPEN });
  assert.ok(alerts.length > 0, 'At least one open alert must be available');
  const alert = alerts[0];

  // 1. Technician acknowledges alert
  const ackRes = await fetch(`${baseUrl}/api/alerts/${alert._id}/acknowledge`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${techToken}` }
  });
  assert.equal(ackRes.status, 200);
  const ackData = await ackRes.json();
  assert.equal(ackData.alert.status, ALERT_STATUSES.ACKNOWLEDGED);
  assert.ok(ackData.alert.acknowledgedAt, 'Acknowledgement timestamp must be set');

  // 2. Technician logs observation note
  const obsRes = await fetch(`${baseUrl}/api/alerts/${alert._id}/observations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${techToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      note: 'Field inspection performed at 14:00. Measured 4.8 mm/s peak vibration on input shaft bearing.'
    })
  });
  assert.equal(obsRes.status, 200);
  const obsData = await obsRes.json();
  assert.ok(obsData.alert.technicianObservations.length > 0);
  assert.equal(
    obsData.alert.technicianObservations[obsData.alert.technicianObservations.length - 1].note,
    'Field inspection performed at 14:00. Measured 4.8 mm/s peak vibration on input shaft bearing.'
  );

  // 3. Verify original AnalysisRun remains completely immutable
  const originalRun = await AnalysisRun.findById(alert.analysisRunId);
  assert.ok(originalRun, 'Associated analysis run must exist');
  assert.equal(originalRun.isImmutable, true, 'Analysis run must remain frozen and immutable');
});

test('Work Order Creation from Alert: Manager creates task; enforces technician machine assignment', async () => {
  const { token: mgrToken } = await loginUser(TEST_CREDS.manager.email, TEST_CREDS.manager.password);
  const { token: techToken } = await loginUser(TEST_CREDS.tech.email, TEST_CREDS.tech.password);

  const alert = await Alert.findOne({ maintenanceWorkOrderId: null });
  assert.ok(alert, 'Unlinked alert must exist');

  const techUser = await mongoose.model('User').findOne({ email: TEST_CREDS.tech.email });
  assert.ok(techUser, 'Pune technician must exist');

  // Non-manager (technician) cannot create work order from alert (403 Forbidden)
  const forbiddenRes = await fetch(`${baseUrl}/api/alerts/${alert._id}/work-order`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${techToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      title: 'Unauthorized Work Order',
      description: 'Should fail',
      priority: WORK_ORDER_PRIORITY.HIGH,
      dueDate: new Date(Date.now() + 86400000).toISOString(),
      assignedTechnicianId: techUser._id
    })
  });
  assert.equal(forbiddenRes.status, 403, 'Technician cannot create work order');

  // Manager creates work order from alert
  const createRes = await fetch(`${baseUrl}/api/alerts/${alert._id}/work-order`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${mgrToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      title: 'Investigate High-Frequency Bearing Resonance',
      description: 'Follow-up on Alert and verify pinion alignment and lubricant viscosity.',
      priority: WORK_ORDER_PRIORITY.HIGH,
      dueDate: new Date(Date.now() + 2 * 86400000).toISOString(),
      assignedTechnicianId: techUser._id
    })
  });

  assert.equal(createRes.status, 201);
  const { workOrder } = await createRes.json();
  assert.ok(workOrder.orderNumber, 'Work order number must be generated');
  assert.equal(workOrder.status, WORK_ORDER_STATUS.OPEN);

  // Verify bidirectional link between Alert and MaintenanceWorkOrder
  const updatedAlert = await Alert.findById(alert._id);
  assert.equal(updatedAlert.maintenanceWorkOrderId.toString(), workOrder._id.toString());

  const createdWo = await MaintenanceWorkOrder.findById(workOrder._id);
  assert.equal(createdWo.sourceAlertId.toString(), alert._id.toString());
  assert.equal(createdWo.sourceAnalysisRunId.toString(), alert.analysisRunId.toString());

  // Attempting to create duplicate work order for same alert returns 400
  const dupRes = await fetch(`${baseUrl}/api/alerts/${alert._id}/work-order`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${mgrToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      title: 'Duplicate Work Order',
      description: 'Should fail',
      priority: WORK_ORDER_PRIORITY.HIGH,
      dueDate: new Date(Date.now() + 86400000).toISOString(),
      assignedTechnicianId: techUser._id
    })
  });
  assert.equal(dupRes.status, 400);
});
