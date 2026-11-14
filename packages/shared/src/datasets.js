/**
 * Dataset contracts, modalities, lifecycle statuses, and quality thresholds.
 */

export const DATASET_TYPES = Object.freeze({
  OPERATIONAL: 'operational',
  REFERENCE: 'reference',
  SIMULATOR: 'simulator',
  SYNTHETIC_QA: 'synthetic_qa'
});

export const DATASET_PROVENANCE_LABELS = Object.freeze({
  operational: 'Operational Factory Telemetry',
  simulator: 'Gearbox Simulator Telemetry (Digital Twin)',
  reference: 'Public Research Benchmark',
  synthetic_qa: 'Synthetic / QA Test Data'
});

export const DATASET_STATUS = Object.freeze({
  UPLOADED: 'uploaded',
  VALIDATING: 'validating',
  READY: 'ready',
  NEEDS_REVIEW: 'needs_review',
  REJECTED: 'rejected'
});

export const DATASET_MODALITY = Object.freeze({
  RAW_SIGNALS: 'raw_signals',
  PRECOMPUTED_FEATURES: 'precomputed_features',
  LABELED_FAULTS: 'labeled_fault_examples',
  UNLABELED_TELEMETRY: 'unlabeled_telemetry',
  RUN_TO_FAILURE: 'run_to_failure'
});

export const AI_TASK_TYPES = Object.freeze({
  ANOMALY_DETECTION: 'anomaly_detection',
  FAULT_CLASSIFICATION: 'fault_classification',
  REMAINING_USEFUL_LIFE: 'remaining_useful_life'
});

/**
 * Standard engineering bounds for Gearbox signals.
 * Values outside these plausible physical limits trigger validation warnings.
 */
export const GEARBOX_SIGNAL_BOUNDS = Object.freeze({
  vibration_input_axial: { min: -50, max: 50, unit: 'mm/s', label: 'Vibration Input Axial' },
  vibration_input_radial: { min: -50, max: 50, unit: 'mm/s', label: 'Vibration Input Radial' },
  vibration_output_radial: { min: -50, max: 50, unit: 'mm/s', label: 'Vibration Output Radial' },
  temp_gearbox_sump: { min: -30, max: 140, unit: 'degC', label: 'Oil Sump Temperature' },
  temp_bearing_input: { min: -30, max: 150, unit: 'degC', label: 'Bearing Temperature' },
  rotational_speed: { min: 0, max: 8000, unit: 'RPM', label: 'Shaft Speed' },
  load_torque: { min: -100, max: 25000, unit: 'Nm', label: 'Load Torque' }
});

export const MAX_UPLOAD_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB legacy/default limit
export const MAX_OPERATIONAL_UPLOAD_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB operational limit
export const MAX_RESEARCH_UPLOAD_SIZE_BYTES = 1024 * 1024 * 1024; // 1 GB research limit
export const DEFAULT_CHUNK_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB per upload chunk
export const ACCEPTED_FILE_EXTENSIONS = Object.freeze(['.csv', '.txt']);
export const ACCEPTED_RESEARCH_EXTENSIONS = Object.freeze([
  '.csv',
  '.txt',
  '.zip',
  '.tar.gz',
  '.tgz',
  '.gz'
]);

export const DATASET_JOB_STATUS = Object.freeze({
  QUEUED: 'queued',
  PROCESSING: 'processing',
  COMPLETE: 'complete',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
});

export const DATASET_JOB_STAGES = Object.freeze({
  QUEUED: 'queued',
  VALIDATING_INTEGRITY: 'validating_integrity',
  INSPECTING_ARCHIVE: 'inspecting_archive',
  EXTRACTING_ARCHIVE: 'extracting_archive',
  STREAM_PROFILING: 'stream_profiling',
  COMPUTING_STATISTICS: 'computing_statistics',
  EVALUATING_COMPATIBILITY: 'evaluating_compatibility',
  COMPLETE: 'complete',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
});

