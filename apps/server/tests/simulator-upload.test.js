import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import app from '../src/app.js';
import { env } from '../src/config/env.js';
import { Machine, Dataset, ModelArtifact, AnalysisRun, Alert } from '../src/models/index.js';
import { TEST_CREDS } from './testCredentials.js';
import { ANALYSIS_RUN_STATUS } from '@predictive-maintenance/shared';

let server;
let baseUrl;

async function loginUser(email, password) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emailOrUsername: email, password })
  });
  const data = await res.json();
  return { status: res.status, data, token: data.sessionToken };
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
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
});

test('Real Simulator CSV Upload, Processing & Isolation Forest Analysis Run', async () => {
  const simulatorCsvPath = '/Users/vamshi_07/Downloads/live_telemetry_2026-10-31_09_11_32.csv';
  assert.ok(fs.existsSync(simulatorCsvPath), 'Simulator CSV must exist in Downloads');

  // 1. Authenticate as Pune Technician (Rajesh Kumar)
  const { token: techToken } = await loginUser(TEST_CREDS.tech.email, TEST_CREDS.tech.password);
  assert.ok(techToken, 'Must authenticate successfully');

  // 2. Upload real simulator CSV file via POST /api/datasets/upload
  const fileContent = fs.readFileSync(simulatorCsvPath);
  const formData = new FormData();
  formData.append(
    'file',
    new Blob([fileContent], { type: 'text/csv' }),
    'live_telemetry_2026-10-31_09_11_32.csv'
  );

  const uploadRes = await fetch(`${baseUrl}/api/datasets/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${techToken}` },
    body: formData
  });

  assert.equal(uploadRes.status, 200);
  const uploadData = await uploadRes.json();
  assert.equal(uploadData.success, true);
  assert.equal(uploadData.totalRows, 656);
  assert.ok(uploadData.headers.includes('vib_rms'));
  assert.ok(uploadData.headers.includes('torque_nm'));

  const uploadId = uploadData.uploadId;

  // 3. Confirm dataset with signal mappings for machine GB-104
  const machineGB104 = await Machine.findOne({ code: 'GB-104' });
  assert.ok(machineGB104, 'Machine GB-104 must exist in Pune plant');

  const columnMappings = [
    { rawHeader: 'time_s', isTimestamp: true },
    { rawHeader: 'vib_rms', mappedSignal: 'vibration_input_radial', sourceUnit: 'mm/s' },
    { rawHeader: 'gearbox_in_rpm', mappedSignal: 'rotational_speed', sourceUnit: 'RPM' },
    { rawHeader: 'torque_nm', mappedSignal: 'load_torque', sourceUnit: 'Nm' },
    { rawHeader: 'coolant_c', mappedSignal: 'temp_gearbox_sump', sourceUnit: 'degC' }
  ];

  const confirmRes = await fetch(`${baseUrl}/api/datasets/confirm`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${techToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      uploadId,
      title: 'GB-104 Real Simulator Telemetry Run (2026-10-31)',
      description: 'Live hardware-in-the-loop generator/gearbox dyno telemetry test file',
      datasetType: 'operational',
      machineId: machineGB104._id,
      columnMappings,
      isSimulatorDerived: true,
      isDemoData: true
    })
  });

  assert.equal(confirmRes.status, 201);
  const { dataset } = await confirmRes.json();
  console.log('Dataset status:', dataset.status, 'Quality findings:', dataset.qualityFindings);
  assert.equal(dataset.title, 'GB-104 Real Simulator Telemetry Run (2026-10-31)');
  assert.equal(dataset.isSimulatorDerived, true);
  assert.equal(dataset.isDemoData, true);
  assert.equal(dataset.totalRows, 656);

  // 4. Trigger Analysis Run using seeded Isolation Forest model
  const isoModel = await ModelArtifact.findOne({ modelType: 'isolation_forest' });
  assert.ok(isoModel, 'Seeded Isolation Forest model must exist');

  const runRes = await fetch(`${baseUrl}/api/analysis-runs`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${techToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      datasetId: dataset._id,
      modelArtifactId: isoModel._id,
      machineId: machineGB104._id,
      configuration: {
        windowSize: 16,
        overlapRatio: 0.5,
        regimeAware: true
      },
      sync: true
    })
  });

  if (runRes.status !== 201) {
    const errBody = await runRes.json();
    console.error('Analysis run failed with status', runRes.status, errBody);
  }
  assert.equal(runRes.status, 201);
  const { analysisRun } = await runRes.json();
  assert.equal(analysisRun.status, ANALYSIS_RUN_STATUS.COMPLETED);
  assert.ok(analysisRun.summary.totalWindows > 0, 'Analysis windows must be processed');
  assert.ok(analysisRun.regimeSummary, 'Operating regimes must be summarized');

  // Verify Alerts created from this run
  const alerts = await Alert.find({ analysisRunId: analysisRun._id });
  console.log(`[SimulatorTest] Analysis completed with ${analysisRun.summary.totalWindows} windows processed and ${alerts.length} alerts generated.`);
});
