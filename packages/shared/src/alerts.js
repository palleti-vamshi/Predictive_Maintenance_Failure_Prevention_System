/**
 * Alert severities, states, and analysis categories.
 */
export const ALERT_SEVERITIES = Object.freeze({
  CRITICAL: 'critical',
  WARNING: 'warning',
  INFO: 'info',
  HEALTHY: 'healthy'
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

export const DATASET_TYPES = Object.freeze({
  OPERATIONAL: 'operational',
  RESEARCH_BENCHMARK: 'research_benchmark',
  SIMULATED: 'simulated'
});

