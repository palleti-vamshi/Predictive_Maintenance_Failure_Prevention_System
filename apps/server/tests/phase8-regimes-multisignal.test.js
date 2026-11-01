import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import app from '../src/app.js';
import { ModelArtifact } from '../src/models/ModelArtifact.js';
import { Dataset } from '../src/models/Dataset.js';
import { Machine } from '../src/models/Machine.js';
import { AnalysisRun } from '../src/models/AnalysisRun.js';
import { Alert } from '../src/models/Alert.js';
import { ANALYSIS_RUN_STATUS, MODEL_TYPES } from '@predictive-maintenance/shared';
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

test('Phase 8 Research Comparison Endpoint: Returns verified provenance and baseline comparisons', async () => {
  const { token } = await loginUser(TEST_CREDS.manager.email, TEST_CREDS.manager.password);

  const res = await fetch(`${baseUrl}/api/analysis-runs/research-comparison`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  const evalData = data.comparison || data.evaluation;
  assert.ok(evalData, 'Evaluation payload must be returned');

  // Verify Provenance Registry
  const provenance = evalData.provenance_registry;
  assert.ok(provenance, 'Benchmark provenance registry must be present');
  assert.ok(provenance['mfpt_bearing'], 'MFPT must be registered as bearing benchmark');
  assert.equal(provenance['mfpt_bearing'].component_type, 'bearing');
  assert.equal(provenance['mfpt_bearing'].provenance_verified, true);

  assert.ok(provenance['seu_dds_gearbox'], 'SEU DDS must be registered as gearbox benchmark');
  assert.equal(provenance['seu_dds_gearbox'].component_type, 'gearbox');
  assert.equal(provenance['seu_dds_gearbox'].provenance_verified, true);

  // Verify Baseline Comparison (Global vs Regime-Conditioned)
  const regimeComp = evalData.regime_comparison;
  assert.ok(regimeComp, 'Regime baseline comparison must be present');
  assert.ok(
    regimeComp.regime_conditioned_baseline.false_positive_rate_healthy <
      regimeComp.global_baseline.false_positive_rate_healthy,
    'Regime-conditioned detector must reduce healthy transition false positive rate'
  );

  // Verify Signal Path Comparison
  const sigComp = evalData.signal_paths_comparison;
  assert.ok(sigComp, 'Signal paths comparison must be present');
  assert.ok(sigComp.multi_signal_fused, 'Multi-signal fused evaluation must be present');
  assert.equal(sigComp.multi_signal_fused.overall_metrics.recall, 1.0);
});

test('Phase 8 Operating-Regime-Aware Analysis: Preserves regime, signal paths, and sensor coverage', async () => {
  const { token } = await loginUser(TEST_CREDS.manager.email, TEST_CREDS.manager.password);

  const machineGB104 = await Machine.findOne({ code: 'GB-104' });
  const isoModel = await ModelArtifact.findOne({ modelType: 'isolation_forest' });
  const opDs = await Dataset.findOne({ title: /GB-104 Extruder/i });

  // Trigger analysis run with regime-awareness enabled
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
        overlapRatio: 0.5,
        regimeAware: true
      },
      sync: true
    })
  });

  assert.equal(res.status, 201);
  const { analysisRun } = await res.json();
  assert.equal(analysisRun.status, ANALYSIS_RUN_STATUS.COMPLETED);

  // Verify Phase 8 Regime Summary
  assert.ok(analysisRun.regimeSummary, 'regimeSummary must be populated');
  assert.ok(
    Array.isArray(analysisRun.regimeSummary.detectedRegimes),
    'detectedRegimes must be an array'
  );

  // Verify Phase 8 Signal Paths Summary
  assert.ok(analysisRun.signalPathsSummary, 'signalPathsSummary must be populated');
  assert.equal(analysisRun.signalPathsSummary.vibrationPathActive, true);
  assert.equal(analysisRun.signalPathsSummary.thermalPathActive, true);

  // Verify Phase 8 Sensor Coverage
  assert.ok(analysisRun.sensorCoverage, 'sensorCoverage must be populated');
  assert.ok(analysisRun.sensorCoverage.coverageScore > 0, 'coverageScore must be positive');
  assert.ok(Array.isArray(analysisRun.sensorCoverage.availableModalities));
});

test('Phase 8 Alert Detail: Verifies triggering path, detector breakdown, and fusion rationale', async () => {
  const { token } = await loginUser(TEST_CREDS.tech.email, TEST_CREDS.tech.password);

  // Retrieve alert list
  const listRes = await fetch(`${baseUrl}/api/alerts`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(listRes.status, 200);
  const { alerts } = await listRes.json();
  assert.ok(alerts.length > 0, 'Seeded alerts must exist');

  // Verify alert has Phase 8 fields populated
  const alertWithBreakdown = alerts.find((a) => a.triggeringPath && a.fusionRationale);
  assert.ok(alertWithBreakdown, 'At least one alert must have Phase 8 multi-signal fusion metadata');

  assert.ok(['vibration_path', 'thermal_path', 'fused_multisignal'].includes(alertWithBreakdown.triggeringPath));
  assert.ok(alertWithBreakdown.operatingRegime, 'Operating regime context must be stored');
  assert.ok(alertWithBreakdown.operatingRegime.regimeId, 'Regime ID must be present');
  assert.ok(alertWithBreakdown.detectorBreakdown, 'Detector breakdown must be present');
  assert.ok(alertWithBreakdown.sensorCoverage, 'Sensor coverage must be present');
});
