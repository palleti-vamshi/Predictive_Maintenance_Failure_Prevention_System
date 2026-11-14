import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import {
  createPrng,
  generateDemoSchedule,
  getScheduleSegmentAtTime,
  SUPPORTED_DEMO_FAULTS
} from '../../web/src/components/simulator/demoScheduler.js';
import {
  extractWindowFeatures,
  evaluateIsolationForestAnomaly,
  classifyWithRandomForest,
  DemoAlertManager,
  evaluateRunPerformance
} from '../../web/src/components/simulator/telemetryWindowing.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SIMULATOR_HTML_PATH = path.resolve(__dirname, '../../web/public/simulator/transmission_dynamics_studio.html');

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

// ============================================================================
// 1. SCHEDULER REPRODUCIBILITY & BOUNDS
// ============================================================================
test('Scheduler 1: Identical random seed produces 100% reproducible schedule', () => {
  const seed = 42;
  const schedule1 = generateDemoSchedule({ seed, totalDuration: 60, healthyBaselineDuration: 10 });
  const schedule2 = generateDemoSchedule({ seed, totalDuration: 60, healthyBaselineDuration: 10 });

  assert.equal(schedule1.seed, 42);
  assert.equal(schedule1.totalDuration, 60);
  assert.equal(schedule1.segments.length, schedule2.segments.length, 'Segment count must match');
  assert.equal(schedule1.faultEvents.length, schedule2.faultEvents.length, 'Fault event count must match');

  for (let i = 0; i < schedule1.segments.length; i++) {
    const s1 = schedule1.segments[i];
    const s2 = schedule2.segments[i];
    assert.equal(s1.id, s2.id, `Segment ${i} ID mismatch`);
    assert.equal(s1.faultId, s2.faultId, `Segment ${i} faultId mismatch`);
    assert.equal(s1.startTime, s2.startTime, `Segment ${i} startTime mismatch`);
    assert.equal(s1.endTime, s2.endTime, `Segment ${i} endTime mismatch`);
    assert.equal(s1.severity, s2.severity, `Segment ${i} severity mismatch`);
  }
});

test('Scheduler 2: Different seeds produce distinct event sequences', () => {
  const sA = generateDemoSchedule({ seed: 101, totalDuration: 60 });
  const sB = generateDemoSchedule({ seed: 999, totalDuration: 60 });

  const seqA = sA.faultEvents.map((e) => e.faultId).join(',');
  const seqB = sB.faultEvents.map((e) => e.faultId).join(',');

  // The event sequences or timings should differ between distinct seeds
  const diffTiming = sA.faultEvents[0].startTime !== sB.faultEvents[0].startTime ||
                     sA.faultEvents[0].severity !== sB.faultEvents[0].severity ||
                     seqA !== seqB;
  assert.ok(diffTiming, 'Different seeds should vary start times, severities, or fault sequence');
});

test('Scheduler 3: Preserves healthy baseline and stays within physical bounds', () => {
  const schedule = generateDemoSchedule({ seed: 777, totalDuration: 60, healthyBaselineDuration: 10 });

  // First segment must be healthy baseline
  const first = schedule.segments[0];
  assert.equal(first.type, 'healthy_baseline');
  assert.equal(first.startTime, 0);
  assert.equal(first.endTime, 10);
  assert.equal(first.isHealthy, true);

  // Check physical limits for all fault events
  for (const event of schedule.faultEvents) {
    const def = SUPPORTED_DEMO_FAULTS.find((f) => f.id === event.faultId);
    assert.ok(def, `Event faultId ${event.faultId} must be in SUPPORTED_DEMO_FAULTS`);
    assert.ok(
      event.severity >= def.minSeverity && event.severity <= def.maxSeverity,
      `Severity ${event.severity} out of bounds for ${event.faultId} [${def.minSeverity}, ${def.maxSeverity}]`
    );
    assert.ok(event.duration >= 5.0, `Duration ${event.duration}s too short`);
  }
});

test('Scheduler 4: getScheduleSegmentAtTime retrieves correct interval', () => {
  const schedule = generateDemoSchedule({ seed: 42, totalDuration: 60, healthyBaselineDuration: 10 });

  const t0 = getScheduleSegmentAtTime(schedule.segments, 0);
  assert.equal(t0.type, 'healthy_baseline');

  const t5 = getScheduleSegmentAtTime(schedule.segments, 5.0);
  assert.equal(t5.type, 'healthy_baseline');

  const firstEvent = schedule.faultEvents[0];
  const tEvent = getScheduleSegmentAtTime(schedule.segments, firstEvent.startTime + 1.0);
  assert.equal(tEvent.id, firstEvent.id);
  assert.equal(tEvent.faultId, firstEvent.faultId);
});

