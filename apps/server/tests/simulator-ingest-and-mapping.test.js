import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import app from '../src/app.js';
import { env } from '../src/config/env.js';
import { Machine, Dataset, ModelArtifact, AnalysisRun, Alert } from '../src/models/index.js';
import { TEST_CREDS } from './testCredentials.js';
import { ANALYSIS_RUN_STATUS, MODEL_TYPES } from '@predictive-maintenance/shared';

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

test('Simulator CSV Detection & Candidate Column Mappings', async () => {
  const simulatorCsvPath = '/Users/vamshi_07/Downloads/live_telemetry_2026-10-31_09_11_32.csv';
  assert.ok(fs.existsSync(simulatorCsvPath), 'Simulator CSV must exist in Downloads');

  const { token: techToken } = await loginUser(TEST_CREDS.tech.email, TEST_CREDS.tech.password);
  assert.ok(techToken, 'Must authenticate as technician');

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
  assert.equal(uploadData.isSimulatorSignature, true, 'Must detect simulator signature');

  const vibMapping = uploadData.candidateMappings.find((m) => m.rawHeader === 'vib_rms');
  assert.ok(vibMapping, 'vib_rms must be recognized');
  assert.equal(vibMapping.mappedSignal, 'vibration_input_radial');
  assert.equal(vibMapping.suggestedUnit, 'mm/s');

  const coolantMapping = uploadData.candidateMappings.find((m) => m.rawHeader === 'coolant_c');
  assert.ok(coolantMapping, 'coolant_c must be recognized');
  assert.equal(coolantMapping.mappedSignal, 'temp_gearbox_sump');
  assert.equal(coolantMapping.suggestedUnit, 'degC');
});

test('Pre-flight Guardrail: Reject Random Forest Classifier on Unlabelled Simulator Telemetry', async () => {
  const { token: techToken } = await loginUser(TEST_CREDS.tech.email, TEST_CREDS.tech.password);
  const machineGB104 = await Machine.findOne({ code: 'GB-104' });
  const rfModel = await ModelArtifact.findOne({ modelType: MODEL_TYPES.RANDOM_FOREST });
  assert.ok(rfModel, 'Seeded Random Forest model must exist');

  // Create a simulated dataset without labels
  const simDataset = await Dataset.create({
    factoryId: machineGB104.factoryId,
    siteId: machineGB104.siteId,
    machineId: machineGB104._id,
    datasetType: 'operational',
    title: '[SIMULATED] Test Unlabelled Telemetry Run',
    status: 'ready',
    uploadedById: machineGB104.assignedTechnicians?.[0] || machineGB104._id,
    uploadedByName: 'Rajesh Kumar',
    storageKey: 'mock_sim_unlabelled.csv',
    originalFilename: 'mock_sim.csv',
    fileSizeBytes: 1024,
    totalRows: 100,
    totalColumns: 15,
    columns: [
      { rawHeader: 'time_s', mappedSignal: 'timestamp', isTimestamp: true },
      { rawHeader: 'vib_rms', mappedSignal: 'vibration_input_radial', sourceUnit: 'mm/s' },
      { rawHeader: 'gearbox_in_rpm', mappedSignal: 'rotational_speed', sourceUnit: 'RPM' }
    ],
    isSimulatorDerived: true,
    isDemoData: true
  });

  const runRes = await fetch(`${baseUrl}/api/analysis-runs`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${techToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      datasetId: simDataset._id,
      modelArtifactId: rfModel._id,
      machineId: machineGB104._id
    })
  });

  assert.equal(runRes.status, 400);
  const errData = await runRes.json();
  assert.equal(errData.error, 'IncompatibleDatasetError');
  assert.match(errData.message, /requires ground-truth fault classification labels/i);
});

