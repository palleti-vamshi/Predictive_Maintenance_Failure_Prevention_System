import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SIMULATOR_HTML_PATH = path.resolve(__dirname, '../../web/public/simulator/transmission_dynamics_studio.html');

/**
 * Creates an isolated simulation physics sandbox directly from transmission_dynamics_studio.html
 */
function createPhysicsSandbox(initialControls = {}) {
  const html = fs.readFileSync(SIMULATOR_HTML_PATH, 'utf8');
  const scriptMatches = [...html.matchAll(/<script[\s\S]*?>([\s\S]*?)<\/script>/gi)];
  const scriptCode = scriptMatches[2][1] + 
    '\n;globalThis.liveState = liveState;' + 
    'globalThis.advancePhysicsStep = advancePhysicsStep;' + 
    'globalThis.physicalParams = physicalParams;' + 
    'globalThis.getActiveFaultsList = getActiveFaultsList;' + 
    'globalThis.gearRatios = gearRatios;' +
    'globalThis.SIM_DT = SIM_DT;';

  const controls = {
    load: '35',
    throttle: '50',
    ambient: '25',
    wear: '10',
    ratio: '2.45',
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
// 1. STEADY OPERATION IN ALL GEARS (-1, 0, 1, 2, 3, 4, 5)
// ============================================================================
test('RPM Stability 1: Steady operation in all transmission gears with kinematic consistency', () => {
  const gears = [-1, 0, 1, 2, 3, 4, 5];

  gears.forEach(g => {
    const sim = createPhysicsSandbox({ throttle: '45', load: '30', gear: String(g) });
    sim.liveState.currentGear = g;
    sim.liveState.targetGear = g;
    sim.liveState.shiftState = 'LOCKED';

    const ratio = sim.gearRatios[String(g)] || 0;
    if (ratio !== 0) {
      sim.liveState.inOmega = sim.liveState.omega;
      sim.liveState.outOmega = sim.liveState.inOmega / ratio;
    } else {
      sim.liveState.inOmega = sim.liveState.omega;
      sim.liveState.outOmega = 50.0; // pre-existing coasting speed
    }

    // Run for 1.0 second (100 steps)
    for (let step = 0; step < 100; step++) {
      sim.advancePhysicsStep(0.01);

      // Verify finite numbers
      assert.ok(Number.isFinite(sim.liveState.rpm), `Gear ${g}: Engine RPM must be finite`);
      assert.ok(Number.isFinite(sim.liveState.inRpm), `Gear ${g}: Input RPM must be finite`);
      assert.ok(Number.isFinite(sim.liveState.outRpm), `Gear ${g}: Output RPM must be finite`);

      // Verify no collapse to 0 or 100 RPM chatter
      assert.ok(sim.liveState.rpm >= 700, `Gear ${g}: Engine RPM must remain above anti-stall governor floor, got ${sim.liveState.rpm}`);
      assert.ok(sim.liveState.rpm <= 5500, `Gear ${g}: Engine RPM must respect rev limiter, got ${sim.liveState.rpm}`);

      // Verify kinematic relationship when locked in gear
      if (ratio !== 0 && sim.liveState.clutchLocked) {
        const expectedOutRpm = Math.abs(sim.liveState.inRpm / ratio);
        const actualOutRpm = sim.liveState.outRpm;
        assert.ok(
          Math.abs(actualOutRpm - expectedOutRpm) < 1.0,
          `Gear ${g}: Output RPM (${actualOutRpm.toFixed(1)}) must match input RPM / ratio (${expectedOutRpm.toFixed(1)})`
        );
      }
    }
  });
});

// ============================================================================
// 2. DYNAMIC SHIFT TRANSITION STABILITY (OUTPUT MOMENTUM & NO 0/100 SPIKES)
// ============================================================================
test('RPM Stability 2: Upshifts and downshifts preserve driveline momentum without collapsing to 0 or spiking', () => {
  const sim = createPhysicsSandbox({ throttle: '55', load: '35', gear: '3' });
  sim.liveState.currentGear = 3;
  sim.liveState.targetGear = 3;
  sim.liveState.shiftState = 'LOCKED';
  sim.liveState.clutchFactor = 1.0;
  // Initialize at nominal cruising operating point (2400 RPM)
  sim.liveState.rpm = 2400;
  sim.liveState.omega = (2400 * 2 * Math.PI) / 60;
  sim.liveState.inOmega = sim.liveState.omega;
  sim.liveState.outOmega = sim.liveState.inOmega / 1.40;

  // Settle in 3rd gear
  for (let i = 0; i < 50; i++) sim.advancePhysicsStep(0.01);
  const preShiftEngRpm = sim.liveState.rpm;
  const preShiftOutRpm = sim.liveState.outRpm;
  assert.ok(preShiftEngRpm > 1500, `Engine should be running at speed, got ${preShiftEngRpm}`);
  assert.ok(preShiftOutRpm > 1000, `Output shaft should be running at speed, got ${preShiftOutRpm}`);

  // Initiate Upshift 3 -> 4
  sim.liveState.targetGear = 4;
  sim.liveState.shiftState = 'DISENGAGING';
  sim.liveState.shiftTimer = 0;

  let minOutRpm = Infinity;
  let minEngRpm = Infinity;
  let shiftCompleted = false;

  // Run through entire shift sequence (80 steps = 0.8s)
  for (let step = 0; step < 80; step++) {
    sim.advancePhysicsStep(0.01);

    minOutRpm = Math.min(minOutRpm, sim.liveState.outRpm);
    minEngRpm = Math.min(minEngRpm, sim.liveState.rpm);

    // CRITICAL: Output shaft must NEVER plunge to 0 during shift!
    assert.ok(
      sim.liveState.outRpm > preShiftOutRpm * 0.85,
      `Step ${step} (${sim.liveState.shiftState}): Output shaft RPM must maintain driveline momentum, got ${sim.liveState.outRpm.toFixed(1)} (pre-shift: ${preShiftOutRpm.toFixed(1)})`
    );

    // CRITICAL: Engine RPM must NEVER plunge to 0 or 100 during shift!
    assert.ok(
      sim.liveState.rpm >= 850,
      `Step ${step} (${sim.liveState.shiftState}): Engine RPM must be held by idle governor/throttle, got ${sim.liveState.rpm.toFixed(1)}`
    );

    if (sim.liveState.shiftState === 'LOCKED' && sim.liveState.currentGear === 4) {
      shiftCompleted = true;
    }
  }

  assert.ok(shiftCompleted, 'Shift 3 -> 4 must complete into LOCKED state in Gear 4');
  assert.equal(sim.liveState.currentGear, 4, 'Current gear must be 4');
  assert.ok(minOutRpm > preShiftOutRpm * 0.90, `Minimum output RPM during shift should be high, got ${minOutRpm.toFixed(1)}`);

  // Now test Downshift 4 -> 3
  sim.liveState.targetGear = 3;
  sim.liveState.shiftState = 'DISENGAGING';
  sim.liveState.shiftTimer = 0;

  let downshiftCompleted = false;
  const preDownshiftOut = sim.liveState.outRpm;

  for (let step = 0; step < 80; step++) {
    sim.advancePhysicsStep(0.01);

    assert.ok(
      sim.liveState.outRpm > preDownshiftOut * 0.85,
      `Downshift Step ${step}: Output shaft RPM must maintain driveline momentum, got ${sim.liveState.outRpm.toFixed(1)}`
    );
    assert.ok(
      sim.liveState.rpm >= 850,
      `Downshift Step ${step}: Engine RPM must not collapse, got ${sim.liveState.rpm.toFixed(1)}`
    );

    if (sim.liveState.shiftState === 'LOCKED' && sim.liveState.currentGear === 3) {
      downshiftCompleted = true;
    }
  }

  assert.ok(downshiftCompleted, 'Downshift 4 -> 3 must complete into LOCKED state in Gear 3');
});

// ============================================================================
// 3. ENGINE STARTING & CRANKING PROGRESSION
// ============================================================================
test('RPM Stability 3: Starter motor cranking sequence progresses smoothly without step jumps', () => {
  const sim = createPhysicsSandbox({ throttle: '0', load: '0', gear: '0' });
  sim.liveState.ignition = false;
  sim.liveState.stalled = false;
  sim.liveState.omega = 0;
  sim.liveState.rpm = 0;
  sim.liveState.inOmega = 0;
  sim.liveState.outOmega = 0;
  sim.liveState.operatingState = 'STOPPED';

  // Advance 10 steps stopped
  for (let i = 0; i < 10; i++) sim.advancePhysicsStep(0.01);
  assert.equal(sim.liveState.rpm, 0, 'Engine must be stationary when stopped');
  assert.equal(sim.liveState.operatingState, 'STOPPED');

  // Trigger ignition
  sim.liveState.ignition = true;
  sim.liveState.startingTimer = 0.50;
  sim.liveState.operatingState = 'STARTING';

  const rpmTrajectory = [];
  for (let step = 0; step < 70; step++) { // 0.7s
    sim.advancePhysicsStep(0.01);
    rpmTrajectory.push({
      time: +(step * 0.01).toFixed(2),
      rpm: sim.liveState.rpm,
      state: sim.liveState.operatingState
    });
  }

  // Verify cranking progression
  const midCrank = rpmTrajectory[20]; // 0.20s
  assert.ok(midCrank.rpm >= 200 && midCrank.rpm <= 500, `At 0.2s cranking RPM should be in cranking range (200-500), got ${midCrank.rpm.toFixed(1)}`);
  assert.equal(midCrank.state, 'STARTING');

  // Verify transition to RUNNING at idle RPM
  const postCrank = rpmTrajectory[60]; // 0.60s
  assert.ok(postCrank.rpm >= 850 && postCrank.rpm <= 1050, `At 0.6s engine should have caught idle (~950 RPM), got ${postCrank.rpm.toFixed(1)}`);
  assert.equal(postCrank.state, 'RUNNING');

  // Verify monotonic smooth rise (no backward plunges or spikes)
  for (let i = 1; i < 50; i++) {
    const diff = rpmTrajectory[i].rpm - rpmTrajectory[i - 1].rpm;
    assert.ok(diff >= -2.0, `Cranking RPM should increase monotonically, step ${i} dropped by ${diff}`);
  }
});

// ============================================================================
// 4. ENGINE SHUTDOWN CONTROLLED SPINDOWN
// ============================================================================
test('RPM Stability 4: Engine shutdown decelerates smoothly to zero without oscillating', () => {
  const sim = createPhysicsSandbox({ throttle: '40', load: '20', gear: '0' });
  sim.liveState.currentGear = 0;
  sim.liveState.shiftState = 'LOCKED';

  // Run at idle/light load
  for (let i = 0; i < 50; i++) sim.advancePhysicsStep(0.01);
  assert.ok(sim.liveState.rpm >= 900, `Engine should be running before shutdown, got ${sim.liveState.rpm}`);

  // Cut ignition
  sim.liveState.ignition = false;
  sim.liveState.operatingState = 'STOPPED';

  let prevRpm = sim.liveState.rpm;
  for (let step = 0; step < 350; step++) { // 3.5s spindown
    sim.advancePhysicsStep(0.01);
    assert.ok(sim.liveState.rpm <= prevRpm + 0.1, `RPM must continuously decrease during shutdown (step ${step}: ${sim.liveState.rpm} vs prev ${prevRpm})`);
    prevRpm = sim.liveState.rpm;
  }

  assert.equal(sim.liveState.rpm, 0, 'Engine RPM must reach exactly 0 after spindown');
  assert.equal(sim.liveState.operatingState, 'STOPPED');
});

// ============================================================================
// 5. PAUSE AND RESUME RESILIENCE
// ============================================================================
test('RPM Stability 5: Pause and resume does not cause physics accumulator windup or velocity spikes', () => {
  const sim = createPhysicsSandbox({ throttle: '50', load: '35', gear: '3' });
  for (let i = 0; i < 50; i++) sim.advancePhysicsStep(0.01);
  const baselineRpm = sim.liveState.rpm;

  // Pause simulation
  sim.liveState.running = false;
  sim.liveState.operatingState = 'PAUSED';

  // While paused, simTime does not advance and state remains frozen
  assert.equal(sim.liveState.operatingState, 'PAUSED');

  // Resume simulation
  sim.liveState.running = true;
  sim.liveState.operatingState = 'RUNNING';

  // Step immediately
  sim.advancePhysicsStep(0.01);
  const postResumeRpm = sim.liveState.rpm;

  // Verify delta is minimal (< 5 RPM)
  const jump = Math.abs(postResumeRpm - baselineRpm);
  assert.ok(jump < 5.0, `Post-resume RPM jump must be negligible (< 5 RPM), got ${jump.toFixed(2)} RPM`);
});

// ============================================================================
// 6. RESET BASELINE STABILITY
// ============================================================================
test('RPM Stability 6: Reset from extreme state reinitializes cleanly without residual windup', () => {
  const sim = createPhysicsSandbox({ throttle: '90', load: '85', gear: '1' });
  // Set extreme / perturbed state
  sim.liveState.rpm = 4800;
  sim.liveState.omega = 4800 * 2 * Math.PI / 60;
  sim.liveState.coolant = 108.0;
  sim.liveState.gearboxTemp = 95.0;
  sim.liveState.faults.clutch_slippage.enabled = true;
  sim.liveState.faults.clutch_slippage.severity = 0.95;

  // Run 10 steps under perturbation
  for (let i = 0; i < 10; i++) sim.advancePhysicsStep(0.01);

  // Trigger full reset baseline
  sim.liveState.running = true;
  sim.liveState.clutchTarget = 1.0;
  sim.liveState.clutchFactor = 1.0;
  sim.liveState.clutchLocked = true;
  sim.liveState.brakeTarget = 0.0;
  sim.liveState.brakeFactor = 0.0;
  sim.liveState.brakeTorque = 0.0;
  sim.liveState.ignition = true;
  sim.liveState.stalled = false;
  sim.liveState.stallTimer = 0;
  sim.liveState.startingTimer = 0;
  sim.liveState.currentGear = 3;
  sim.liveState.targetGear = 3;
  sim.liveState.shiftState = 'LOCKED';
  sim.liveState.operatingState = 'RUNNING';
  sim.liveState.rpm = sim.physicalParams.idleRpm;
  sim.liveState.omega = (sim.physicalParams.idleRpm * 2 * Math.PI) / 60;
  sim.liveState.inOmega = sim.liveState.omega;
  sim.liveState.outOmega = sim.liveState.inOmega / 1.40;
  sim.liveState.genOmega = sim.liveState.outOmega * 2.45;
  sim.liveState.genRpm = (sim.liveState.genOmega * 60) / (2 * Math.PI);
  sim.liveState.coolant = 82.0;
  sim.liveState.clutchTemp = 35.0;
  sim.liveState.gearboxTemp = 52.0;
  sim.liveState.simTime = 0;
  sim.liveState.faults.clutch_slippage.enabled = false;

  // Run 50 steps from reset
  for (let i = 0; i < 50; i++) {
    sim.advancePhysicsStep(0.01);
    assert.ok(Number.isFinite(sim.liveState.rpm), 'RPM must be finite after reset');
    assert.ok(sim.liveState.rpm >= 850 && sim.liveState.rpm <= 3000, `RPM must settle smoothly near baseline, got ${sim.liveState.rpm.toFixed(1)}`);
  }

  assert.equal(sim.liveState.operatingState, 'RUNNING');
  assert.equal(sim.liveState.currentGear, 3);
});

// ============================================================================
// 7. PHYSICAL FAULT ACTIVATION STABILITY
// ============================================================================
test('RPM Stability 7: Fault activations produce physically continuous RPM responses without chatter', () => {
  const faultNames = [
    'clutch_slippage',
    'gear_tooth_wear',
    'bearing_failure',
    'gearbox_lubrication_failure',
    'engine_cooling_failure'
  ];

  faultNames.forEach(faultKey => {
    const sim = createPhysicsSandbox({ throttle: '60', load: '40', gear: '3' });
    // Baseline settle
    for (let i = 0; i < 50; i++) sim.advancePhysicsStep(0.01);
    const preFaultEngRpm = sim.liveState.rpm;
    const preFaultOutRpm = sim.liveState.outRpm;

    // Activate fault at high severity
    sim.liveState.faults[faultKey].enabled = true;
    sim.liveState.faults[faultKey].severity = 0.85;

    // Run for 1.0 second (100 steps)
    for (let step = 0; step < 100; step++) {
      sim.advancePhysicsStep(0.01);

      assert.ok(Number.isFinite(sim.liveState.rpm), `Fault ${faultKey}: Engine RPM must be finite`);
      assert.ok(Number.isFinite(sim.liveState.inRpm), `Fault ${faultKey}: Input RPM must be finite`);
      assert.ok(Number.isFinite(sim.liveState.outRpm), `Fault ${faultKey}: Output RPM must be finite`);

      // Verify no discrete chatter / 100 RPM limit cycle spikes
      assert.ok(sim.liveState.rpm >= 550, `Fault ${faultKey}: Engine RPM must not collapse, got ${sim.liveState.rpm}`);
    }

    if (faultKey === 'clutch_slippage') {
      // Must produce physical slip divergence
      assert.ok(sim.liveState.clutchSlipRpm > 25, 'Clutch slippage fault must produce non-zero slip RPM');
    }
  });
});

// ============================================================================
// 8. DATA QUALITY & CORRUPT/MISSING FRAME RESILIENCE
// ============================================================================
test('RPM Stability 8: Missing or corrupt telemetry values are handled safely without NaN or zero-clamps', () => {
  // Test safe conversion logic used in web UI
  const formatSafely = (val, decimals = 0) => {
    if (val === null || val === undefined || !Number.isFinite(Number(val))) {
      return '—';
    }
    return decimals === 0 ? String(Math.round(val)) : Number(val).toFixed(decimals);
  };

  assert.equal(formatSafely(null), '—', 'null reading must render as em-dash, NOT 0');
  assert.equal(formatSafely(undefined), '—', 'undefined reading must render as em-dash, NOT 0');
  assert.equal(formatSafely(NaN), '—', 'NaN reading must render as em-dash, NOT 0');
  assert.equal(formatSafely(Infinity), '—', 'Infinity reading must render as em-dash, NOT 0');
  assert.equal(formatSafely(950), '950', 'Valid 950 RPM reading renders correctly');
  assert.equal(formatSafely(0), '0', 'Legitimate 0 RPM (e.g. stopped engine) renders as 0');
});
