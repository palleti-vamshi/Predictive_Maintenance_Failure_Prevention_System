import mongoose from 'mongoose';
import { DATASET_JOB_STATUS, DATASET_JOB_STAGES } from '@predictive-maintenance/shared';

const datasetJobSchema = new mongoose.Schema(
  {
    jobId: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    datasetId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Dataset',
      default: null,
      index: true
    },
    uploadId: {
      type: String,
      required: true,
      index: true
    },
    factoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Factory',
      required: true,
      index: true
    },
    createdById: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    jobType: {
      type: String,
      default: 'DATASET_INGESTION_AND_PROFILING'
    },
    status: {
      type: String,
      enum: Object.values(DATASET_JOB_STATUS),
      default: DATASET_JOB_STATUS.QUEUED,
      index: true
    },
    stage: {
      type: String,
      enum: Object.values(DATASET_JOB_STAGES),
      default: DATASET_JOB_STAGES.QUEUED
    },
    progress: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    },
    stageMessage: {
      type: String,
      default: 'Job queued for asynchronous dataset processing'
    },
    errorMessage: {
      type: String,
      default: null
    },
    cancellationRequested: {
      type: Boolean,
      default: false
    },
    metrics: {
      totalRows: { type: Number, default: 0 },
      totalColumns: { type: Number, default: 0 },
      processedBytes: { type: Number, default: 0 },
      totalBytes: { type: Number, default: 0 },
      durationMs: { type: Number, default: 0 },
      samplingRateHz: { type: Number, default: null }
    },
    startedAt: {
      type: Date,
      default: null
    },
    completedAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
);

export const DatasetJob = mongoose.model('DatasetJob', datasetJobSchema);

