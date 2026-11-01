/**
 * Alert severities, states, and analysis categories.
 */
export const ALERT_SEVERITIES = Object.freeze({
  CRITICAL: 'critical',
  WARNING: 'warning',
  INFO: 'info',
  HEALTHY: 'healthy',
  UNCALIBRATED: 'uncalibrated'
});

export const ALERT_STATUSES = Object.freeze({
  OPEN: 'open',
  ACKNOWLEDGED: 'acknowledged',
  RESOLVED: 'resolved'
});

export const ANALYSIS_METHODS = Object.freeze({
  THRESHOLD_BASELINE: 'threshold_baseline',
  STATISTICAL_ROLLING: 'statistical_rolling',
  ISOLATION_FOREST: 'isolation_forest',
  SUPERVISED_CLASSIFIER: 'supervised_classifier'
});

export const ANALYSIS_RUN_STATUS = Object.freeze({
  QUEUED: 'queued',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed'
});

export const ALERT_TASK_TYPES = Object.freeze({
  FAULT_CLASSIFICATION: 'fault_classification',
  ANOMALY_DETECTION: 'anomaly_detection'
});


