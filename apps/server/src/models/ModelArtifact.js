import mongoose from 'mongoose';
import {
  MODEL_TYPES,
  MODEL_STATUS,
  FAULT_DOMAINS
} from '@predictive-maintenance/shared';

const modelArtifactSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    modelType: {
      type: String,
      enum: Object.values(MODEL_TYPES),
      required: true
    },
    version: {
      type: String,
      default: '1.0.0'
    },
    status: {
      type: String,
      enum: Object.values(MODEL_STATUS),
      default: MODEL_STATUS.PENDING
    },
    failureReason: {
      type: String,
      default: null
    },
    factoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Factory',
      required: true
    },
    siteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Site',
      default: null
    },
    machineId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Machine',
      default: null
    },
    datasetId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Dataset',
      required: true
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
    targetDomain: {
      type: String,
      enum: Object.values(FAULT_DOMAINS),
      default: FAULT_DOMAINS.GEAR_FAULTS
    },
    componentType: {
      type: String,
      default: 'gearbox'
    },
    parameters: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    featureNames: [
      {
        type: String
      }
    ],
    classMapping: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    metrics: {
      accuracy: { type: Number, default: null },
      macroF1: { type: Number, default: null },
      classes: [{ type: String }],
      perClassMetrics: { type: mongoose.Schema.Types.Mixed, default: {} },
      confusionMatrix: { type: mongoose.Schema.Types.Mixed, default: [] },
      rocAuc: { type: Number, default: null },
      falsePositiveRate: { type: Number, default: null },
      faultRecall: { type: Number, default: null },
      calibratedThreshold: { type: Number, default: null },
      trainSamples: { type: Number, default: null },
      testSamples: { type: Number, default: null },
      splitMethod: { type: String, default: null },
      notes: { type: String, default: null }
    },
    featureImportance: [
      {
        feature: { type: String },
        importance: { type: Number }
      }
    ],
    shapSummary: {
      explainerType: { type: String },
      additivityVerified: { type: Boolean, default: false },
      maxAdditivityDiscrepancy: { type: Number, default: null },
      baselineExpectedValue: { type: mongoose.Schema.Types.Mixed, default: null },
      topContributingFeatures: [
        {
          feature: { type: String },
          importance: { type: Number },
          attribution: { type: Number },
          value: { type: Number }
        }
      ],
      globalFeatureImportance: [
        {
          feature: { type: String },
          meanAbsShap: { type: Number }
        }
      ],
      sampleExplanations: [mongoose.Schema.Types.Mixed]
    },
    datasetSummary: {
      datasetTitle: { type: String },
      datasetType: { type: String },
      totalRawRows: { type: Number },
      mappedSignals: [{ type: String }],
      windowSize: { type: Number },
      overlapRatio: { type: Number },
      totalExtractedWindows: { type: Number },
      featureCount: { type: Number }
    },
    storageKey: {
      type: String,
      default: null
    }
  },
  {
    timestamps: true
  }
);

// Indexed queries
modelArtifactSchema.index({ factoryId: 1, modelType: 1, status: 1 });
modelArtifactSchema.index({ datasetId: 1 });
modelArtifactSchema.index({ machineId: 1 });

modelArtifactSchema.methods.toJSON = function () {
  const obj = this.toObject();
  obj.id = obj._id.toString();
  return obj;
};

export const ModelArtifact = mongoose.model('ModelArtifact', modelArtifactSchema);
