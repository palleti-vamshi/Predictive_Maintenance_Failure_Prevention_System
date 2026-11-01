import mongoose from 'mongoose';
import {
  ANALYSIS_RUN_STATUS,
  MODEL_TYPES,
  FAULT_DOMAINS
} from '@predictive-maintenance/shared';

const analysisRunSchema = new mongoose.Schema(
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
    modelArtifactId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ModelArtifact',
      required: true,
      index: true
    },
    datasetTitle: {
      type: String,
      required: true,
      trim: true
    },
    fileChecksumSha256: {
      type: String,
      default: null
    },
    modelName: {
      type: String,
      required: true,
      trim: true
    },
    modelType: {
      type: String,
      enum: Object.values(MODEL_TYPES),
      required: true
    },
    modelVersion: {
      type: String,
      default: '1.0.0'
    },
    featurePipelineVersion: {
      type: String,
      default: '1.0.0'
    },
    targetDomain: {
      type: String,
      enum: Object.values(FAULT_DOMAINS),
      default: FAULT_DOMAINS.GEAR_FAULTS
    },
    componentType: {
      type: String,
      default: 'gearbox'
    },
    mappedSignals: [
      {
        type: String
      }
    ],
    configuration: {
      windowSize: { type: Number, default: 256 },
      overlapRatio: { type: Number, default: 0.5 },
      samplingRateHz: { type: Number, default: null },
      shaftSpeedRpm: { type: Number, default: null },
      pinionTeeth: { type: Number, default: null },
      thresholdOverride: { type: Number, default: null }
    },
    status: {
      type: String,
      enum: Object.values(ANALYSIS_RUN_STATUS),
      default: ANALYSIS_RUN_STATUS.QUEUED,
      index: true
    },
    failureReason: {
      type: String,
      default: null
    },
    summary: {
      totalWindows: { type: Number, default: 0 },
      anomalousWindowsCount: { type: Number, default: 0 },
      intervalsCount: { type: Number, default: 0 },
      maxAnomalyScore: { type: Number, default: 0 },
      dataSufficiencyScore: { type: Number, default: 1.0 },
      missingValuePct: { type: Number, default: 0 },
      steadyStateConfirmed: { type: Boolean, default: true }
    },
    intervals: {
      type: mongoose.Schema.Types.Mixed,
      default: []
    },
    createdById: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    createdByName: {
      type: String,
      required: true
    },
    startedAt: {
      type: Date,
      default: null
    },
    completedAt: {
      type: Date,
      default: null
    },
    isImmutable: {
      type: Boolean,
      default: true
    }
  },
  {
    timestamps: true
  }
);

analysisRunSchema.index({ factoryId: 1, machineId: 1, createdAt: -1 });

export const AnalysisRun = mongoose.model('AnalysisRun', analysisRunSchema);