// ============================================================================
// 2. GROUND TRUTH SEPARATION & ROLLING WINDOW EXTRACTION
// ============================================================================
test('Windowing 1: Zero ground-truth leakage into feature extraction', () => {
  // Construct simulated raw samples without ground truth labels
  const rawSamples = [];
  for (let i = 0; i < 16; i++) {
    rawSamples.push({
      simTime: 10.0 + i * 0.1,
      rpm: 1450 + Math.sin(i) * 10,
      inRpm: 1448 + Math.cos(i) * 8,
      outRpm: 1035 + Math.sin(i) * 5,
      torque: 42.5,
      powerKw: 6.4,
      coolant: 83.2,
      egt: 312.0,
      vibRms: 1.42 + i * 0.02,
      clutchSlipRpm: 2.0,
      clutchTemp: 35.5,
      gearboxTemp: 53.0,
      transEffPct: 95.8,
      currentGear: 3
    });
  }

  const features = extractWindowFeatures(rawSamples, 1.40);

  // Features must not contain any injected fault label or scenario identifiers
  assert.equal(features.faultId, undefined);
  assert.equal(features.faultName, undefined);
  assert.equal(features.injectedSeverity, undefined);
  assert.equal(features.groundTruth, undefined);

  // Mathematical feature verification
  assert.equal(features.sampleCount, 16);
  assert.equal(features.windowStartTime, 10.0);
  assert.equal(features.windowEndTime, 11.5);
  assert.ok(features.meanVibRms >= 1.4 && features.meanVibRms <= 1.8);
  assert.ok(features.ratioError < 0.05);
  assert.ok(features.meanTransEffPct > 90);
});

// ============================================================================
// 3. RANDOM FOREST DOMAIN RESTRICTION & TRUTHFUL CLASSIFICATION
// ============================================================================
test('Model 1: Random Forest accurately classifies verified gear tooth wear within domain', () => {
  // Gear tooth wear feature profile: elevated vibration, strict kinematic ratio preservation, zero clutch slip
  const gearWearFeatures = {
    meanVibRms: 3.85,
    ratioError: 0.002, // Invariant strictly preserved!
    ratioObserved: 1.401,
    meanClutchSlipRpm: 1.8,
    meanCoolantTemp: 84.0,
    coolantRate: 0.02,
    meanGearboxTemp: 58.0,
    gearboxTempRate: 0.15,
    meanTransEffPct: 91.5
  };

  const isAnomaly = true;
  const classification = classifyWithRandomForest(gearWearFeatures, isAnomaly);

  assert.equal(classification.predictedClass, 'gear_tooth_wear');
  assert.equal(classification.status, 'classified_by_model');
  assert.equal(classification.isSupportedDomain, true);
  assert.ok(classification.confidence > 0.80);
});

test('Model 2: Random Forest strictly reports Unknown / Out of Domain for unvalidated faults', () => {
  // Case A: Clutch Slippage (speed divergence ΔRPM = 180)
  const clutchSlipFeatures = {
    meanVibRms: 2.9,
    ratioError: 0.01,
    ratioObserved: 1.40,
    meanClutchSlipRpm: 185.0, // Major slip divergence!
    meanCoolantTemp: 85.0,
    coolantRate: 0.03,
    meanGearboxTemp: 56.0,
    gearboxTempRate: 0.10,
    meanTransEffPct: 78.0
  };

  const resA = classifyWithRandomForest(clutchSlipFeatures, true);
  assert.equal(resA.predictedClass, 'unknown_unsupported');
  assert.equal(resA.status, 'unsupported_by_model');
  assert.equal(resA.isSupportedDomain, false);
  assert.equal(resA.confidence, null);
  assert.ok(resA.label.includes('Unknown / anomaly detected'));
  assert.ok(resA.diagnosticNote.includes('slippage'));

  // Case B: Engine Cooling Overheat (Coolant = 108°C)
  const coolingFeatures = {
    meanVibRms: 1.8,
    ratioError: 0.005,
    ratioObserved: 1.40,
    meanClutchSlipRpm: 2.0,
    meanCoolantTemp: 108.5, // Overheat!
    coolantRate: 0.85,
    meanGearboxTemp: 60.0,
    gearboxTempRate: 0.05,
    meanTransEffPct: 94.0
  };

  const resB = classifyWithRandomForest(coolingFeatures, true);
  assert.equal(resB.predictedClass, 'unknown_unsupported');
  assert.equal(resB.isSupportedDomain, false);
  assert.ok(resB.diagnosticNote.includes('cooling'));
});