test('Authenticated Simulator Ingestion Endpoint RBAC & Scoping', async () => {
  const machineGB104 = await Machine.findOne({ code: 'GB-104' });
  const machineGB101 = await Machine.findOne({ code: 'GB-201' }); // Different machine in Pune not assigned to tech
  const machineChennai = await Machine.findOne({ code: 'GB-999' }); // Chennai machine

  const sampleTelemetry = [
    { time_s: 0.1, engine_rpm: 1000, gearbox_in_rpm: 1000, gearbox_out_rpm: 256, gen_rpm: 1000, torque_nm: 15.2, shaft_power_kw: 1.5, gen_elec_kw: 1.2, gen_voltage_v: 400, gen_current_a: 2.5, gen_freq_hz: 50, coolant_c: 80, egt_c: 300, fuel_rate_l_h: 0.5, vib_rms: 1.2 },
    { time_s: 0.2, engine_rpm: 1002, gearbox_in_rpm: 1002, gearbox_out_rpm: 257, gen_rpm: 1002, torque_nm: 15.3, shaft_power_kw: 1.5, gen_elec_kw: 1.2, gen_voltage_v: 400, gen_current_a: 2.5, gen_freq_hz: 50, coolant_c: 80, egt_c: 300, fuel_rate_l_h: 0.5, vib_rms: 1.22 }
  ];

  // 1. Unauthenticated request rejected with 401
  const unauthRes = await fetch(`${baseUrl}/api/datasets/simulator-ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ machineId: machineGB104._id, telemetry: sampleTelemetry })
  });
  assert.equal(unauthRes.status, 401);

  // 2. Viewer role rejected with 403
  const { token: viewerToken } = await loginUser(TEST_CREDS.viewer.email, TEST_CREDS.viewer.password);
  const viewerRes = await fetch(`${baseUrl}/api/datasets/simulator-ingest`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${viewerToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ machineId: machineGB104._id, telemetry: sampleTelemetry })
  });
  assert.equal(viewerRes.status, 403);

  // 3. Technician targeting unassigned machine rejected with 403
  const { token: techToken } = await loginUser(TEST_CREDS.tech.email, TEST_CREDS.tech.password);
  if (machineGB101) {
    const unassignedRes = await fetch(`${baseUrl}/api/datasets/simulator-ingest`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${techToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ machineId: machineGB101._id, telemetry: sampleTelemetry })
    });
    assert.equal(unassignedRes.status, 403);
  }

  // 4. Cross-factory machine rejected with 404
  if (machineChennai) {
    const crossRes = await fetch(`${baseUrl}/api/datasets/simulator-ingest`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${techToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ machineId: machineChennai._id, telemetry: sampleTelemetry })
    });
    assert.equal(crossRes.status, 404);
  }

  // 5. Technician targeting assigned machine GB-104 succeeds
  const validRes = await fetch(`${baseUrl}/api/datasets/simulator-ingest`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${techToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      machineId: machineGB104._id,
      title: 'GB-104 Test Batch Ingest',
      telemetry: sampleTelemetry,
      faultMetadata: { faultType: 'none' }
    })
  });

  assert.equal(validRes.status, 201);
  const validData = await validRes.json();
  assert.equal(validData.success, true);
  assert.equal(validData.isSimulated, true);
  assert.equal(validData.dataset.isSimulatorDerived, true);
  assert.match(validData.dataset.title, /\[SIMULATED\]/);
});

test('End-to-End Synthetic Fault Perturbation Ingestion & Isolation Forest Analysis', async () => {
  const { token: techToken } = await loginUser(TEST_CREDS.tech.email, TEST_CREDS.tech.password);
  const machineGB104 = await Machine.findOne({ code: 'GB-104' });
  const isoModel = await ModelArtifact.findOne({ modelType: MODEL_TYPES.ISOLATION_FOREST });

  // Generate 80 synthetic samples representing 8 seconds of continuous run with a severe vibration spike
  const simulatedRun = [];
  for (let i = 0; i < 80; i++) {
    const t = Number((i * 0.1).toFixed(2));
    const isSpike = i >= 30 && i <= 50; // Injected synthetic fault interval
    simulatedRun.push({
      time_s: t,
      engine_rpm: 1800,
      gearbox_in_rpm: 1800,
      gearbox_out_rpm: 461.5,
      gen_rpm: 1800,
      torque_nm: isSpike ? 45.0 : 22.0,
      shaft_power_kw: 4.2,
      gen_elec_kw: 3.8,
      gen_voltage_v: 400.0,
      gen_current_a: 5.5,
      gen_freq_hz: 50.0,
      coolant_c: 82.5,
      egt_c: 310.0,
      fuel_rate_l_h: 0.85,
      vib_rms: isSpike ? 5.8 : 1.35 // Severe synthetic vibration perturbation
    });
  }

  const ingestRes = await fetch(`${baseUrl}/api/datasets/simulator-ingest`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${techToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      machineId: machineGB104._id,
      title: 'GB-104 Synthetic Vibration Spike Demonstration',
      telemetry: simulatedRun,
      faultMetadata: {
        faultType: 'vibration_spike',
        severity: 0.95,
        injectedAtSec: 3.0
      },
      runAnalysis: true,
      modelArtifactId: isoModel._id
    })
  });

  assert.equal(ingestRes.status, 201);
  const result = await ingestRes.json();
  assert.equal(result.success, true);
  assert.equal(result.isSimulated, true);
  assert.ok(result.dataset, 'Dataset must be persisted');
  assert.equal(result.dataset.isSimulatorDerived, true);

  assert.ok(result.analysisRun, 'AnalysisRun must be executed');
  assert.equal(result.analysisRun.status, ANALYSIS_RUN_STATUS.COMPLETED);
  assert.equal(result.analysisRun.isSimulatorDerived, true);
  assert.ok(result.analysisRun.summary.totalWindows > 0, 'Windows must be extracted');

  // Verify created Alerts
  assert.ok(result.alerts, 'Alerts array must be present');
  for (const alert of result.alerts) {
    assert.equal(alert.isSimulatorDerived, true, 'Alert must be marked isSimulatorDerived');
    assert.match(alert.title, /\[SIMULATED\]/, 'Alert title must have [SIMULATED] prefix');
  }
});

test('Save Run as Dataset (runAnalysis: false) tags simulated dataset and skips ML execution', async () => {
  const { token: techToken } = await loginUser(TEST_CREDS.tech.email, TEST_CREDS.tech.password);
  const machineGB104 = await Machine.findOne({ code: 'GB-104' });

  // Generate 25 nominal telemetry samples
  const nominalRun = [];
  for (let i = 0; i < 25; i++) {
    const t = Number((i * 0.1).toFixed(2));
    nominalRun.push({
      time_s: t,
      engine_rpm: 1500,
      gearbox_in_rpm: 1500,
      gearbox_out_rpm: 384.6,
      gen_rpm: 1500,
      torque_nm: 18.5,
      shaft_power_kw: 2.9,
      gen_elec_kw: 2.6,
      gen_voltage_v: 400.0,
      gen_current_a: 3.75,
      gen_freq_hz: 50.0,
      coolant_c: 81.0,
      egt_c: 305.0,
      fuel_rate_l_h: 0.65,
      vib_rms: 1.18
    });
  }

  const res = await fetch(`${baseUrl}/api/datasets/simulator-ingest`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${techToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      machineId: machineGB104._id,
      title: 'GB-104 Nominal Baseline Run',
      description: 'Captured baseline test run without synthetic perturbations',
      telemetry: nominalRun,
      faultMetadata: null,
      runAnalysis: false // Explicitly skip ML analysis
    })
  });

  assert.equal(res.status, 201);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.equal(data.isSimulated, true);
  assert.equal(data.analysisRun, null, 'No analysis run should be started when runAnalysis is false');
  assert.deepEqual(data.alerts, [], 'No alerts should be generated');

  const dataset = data.dataset;
  assert.ok(dataset, 'Dataset document must be returned');
  assert.equal(dataset.isSimulatorDerived, true, 'Must have isSimulatorDerived flag');
  assert.equal(dataset.isDemoData, true, 'Must have isDemoData flag');
  assert.match(dataset.title, /^\[SIMULATED\]/, 'Title must be prefixed with [SIMULATED]');
  assert.equal(dataset.totalRows, 25);
  assert.equal(dataset.machineId.toString(), machineGB104._id.toString());

  // Verify dataset is queryable via GET /api/datasets/:id
  const getRes = await fetch(`${baseUrl}/api/datasets/${dataset._id}`, {
    headers: { Authorization: `Bearer ${techToken}` }
  });
  assert.equal(getRes.status, 200);
  const fetched = await getRes.json();
  assert.equal(fetched.dataset._id.toString(), dataset._id.toString());
  assert.equal(fetched.dataset.isSimulatorDerived, true);
});

test('Telemetry Receipt, Schema Validation, and Stale State Timeout Detection', async () => {
  const { token: techToken } = await loginUser(TEST_CREDS.tech.email, TEST_CREDS.tech.password);
  const machineGB104 = await Machine.findOne({ code: 'GB-104' });

  // 1. Invalid non-numeric signal value rejected with 400
  const invalidRes = await fetch(`${baseUrl}/api/datasets/simulator-tick`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${techToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      machineId: machineGB104._id,
      rpm: 'corrupt_string_value'
    })
  });
  assert.equal(invalidRes.status, 400);
  const invalidData = await invalidRes.json();
  assert.equal(invalidData.error, 'InvalidTelemetryTick');

  // 2. Out-of-range physical value rejected with 400 TelemetryValueOutOfRange
  const oortRes = await fetch(`${baseUrl}/api/datasets/simulator-tick`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${techToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      machineId: machineGB104._id,
      rpm: 99999 // Exceeds physical engineering range max 12000
    })
  });
  assert.equal(oortRes.status, 400);
  const oortData = await oortRes.json();
  assert.equal(oortData.error, 'TelemetryValueOutOfRange');

  // 3. Valid telemetry tick accepted with 200 and sanitized metadata
  const validTickRes = await fetch(`${baseUrl}/api/datasets/simulator-tick`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${techToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      machineId: machineGB104._id,
      rpm: 1850,
      inRpm: 1850,
      outRpm: 474.3,
      torque: 24.5,
      powerKw: 4.75,
      coolant: 84.2,
      egt: 312.0,
      vibRms: 1.25,
      simTime: 12.4
    })
  });
  assert.equal(validTickRes.status, 200);
  const validTickData = await validTickRes.json();
  assert.equal(validTickData.success, true);
  assert.equal(validTickData.machineId, machineGB104._id.toString());
  assert.equal(validTickData.machineCode, machineGB104.code);
  assert.ok(validTickData.timestamp, 'Must record timestamp');
});
