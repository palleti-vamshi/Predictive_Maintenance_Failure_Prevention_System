import mongoose from 'mongoose';
import {
  DATASET_TYPES,
  DATASET_STATUS,
  DATASET_MODALITY,
  AI_TASK_TYPES
} from '@predictive-maintenance/shared';

const columnMappingSchema = new mongoose.Schema(
  {
    rawHeader: { type: String, required: true },
    mappedSignal: { type: String, default: null },
    isTimestamp: { type: Boolean, default: false },
    isLabel: { type: Boolean, default: false },
    sourceUnit: { type: String, default: null },
    targetUnit: { type: String, default: null },
    dataType: { type: String, enum: ['numeric', 'string', 'datetime'], default: 'numeric' },
    stats: {
      missingCount: { type: Number, default: 0 },
      missingPct: { type: Number, default: 0 },
      min: { type: Number, default: null },
      max: { type: Number, default: null },
      mean: { type: Number, default: null },
      outOfBoundsCount: { type: Number, default: 0 }
    }
  },
  { _id: false }
);

const qualityFindingSchema = new mongoose.Schema(
  {
    severity: { type: String, enum: ['info', 'warning', 'error'], required: true },
    code: { type: String, required: true },
    message: { type: String, required: true },
    column: { type: String, default: null },
    affectedCount: { type: Number, default: 0 }
  },
  { _id: false }
);

const taskCompatibilitySchema = new mongoose.Schema(
  {
    isCompatible: { type: Boolean, required: true },
    reason: { type: String, required: true },
    recommendedModel: { type: String, required: true }
  },
  { _id: false }
);

const referenceDetailsSchema = new mongoose.Schema(
  {
    sourceName: { type: String, trim: true },
    sourceUrl: { type: String, trim: true },
    citation: { type: String, trim: true },
    license: { type: String, trim: true },
    usageTerms: { type: String, trim: true },
    machineType: { type: String, trim: true, default: 'gearbox' },
    sensorChannels: [{ type: String, trim: true }],
    units: [{ type: String, trim: true }],
    operatingConditions: { type: String, trim: true },
    labelDefinitions: { type: String, trim: true },
    knownLimitations: { type: String, trim: true },
    userConfirmedTerms: { type: Boolean, default: false }
  },
  { _id: false }
);

const datasetSchema = new mongoose.Schema(
  {
    factoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Factory',
      index: true
    },
    siteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Site',
      index: true
    },
    machineId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Machine',
      index: true
    },
    datasetType: {
      type: String,
      enum: Object.values(DATASET_TYPES),
      default: DATASET_TYPES.OPERATIONAL,
      required: true,
      index: true
    },
    title: {
      type: String,
      required: true,
      trim: true
    },
    description: {
      type: String,
      trim: true
    },
    status: {
      type: String,
      enum: Object.values(DATASET_STATUS),
      default: DATASET_STATUS.UPLOADED,
      index: true
    },
    uploadedById: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    uploadedByName: {
      type: String,
      required: true
    },
    // Storage reference (sanitized file on local storage, never exposes filesystem path)
    storageKey: {
      type: String,
      required: true
    },
    originalFilename: {
      type: String,
      required: true
    },
    mimeType: {
      type: String,
      default: 'text/csv'
    },
    fileSizeBytes: {
      type: Number,
      required: true
    },
    fileChecksumSha256: {
      type: String
    },
    delimiter: {
      type: String,
      default: ','
    },
    encoding: {
      type: String,
      default: 'utf-8'
    },
    dataSchemaVersion: {
      type: String,
      default: '1.0.0'
    },
    featurePipelineVersion: {
      type: String,
      default: '1.0.0'
    },
    modality: {
      type: String,
      enum: Object.values(DATASET_MODALITY),
      default: DATASET_MODALITY.UNLABELED_TELEMETRY,
      index: true
    },
    timeRange: {
      start: { type: Date },
      end: { type: Date },
      durationSeconds: { type: Number }
    },
    samplingRateHz: { type: Number },
    samplingIntervalMeanMs: { type: Number },
    totalRows: { type: Number, default: 0 },
    totalColumns: { type: Number, default: 0 },
    columns: [columnMappingSchema],
    previewRows: [{ type: mongoose.Schema.Types.Mixed }],
    qualityFindings: [qualityFindingSchema],
    labelDistribution: {
      type: Map,
      of: Number,
      default: {}
    },
    aiTaskCompatibility: {
      [AI_TASK_TYPES.ANOMALY_DETECTION]: taskCompatibilitySchema,
      [AI_TASK_TYPES.FAULT_CLASSIFICATION]: taskCompatibilitySchema,
      [AI_TASK_TYPES.REMAINING_USEFUL_LIFE]: taskCompatibilitySchema
    },
    isSimulatorDerived: {
      type: Boolean,
      default: false
    },
    isDemoData: {
      type: Boolean,
      default: false
    },
    referenceDetails: referenceDetailsSchema
  },
  { timestamps: true }
);

// Never expose internal storageKey to client JSON responses
datasetSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.storageKey;
  return obj;
};

export const Dataset = mongoose.model('Dataset', datasetSchema);

