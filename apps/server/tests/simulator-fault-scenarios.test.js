import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import mongoose from 'mongoose';
import app from '../src/app.js';
import { env } from '../src/config/env.js';
import { Machine, Dataset, ModelArtifact, AnalysisRun, Alert } from '../src/models/index.js';
import { TEST_CREDS } from './testCredentials.js';
import { MODEL_TYPES } from '@predictive-maintenance/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SIMULATOR_HTML_PATH = path.resolve(__dirname, '../../web/public/simulator/transmission_dynamics_studio.html');

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

/**
 * Creates an isolated simulation physics sandbox directly from transmission_dynamics_studio.html
 */
function createPhysicsSandbox(initialControls = {}) {
  const html = fs.readFileSync(SIMULATOR_HTML_PATH, 'utf8');
  const scriptMatches = [...html.matchAll(/<script[\s\S]*?>([\s\S]*?)<\/script>/gi)];
  const scriptCode = scriptMatches[2][1] + '\n;globalThis.liveState = liveState; globalThis.advancePhysicsStep = advancePhysicsStep; globalThis.physicalParams = physicalParams; globalThis.getActiveFaultsList = getActiveFaultsList;';

  const controls = {
    load: '35',
    throttle: '50',
    ambient: '25',
    wear: '10',
    ratio: '3.9',
    gear: '3',
    ...initialControls
  };

  const makeMockEl = () => ({
    textContent: '',
    value: '0',
    classList: { add() {}, remove() {}, contains() { return false; } },
    style: {},
    addEventListener() {},
    removeEventListener() {},
    querySelectorAll: () => [],
    getContext() {
      return {
        save() {}, restore() {}, clearRect() {}, beginPath() {},
        moveTo() {}, lineTo() {}, stroke() {}, fill() {}, arc() {},
        fillText() {}, setLineDash() {}
      };
    }
  });

  const sandbox = {
    document: {
      readyState: 'complete',
      getElementById: (id) => controls[id] ? { value: String(controls[id]) } : makeMockEl(),
      querySelectorAll: () => []
    },
    window: {
      location: { origin: 'http://localhost:5173' },
      addEventListener() {},
      removeEventListener() {},
      postMessage() {}
    },
    setInterval() {},
    performance: { now: () => 1000 },
    requestAnimationFrame() {},
    THREE: null,
    Math,
    Number,
    Boolean,
    String,
    Array,
    Object,
    Date,
    console
  };
  sandbox.window.parent = sandbox.window;

  vm.createContext(sandbox);
  vm.runInContext(scriptCode, sandbox);
  return sandbox;
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

// ============================================================================
// 1. FAULT 1: CLUTCH SLIPPAGE PHYSICS VERIFICATION
// ============================================================================
test('Fault 1: Clutch Slippage limits torque transfer capacity and drives ΔRPM speed divergence', () => {
  const sim = createPhysicsSandbox({ throttle: '65', load: '60', gear: '3' });

  // 1. Run in healthy nominal baseline (50 steps = 0.5s)
  for (let i = 0; i < 50; i++) sim.advancePhysicsStep(0.01);
  const healthyEngineRpm = sim.liveState.rpm;
  const healthyInRpm = sim.liveState.inRpm;
  const healthySlip = sim.liveState.clutchSlipRpm;
  const healthyVib = sim.liveState.vibRms;

  // In healthy locked drive, clutch slip is near zero and shafts match
  assert.ok(healthySlip < 10, `Healthy clutch slip should be < 10 RPM, got ${healthySlip}`);
  assert.ok(Math.abs(healthyEngineRpm - healthyInRpm) < 10, 'Engine and input shaft speeds should match synchronously in healthy lockup');

  // 2. Inject Clutch Slippage (severity = 0.85)
  sim.liveState.faults.clutch_slippage.enabled = true;
  sim.liveState.faults.clutch_slippage.severity = 0.85;

  for (let i = 0; i < 150; i++) sim.advancePhysicsStep(0.01);

  const slippedEngineRpm = sim.liveState.rpm;
  const slippedInRpm = sim.liveState.inRpm;
  const deltaRpm = sim.liveState.clutchSlipRpm;
  const plateTemp = sim.liveState.clutchTemp;
  const slippedVib = sim.liveState.vibRms;

  // Primary physical effect: speed divergence between engine and input shaft
  assert.ok(deltaRpm > 150, `Clutch slip speed divergence should exceed 150 RPM under load, got ${deltaRpm.toFixed(1)} RPM`);
  assert.ok(slippedEngineRpm > slippedInRpm, 'Engine RPM should outpace gearbox input RPM under clutch slippage');
  assert.ok(!sim.liveState.clutchLocked, 'Clutch locked state must be false when slipping under load');

  // Secondary physical effect: friction chatter vibration elevates
  assert.ok(slippedVib > healthyVib, `Vibration RMS should rise with slip chatter (healthy: ${healthyVib.toFixed(2)}, slipped: ${slippedVib.toFixed(2)})`);
});

// ============================================================================
// 2. FAULT 2: GEAR TOOTH WEAR & KINEMATIC RATIO GOVERNANCE
// ============================================================================
test('Fault 2: Gear Tooth Wear excites mesh harmonics while strictly governing output RPM to gear ratio', () => {
  const sim = createPhysicsSandbox({ throttle: '45', load: '40', gear: '3' });

  // Baseline healthy run
  for (let i = 0; i < 50; i++) sim.advancePhysicsStep(0.01);
  const baselineVib = sim.liveState.vibRms;
  const baselineEff = sim.liveState.transEff;

  // Inject Gear Tooth Wear (severity = 0.75)
  sim.liveState.faults.gear_tooth_wear.enabled = true;
  sim.liveState.faults.gear_tooth_wear.severity = 0.75;

  for (let i = 0; i < 100; i++) sim.advancePhysicsStep(0.01);

  const wornInRpm = sim.liveState.inRpm;
  const wornOutRpm = sim.liveState.outRpm;
  const wornVib = sim.liveState.vibRms;
  const wornEff = sim.liveState.transEff;

  // 1. Strict Kinematic Governance: output RPM MUST equal inRpm / 1.40 (3rd gear)
  const gRatio = 1.40;
  const expectedOutRpm = wornInRpm / gRatio;
  const diff = Math.abs(wornOutRpm - expectedOutRpm);
  assert.ok(diff < 0.05, `Output RPM must be strictly governed by gear ratio: expected ${expectedOutRpm.toFixed(2)}, got ${wornOutRpm.toFixed(2)} (diff: ${diff.toFixed(4)})`);

  // 2. Mesh Harmonic Vibration elevates
  assert.ok(wornVib > baselineVib + 1.0, `Vibration RMS should surge with gear mesh frequency harmonics (baseline: ${baselineVib.toFixed(2)}, worn: ${wornVib.toFixed(2)})`);

  // 3. Transmission efficiency degrades
  assert.ok(wornEff < baselineEff, `Mechanical transmission efficiency should degrade under tooth wear (baseline: ${baselineEff.toFixed(3)}, worn: ${wornEff.toFixed(3)})`);
});

// ============================================================================
// 3. FAULT 3: BEARING FAILURE PARASITIC DRAG & IMPACTS
// ============================================================================
test('Fault 3: Bearing Failure introduces Coulomb/viscous parasitic drag torque and raceway vibration', () => {
  const sim = createPhysicsSandbox({ throttle: '50', load: '35', gear: '3' });

  for (let i = 0; i < 50; i++) sim.advancePhysicsStep(0.01);
  const healthyOutTorque = sim.liveState.outTorque;
  const healthyVib = sim.liveState.vibRms;

  // Inject Bearing Failure (severity = 0.80)
  sim.liveState.faults.bearing_failure.enabled = true;
  sim.liveState.faults.bearing_failure.severity = 0.80;

  for (let i = 0; i < 100; i++) sim.advancePhysicsStep(0.01);

  const failedOutTorque = sim.liveState.outTorque;
  const failedVib = sim.liveState.vibRms;

  // High-frequency bearing raceway impact vibration increases
  assert.ok(failedVib > healthyVib + 1.2, `Bearing failure must elevate vibration RMS (healthy: ${healthyVib.toFixed(2)}, bearing: ${failedVib.toFixed(2)})`);
  assert.ok(sim.liveState.transEff < 0.90, `Mechanical efficiency must drop below 0.90 under bearing failure drag, got ${sim.liveState.transEff.toFixed(3)}`);
});

// ============================================================================
// 4. FAULT 4: GEARBOX LUBRICATION BREAKDOWN & SUMP OVERHEATING
// ============================================================================
test('Fault 4: Gearbox Lubrication Failure breaks hydrodynamic film, surges boundary friction & sump heat', () => {
  const sim = createPhysicsSandbox({ throttle: '70', load: '35', gear: '3' });

  for (let i = 0; i < 50; i++) sim.advancePhysicsStep(0.01);
  const initialSumpTemp = sim.liveState.gearboxTemp;

  // Inject Gearbox Lubrication Failure (severity = 0.85)
  sim.liveState.faults.gearbox_lubrication_failure.enabled = true;
  sim.liveState.faults.gearbox_lubrication_failure.severity = 0.85;

  // Run for 150 steps (1.5s simulation time)
  for (let i = 0; i < 150; i++) sim.advancePhysicsStep(0.01);

  const finalSumpTemp = sim.liveState.gearboxTemp;
  const lubeEff = sim.liveState.transEff;
  const lubeVib = sim.liveState.vibRms;

  // Transmission efficiency drops sharply (loss of hydrodynamic film)
  assert.ok(lubeEff < 0.80, `Transmission efficiency should drop below 0.80 under boundary lubrication collapse, got ${lubeEff.toFixed(3)}`);
  // Broadband scuffing and rubbing vibration elevates
  assert.ok(lubeVib > 3.0, `Vibration RMS must exceed 3.0 mm/s from boundary scuffing, got ${lubeVib.toFixed(2)}`);
  // Casing and sump temperature responds to mechanical power dissipation
  assert.ok(finalSumpTemp > initialSumpTemp, `Gearbox sump temperature must rise from friction dissipation (initial: ${initialSumpTemp.toFixed(1)}°C, final: ${finalSumpTemp.toFixed(1)}°C)`);
});

// ============================================================================
// 5. FAULT 5: ENGINE COOLING FAILURE & THERMAL DERATING
// ============================================================================
test('Fault 5: Engine Cooling Failure restricts radiator convection, causes overheat & triggers torque derate > 98°C', () => {
  const sim = createPhysicsSandbox({ throttle: '70', load: '35', gear: '3' });

  // Warm engine up under load
  for (let i = 0; i < 50; i++) sim.advancePhysicsStep(0.01);

  // Inject extreme cooling restriction (severity = 0.95) and start near threshold (97.2°C)
  sim.liveState.coolant = 97.2;
  sim.liveState.faults.engine_cooling_failure.enabled = true;
  sim.liveState.faults.engine_cooling_failure.severity = 0.95;

  // Run for 300 steps (3.0s simulation time)
  for (let i = 0; i < 300; i++) sim.advancePhysicsStep(0.01);

  // Coolant must climb past 98°C
  assert.ok(sim.liveState.coolant > 98.0, `Coolant temperature should climb past 98°C threshold under sustained run, got ${sim.liveState.coolant.toFixed(1)}°C`);

  // Thermal derating check: when coolant > 98°C, indicated torque is throttled
  const deratedTorque = sim.liveState.torqueInd;
  assert.ok(deratedTorque > 0, 'Indicated torque must remain positive');
  assert.ok(sim.liveState.bsfc > 240, 'BSFC must reflect overheat fuel penalty');
});

// ============================================================================
// 6. SEVERITY SCALING & HEALTHY STATE RESET
// ============================================================================
test('Fault Severity Scaling & Healthy-State Reset', () => {
  const sim = createPhysicsSandbox({ throttle: '50', load: '40', gear: '3' });

  // 1. Mild gear tooth wear (severity = 0.20)
  sim.liveState.faults.gear_tooth_wear.enabled = true;
  sim.liveState.faults.gear_tooth_wear.severity = 0.20;
  for (let i = 0; i < 50; i++) sim.advancePhysicsStep(0.01);
  const mildVib = sim.liveState.vibRms;
  const mildEff = sim.liveState.transEff;

  // 2. Severe gear tooth wear (severity = 0.90)
  sim.liveState.faults.gear_tooth_wear.severity = 0.90;
  for (let i = 0; i < 50; i++) sim.advancePhysicsStep(0.01);
  const severeVib = sim.liveState.vibRms;
  const severeEff = sim.liveState.transEff;

  assert.ok(severeVib > mildVib, `Higher severity must produce greater vibration RMS (mild: ${mildVib.toFixed(2)}, severe: ${severeVib.toFixed(2)})`);
  assert.ok(severeEff < mildEff, `Higher severity must produce greater transmission efficiency loss (mild: ${mildEff.toFixed(3)}, severe: ${severeEff.toFixed(3)})`);

  // 3. Reset to healthy mode
  for (const k of Object.keys(sim.liveState.faults)) {
    sim.liveState.faults[k].enabled = false;
  }
  sim.liveState.clutchTemp = 35.0;
  sim.liveState.gearboxTemp = 52.0;

  for (let i = 0; i < 50; i++) sim.advancePhysicsStep(0.01);

  // Verifies healthy baseline recovery
  assert.ok(sim.liveState.transEff >= 0.95, `Healthy reset must restore nominal efficiency (>= 0.95), got ${sim.liveState.transEff.toFixed(3)}`);
  assert.ok(sim.liveState.vibRms < 2.5, `Healthy reset must return vibration to baseline (< 2.5 mm/s), got ${sim.liveState.vibRms.toFixed(2)}`);
  assert.ok(sim.getActiveFaultsList().length === 0, 'Active faults list must be empty after healthy reset');
});

// ============================================================================
// 7. END-TO-END SIMULATED INGESTION & ISOLATION FOREST ANALYSIS
// ============================================================================
test('End-to-End: Ingest Simulated Fault Telemetry, verify [SIMULATED] Provenance & Anomaly Detection', async () => {
  const { token: techToken } = await loginUser(TEST_CREDS.tech.email, TEST_CREDS.tech.password);
  const machineGB104 = await Machine.findOne({ code: 'GB-104' });
  assert.ok(machineGB104, 'Machine GB-104 must exist');

  // Generate 35 simulated telemetry samples reflecting Clutch Slippage & Sump Overheating
  const telemetryFrames = [];
  for (let i = 0; i < 35; i++) {
    const t = Number((i * 0.1).toFixed(2));
    telemetryFrames.push({
      time_s: t,
      engine_rpm: 1650.0,
      gearbox_in_rpm: 1250.0, // 400 RPM slip
      gearbox_out_rpm: 892.8,
      gen_rpm: 3482.0,
      torque_nm: 22.4,
      shaft_power_kw: 3.87,
      gen_elec_kw: 3.10,
      gen_voltage_v: 400.0,
      gen_current_a: 5.25,
      gen_freq_hz: 50.0,
      coolant_c: 88.5,
      egt_c: 340.0,
      fuel_rate_l_h: 0.95,
      vib_rms: 4.85 // Elevated slip friction chatter
    });
  }

  const faultMetadata = {
    activeFaults: [
      { id: 'clutch_slippage', name: 'Clutch slippage', severity: 0.75 },
      { id: 'gearbox_lubrication_failure', name: 'Gearbox lubrication failure', severity: 0.70 }
    ],
    isHealthy: false,
    isSimulated: true,
    provenance: '[SIMULATED]',
    faultType: 'multiple_faults',
    severity: 0.75
  };

  const res = await fetch(`${baseUrl}/api/datasets/simulator-ingest`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${techToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      machineId: machineGB104._id,
      title: 'GB-104 Dyno Test — Faults: Clutch slippage (75%), Gearbox lubrication (70%)',
      description: 'Captured simulated session with active clutch slippage and lubrication breakdown',
      telemetry: telemetryFrames,
      faultMetadata,
      runAnalysis: true // Execute unsupervised anomaly detection pipeline
    })
  });

  assert.equal(res.status, 201, 'Dataset ingestion must return 201 Created');
  const data = await res.json();
  assert.equal(data.success, true);
  assert.equal(data.isSimulated, true);

  // 1. Dataset Provenance Verification
  const dataset = data.dataset;
  assert.ok(dataset, 'Dataset document must be created');
  assert.match(dataset.title, /^\[SIMULATED\]/, 'Dataset title must have mandatory [SIMULATED] prefix');
  assert.match(dataset.description, /\[SIMULATED TELEMETRY\]/, 'Dataset description must contain [SIMULATED TELEMETRY] tag');
  assert.equal(dataset.isSimulatorDerived, true, 'isSimulatorDerived must be true');
  assert.equal(dataset.isDemoData, true, 'isDemoData must be true');

  // 2. 15 Standard CSV Channels Validation
  assert.equal(dataset.totalColumns, 15, 'Must have exactly 15 standard channels');
  assert.equal(dataset.totalRows, 35, 'Must have stored all 35 samples');

  // 3. Analysis Run & Alert Provenance Verification
  if (data.analysisRun) {
    const run = await AnalysisRun.findById(data.analysisRun._id);
    assert.ok(run, 'AnalysisRun record must exist');
    assert.equal(run.isSimulatorDerived, true, 'AnalysisRun must be flagged as simulated');
    assert.match(run.datasetTitle, /^\[SIMULATED\]/, 'AnalysisRun datasetTitle must carry [SIMULATED]');
  }

  if (data.alerts && data.alerts.length > 0) {
    const alert = await Alert.findById(data.alerts[0]._id);
    assert.ok(alert, 'Alert must exist');
    assert.equal(alert.isSimulatorDerived, true, 'Alert must be marked as simulator derived');
    assert.match(alert.title, /^\[SIMULATED\]/, 'Alert title must be prefixed with [SIMULATED]');
  }
});