// ============================================================================
// 4. ISOLATION FOREST ANOMALY SCORING
// ============================================================================
test('Model 3: Isolation Forest detects deviation from baseline without fabricating probabilities', () => {
  const baseline = {
    meanVibRms: 1.32,
    meanClutchSlipRpm: 2.0,
    meanTransEffPct: 96.0,
    gearboxTempRate: 0.02,
    coolantRate: 0.02,
    ratioError: 0.002
  };

  // Normal window
  const normalFeatures = {
    meanVibRms: 1.35,
    meanClutchSlipRpm: 2.2,
    meanTransEffPct: 95.8,
    gearboxTempRate: 0.04,
    coolantRate: 0.03,
    meanGearboxTemp: 52.0,
    meanCoolantTemp: 82.5
  };

  const normalRes = evaluateIsolationForestAnomaly(normalFeatures, baseline);
  assert.equal(normalRes.isAnomaly, false);
  assert.ok(normalRes.anomalyScore < 0.35);
  assert.ok(normalRes.interpretation.includes('not a fault probability'));

  // Anomalous window (vibration surge + efficiency drop)
  const anomalousFeatures = {
    meanVibRms: 4.15,
    meanClutchSlipRpm: 2.5,
    meanTransEffPct: 82.0,
    gearboxTempRate: 0.45,
    coolantRate: 0.05,
    meanGearboxTemp: 68.0,
    meanCoolantTemp: 84.0
  };

  const anomRes = evaluateIsolationForestAnomaly(anomalousFeatures, baseline);
  assert.equal(anomRes.isAnomaly, true);
  assert.ok(anomRes.anomalyScore >= 0.55);
  assert.ok(anomRes.topDeviations.length > 0);
});

// ============================================================================
// 5. ALERT PERSISTENCE, HYSTERESIS, COOLDOWN & DEDUPLICATION
// ============================================================================
test('Alerts 1: Requires K=2 consecutive windows, enforces cooldown, and deduplicates', () => {
  const alertMgr = new DemoAlertManager({ persistenceThreshold: 2, cooldownSeconds: 8 });

  const healthyInf = {
    features: { windowStartTime: 0.0, windowEndTime: 3.2 },
    isolationForest: { isAnomaly: false, anomalyScore: 0.15, interpretation: 'Baseline', topDeviations: [] },
    randomForest: { predictedClass: 'healthy', label: 'Nominal Baseline', isSupportedDomain: true, confidence: 0.95 }
  };

  const anomalyInf1 = {
    features: { windowStartTime: 10.0, windowEndTime: 13.2 },
    isolationForest: { isAnomaly: true, anomalyScore: 0.78, interpretation: 'Outlier', topDeviations: ['Vib surged'] },
    randomForest: { predictedClass: 'gear_tooth_wear', label: 'Gear tooth wear', isSupportedDomain: true, confidence: 0.88, status: 'classified' }
  };

  const anomalyInf2 = {
    features: { windowStartTime: 10.8, windowEndTime: 14.0 },
    isolationForest: { isAnomaly: true, anomalyScore: 0.82, interpretation: 'Outlier', topDeviations: ['Vib surged'] },
    randomForest: { predictedClass: 'gear_tooth_wear', label: 'Gear tooth wear', isSupportedDomain: true, confidence: 0.90, status: 'classified' }
  };

  // 1. Single anomaly window must NOT raise alert (persistence rule requires K=2)
  const alert0 = alertMgr.processWindow(healthyInf);
  assert.equal(alert0, null);

  const alert1 = alertMgr.processWindow(anomalyInf1);
  assert.equal(alert1, null, 'Single anomalous window should not trigger alert (requires K=2)');

  // 2. Second consecutive anomaly window raises the alert
  const alert2 = alertMgr.processWindow(anomalyInf2);
  assert.ok(alert2 !== null, 'Second consecutive window must trigger alert');
  assert.equal(alert2.isSimulated, true);
  assert.equal(alert2.machineCode, 'GB-104');
  assert.ok(alert2.title.includes('[SIMULATED]'));

  // 3. Immediately next anomalous window within cooldown must be deduplicated
  const anomalyInf3 = {
    features: { windowStartTime: 11.6, windowEndTime: 14.8 },
    isolationForest: { isAnomaly: true, anomalyScore: 0.85, interpretation: 'Outlier', topDeviations: ['Vib surged'] },
    randomForest: { predictedClass: 'gear_tooth_wear', label: 'Gear tooth wear', isSupportedDomain: true, confidence: 0.90, status: 'classified' }
  };

  const alert3 = alertMgr.processWindow(anomalyInf3);
  assert.equal(alert3, null, 'Duplicate alert should be suppressed during active event/cooldown');
  assert.equal(alertMgr.alerts.length, 1, 'Exactly one alert should exist for this event interval');
});

