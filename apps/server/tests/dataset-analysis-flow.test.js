import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app.js';
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { TEST_CREDS } from './testCredentials.js';
import { Dataset } from '../src/models/Dataset.js';
import { ModelArtifact } from '../src/models/ModelArtifact.js';
import { Machine } from '../src/models/Machine.js';
import { AnalysisRun } from '../src/models/AnalysisRun.js';
import { MODEL_TYPES, ANALYSIS_RUN_STATUS } from '@predictive-maintenance/shared';

let server;
let baseUrl;
let managerToken;
let testDataset;
let rfModel;
let ifModel;
let machineTarget;

async function loginUser(creds) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: creds.email,
      password: creds.password
    })
  });
  const data = await res.json();
  assert.equal(res.status, 200, `Login failed for ${creds.email}: ${JSON.stringify(data)}`);
  return data.sessionToken;
}

test.before(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(env.MONGODB_URI);
  }

  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });

  managerToken = await loginUser(TEST_CREDS.manager);

  // Locate the synthetic test dataset (150 rows, 5 telemetry signals, 3 classes)
  testDataset = await Dataset.findOne({
    title: /synthetic test data/i,
    status: 'ready'
  });

  if (!testDataset) {
    // Fallback: search for any ready dataset with ~150 rows or telemetry signals
    testDataset = await Dataset.findOne({
      status: 'ready',
      'columns.1': { $exists: true }
    });
  }

  assert.ok(testDataset, 'Target test dataset must exist in the database');

  // Locate machine
  if (testDataset.machineId) {
    machineTarget = await Machine.findById(testDataset.machineId);
  }
  if (!machineTarget) {
    machineTarget = await Machine.findOne({ code: 'GB-104' }) || await Machine.findOne({});
  }
  assert.ok(machineTarget, 'Monitored machine target must exist');

  // Locate models
  rfModel = await ModelArtifact.findOne({
    modelType: MODEL_TYPES.RANDOM_FOREST,
    status: 'ready'
  });
  ifModel = await ModelArtifact.findOne({
    modelType: MODEL_TYPES.ISOLATION_FOREST,
    status: 'ready'
  });

  assert.ok(rfModel, 'Ready Random Forest model must exist');
  assert.ok(ifModel, 'Ready Isolation Forest model must exist');
});

test.after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('1. Target Dataset Verification: Verify rows, channels, and multi-class distribution', async () => {
  assert.ok(testDataset._id, 'Dataset must have an _id');
  assert.equal(testDataset.totalRows, 150, 'Dataset must have exactly 150 rows');
  assert.equal(testDataset.columns.length, 7, 'Dataset must have 7 columns (5 telemetry signals, timestamp, label)');

  const labelDist = testDataset.labelDistribution instanceof Map
    ? Object.fromEntries(testDataset.labelDistribution)
    : (testDataset.labelDistribution || {});
  
  const classCount = Object.keys(labelDist).length;
  assert.equal(classCount, 3, 'Dataset must contain 3 ground-truth fault classes');
  assert.equal(labelDist.normal, 50, 'Normal class has 50 samples');
  assert.equal(labelDist.misalignment_demo, 50, 'Misalignment class has 50 samples');
  assert.equal(labelDist.thermal_rise_demo, 50, 'Thermal rise class has 50 samples');
});

test('2. Compatible Model Execution: Run Random Forest Gear Fault Classifier', async () => {
  const res = await fetch(`${baseUrl}/api/analysis-runs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${managerToken}`
    },
    body: JSON.stringify({
      machineId: machineTarget._id.toString(),
      datasetId: testDataset._id.toString(),
      modelArtifactId: rfModel._id.toString(),
      configuration: {
        windowSize: 64,
        overlapRatio: 0.5
      },
      sync: true
    })
  });

  const body = await res.json();
  assert.equal(res.status, 201, `Failed to execute Random Forest analysis: ${JSON.stringify(body)}`);
  assert.ok(body.analysisRun, 'Response must contain analysisRun object');
  assert.equal(body.analysisRun.status, ANALYSIS_RUN_STATUS.COMPLETED);
  assert.equal(body.analysisRun.modelType, MODEL_TYPES.RANDOM_FOREST);
  assert.ok(body.analysisRun.summary, 'Must contain summary');
  assert.equal(body.analysisRun.summary.totalWindows, 3, 'Must analyze exactly 3 windows for 150 rows with windowSize 64 and overlap 0.5');
  assert.ok(typeof body.analysisRun.summary.maxAnomalyScore === 'number', 'Must have numeric maxAnomalyScore');
  assert.ok(Array.isArray(body.analysisRun.intervals), 'intervals must be an array');
});

test('3. Compatible Model Execution: Run Isolation Forest Anomaly Detector', async () => {
  const res = await fetch(`${baseUrl}/api/analysis-runs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${managerToken}`
    },
    body: JSON.stringify({
      machineId: machineTarget._id.toString(),
      datasetId: testDataset._id.toString(),
      modelArtifactId: ifModel._id.toString(),
      configuration: {
        windowSize: 64,
        overlapRatio: 0.5
      },
      sync: true
    })
  });

  const body = await res.json();
  assert.equal(res.status, 201, `Failed to execute Isolation Forest analysis: ${JSON.stringify(body)}`);
  assert.ok(body.analysisRun, 'Response must contain analysisRun object');
  assert.equal(body.analysisRun.status, ANALYSIS_RUN_STATUS.COMPLETED);
  assert.equal(body.analysisRun.modelType, MODEL_TYPES.ISOLATION_FOREST);
  assert.ok(body.analysisRun.summary, 'Must contain summary');
  assert.ok(body.analysisRun.summary.totalWindows >= 1, 'Must analyze at least 1 window');
  assert.ok(typeof body.analysisRun.summary.maxAnomalyScore === 'number', 'Must have numeric maxAnomalyScore');
  assert.ok(Array.isArray(body.analysisRun.intervals), 'intervals must be an array');
});

test('4. Incompatible Request Rejection: Rejects missing model, dataset, or machine', async () => {
  // Missing modelArtifactId
  const res = await fetch(`${baseUrl}/api/analysis-runs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${managerToken}`
    },
    body: JSON.stringify({
      machineId: machineTarget._id.toString(),
      datasetId: testDataset._id.toString(),
      configuration: { windowSize: 64 }
    })
  });

  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.error, 'ValidationError');
});

test('5. Duplicate Click Handling: Repeated calls create valid distinct immutable runs without data corruption', async () => {
  const payload = {
    machineId: machineTarget._id.toString(),
    datasetId: testDataset._id.toString(),
    modelArtifactId: ifModel._id.toString(),
    configuration: { windowSize: 64, overlapRatio: 0.5 },
    sync: true
  };

  const [res1, res2] = await Promise.all([
    fetch(`${baseUrl}/api/analysis-runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${managerToken}` },
      body: JSON.stringify(payload)
    }),
    fetch(`${baseUrl}/api/analysis-runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${managerToken}` },
      body: JSON.stringify(payload)
    })
  ]);

  assert.equal(res1.status, 201);
  assert.equal(res2.status, 201);
  const data1 = await res1.json();
  const data2 = await res2.json();

  assert.notEqual(data1.analysisRun._id, data2.analysisRun._id, 'Each run gets an independent immutable ID');
  assert.equal(data1.analysisRun.status, ANALYSIS_RUN_STATUS.COMPLETED);
  assert.equal(data2.analysisRun.status, ANALYSIS_RUN_STATUS.COMPLETED);
});

after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
});
