/**
 * MechGuard AI — Gearbox Simulator Demo Scheduler
 *
 * Provides deterministic, reproducible scenario scheduling for automatic
 * fault injection and detection demonstrations. Uses a seeded pseudo-random
 * number generator (Mulberry32) so any presentation or test run can be
 * identically replayed.
 *
 * Strictly browser-side digital twin simulation — NEVER connected to physical machinery.
 */

/**
 * 32-bit Mulberry32 seeded pseudo-random number generator.
 * Produces deterministic sequence in [0, 1) for a given integer seed.
 *
 * @param {number|string} seed
 * @returns {() => number}
 */
export function createPrng(seed) {
  let s = (typeof seed === 'number' ? seed : parseInt(seed, 10)) >>> 0;
  if (Number.isNaN(s)) s = 42;
  return function prng() {
    s |= 0;
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Supported fault types informed by manual_transmission_fault_parameters.pdf
 * and continuous ODE physics.
 */
export const SUPPORTED_DEMO_FAULTS = [
  {
    id: 'clutch_slippage',
    name: 'Clutch slippage',
    subsystem: 'Friction Plates & Clamping System',
    minSeverity: 0.70,
    maxSeverity: 0.88,
    minDuration: 8.0,
    maxDuration: 14.0,
    primaryEffect: 'Limits clamping torque capacity; drives ΔRPM speed divergence between engine and input shaft.',
    rfSupported: false // Random Forest SEU DDS benchmark is NOT trained on clutch slip
  },
  {
    id: 'gear_tooth_wear',
    name: 'Gear tooth wear',
    subsystem: 'Helical Pinion & Output Gears',
    minSeverity: 0.40,
    maxSeverity: 0.80,
    minDuration: 8.0,
    maxDuration: 15.0,
    primaryEffect: 'Excites Gear Mesh Frequency (GMF) harmonics while strictly preserving kinematic gear ratio (ω_out = ω_in / ratio).',
    rfSupported: true // SEU DDS Gearbox benchmark has chipped/broken tooth classes
  },
  {
    id: 'bearing_failure',
    name: 'Bearing failure',
    subsystem: 'Countershaft Support Bearings',
    minSeverity: 0.35,
    maxSeverity: 0.75,
    minDuration: 8.0,
    maxDuration: 14.0,
    primaryEffect: 'Introduces Coulomb and viscous parasitic drag torque opposing rotation and raceway impact harmonics.',
    rfSupported: false // Gearbox RF model is NOT trained on bearing degradation
  },
  {
    id: 'gearbox_lubrication_failure',
    name: 'Gearbox lubrication failure',
    subsystem: 'Sump Oil & Hydrodynamic Lubricating Film',
    minSeverity: 0.45,
    maxSeverity: 0.85,
    minDuration: 7.0,
    maxDuration: 13.0,
    primaryEffect: 'Loss of hydrodynamic lubricating film causes boundary metal contact, severe efficiency loss, and sump oil overheating.',
    rfSupported: false // Gearbox RF model is NOT trained on lubricant failure
  },
  {
    id: 'engine_cooling_failure',
    name: 'Engine cooling-system failure',
    subsystem: 'Radiator Heat Exchanger & Coolant Circuit',
    minSeverity: 0.50,
    maxSeverity: 0.90,
    minDuration: 9.0,
    maxDuration: 15.0,
    primaryEffect: 'Restricts radiator convection; coolant temperature climbs past 98°C triggering ECU torque thermal derate.',
    rfSupported: false // Gearbox RF model is NOT trained on cooling failure
  }
];

/**
 * Generates an automatic demonstration scenario schedule.
 *
 * Guarantees:
 * 1. An initial pure healthy baseline period (default 10s).
 * 2. Deterministic fault sequence, severities, and durations derived from seed.
 * 3. Recovery periods between faults so physical ODE settling is observable.
 * 4. Ground-truth metadata kept completely separate from telemetry features.
 *
 * @param {Object} options
 * @param {number|string} [options.seed=42] - Reproducible seed
 * @param {number} [options.totalDuration=60] - Total run duration in seconds
 * @param {number} [options.healthyBaselineDuration=10] - Initial healthy baseline duration
 * @param {number} [options.recoveryDuration=6] - Healthy recovery duration between faults
 * @returns {{ seed: number, totalDuration: number, segments: Array<Object>, faultEvents: Array<Object> }}
 */
export function generateDemoSchedule({
  seed = 42,
  totalDuration = 60,
  healthyBaselineDuration = 10,
  recoveryDuration = 6
} = {}) {
  const numericSeed = (typeof seed === 'number' ? seed : parseInt(seed, 10)) || 42;
  const prng = createPrng(numericSeed);

  const segments = [];
  const faultEvents = [];
  let currentTime = 0;

  // 1. Initial Healthy Baseline Period
  segments.push({
    id: 'seg_baseline_healthy',
    type: 'healthy_baseline',
    faultId: 'none',
    faultName: 'Nominal Baseline',
    severity: 0,
    startTime: 0,
    endTime: healthyBaselineDuration,
    isHealthy: true,
    description: 'Calibrated healthy baseline. Transducer vibration and thermal sensors within nominal ISO limits.'
  });
  currentTime = healthyBaselineDuration;

  // Shuffle fault pool deterministically using Fisher-Yates with PRNG
  const faultPool = [...SUPPORTED_DEMO_FAULTS];
  for (let i = faultPool.length - 1; i > 0; i--) {
    const j = Math.floor(prng() * (i + 1));
    [faultPool[i], faultPool[j]] = [faultPool[j], faultPool[i]];
  }

  let eventIndex = 1;
  let poolIndex = 0;

  // 2. Schedule Fault Events with Recovery Intervals
  while (currentTime + 8.0 < totalDuration) {
    const faultDef = faultPool[poolIndex % faultPool.length];
    poolIndex++;

    // Randomize duration and severity within physical limits
    const durationRange = faultDef.maxDuration - faultDef.minDuration;
    const rawDuration = faultDef.minDuration + prng() * durationRange;
    const duration = Math.min(rawDuration, totalDuration - currentTime);

    if (duration < 5.0) break; // Don't schedule micro-stubs at the very end

    const severityRange = faultDef.maxSeverity - faultDef.minSeverity;
    const severity = Number((faultDef.minSeverity + prng() * severityRange).toFixed(2));

    const faultStartTime = Number(currentTime.toFixed(2));
    const faultEndTime = Number((currentTime + duration).toFixed(2));

    const eventObj = {
      id: `fault_event_${eventIndex}`,
      eventIndex,
      type: 'simulated_fault',
      faultId: faultDef.id,
      faultName: faultDef.name,
      subsystem: faultDef.subsystem,
      severity,
      startTime: faultStartTime,
      endTime: faultEndTime,
      duration: Number(duration.toFixed(2)),
      isHealthy: false,
      primaryEffect: faultDef.primaryEffect,
      rfSupported: faultDef.rfSupported,
      description: `Injected physical anomaly: ${faultDef.name} (${Math.round(severity * 100)}% severity). [SIMULATED]`
    };

    segments.push(eventObj);
    faultEvents.push(eventObj);

    currentTime = faultEndTime;
    eventIndex++;

    // Schedule Recovery buffer between events if time permits
    if (currentTime + recoveryDuration + 6.0 <= totalDuration) {
      const recEndTime = Number((currentTime + recoveryDuration).toFixed(2));
      segments.push({
        id: `seg_recovery_${eventIndex - 1}`,
        type: 'healthy_recovery',
        faultId: 'none',
        faultName: 'Healthy Baseline Recovery',
        severity: 0,
        startTime: currentTime,
        endTime: recEndTime,
        isHealthy: true,
        description: 'Post-anomaly recovery phase. Dynamic thermal dissipation and velocity stabilization.'
      });
      currentTime = recEndTime;
    }
  }

  // Ensure segments fill up to totalDuration
  if (currentTime < totalDuration) {
    segments.push({
      id: `seg_terminal_healthy`,
      type: 'healthy_recovery',
      faultId: 'none',
      faultName: 'Healthy Run Completion',
      severity: 0,
      startTime: currentTime,
      endTime: totalDuration,
      isHealthy: true,
      description: 'Run completion and telemetry buffer stabilization.'
    });
  }

  return {
    seed: numericSeed,
    totalDuration,
    segments,
    faultEvents
  };
}

/**
 * Finds the active schedule segment at a given simulation time.
 *
 * @param {Array<Object>} segments
 * @param {number} simTime
 * @returns {Object|null}
 */
export function getScheduleSegmentAtTime(segments, simTime) {
  if (!Array.isArray(segments) || segments.length === 0) return null;
  const time = Math.max(0, simTime);
  for (const seg of segments) {
    if (time >= seg.startTime && time < seg.endTime) {
      return seg;
    }
  }
  return segments[segments.length - 1];
}

