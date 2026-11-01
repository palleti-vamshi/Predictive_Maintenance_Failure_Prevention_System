import mongoose from 'mongoose';
import {
  ALERT_SEVERITIES,
  ALERT_STATUSES,
  ALERT_TASK_TYPES
} from '@predictive-maintenance/shared';

const technicianObservationSchema = new mongoose.Schema(
  {
    technicianId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    technicianName: {
      type: String,
      required: true
    },
    note: {
      type: String,
      required: true,
      trim: true
    },
    loggedAt: {
      type: Date,
      default: Date.now
    }
  },
  { _id: true }
);

const alertSchema = new mongoose.Schema(
  {
    factoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Factory',
      required: true,
      index: true
    },
    siteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Site',
      default: null
    },
    machineId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Machine',
      required: true,
      index: true
    },
    datasetId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Dataset',
      required: true,
      index: true
    },
    analysisRunId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AnalysisRun',
      required: true,
      index: true
    },
    modelArtifactId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ModelArtifact',
      required: true,
      index: true
    },
    title: {
      type: String,
      required: true,
      trim: true
    },
    severity: {
      type: String,
      enum: Object.values(ALERT_SEVERITIES),
      default: ALERT_SEVERITIES.WARNING,
      index: true
    },
    severityMethod: {
      type: String,
      default: 'calibrated_threshold'
    },
    severityNote: {
      type: String,
      default: null
    },
    status: {
      type: String,
      enum: Object.values(ALERT_STATUSES),
      default: ALERT_STATUSES.OPEN,
      index: true
    },
    triggeringPath: {
      type: String,
      default: 'vibration_path'
    },
    fusionRule: {
      type: String,
      default: 'vibration_isolated'
    },
    fusionRationale: {
      type: String,
      default: null
    },
    operatingRegime: {
      regimeId: { type: String, default: 'UNKNOWN' },
      regimeLabel: { type: String, default: 'Unknown Operating Regime' },
      stability: { type: String, default: 'steady_state' },
      speedRpm: { type: Number, default: null },
      loadNm: { type: Number, default: null }
    },
    detectorBreakdown: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    },
    sensorCoverage: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    },
    pathLimitations: [
      {
        type: String
      }
    ],
    analysisTask: {
      type: String,
      enum: Object.values(ALERT_TASK_TYPES),
      required: true
    },
    modelDetails: {
      modelName: { type: String, required: true },
      modelType: { type: String, required: true },
      version: { type: String, default: '1.0.0' },
      pipelineVersion: { type: String, default: '1.0.0' },
      isVerifiedModel: { type: Boolean, default: true }
    },
    interval: {
      intervalIndex: { type: Number, default: 0 },
      startIdx: { type: Number, required: true },
      endIdx: { type: Number, required: true },
      startTime: { type: String, default: null },
      endTime: { type: String, default: null },
      sampleCount: { type: Number, default: 0 },
      predictedClass: { type: String, default: null }
    },
    scores: {
      peakScore: { type: Number, required: true },
      calibratedThreshold: { type: Number, required: true },
      isCalibrated: { type: Boolean, default: true },
      decisionValue: { type: Number, default: null },
      confidence: { type: Number, default: null }
    },
    contributingSignals: [
      {
        signal: String,
        peakValue: Number,
        baselineMean: Number,
        deviationRatio: Number,
        unit: String
      }
    ],
    contributingFeatures: [
      {
        feature: String,
        attribution: Number,
        importance: Number,
        interpretation: String,
        value: Number
      }
    ],
    shapAttribution: {
      explainerType: { type: String, default: null },
      modelOutput: { type: String, default: null },
      approximation: { type: String, default: null },
      additivityVerified: { type: Boolean, default: false },
      maxDiscrepancy: { type: Number, default: 0 },
      baselineExpectedValue: { type: Number, default: 0 },
      featureContributions: { type: mongoose.Schema.Types.Mixed, default: [] }
    },
    dataQuality: {
      sufficiencyScore: { type: Number, default: 1.0 },
      missingValuePct: { type: Number, default: 0.0 },
      steadyStateConfirmed: { type: Boolean, default: true }
    },
    limitations: [
      {
        type: String
      }
    ],
    trendExcerpt: {
      type: mongoose.Schema.Types.Mixed,
      default: []
    },
    technicianObservations: [technicianObservationSchema],
    maintenanceWorkOrderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MaintenanceWorkOrder',
      default: null,
      index: true
    },
    acknowledgedAt: {
      type: Date,
      default: null
    },
    acknowledgedById: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    acknowledgedByName: {
      type: String,
      default: null
    }
  },
  {
    timestamps: true
  }
);

alertSchema.index({ factoryId: 1, machineId: 1, status: 1, createdAt: -1 });

export const Alert = mongoose.model('Alert', alertSchema);

