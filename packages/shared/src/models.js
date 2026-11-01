/**
 * ML Model Contracts, architectures, statuses, and fault domain taxonomy.
 */

export const MODEL_TYPES = Object.freeze({
  RANDOM_FOREST: 'random_forest',
  ISOLATION_FOREST: 'isolation_forest'
});

export const MODEL_STATUS = Object.freeze({
  PENDING: 'pending',
  TRAINING: 'training',
  READY: 'ready',
  FAILED: 'failed'
});

export const FAULT_DOMAINS = Object.freeze({
  GEAR_FAULTS: 'gear_faults',
  BEARING_FAULTS: 'bearing_faults',
  GENERAL_MECHANICAL: 'general_mechanical'
});

export const FAULT_DOMAIN_LABELS = Object.freeze({
  [FAULT_DOMAINS.GEAR_FAULTS]: 'Gear Faults (Gearbox Meshing, Broken/Chipped Tooth, Pitting)',
  [FAULT_DOMAINS.BEARING_FAULTS]: 'Bearing Faults (Inner/Outer Race, Ball, Cage Defect)',
  [FAULT_DOMAINS.GENERAL_MECHANICAL]: 'General Mechanical Telemetry & Unsupervised Baseline'
});

export const MODEL_TYPE_LABELS = Object.freeze({
  [MODEL_TYPES.RANDOM_FOREST]: 'Random Forest Multi-Class Classifier',
  [MODEL_TYPES.ISOLATION_FOREST]: 'Isolation Forest Unsupervised Anomaly Detector'
});

export const STANDARD_EXTRACTED_FEATURES = Object.freeze([
  'mean',
  'std',
  'rms',
  'peak_to_peak',
  'max_abs',
  'crest_factor',
  'kurtosis',
  'skewness',
  'shape_factor',
  'impulse_factor',
  'spectral_centroid',
  'spectral_spread',
  'band_energy_low',
  'band_energy_mid',
  'band_energy_high',
  'gmf_peak_energy'
]);