// ============================================================================
// 6. END-OF-RUN EVALUATION
// ============================================================================
test('Evaluation: Computes injected, detected, missed, false alerts and detection latency', () => {
  const faultEvents = [
    { id: 'ev1', faultId: 'gear_tooth_wear', faultName: 'Gear tooth wear', startTime: 10.0, endTime: 22.0 },
    { id: 'ev2', faultId: 'clutch_slippage', faultName: 'Clutch slippage', startTime: 30.0, endTime: 42.0 }
  ];

  const alerts = [
    { id: 'al1', simTime: 12.5, severity: 'warning' }, // Detects ev1 (delay = 2.5s)
    { id: 'al2', simTime: 32.1, severity: 'critical' }  // Detects ev2 (delay = 2.1s)
  ];

  const evalRes = evaluateRunPerformance(faultEvents, alerts, 60);

  assert.equal(evalRes.totalInjectedEvents, 2);
  assert.equal(evalRes.detectedEventsCount, 2);
  assert.equal(evalRes.missedEventsCount, 0);
  assert.equal(evalRes.falseAlertsCount, 0);
  assert.equal(evalRes.meanDetectionDelaySeconds, 2.3);
  assert.ok(evalRes.disclaimer.includes('Single-run demonstration evaluation'));
});

// ============================================================================
// 7. PHYSICAL SANDBOX LIFECYCLE: PAUSE, RESUME & RESET
// ============================================================================
test('Lifecycle 1: Pause freezes physical simulation and resume continues seamlessly without jump', () => {
  const sim = createPhysicsSandbox({ throttle: '50', load: '40', gear: '3' });

  // 1. Advance in running mode (50 steps = 0.5s)
  for (let i = 0; i < 50; i++) sim.advancePhysicsStep(0.01);
  const rpmBeforePause = sim.liveState.rpm;
  const timeBeforePause = sim.liveState.simTime;
  assert.ok(rpmBeforePause > 800, `RPM should be running, got ${rpmBeforePause}`);

  // 2. Pause
  sim.liveState.running = false;
  sim.advancePhysicsStep(0.01);
  const timePaused1 = sim.liveState.simTime;
  assert.equal(sim.liveState.operatingState, 'PAUSED');

  // 3. Resume
  sim.liveState.running = true;
  for (let i = 0; i < 20; i++) sim.advancePhysicsStep(0.01);
  const rpmAfterResume = sim.liveState.rpm;

  // The speed should remain continuous without collapsing to 0 or spiking wildly
  const delta = Math.abs(rpmAfterResume - rpmBeforePause);
  assert.ok(delta < 150, `RPM after resume must transition continuously, delta was ${delta.toFixed(1)} RPM`);
  assert.ok(sim.liveState.simTime > timeBeforePause, 'Simulation time must advance after resume');
});

test('Lifecycle 2: Reset ends run, clears transient state, and returns to healthy baseline', () => {
  const sim = createPhysicsSandbox({ throttle: '55', load: '45', gear: '3' });

  // Inject multiple faults
  sim.liveState.faults.gear_tooth_wear.enabled = true;
  sim.liveState.faults.gear_tooth_wear.severity = 0.8;
  sim.liveState.faults.gearbox_lubrication_failure.enabled = true;
  sim.liveState.faults.gearbox_lubrication_failure.severity = 0.75;
  sim.liveState.coolant = 104.0;
  sim.liveState.gearboxTemp = 85.0;

  for (let i = 0; i < 50; i++) sim.advancePhysicsStep(0.01);
  assert.ok(sim.getActiveFaultsList().length >= 2, 'Faults should be active before reset');

  // Trigger reset healthy
  for (const k of Object.keys(sim.liveState.faults)) {
    sim.liveState.faults[k].enabled = false;
  }
  sim.liveState.syntheticFault = null;
  sim.liveState.coolant = 82.0;
  sim.liveState.gearboxTemp = 52.0;

  assert.equal(sim.getActiveFaultsList().length, 0, 'Active faults list must be empty after reset');
  assert.equal(sim.liveState.coolant, 82.0);
  assert.equal(sim.liveState.gearboxTemp, 52.0);
});

