import mongoose from 'mongoose';
import { DATASET_TYPES } from '@predictive-maintenance/shared';

/**
 * StagedUpload Schema
 * Persists staged dataset upload records across server restarts and multi-instance deployments.
 * Enforces tenant factory scoping and uploader ownership before dataset confirmation.
 * MongoDB TTL index automatically cleans up expired unconfirmed uploads.
 */
const stagedUploadSchema = new mongoose.Schema(
  {
    uploadId: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    storageKey: {
      type: String,
      default: null
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
      type: String,
      default: null
    },
    isChunked: {
      type: Boolean,
      default: false
    },
    totalChunks: {
      type: Number,
      default: 1
    },
    chunkSizeBytes: {
      type: Number,
      default: 5 * 1024 * 1024
    },
    receivedChunks: {
      type: [Number],
      default: []
    },
    datasetType: {
      type: String,
      enum: Object.values(DATASET_TYPES),
      default: DATASET_TYPES.OPERATIONAL
    },
    isSyntheticQA: {
      type: Boolean,
      default: false
    },
    machineId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Machine',
      default: null
    },
    title: {
      type: String,
      default: null
    },
    description: {
      type: String,
      default: null
    },
    referenceDetails: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    },
    isSimulatorDerived: {
      type: Boolean,
      default: false
    },
    isDemoData: {
      type: Boolean,
      default: false
    },
    uploaderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    factoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Factory',
      required: true,
      index: true
    },
    status: {
      type: String,
      enum: [
        'uploading',
        'staged',
        'assembling',
        'processing',
        'validated',
        'confirmed',
        'cancelled',
        'expired',
        'failed'
      ],
      default: 'staged',
      index: true
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 } // MongoDB native TTL index for automatic expiry cleanup
    }
  },
  {
    timestamps: true
  }
);

export const StagedUpload = mongoose.model('StagedUpload', stagedUploadSchema);