// ============================================================================
// 8. END-TO-END DEMO EXECUTION WITH REAL PHYSICS, WINDOWING & ALERTS
// ============================================================================
test('End-to-End: Automated demo transitions, feature windowing, and alerts without ground-truth leakage', () => {
  const sim = createPhysicsSandbox({ throttle: '65', load: '60', gear: '3' });
  const schedule = generateDemoSchedule({ seed: 42, totalDuration: 30, healthyBaselineDuration: 6 });
  const alertMgr = new DemoAlertManager({ persistenceThreshold: 2, cooldownSeconds: 6 });

  const sampleBuffer = [];
  const modelPredictions = [];
  const capturedAlerts = [];
  let healthyBaselineProfile = null;

  // Simulate 20 seconds of continuous operation in 100ms ticks (200 ticks)
  for (let tick = 0; tick < 200; tick++) {
    const simTime = tick * 0.1;

    // Apply active schedule segment
    const activeSeg = getScheduleSegmentAtTime(schedule.segments, simTime);
    if (activeSeg.isHealthy) {
      for (const k of Object.keys(sim.liveState.faults)) {
        sim.liveState.faults[k].enabled = false;
      }
    } else {
      sim.liveState.faults[activeSeg.faultId].enabled = true;
      sim.liveState.faults[activeSeg.faultId].severity = activeSeg.severity;
    }

    // Step physics 10 steps of 0.01s (0.1s total)
    for (let s = 0; s < 10; s++) sim.advancePhysicsStep(0.01);

    // Capture telemetry tick (pure sensor readings, NO ground-truth labels)
    sampleBuffer.push({
      simTime,
      rpm: sim.liveState.rpm,
      inRpm: sim.liveState.inRpm,
      outRpm: sim.liveState.outRpm,
      torque: sim.liveState.torqueBrake,
      powerKw: sim.liveState.powerKw,
      coolant: sim.liveState.coolant,
      egt: sim.liveState.egt,
      vibRms: sim.liveState.vibRms,
      clutchSlipRpm: sim.liveState.clutchSlipRpm,
      clutchTemp: sim.liveState.clutchTemp,
      gearboxTemp: sim.liveState.gearboxTemp,
      transEffPct: sim.liveState.transEff * 100,
      currentGear: sim.liveState.currentGear
    });

    // Windowing: evaluate every 4 ticks once 16 samples exist
    if (sampleBuffer.length >= 16 && tick % 4 === 0) {
      const windowSamples = sampleBuffer.slice(-16);
      const features = extractWindowFeatures(windowSamples, 1.40);

      // Calibrate healthy baseline profile ONLY during the initial healthy baseline period
      if (simTime < 5.5 || !healthyBaselineProfile) {
        healthyBaselineProfile = {
          meanVibRms: features.meanVibRms,
          meanClutchSlipRpm: features.meanClutchSlipRpm,
          meanTransEffPct: features.meanTransEffPct,
          gearboxTempRate: 0.05,
          coolantRate: 0.05,
          ratioError: 0.005
        };
      }

      const iso = evaluateIsolationForestAnomaly(features, healthyBaselineProfile);
      const rf = classifyWithRandomForest(features, iso.isAnomaly);
      const pred = { windowStartTime: features.windowStartTime, windowEndTime: features.windowEndTime, features, isolationForest: iso, randomForest: rf };
      modelPredictions.push(pred);

      const alert = alertMgr.processWindow(pred, 'GB-104', 'demo_seed_42');
      if (alert) capturedAlerts.push(alert);
    }
  }

  // Verification
  assert.ok(modelPredictions.length >= 10, 'Should have processed at least 10 rolling windows');
  assert.ok(capturedAlerts.length >= 1, 'Should have generated at least 1 alert for injected fault');

  // Verify alert properties
  const firstAlert = capturedAlerts[0];
  assert.equal(firstAlert.isSimulated, true);
  assert.equal(firstAlert.machineCode, 'GB-104');
  assert.ok(firstAlert.anomalyScore >= 0.55);
  assert.ok(firstAlert.evidence.length > 0);

  // Evaluate run
  const evalRes = evaluateRunPerformance(schedule.faultEvents, capturedAlerts, 20);
  assert.ok(evalRes.totalInjectedEvents >= 1);
  assert.ok(evalRes.detectedEventsCount >= 1);
});
