import { Router } from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { Dataset } from '../models/Dataset.js';
import { Machine } from '../models/Machine.js';
import { ModelArtifact } from '../models/ModelArtifact.js';
import { AnalysisRun } from '../models/AnalysisRun.js';
import { Alert } from '../models/Alert.js';
import { StagedUpload } from '../models/StagedUpload.js';
import { DatasetJob } from '../models/DatasetJob.js';
import { User } from '../models/User.js';
import { startAnalysisRunJob } from '../services/mlJob.service.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireManager, requireTechnicianOrManager } from '../middleware/authorize.js';
import { uploadRateLimiter, chunkUploadRateLimiter } from '../middleware/rateLimiter.js';
import { env } from '../config/env.js';
import {
  saveUploadedFile,
  readStoredFile,
  getSafeFilePath,
  deleteStoredFile,
  getChunkPath,
  saveChunkBuffer,
  saveChunkStream,
  assembleChunks,
  cleanupUploadStaging
} from '../services/storage.service.js';
import { parseAndProfileCsv } from '../services/csv.service.js';
import { validateDatasetContent } from '../services/datasetValidator.service.js';
import { streamProfileCsv } from '../services/streamingCsvProfiler.service.js';
import { isArchiveFile } from '../services/archiveValidator.service.js';
import { createAndStartDatasetJob, cancelDatasetJob } from '../services/datasetJob.service.js';
import {
  DATASET_TYPES,
  DATASET_STATUS,
  MAX_UPLOAD_SIZE_BYTES,
  MAX_OPERATIONAL_UPLOAD_SIZE_BYTES,
  MAX_RESEARCH_UPLOAD_SIZE_BYTES,
  ACCEPTED_RESEARCH_EXTENSIONS,
  DATASET_JOB_STATUS,
  USER_ROLES,
  MODEL_TYPES,
  MODEL_STATUS,
  ANALYSIS_RUN_STATUS
} from '@predictive-maintenance/shared';

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Multer memory storage configuration with 25MB bounded limit
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_SIZE_BYTES,
    files: 1
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== '.csv' && ext !== '.txt') {
      const err = new Error('Invalid file type. Only CSV files (.csv, .txt) are supported.');
      err.status = 400;
      err.code = 'INVALID_FILE_TYPE';
      return cb(err);
    }
    cb(null, true);
  }
});

export const stagedUploads = new Map();
export const STAGING_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

// Short-lived single-use stream tickets for mobile and streaming clients
export const streamTickets = new Map(); // ticket -> { userId, factoryId, machineId, expiresAt }

// Factory and Machine scoped SSE subscribers and latest telemetry ticks
export const sseClientsByStreamKey = new Map(); // streamKey (${factoryId}:${machineId}) -> Set of res objects
export const latestTickByStreamKey = new Map(); // streamKey -> latest tick object

// Physical engineering telemetry ranges for powertrain digital twin validation
export const TELEMETRY_RANGES = {
  rpm: { min: 0, max: 15000, label: 'Engine Speed (RPM)' },
  inRpm: { min: 0, max: 15000, label: 'Input Shaft Speed (RPM)' },
  outRpm: { min: 0, max: 15000, label: 'Output Shaft Speed (RPM)' },
  torque: { min: -1000, max: 5000, label: 'Torque (Nm)' },
  powerKw: { min: -200, max: 3000, label: 'Power (kW)' },
  coolant: { min: -50, max: 300, label: 'Coolant Temperature (°C)' },
  egt: { min: -50, max: 1500, label: 'Exhaust Gas Temperature (°C)' },
  vibRms: { min: 0, max: 200, label: 'Vibration RMS (mm/s)' },
  simTime: { min: 0, max: 1e9, label: 'Simulation Time (s)' }
};

// Periodic cleanup of expired staging files from disk storage
setInterval(async () => {
  try {
    const expiredDocs = await StagedUpload.find({
      expiresAt: { $lt: new Date() }
    }).limit(50);
    for (const doc of expiredDocs) {
      await deleteStoredFile(doc.storageKey).catch(() => {});
      await StagedUpload.deleteOne({ _id: doc._id }).catch(() => {});
    }
  } catch {
    // Non-blocking cleanup
  }
}, 15 * 60 * 1000).unref();

// Wrapper to handle Multer upload errors gracefully
function handleMulterUpload(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          error: 'FileTooLarge',
          message: `File exceeds maximum permitted upload limit of ${MAX_UPLOAD_SIZE_BYTES / (1024 * 1024)} MB.`
        });
      }
      return res.status(err.status || 400).json({
        error: err.code || 'UploadError',
        message: err.message
      });
    }
    next();
  });
}

/**
 * Stream auth middleware:
 * Supports short-lived single-use ticket in ?ticket=... or falls back to cookie/Bearer auth.
 * Burns ticket immediately upon presentation. Rejects ?token= query strings.
 */
async function authenticateStreamConnection(req, res, next) {
  const ticket = req.query.ticket;
  if (ticket) {
    if (typeof ticket !== 'string' || !streamTickets.has(ticket)) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid or expired single-use stream ticket.'
      });
    }

    const ticketData = streamTickets.get(ticket);
    streamTickets.delete(ticket); // Burn ticket immediately on first presentation

    if (Date.now() > ticketData.expiresAt) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Stream ticket has expired.'
      });
    }

    const user = await User.findById(ticketData.userId).populate('assignedMachines');
    if (!user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'User associated with ticket not found.'
      });
    }

    req.user = user;
    req.streamTicket = ticketData;
    return next();
  }

  // Standard cookie or Bearer token auth (note: authenticate middleware rejects req.query.token)
  return authenticate(req, res, next);
}

// Simulator SSE live stream endpoint with ticket support (mounted before generic authenticate)
router.get('/simulator-stream', authenticateStreamConnection, async (req, res) => {
  try {
    const userFactoryId = (req.user?.factoryId?._id || req.user?.factoryId || '').toString();
    const requestedMachineId = req.streamTicket?.machineId || req.query.machineId;

    let targetMachine = null;
    if (requestedMachineId) {
      if (!mongoose.Types.ObjectId.isValid(requestedMachineId)) {
        return res.status(400).json({
          error: 'BadRequest',
          message: 'Invalid machineId format.'
        });
      }
      targetMachine = await Machine.findById(requestedMachineId);
      if (!targetMachine || targetMachine.factoryId.toString() !== userFactoryId) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Target machine not found within your factory scope.'
        });
      }
    } else {
      // Default to first assigned or factory machine if not explicitly specified
      if (req.user.role === USER_ROLES.TECHNICIAN) {
        const assigned = req.user.assignedMachines || [];
        const firstId = assigned[0]?._id || assigned[0];
        if (firstId) {
          targetMachine = await Machine.findById(firstId);
        }
      }
      if (!targetMachine) {
        targetMachine = await Machine.findOne({ factoryId: userFactoryId });
      }
      if (!targetMachine) {
        return res.status(404).json({
          error: 'NotFound',
          message: 'No registered machines found in your factory scope.'
        });
      }
    }

    // Role check for technician: must be assigned to target machine
    if (req.user.role === USER_ROLES.TECHNICIAN) {
      const assignedIds = (req.user.assignedMachines || []).map((m) => (m._id || m).toString());
      if (!assignedIds.includes(targetMachine._id.toString())) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'You are not assigned to monitor telemetry for this machine.'
        });
      }
    }

    const streamKey = `${userFactoryId}:${targetMachine._id.toString()}`;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    res.write(`data: ${JSON.stringify({
      type: 'CONNECTED',
      message: 'Connected to MechGuard Simulator SSE Telemetry Feed',
      factoryId: userFactoryId,
      machineId: targetMachine._id.toString(),
      machineCode: targetMachine.code,
      timestamp: new Date().toISOString(),
      isSimulated: true
    })}\n\n`);

    const latestTick = latestTickByStreamKey.get(streamKey);
    if (latestTick) {
      res.write(`data: ${JSON.stringify({ type: 'TELEMETRY_TICK', ...latestTick })}\n\n`);
    }

    if (!sseClientsByStreamKey.has(streamKey)) {
      sseClientsByStreamKey.set(streamKey, new Set());
    }
    const clientSet = sseClientsByStreamKey.get(streamKey);
    clientSet.add(res);

    req.on('close', () => {
      clientSet.delete(res);
      if (clientSet.size === 0) {
        sseClientsByStreamKey.delete(streamKey);
      }
    });
  } catch (err) {
    console.error('[SimulatorStream] Error:', err);
    if (!res.headersSent) {
      return res.status(500).json({
        error: 'ServerError',
        message: 'Failed to establish simulator telemetry stream.'
      });
    }
  }
});

// All other dataset endpoints require standard session authentication
router.use(authenticate);

// Validate id parameter format across all routes
router.param('id', (req, res, next, id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({
      error: 'BadRequest',
      message: 'Invalid dataset ID format.'
    });
  }
  next();
});

// Chunk upload multer memory buffer (scoped only to a single 5MB chunk)
const chunkUploadMulter = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }
});

/**
 * GET /api/datasets/storage/quota
 * Retrieves factory research storage usage, total limits, and remaining quota.
 */
router.get('/storage/quota', requireTechnicianOrManager, async (req, res) => {
  try {
    const userFactoryId = (req.user?.factoryId?._id || req.user?.factoryId || '').toString();
    let currentUsedBytes = 0;
    if (userFactoryId && mongoose.Types.ObjectId.isValid(userFactoryId)) {
      const usage = await Dataset.aggregate([
        { $match: { factoryId: new mongoose.Types.ObjectId(userFactoryId) } },
        { $group: { _id: null, totalBytes: { $sum: '$fileSizeBytes' } } }
      ]);
      currentUsedBytes = usage[0]?.totalBytes || 0;
    }

    return res.status(200).json({
      maxResearchUploadSizeBytes: env.MAX_RESEARCH_UPLOAD_SIZE_BYTES,
      maxOperationalUploadSizeBytes: env.MAX_OPERATIONAL_UPLOAD_SIZE_BYTES,
      factoryQuotaBytes: env.FACTORY_RESEARCH_STORAGE_QUOTA_BYTES,
      currentUsedBytes,
      remainingQuotaBytes: Math.max(0, env.FACTORY_RESEARCH_STORAGE_QUOTA_BYTES - currentUsedBytes)
    });
  } catch (err) {
    return res.status(500).json({ error: 'InternalError', message: err.message });
  }
});

/**
 * POST /api/datasets/uploads/initiate
 * Initiates a resumable chunked upload session for large research or operational files.
 */
router.post('/uploads/initiate', requireTechnicianOrManager, uploadRateLimiter, async (req, res) => {
  try {
    const {
      originalFilename,
      fileSizeBytes,
      fileChecksumSha256 = null,
      mimeType = 'text/csv',
      totalChunks = 1,
      chunkSizeBytes = env.DEFAULT_CHUNK_SIZE_BYTES,
      datasetType = DATASET_TYPES.OPERATIONAL,
      machineId = null,
      title = null,
      description = '',
      referenceDetails = null,
      isSimulatorDerived = false,
      isSyntheticQA = false,
      isDemoData = false
    } = req.body;

    if (!originalFilename || !fileSizeBytes || fileSizeBytes <= 0) {
      return res.status(400).json({
        error: 'BadRequest',
        message: 'originalFilename and a positive fileSizeBytes are required.'
      });
    }

    const isSynthetic = Boolean(
      isSyntheticQA ||
      datasetType === DATASET_TYPES.SYNTHETIC_QA ||
      originalFilename.toLowerCase().includes('smoke_test') ||
      originalFilename.toLowerCase().includes('synthetic')
    );

    const userFactoryId = (req.user?.factoryId?._id || req.user?.factoryId || '').toString();

    // 1. Validate File Extension
    const allowedExts = datasetType === DATASET_TYPES.REFERENCE
      ? ACCEPTED_RESEARCH_EXTENSIONS
      : ['.csv', '.txt'];

    const hasAllowedExt = allowedExts.some((ext) => originalFilename.toLowerCase().endsWith(ext));
    if (!hasAllowedExt) {
      return res.status(400).json({
        error: 'INVALID_FILE_TYPE',
        message: `Disallowed file format. Allowed extensions for ${datasetType} datasets: ${allowedExts.join(', ')}.`
      });
    }

    // 2. Enforce Size Limit
    const maxSize = datasetType === DATASET_TYPES.REFERENCE
      ? env.MAX_RESEARCH_UPLOAD_SIZE_BYTES
      : env.MAX_OPERATIONAL_UPLOAD_SIZE_BYTES;

    if (fileSizeBytes > maxSize) {
      const maxMb = Math.round(maxSize / (1024 * 1024));
      return res.status(413).json({
        error: 'FILE_TOO_LARGE',
        message: `File size exceeds the ${maxMb} MB limit configured for ${datasetType} uploads.`
      });
    }

    // 3. Role & Machine Scope Enforcement
    if (datasetType === DATASET_TYPES.REFERENCE) {
      if (req.user.role !== USER_ROLES.FACTORY_MANAGER) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Only Factory Managers can initiate research or benchmark dataset uploads.'
        });
      }
    } else {
      if (!machineId) {
        return res.status(400).json({
          error: 'MissingMachineId',
          message: 'Operational datasets require a target machineId.'
        });
      }

      const machine = await Machine.findById(machineId);
      if (!machine || machine.factoryId.toString() !== userFactoryId) {
        return res.status(404).json({
          error: 'NotFound',
          message: 'Target machine not found within your factory scope.'
        });
      }

      if (req.user.role === USER_ROLES.TECHNICIAN) {
        const assigned = (req.user.assignedMachines || []).map((m) => (m._id || m).toString());
        if (!assigned.includes(machine._id.toString())) {
          return res.status(403).json({
            error: 'Forbidden',
            message: 'You are not authorized to upload operational telemetry for this machine.'
          });
        }
      }
    }

    // 4. Enforce Factory Storage Quota for research datasets
    if (datasetType === DATASET_TYPES.REFERENCE && userFactoryId && mongoose.Types.ObjectId.isValid(userFactoryId)) {
      const usage = await Dataset.aggregate([
        { $match: { factoryId: new mongoose.Types.ObjectId(userFactoryId) } },
        { $group: { _id: null, totalBytes: { $sum: '$fileSizeBytes' } } }
      ]);
      const currentUsed = usage[0]?.totalBytes || 0;
      if (currentUsed + fileSizeBytes > env.FACTORY_RESEARCH_STORAGE_QUOTA_BYTES) {
        const quotaGb = (env.FACTORY_RESEARCH_STORAGE_QUOTA_BYTES / (1024 * 1024 * 1024)).toFixed(1);
        const usedGb = (currentUsed / (1024 * 1024 * 1024)).toFixed(2);
        return res.status(403).json({
          error: 'QuotaExceeded',
          message: `Factory research storage quota exceeded (limit: ${quotaGb} GB, currently used: ${usedGb} GB).`
        });
      }
    }

    // 5. Create Staged Upload Session
    const uploadId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + STAGING_TTL_MS);

    await StagedUpload.create({
      uploadId,
      storageKey: null,
      originalFilename,
      mimeType,
      fileSizeBytes,
      fileChecksumSha256,
      isChunked: true,
      totalChunks: Math.max(1, parseInt(totalChunks, 10)),
      chunkSizeBytes: parseInt(chunkSizeBytes, 10),
      receivedChunks: [],
      datasetType: isSynthetic ? DATASET_TYPES.SYNTHETIC_QA : datasetType,
      machineId: machineId || null,
      title: title || path.basename(originalFilename).replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' '),
      description,
      referenceDetails,
      isSimulatorDerived: Boolean(isSimulatorDerived || datasetType === DATASET_TYPES.SIMULATOR),
      isSyntheticQA: isSynthetic,
      isDemoData: Boolean(isDemoData || isSynthetic || isSimulatorDerived || datasetType === DATASET_TYPES.SIMULATOR),
      uploaderId: req.user._id,
      factoryId: userFactoryId,
      expiresAt,
      status: 'uploading'
    });

    return res.status(201).json({
      success: true,
      uploadId,
      chunkSizeBytes: parseInt(chunkSizeBytes, 10),
      totalChunks: Math.max(1, parseInt(totalChunks, 10)),
      receivedChunks: [],
      maxUploadSizeBytes: maxSize
    });
  } catch (err) {
    console.error('[UploadInitiate] Error:', err);
    return res.status(err.status || 500).json({
      error: err.code || 'InitiateFailed',
      message: err.message || 'Failed to initiate upload session.'
    });
  }
});

/**
 * POST /api/datasets/uploads/:uploadId/chunk
 * Streams a single chunk to disk, verifying chunk bounds and idempotency.
 */
router.post(
  '/uploads/:uploadId/chunk',
  requireTechnicianOrManager,
  chunkUploadRateLimiter,
  (req, res, next) => {
    if (req.is('multipart/form-data')) {
      chunkUploadMulter.single('chunk')(req, res, next);
    } else {
      next();
    }
  },
  async (req, res) => {
    try {
      const { uploadId } = req.params;
      const rawIndex = req.headers['x-chunk-index'] || req.query.chunkIndex || req.body?.chunkIndex;
      const chunkIndex = parseInt(rawIndex, 10);
      const rawChunkSize = req.headers['x-chunk-size'] || req.query.chunkSize || req.body?.chunkSize;
      const expectedChunkSize = rawChunkSize ? parseInt(rawChunkSize, 10) : undefined;

      if (isNaN(chunkIndex) || chunkIndex < 0) {
        return res.status(400).json({
          error: 'InvalidChunkIndex',
          message: 'A valid non-negative chunkIndex is required.'
        });
      }

      const staged = await StagedUpload.findOne({ uploadId });
      if (!staged || staged.status === 'cancelled') {
        return res.status(404).json({
          error: 'UploadNotFound',
          message: 'Upload session not found or has been cancelled.'
        });
      }

      const userFactoryId = (req.user?.factoryId?._id || req.user?.factoryId || '').toString();
      if (staged.factoryId.toString() !== userFactoryId) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Access denied to this upload session.'
        });
      }

      if (chunkIndex >= staged.totalChunks) {
        return res.status(400).json({
          error: 'ChunkOutOfRange',
          message: `chunkIndex ${chunkIndex} exceeds declared totalChunks ${staged.totalChunks}.`
        });
      }

      // Idempotency: Duplicate chunks return success without re-writing or failing
      if (staged.receivedChunks.includes(chunkIndex) && fs.existsSync(getChunkPath(uploadId, chunkIndex))) {
        return res.status(200).json({
          success: true,
          chunkIndex,
          receivedChunksCount: staged.receivedChunks.length,
          totalChunks: staged.totalChunks,
          isComplete: staged.receivedChunks.length >= staged.totalChunks,
          isDuplicate: true
        });
      }

      // Stream / save chunk to disk
      if (req.file?.buffer) {
        await saveChunkBuffer({
          uploadId,
          chunkIndex,
          buffer: req.file.buffer,
          expectedChunkSize
        });
      } else {
        await saveChunkStream({
          uploadId,
          chunkIndex,
          readableStream: req,
          expectedChunkSize
        });
      }

      const updated = await StagedUpload.findOneAndUpdate(
        { uploadId },
        { $addToSet: { receivedChunks: chunkIndex } },
        { new: true }
      );

      const isComplete = updated.receivedChunks.length >= updated.totalChunks;

      return res.status(200).json({
        success: true,
        chunkIndex,
        receivedChunksCount: updated.receivedChunks.length,
        totalChunks: updated.totalChunks,
        isComplete
      });
    } catch (err) {
      console.error('[UploadChunk] Error:', err);
      return res.status(err.status || 500).json({
        error: err.code || 'ChunkUploadFailed',
        message: err.message || 'Failed to process chunk.'
      });
    }
  }
);

/**
 * GET /api/datasets/uploads/:uploadId/status
 * Queries current upload progress and missing chunks for resumability.
 */
router.get('/uploads/:uploadId/status', requireTechnicianOrManager, async (req, res) => {
  try {
    const { uploadId } = req.params;
    const staged = await StagedUpload.findOne({ uploadId });
    if (!staged) {
      return res.status(404).json({ error: 'NotFound', message: 'Upload session not found.' });
    }

    const userFactoryId = (req.user?.factoryId?._id || req.user?.factoryId || '').toString();
    if (staged.factoryId.toString() !== userFactoryId) {
      return res.status(403).json({ error: 'Forbidden', message: 'Access denied.' });
    }

    const missingChunks = [];
    for (let i = 0; i < staged.totalChunks; i++) {
      if (!staged.receivedChunks.includes(i)) {
        missingChunks.push(i);
      }
    }

    return res.status(200).json({
      uploadId: staged.uploadId,
      status: staged.status,
      originalFilename: staged.originalFilename,
      fileSizeBytes: staged.fileSizeBytes,
      totalChunks: staged.totalChunks,
      receivedChunks: staged.receivedChunks,
      receivedCount: staged.receivedChunks.length,
      missingChunks,
      isComplete: staged.receivedChunks.length >= staged.totalChunks,
      expiresAt: staged.expiresAt
    });
  } catch (err) {
    return res.status(500).json({ error: 'InternalError', message: err.message });
  }
});

/**
 * POST /api/datasets/uploads/:uploadId/cancel
 * Cancels active upload session and cleans up partial disk staging.
 */
router.post('/uploads/:uploadId/cancel', requireTechnicianOrManager, async (req, res) => {
  try {
    const { uploadId } = req.params;
    const staged = await StagedUpload.findOne({ uploadId });
    if (!staged) {
      return res.status(404).json({ error: 'NotFound', message: 'Upload session not found.' });
    }

    const userFactoryId = (req.user?.factoryId?._id || req.user?.factoryId || '').toString();
    if (staged.factoryId.toString() !== userFactoryId) {
      return res.status(403).json({ error: 'Forbidden', message: 'Access denied to this upload session.' });
    }

    await cleanupUploadStaging(uploadId);
    staged.status = 'cancelled';
    await staged.save();

    return res.status(200).json({
      success: true,
      message: 'Upload session cancelled and temporary partial files removed.'
    });
  } catch (err) {
    return res.status(500).json({ error: 'CancelFailed', message: err.message });
  }
});

/**
 * POST /api/datasets/uploads/:uploadId/complete
 * Assembles all chunks with cryptographic integrity verification, creates Dataset, and starts asynchronous background job.
 */
router.post('/uploads/:uploadId/complete', requireTechnicianOrManager, async (req, res) => {
  try {
    const { uploadId } = req.params;
    const { columnMappings = [] } = req.body;

    const staged = await StagedUpload.findOne({ uploadId });
    if (!staged) {
      return res.status(404).json({ error: 'NotFound', message: 'Upload session not found.' });
    }

    const userFactoryId = (req.user?.factoryId?._id || req.user?.factoryId || '').toString();
    if (staged.factoryId.toString() !== userFactoryId) {
      return res.status(403).json({ error: 'Forbidden', message: 'Access denied to this upload session.' });
    }

    if (staged.receivedChunks.length < staged.totalChunks) {
      return res.status(400).json({
        error: 'IncompleteUpload',
        message: `Cannot complete upload: received ${staged.receivedChunks.length} of ${staged.totalChunks} chunks.`
      });
    }

    staged.status = 'assembling';
    await staged.save();

    // Streaming assembly and strict checksum verification
    const assembled = await assembleChunks({
      uploadId,
      totalChunks: staged.totalChunks,
      expectedSha256: staged.fileChecksumSha256,
      expectedSizeBytes: staged.fileSizeBytes,
      originalFilename: staged.originalFilename,
      mimeType: staged.mimeType
    });

    staged.storageKey = assembled.storageKey;
    staged.status = 'confirmed';
    await staged.save();

    // Create Dataset record with status 'validating'
    const dataset = await Dataset.create({
      factoryId: staged.factoryId,
      machineId: staged.machineId,
      datasetType: staged.datasetType,
      title: staged.title || staged.originalFilename,
      description: staged.description || '',
      status: DATASET_STATUS.VALIDATING,
      uploadedById: staged.uploaderId,
      uploadedByName: req.user.fullName,
      storageKey: assembled.storageKey,
      originalFilename: assembled.originalFilename,
      mimeType: assembled.mimeType,
      fileSizeBytes: assembled.fileSizeBytes,
      fileChecksumSha256: assembled.fileChecksumSha256,
      referenceDetails: staged.referenceDetails,
      isSimulatorDerived: staged.isSimulatorDerived,
      isSyntheticQA: staged.isSyntheticQA,
      isDemoData: staged.isDemoData,
      columns: columnMappings
    });

    // Start background processing job
    const job = await createAndStartDatasetJob({
      datasetId: dataset._id,
      uploadId: staged.uploadId,
      factoryId: staged.factoryId,
      userId: req.user._id
    });

    return res.status(200).json({
      success: true,
      uploadId,
      datasetId: dataset._id,
      jobId: job.jobId,
      fileSizeBytes: assembled.fileSizeBytes,
      fileChecksumSha256: assembled.fileChecksumSha256,
      status: 'processing'
    });
  } catch (err) {
    console.error('[UploadComplete] Error:', err);
    return res.status(err.status || 500).json({
      error: err.code || 'AssemblyFailed',
      message: err.message || 'Failed to assemble and verify dataset.'
    });
  }
});

/**
 * GET /api/datasets/jobs/:jobId
 * Returns real-time status, progress %, stage, and statistics of a background dataset processing job.
 */
router.get('/jobs/:jobId', requireTechnicianOrManager, async (req, res) => {
  try {
    const { jobId } = req.params;
    const job = await DatasetJob.findOne({ jobId });
    if (!job) {
      return res.status(404).json({ error: 'NotFound', message: 'Dataset processing job not found.' });
    }

    const userFactoryId = (req.user?.factoryId?._id || req.user?.factoryId || '').toString();
    if (job.factoryId.toString() !== userFactoryId) {
      return res.status(403).json({ error: 'Forbidden', message: 'Access denied.' });
    }

    return res.status(200).json({
      jobId: job.jobId,
      datasetId: job.datasetId,
      status: job.status,
      stage: job.stage,
      progress: job.progress,
      stageMessage: job.stageMessage,
      errorMessage: job.errorMessage,
      metrics: job.metrics,
      startedAt: job.startedAt,
      completedAt: job.completedAt
    });
  } catch (err) {
    return res.status(500).json({ error: 'InternalError', message: err.message });
  }
});

/**
 * POST /api/datasets/jobs/:jobId/cancel
 * Cancels a running background processing job.
 */
router.post('/jobs/:jobId/cancel', requireTechnicianOrManager, async (req, res) => {
  try {
    const { jobId } = req.params;
    const userFactoryId = (req.user?.factoryId?._id || req.user?.factoryId || '').toString();
    const existingJob = await DatasetJob.findOne({ jobId });
    if (!existingJob) {
      return res.status(404).json({ error: 'NotFound', message: 'Dataset processing job not found.' });
    }
    if (existingJob.factoryId.toString() !== userFactoryId) {
      return res.status(403).json({ error: 'Forbidden', message: 'Access denied to this dataset job.' });
    }

    const job = await cancelDatasetJob(jobId);
    return res.status(200).json({
      success: true,
      status: job.status,
      message: 'Dataset processing job cancelled.'
    });
  } catch (err) {
    return res.status(err.status || 500).json({
      error: err.code || 'CancelFailed',
      message: err.message || 'Failed to cancel dataset job.'
    });
  }
});

/**
 * POST /api/datasets/upload
 * Stage 1: Uploads file, saves it securely to storage, and generates preview & candidate signal mappings.
 */
router.post('/upload', requireTechnicianOrManager, uploadRateLimiter, handleMulterUpload, async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({
        error: 'MissingFile',
        message: 'No file was provided in the upload request.'
      });
    }

    // 1. Save file to safe storage
    const fileInfo = await saveUploadedFile({
      buffer: req.file.buffer,
      originalFilename: req.file.originalname,
      mimeType: req.file.mimetype
    });

    // Track staged upload ownership and expiration within user's factory in MongoDB and memory
    const userFactoryId = (req.user?.factoryId?._id || req.user?.factoryId || '').toString();
    const expiresAtDate = new Date(Date.now() + STAGING_TTL_MS);

    await StagedUpload.create({
      uploadId: fileInfo.storageKey,
      storageKey: fileInfo.storageKey,
      originalFilename: fileInfo.originalFilename,
      mimeType: req.file.mimetype || 'text/csv',
      fileSizeBytes: fileInfo.fileSizeBytes,
      fileChecksumSha256: fileInfo.fileChecksumSha256,
      uploaderId: req.user._id,
      factoryId: userFactoryId,
      expiresAt: expiresAtDate,
      status: 'staged'
    });

    stagedUploads.set(fileInfo.storageKey, {
      uploadId: fileInfo.storageKey,
      uploaderId: req.user?._id?.toString(),
      factoryId: userFactoryId,
      originalFilename: fileInfo.originalFilename,
      createdAt: Date.now(),
      expiresAt: expiresAtDate.getTime()
    });

    // 2. Parse and profile CSV
    const contentString = req.file.buffer.toString('utf-8');
    const profile = parseAndProfileCsv(contentString);

    return res.status(200).json({
      success: true,
      uploadId: fileInfo.storageKey,
      originalFilename: fileInfo.originalFilename,
      fileSizeBytes: fileInfo.fileSizeBytes,
      fileChecksumSha256: fileInfo.fileChecksumSha256,
      delimiter: profile.delimiter,
      headers: profile.headers,
      totalRows: profile.totalRows,
      totalColumns: profile.totalColumns,
      candidateMappings: profile.candidateMappings,
      isSimulatorSignature: Boolean(profile.isSimulatorSignature),
      previewRows: profile.previewRows
    });
  } catch (err) {
    console.error('[DatasetUpload] Error:', err);
    return res.status(err.status || 500).json({
      error: err.code || 'UploadFailed',
      message: err.message || 'Failed to process uploaded dataset file.',
      details: err.details || null
    });
  }
});

/**
 * POST /api/datasets/validate
 * Stage 2: Validates mapped columns, runs data quality checks, and assesses AI task compatibility.
 */
router.post('/validate', requireTechnicianOrManager, async (req, res) => {
  try {
    const { uploadId, columnMappings } = req.body;

    if (!uploadId) {
      return res.status(400).json({
        error: 'MissingUploadId',
        message: 'uploadId is required to validate uploaded dataset.'
      });
    }

    if (!Array.isArray(columnMappings) || columnMappings.length === 0) {
      return res.status(400).json({
        error: 'MissingColumnMappings',
        message: 'columnMappings array is required.'
      });
    }

    // Verify staging ownership and expiration in MongoDB with in-memory sync (fail closed)
    const userFactoryId = (req.user?.factoryId?._id || req.user?.factoryId || '').toString();
    const memStaged = stagedUploads.get(uploadId);
    const stagedDoc = await StagedUpload.findOne({ uploadId, status: { $ne: 'confirmed' } });

    if (!stagedDoc && !memStaged) {
      return res.status(404).json({
        error: 'NotFound',
        message: 'Staged upload record not found or already consumed. Please re-upload the file.'
      });
    }

    const staged = stagedDoc || memStaged;
    const expiresAtTime = memStaged?.expiresAt ? new Date(memStaged.expiresAt).getTime() : new Date(staged.expiresAt).getTime();

    if (Date.now() > expiresAtTime) {
      return res.status(410).json({
        error: 'ExpiredUpload',
        message: 'Staged dataset upload has expired. Please re-upload the file.'
      });
    }

    const stagedFactoryId = (staged.factoryId?._id || staged.factoryId || '').toString();
    if (stagedFactoryId && stagedFactoryId !== userFactoryId) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Access denied: Staged upload belongs to another factory scope.'
      });
    }

    const stagedUploaderId = (staged.uploaderId?._id || staged.uploaderId || '').toString();
    if (req.user.role === USER_ROLES.TECHNICIAN && stagedUploaderId && stagedUploaderId !== req.user._id.toString()) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Access denied: Only the original uploader or a factory manager can validate this staged upload.'
      });
    }

    // Read stored file
    const buffer = await readStoredFile(uploadId);
    const contentString = buffer.toString('utf-8');
    const profile = parseAndProfileCsv(contentString);

    // Run deep quality and compatibility validation
    const validation = validateDatasetContent(profile.allRows, columnMappings);

    return res.status(200).json({
      success: true,
      validation: {
        status: validation.status,
        modality: validation.modality,
        timeRange: validation.timeRange,
        samplingRateHz: validation.samplingRateHz,
        samplingIntervalMeanMs: validation.samplingIntervalMeanMs,
        columns: validation.columns,
        qualityFindings: validation.qualityFindings,
        labelDistribution: validation.labelDistribution,
        aiTaskCompatibility: validation.aiTaskCompatibility
      }
    });
  } catch (err) {
    console.error('[DatasetValidate] Error:', err);
    return res.status(err.status || 500).json({
      error: err.code || 'ValidationFailed',
      message: err.message || 'Failed to validate dataset.'
    });
  }
});

/**
 * POST /api/datasets/confirm
 * Stage 3: Confirms ingestion, validates permissions, and persists Dataset in MongoDB.
 */
router.post('/confirm', requireTechnicianOrManager, async (req, res) => {
  try {
    const {
      uploadId,
      datasetType = DATASET_TYPES.OPERATIONAL,
      title,
      description,
      machineId,
      columnMappings,
      referenceDetails
    } = req.body;

    if (!uploadId || !title) {
      return res.status(400).json({
        error: 'BadRequest',
        message: 'uploadId and title are required.'
      });
    }

    const userFactoryId = req.user.factoryId?._id?.toString() || req.user.factoryId?.toString();
    let targetMachine = null;

    // Verify staging ownership and expiration in MongoDB with in-memory sync (fail closed)
    const memStaged = stagedUploads.get(uploadId);
    const stagedDoc = await StagedUpload.findOne({ uploadId });

    if (!stagedDoc && !memStaged) {
      return res.status(404).json({
        error: 'NotFound',
        message: 'Staged upload record not found. Please re-upload the file.'
      });
    }

    const staged = stagedDoc || memStaged;
    const expiresAtTime = memStaged?.expiresAt ? new Date(memStaged.expiresAt).getTime() : new Date(staged.expiresAt).getTime();

    if (Date.now() > expiresAtTime) {
      return res.status(410).json({
        error: 'ExpiredUpload',
        message: 'Staged dataset upload has expired. Please re-upload the file.'
      });
    }

    const stagedFactoryId = (staged.factoryId?._id || staged.factoryId || '').toString();
    if (stagedFactoryId && stagedFactoryId !== userFactoryId) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Access denied: Staged upload belongs to another factory scope.'
      });
    }

    const stagedUploaderId = (staged.uploaderId?._id || staged.uploaderId || '').toString();
    if (req.user.role === USER_ROLES.TECHNICIAN && stagedUploaderId && stagedUploaderId !== req.user._id.toString()) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Access denied: Only the original uploader or a factory manager can confirm this staged upload.'
      });
    }

    // 1. Role and Factory Scoping Verification
    if (datasetType === DATASET_TYPES.OPERATIONAL) {
      if (!machineId) {
        return res.status(400).json({
          error: 'MissingMachineId',
          message: 'Operational datasets require a target machineId.'
        });
      }

      // Verify machine exists and belongs to user's factory
      targetMachine = await Machine.findById(machineId);
      if (!targetMachine || targetMachine.factoryId.toString() !== userFactoryId) {
        return res.status(404).json({
          error: 'NotFound',
          message: 'Target machine not found within your factory scope.'
        });
      }

      // If user is technician, verify machine assignment
      if (req.user.role === USER_ROLES.TECHNICIAN) {
        const assignedIds = (req.user.assignedMachines || []).map((m) =>
          (m._id || m).toString()
        );
        if (!assignedIds.includes(targetMachine._id.toString())) {
          return res.status(403).json({
            error: 'Forbidden',
            message: 'You are not authorized to upload operational data for this machine.'
          });
        }
      }
    } else if (datasetType === DATASET_TYPES.REFERENCE) {
      // Registering reference benchmark datasets requires Factory Manager
      if (req.user.role !== USER_ROLES.FACTORY_MANAGER) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Only Factory Managers can register public or reference datasets in the catalog.'
        });
      }

      if (!referenceDetails || !referenceDetails.userConfirmedTerms) {
        return res.status(400).json({
          error: 'TermsNotConfirmed',
          message: 'You must confirm source attribution and license usage terms for reference datasets.'
        });
      }
    }

    // 2. Prevent replay/double-confirmation of already ingested upload
    if (staged?.status === 'confirmed') {
      return res.status(409).json({
        error: 'AlreadyConfirmed',
        message: 'This staged upload has already been confirmed and ingested into a dataset.'
      });
    }

    // 3. Read stored file and perform final validation
    const filePath = getSafeFilePath(uploadId);
    const fileStats = await fs.promises.stat(filePath);
    let profile;
    let validation;

    if (fileStats.size > 5 * 1024 * 1024) {
      const streamRes = await streamProfileCsv(filePath, {
        fileSizeBytes: fileStats.size,
        columnMappings: columnMappings || []
      });
      profile = streamRes;
      validation = streamRes;
    } else {
      const buffer = await readStoredFile(uploadId);
      const contentString = buffer.toString('utf-8');
      profile = parseAndProfileCsv(contentString);
      validation = validateDatasetContent(profile.allRows, columnMappings || []);
    }

    // 4. Create Dataset Document
    const dataset = await Dataset.create({
      factoryId: targetMachine ? targetMachine.factoryId : req.user.factoryId,
      siteId: targetMachine ? targetMachine.siteId : null,
      machineId: targetMachine ? targetMachine._id : null,
      datasetType,
      title: title.trim(),
      description: description ? description.trim() : '',
      status: validation.status,
      uploadedById: req.user._id,
      uploadedByName: req.user.fullName,
      storageKey: uploadId,
      originalFilename: path.basename(uploadId),
      fileSizeBytes: fileStats.size,
      delimiter: profile.delimiter,
      encoding: 'utf-8',
      dataSchemaVersion: '1.0.0',
      featurePipelineVersion: '1.0.0',
      modality: validation.modality,
      timeRange: validation.timeRange,
      samplingRateHz: validation.samplingRateHz,
      samplingIntervalMeanMs: validation.samplingIntervalMeanMs,
      totalRows: profile.totalRows,
      totalColumns: profile.totalColumns,
      columns: validation.columns,
      previewRows: profile.previewRows,
      qualityFindings: validation.qualityFindings,
      labelDistribution: validation.labelDistribution,
      aiTaskCompatibility: validation.aiTaskCompatibility,
      referenceDetails: datasetType === DATASET_TYPES.REFERENCE ? referenceDetails : undefined,
      isSimulatorDerived: Boolean(req.body.isSimulatorDerived || datasetType === DATASET_TYPES.SIMULATOR),
      isSyntheticQA: Boolean(req.body.isSyntheticQA || datasetType === DATASET_TYPES.SYNTHETIC_QA),
      isDemoData: Boolean(req.body.isDemoData || req.body.isSyntheticQA || req.body.isSimulatorDerived || datasetType === DATASET_TYPES.SYNTHETIC_QA || datasetType === DATASET_TYPES.SIMULATOR)
    });

    // Mark staged upload record as confirmed in MongoDB and in-memory map
    await StagedUpload.updateOne({ uploadId }, { status: 'confirmed' }).catch(() => {});
    if (stagedUploads.has(uploadId)) {
      stagedUploads.get(uploadId).status = 'confirmed';
    }

    return res.status(201).json({
      success: true,
      dataset
    });
  } catch (err) {
    console.error('[DatasetConfirm] Error:', err);
    return res.status(err.status || 500).json({
      error: err.code || 'ConfirmationFailed',
      message: err.message || 'Failed to ingest and save dataset.'
    });
  }
});

/**
 * POST /api/datasets/simulator-stream-ticket
 * Generates a short-lived (60s) single-use stream ticket for mobile and streaming clients.
 * Ticket is scoped strictly to caller's factory and authorized target machine.
 */
router.post('/simulator-stream-ticket', async (req, res) => {
  try {
    const userFactoryId = (req.user?.factoryId?._id || req.user?.factoryId || '').toString();
    const { machineId } = req.body || {};

    let targetMachine = null;
    if (machineId) {
      if (!mongoose.Types.ObjectId.isValid(machineId)) {
        return res.status(400).json({
          error: 'BadRequest',
          message: 'Invalid machineId format.'
        });
      }
      targetMachine = await Machine.findById(machineId);
      if (!targetMachine || targetMachine.factoryId.toString() !== userFactoryId) {
        return res.status(404).json({
          error: 'NotFound',
          message: 'Target machine not found within your factory scope.'
        });
      }
    } else {
      // Default machine: first assigned machine for technician, first factory machine for manager
      if (req.user.role === USER_ROLES.TECHNICIAN) {
        const assigned = req.user.assignedMachines || [];
        const firstId = assigned[0]?._id || assigned[0];
        if (firstId) {
          targetMachine = await Machine.findById(firstId);
        }
      }
      if (!targetMachine) {
        targetMachine = await Machine.findOne({ factoryId: userFactoryId });
      }
      if (!targetMachine) {
        return res.status(404).json({
          error: 'NotFound',
          message: 'No registered machines found in your factory scope.'
        });
      }
    }

    // Role check for technician: must be assigned to target machine
    if (req.user.role === USER_ROLES.TECHNICIAN) {
      const assignedIds = (req.user.assignedMachines || []).map((m) => (m._id || m).toString());
      if (!assignedIds.includes(targetMachine._id.toString())) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'You are not authorized to monitor this machine.'
        });
      }
    }

    const ticket = crypto.randomBytes(24).toString('hex');
    const ticketData = {
      userId: req.user._id.toString(),
      factoryId: userFactoryId,
      machineId: targetMachine._id.toString(),
      expiresAt: Date.now() + 60 * 1000 // 60 seconds TTL
    };
    streamTickets.set(ticket, ticketData);

    // Auto-cleanup after 65 seconds
    setTimeout(() => {
      streamTickets.delete(ticket);
    }, 65000).unref();

    return res.status(200).json({
      success: true,
      ticket,
      machineId: targetMachine._id.toString(),
      machineCode: targetMachine.code,
      expiresInSeconds: 60
    });
  } catch (err) {
    console.error('[SimulatorTicket] Error:', err);
    return res.status(500).json({
      error: 'ServerError',
      message: 'Failed to generate simulator stream ticket.'
    });
  }
});

/**
 * POST /api/datasets/simulator-tick
 * Ingest live telemetry tick from simulator client and broadcast strictly within caller's factory and machine scope.
 * Validates publisher role & machine assignment, payload size (<= 8KB), physical engineering ranges, and schema.
 */
router.post('/simulator-tick', requireTechnicianOrManager, async (req, res) => {
  try {
    const userFactoryId = (req.user?.factoryId?._id || req.user?.factoryId || '').toString();
    const rawData = req.body || {};

    // 1. Bound payload size (max 8KB)
    const rawPayloadString = JSON.stringify(rawData);
    if (Buffer.byteLength(rawPayloadString, 'utf8') > 8192) {
      return res.status(413).json({
        error: 'PayloadTooLarge',
        message: 'Simulator telemetry tick exceeds maximum permitted size of 8 KB.'
      });
    }

    // 2. Resolve and authorize target machine
    let targetMachine = null;
    if (rawData.machineId) {
      if (!mongoose.Types.ObjectId.isValid(rawData.machineId)) {
        return res.status(400).json({
          error: 'BadRequest',
          message: 'Invalid machineId format.'
        });
      }
      targetMachine = await Machine.findById(rawData.machineId);
      if (!targetMachine || targetMachine.factoryId.toString() !== userFactoryId) {
        return res.status(404).json({
          error: 'NotFound',
          message: 'Target machine not found within your factory scope.'
        });
      }
    } else {
      // Default to first assigned machine for technician, first factory machine for manager
      if (req.user.role === USER_ROLES.TECHNICIAN) {
        const assigned = req.user.assignedMachines || [];
        const firstId = assigned[0]?._id || assigned[0];
        if (firstId) {
          targetMachine = await Machine.findById(firstId);
        }
      }
      if (!targetMachine) {
        targetMachine = await Machine.findOne({ factoryId: userFactoryId });
      }
      if (!targetMachine) {
        return res.status(404).json({
          error: 'NotFound',
          message: 'No registered machines found in your factory scope.'
        });
      }
    }

    // Role check: technician must be assigned to this machine
    if (req.user.role === USER_ROLES.TECHNICIAN) {
      const assignedIds = (req.user.assignedMachines || []).map((m) => (m._id || m).toString());
      if (!assignedIds.includes(targetMachine._id.toString())) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'You are not authorized to publish telemetry for this machine.'
        });
      }
    }

    // 3. Sanitize and validate physical signal ranges
    const sanitizedTick = {
      machineId: targetMachine._id.toString(),
      machineCode: targetMachine.code,
      sessionId: typeof rawData.sessionId === 'string' ? rawData.sessionId.slice(0, 64) : null,
      serverReceivedAt: new Date().toISOString(),
      isSimulated: true,
      faultType: typeof rawData.faultType === 'string' ? rawData.faultType.slice(0, 50) : null,
      running: Boolean(rawData.running !== false)
    };

    for (const [key, range] of Object.entries(TELEMETRY_RANGES)) {
      if (rawData[key] !== undefined && rawData[key] !== null) {
        const num = Number(rawData[key]);
        if (!Number.isFinite(num)) {
          return res.status(400).json({
            error: 'InvalidTelemetryTick',
            message: `Field "${key}" must be a finite numeric value.`
          });
        }
        if (num < range.min || num > range.max) {
          return res.status(400).json({
            error: 'TelemetryValueOutOfRange',
            message: `Field "${key}" (${num}) is outside physical engineering range [${range.min}, ${range.max}] for ${range.label}.`
          });
        }
        sanitizedTick[key] = num;
      }
    }

    const streamKey = `${userFactoryId}:${targetMachine._id.toString()}`;
    latestTickByStreamKey.set(streamKey, sanitizedTick);

    const clientSet = sseClientsByStreamKey.get(streamKey);
    const subscriberCount = clientSet ? clientSet.size : 0;

    if (clientSet && clientSet.size > 0) {
      const payload = JSON.stringify({ type: 'TELEMETRY_TICK', ...sanitizedTick });
      for (const client of clientSet) {
        try {
          client.write(`data: ${payload}\n\n`);
        } catch {
          clientSet.delete(client);
        }
      }
    }

    return res.status(200).json({
      success: true,
      machineId: targetMachine._id.toString(),
      machineCode: targetMachine.code,
      sessionId: sanitizedTick.sessionId,
      subscribers: subscriberCount,
      timestamp: sanitizedTick.serverReceivedAt
    });
  } catch (err) {
    console.error('[SimulatorTick] Error:', err);
    return res.status(500).json({
      error: 'ServerError',
      message: 'Failed to process simulator telemetry tick.'
    });
  }
});

/**
 * POST /api/datasets/simulator-ingest
 * Authenticated ingestion of live session telemetry from the Gearbox Simulator component.
 * Validates factory and assigned machine scope, formats 15-channel CSV, checks monotonic timestamps,
 * labels records as [SIMULATED], and optionally executes an anomaly detection analysis run.
 */
router.post('/simulator-ingest', requireTechnicianOrManager, async (req, res) => {
  try {
    const {
      machineId,
      title,
      description,
      telemetry,
      faultMetadata,
      runAnalysis = false,
      modelArtifactId
    } = req.body;

    if (!machineId) {
      return res.status(400).json({
        error: 'MissingMachineId',
        message: 'machineId is required for simulator telemetry ingestion.'
      });
    }

    const userFactoryId = req.user.factoryId?._id?.toString() || req.user.factoryId?.toString();
    const targetMachine = await Machine.findById(machineId);
    if (!targetMachine || targetMachine.factoryId.toString() !== userFactoryId) {
      return res.status(404).json({
        error: 'NotFound',
        message: 'Target machine not found within your factory scope.'
      });
    }

    if (req.user.role === USER_ROLES.TECHNICIAN) {
      const assignedIds = (req.user.assignedMachines || []).map((m) =>
        (m._id || m).toString()
      );
      if (!assignedIds.includes(targetMachine._id.toString())) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'You are not authorized to upload or ingest operational data for this machine.'
        });
      }
    }

    let csvContent = '';
    if (typeof telemetry === 'string') {
      csvContent = telemetry;
    } else if (Array.isArray(telemetry) && telemetry.length > 0) {
      const headers = [
        'time_s', 'engine_rpm', 'gearbox_in_rpm', 'gearbox_out_rpm', 'gen_rpm',
        'torque_nm', 'shaft_power_kw', 'gen_elec_kw', 'gen_voltage_v', 'gen_current_a',
        'gen_freq_hz', 'coolant_c', 'egt_c', 'fuel_rate_l_h', 'vib_rms'
      ];
      const rows = [headers.join(',')];
      for (const row of telemetry) {
        const line = headers.map((h) => {
          const val = row[h] !== undefined ? row[h] : (row[h.replace(/_/g, '')] !== undefined ? row[h.replace(/_/g, '')] : 0);
          return typeof val === 'number' ? (Number.isInteger(val) ? val : Number(val.toFixed(2))) : val;
        }).join(',');
        rows.push(line);
      }
      csvContent = rows.join('\n');
    } else {
      return res.status(400).json({
        error: 'MissingTelemetry',
        message: 'telemetry must be a non-empty array of reading objects or a valid CSV string.'
      });
    }

    const profile = parseAndProfileCsv(csvContent);
    const standardColumnMappings = [
      { rawHeader: 'time_s', isTimestamp: true },
      { rawHeader: 'vib_rms', mappedSignal: 'vibration_input_radial', sourceUnit: 'mm/s' },
      { rawHeader: 'gearbox_in_rpm', mappedSignal: 'rotational_speed', sourceUnit: 'RPM' },
      { rawHeader: 'torque_nm', mappedSignal: 'load_torque', sourceUnit: 'Nm' },
      { rawHeader: 'coolant_c', mappedSignal: 'temp_gearbox_sump', sourceUnit: 'degC' }
    ];

    const validation = validateDatasetContent(profile.allRows, standardColumnMappings);

    // Save CSV to disk storage
    const filename = `simulated_telemetry_${targetMachine.code}_${Date.now()}.csv`;
    const buffer = Buffer.from(csvContent, 'utf-8');
    const fileInfo = await saveUploadedFile({
      buffer,
      originalFilename: filename,
      mimeType: 'text/csv'
    });

    const formattedTitle = title && title.trim()
      ? (title.includes('[SIMULATED]') ? title.trim() : `[SIMULATED] ${title.trim()}`)
      : `[SIMULATED] ${targetMachine.code} Transmission Dyno Run (${new Date().toISOString().slice(0, 19).replace('T', ' ')})`;

    const dataset = await Dataset.create({
      factoryId: targetMachine.factoryId,
      siteId: targetMachine.siteId || null,
      machineId: targetMachine._id,
      datasetType: DATASET_TYPES.OPERATIONAL,
      title: formattedTitle,
      description: description
        ? `${description.trim()} | [SIMULATED TELEMETRY]`
        : `Deterministic 3D transmission/generator simulator telemetry. Evaluated with synthetic anomaly boundaries.`,
      status: validation.status,
      uploadedById: req.user._id,
      uploadedByName: req.user.fullName,
      storageKey: fileInfo.storageKey,
      originalFilename: filename,
      fileSizeBytes: buffer.length,
      fileChecksumSha256: fileInfo.fileChecksumSha256,
      delimiter: profile.delimiter,
      encoding: 'utf-8',
      dataSchemaVersion: '1.0.0',
      featurePipelineVersion: '1.0.0',
      modality: validation.modality,
      timeRange: validation.timeRange,
      samplingRateHz: validation.samplingRateHz || 10.0,
      samplingIntervalMeanMs: validation.samplingIntervalMeanMs || 100.0,
      totalRows: profile.totalRows,
      totalColumns: profile.totalColumns,
      columns: validation.columns,
      previewRows: profile.previewRows,
      qualityFindings: validation.qualityFindings,
      labelDistribution: validation.labelDistribution,
      aiTaskCompatibility: validation.aiTaskCompatibility,
      isSimulatorDerived: true,
      isDemoData: true
    });

    let analysisRun = null;
    let alerts = [];

    if (runAnalysis) {
      let targetModelId = modelArtifactId;
      if (!targetModelId) {
        const defaultIso = await ModelArtifact.findOne({
          factoryId: userFactoryId,
          modelType: MODEL_TYPES.ISOLATION_FOREST,
          status: MODEL_STATUS.READY,
          storageKey: { $exists: true, $ne: null }
        }) || await ModelArtifact.findOne({
          factoryId: userFactoryId,
          modelType: MODEL_TYPES.ISOLATION_FOREST,
          status: MODEL_STATUS.READY
        });
        if (defaultIso) targetModelId = defaultIso._id;
      }

      if (targetModelId) {
        const model = await ModelArtifact.findById(targetModelId);
        if (model) {
          if (
            (model.componentType && model.componentType.toLowerCase().includes('bearing')) ||
            model.targetDomain === 'bearing_faults'
          ) {
            return res.status(400).json({
              error: 'IncompatibleModelError',
              message: `Incompatible model domain: Model "${model.name}" is specialized for bearing test-bench vibration, but simulator telemetry represents multi-stage gearbox powertrain dynamics. Please select a gearbox anomaly detector.`,
              dataset
            });
          }

          if (model.modelType === MODEL_TYPES.RANDOM_FOREST) {
            return res.status(400).json({
              error: 'IncompatibleDatasetError',
              message: `Incompatible dataset: Random Forest classifier "${model.name}" requires ground-truth fault classification labels, but simulator telemetry is unlabelled continuous operational data. Please use Isolation Forest Anomaly Detector.`,
              dataset
            });
          }

          const runDoc = await AnalysisRun.create({
            factoryId: userFactoryId,
            siteId: targetMachine.siteId || null,
            machineId: targetMachine._id,
            datasetId: dataset._id,
            modelArtifactId: model._id,
            datasetTitle: dataset.title,
            fileChecksumSha256: fileInfo.fileChecksumSha256,
            modelName: model.name,
            modelType: model.modelType,
            modelVersion: model.version || '1.0.0',
            featurePipelineVersion: '1.0.0',
            targetDomain: model.targetDomain,
            componentType: targetMachine.componentType || 'gearbox',
            mappedSignals: ['vibration_input_radial', 'rotational_speed', 'load_torque', 'temp_gearbox_sump'],
            isSimulatorDerived: true,
            configuration: {
              windowSize: 16,
              overlapRatio: 0.5,
              regimeAware: true
            },
            status: ANALYSIS_RUN_STATUS.QUEUED,
            createdById: req.user._id,
            createdByName: req.user.fullName
          });

          analysisRun = await startAnalysisRunJob(runDoc._id, { sync: true });
          alerts = await Alert.find({ analysisRunId: analysisRun._id });
        }
      }
    }

    return res.status(201).json({
      success: true,
      dataset,
      analysisRun,
      alerts,
      isSimulated: true,
      diagnostics: {
        totalRows: profile.totalRows,
        samplingRateHz: validation.samplingRateHz || 10.0,
        durationSeconds: validation.timeRange?.durationSeconds || 0,
        faultMetadata: faultMetadata || null
      }
    });
  } catch (err) {
    console.error('[SimulatorIngest] Error:', err);
    return res.status(err.status || 500).json({
      error: err.code || 'SimulatorIngestFailed',
      message: err.message || 'Failed to ingest simulator telemetry.'
    });
  }
});

/**
 * GET /api/datasets
 * Lists datasets scoped to the user's factory and assigned equipment.
 * Supports filters: machineId, datasetType, status.
 */
router.get('/', async (req, res) => {
  try {
    const userFactoryId = req.user.factoryId?._id?.toString() || req.user.factoryId?.toString();
    const { machineId, datasetType, status } = req.query;

    const query = {};

    if (datasetType) {
      query.datasetType = datasetType;
    }

    if (status) {
      query.status = status;
    }

    // Role scoping
    if (req.user.role === USER_ROLES.FACTORY_MANAGER) {
      // Managers see all datasets in their factory or reference datasets
      query.$or = [{ factoryId: userFactoryId }, { datasetType: DATASET_TYPES.REFERENCE }];
    } else {
      // Technicians & Viewers see operational datasets for assigned machines, plus reference catalog
      const assignedIds = (req.user.assignedMachines || []).map((m) =>
        (m._id || m).toString()
      );
      query.$or = [
        { factoryId: userFactoryId, machineId: { $in: assignedIds } },
        { datasetType: DATASET_TYPES.REFERENCE }
      ];
    }

    if (machineId) {
      query.machineId = machineId;
    }

    const datasets = await Dataset.find(query)
      .populate('machineId', 'code name operationalStatus')
      .populate('siteId', 'name code')
      .sort({ createdAt: -1 })
      .select('-previewRows'); // Omit heavy preview rows from listing

    return res.status(200).json({
      success: true,
      count: datasets.length,
      datasets
    });
  } catch (err) {
    console.error('[DatasetsList] Error:', err);
    return res.status(500).json({
      error: 'InternalServerError',
      message: 'Failed to retrieve datasets.'
    });
  }
});

/**
 * GET /api/datasets/reference-catalog
 * Dedicated endpoint for public/reference research datasets.
 */
router.get('/reference-catalog', async (req, res) => {
  try {
    const referenceDatasets = await Dataset.find({
      datasetType: DATASET_TYPES.REFERENCE
    })
      .sort({ createdAt: -1 })
      .select('-previewRows');

    return res.status(200).json({
      success: true,
      count: referenceDatasets.length,
      datasets: referenceDatasets
    });
  } catch (err) {
    console.error('[ReferenceCatalog] Error:', err);
    return res.status(500).json({
      error: 'InternalServerError',
      message: 'Failed to retrieve reference catalog.'
    });
  }
});

/**
 * GET /api/datasets/manifest
 * Returns the verified dataset manifest containing download metadata, checksums, and terms.
 */
router.get('/manifest', (req, res) => {
  try {
    const manifestPath = path.resolve(__dirname, '../../../../data/manifest.json');
    if (!fs.existsSync(manifestPath)) {
      return res.status(404).json({
        error: 'NotFound',
        message: 'Dataset manifest not found on disk.'
      });
    }
    const manifestData = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    return res.status(200).json({
      success: true,
      manifest: manifestData
    });
  } catch (err) {
    console.error('[DatasetManifest] Error:', err);
    return res.status(500).json({
      error: 'InternalServerError',
      message: 'Failed to read dataset manifest.'
    });
  }
});

/**
 * PATCH /api/datasets/:id/mappings
 * Update column mappings, signal roles, and engineering units for an ingested dataset.
 */
router.patch('/:id/mappings', requireTechnicianOrManager, async (req, res) => {
  try {
    const { columnMappings } = req.body;
    if (!Array.isArray(columnMappings)) {
      return res.status(400).json({ error: 'BadRequest', message: 'columnMappings array is required.' });
    }

    const dataset = await Dataset.findById(req.params.id);
    if (!dataset) {
      return res.status(404).json({ error: 'NotFound', message: 'Dataset not found.' });
    }

    const userFactoryId = (req.user.factoryId?._id || req.user.factoryId || '').toString();
    if (dataset.factoryId && dataset.factoryId.toString() !== userFactoryId) {
      return res.status(403).json({ error: 'Forbidden', message: 'Access denied: Dataset belongs to another factory.' });
    }

    if (req.user.role !== USER_ROLES.FACTORY_MANAGER && dataset.machineId) {
      const assignedIds = (req.user.assignedMachines || []).map((m) =>
        (m._id || m).toString()
      );
      if (!assignedIds.includes(dataset.machineId.toString())) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'You are not assigned to the machine associated with this dataset.'
        });
      }
    }

    // Merge mappings preserving stats
    dataset.columns = dataset.columns.map((existingCol) => {
      const match = columnMappings.find((m) => m.rawHeader === existingCol.rawHeader);
      if (!match) return existingCol;
      return {
        ...existingCol.toObject(),
        mappedSignal: match.mappedSignal || null,
        isTimestamp: Boolean(match.isTimestamp),
        isLabel: Boolean(match.isLabel),
        sourceUnit: match.sourceUnit || existingCol.sourceUnit || ''
      };
    });

    await dataset.save();
    return res.status(200).json({
      success: true,
      message: 'Column mappings updated successfully.',
      dataset
    });
  } catch (err) {
    return res.status(500).json({ error: 'InternalError', message: err.message });
  }
});

/**
 * GET /api/datasets/:id
 * Retrieve full dataset details including quality findings, preview rows, and AI compatibility.
 */
router.get('/:id', async (req, res) => {
  try {
    const dataset = await Dataset.findById(req.params.id)
      .populate('machineId', 'code name operationalStatus arrangement stages')
      .populate('siteId', 'name code');

    if (!dataset) {
      return res.status(404).json({
        error: 'NotFound',
        message: 'Dataset not found.'
      });
    }

    // Scoping check
    const userFactoryId = req.user.factoryId?._id?.toString() || req.user.factoryId?.toString();
    if (dataset.datasetType === DATASET_TYPES.OPERATIONAL) {
      if (dataset.factoryId.toString() !== userFactoryId) {
        return res.status(404).json({
          error: 'NotFound',
          message: 'Dataset not found within your factory scope.'
        });
      }

      if (req.user.role !== USER_ROLES.FACTORY_MANAGER) {
        const assignedIds = (req.user.assignedMachines || []).map((m) =>
          (m._id || m).toString()
        );
        if (!assignedIds.includes(dataset.machineId?._id?.toString())) {
          return res.status(403).json({
            error: 'Forbidden',
            message: 'You are not assigned to the machine associated with this dataset.'
          });
        }
      }
    }

    return res.status(200).json({
      success: true,
      dataset
    });
  } catch (err) {
    console.error('[DatasetDetail] Error:', err);
    return res.status(500).json({
      error: 'InternalServerError',
      message: 'Failed to retrieve dataset details.'
    });
  }
});

/**
 * GET /api/datasets/:id/download
 * Secure file stream download, enforcing scope and never exposing internal paths.
 */
router.get('/:id/download', async (req, res) => {
  try {
    const dataset = await Dataset.findById(req.params.id);
    if (!dataset) {
      return res.status(404).json({
        error: 'NotFound',
        message: 'Dataset not found.'
      });
    }

    // Scoping check
    const userFactoryId = req.user.factoryId?._id?.toString() || req.user.factoryId?.toString();
    if (dataset.datasetType === DATASET_TYPES.OPERATIONAL) {
      if (dataset.factoryId.toString() !== userFactoryId) {
        return res.status(404).json({
          error: 'NotFound',
          message: 'Dataset not found within your factory scope.'
        });
      }

      if (req.user.role !== USER_ROLES.FACTORY_MANAGER) {
        const assignedIds = (req.user.assignedMachines || []).map((m) =>
          (m._id || m).toString()
        );
        if (!assignedIds.includes(dataset.machineId?.toString())) {
          return res.status(403).json({
            error: 'Forbidden',
            message: 'You are not assigned to the machine associated with this dataset.'
          });
        }
      }
    }

    const safePath = getSafeFilePath(dataset.storageKey);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${dataset.originalFilename || 'dataset.csv'}"`
    );

    const stream = fs.createReadStream(safePath);
    stream.on('error', (err) => {
      console.error('[StreamDownload] Error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'StreamError', message: 'Failed to stream dataset file.' });
      }
    });
    stream.pipe(res);
  } catch (err) {
    console.error('[DatasetDownload] Error:', err);
    return res.status(err.status || 500).json({
      error: err.code || 'DownloadFailed',
      message: err.message || 'Failed to download dataset.'
    });
  }
});

/**
 * DELETE /api/datasets/:id
 * Factory Manager can delete a dataset and its backing file.
 */
router.delete('/:id', requireManager, async (req, res) => {
  try {
    const dataset = await Dataset.findById(req.params.id);
    if (!dataset) {
      return res.status(404).json({
        error: 'NotFound',
        message: 'Dataset not found.'
      });
    }

    const userFactoryId = req.user.factoryId?._id?.toString() || req.user.factoryId?.toString();
    if (dataset.factoryId && dataset.factoryId.toString() !== userFactoryId) {
      return res.status(404).json({
        error: 'NotFound',
        message: 'Dataset not found within your factory scope.'
      });
    }

    // Delete stored file
    await deleteStoredFile(dataset.storageKey);

    // Delete DB record
    await Dataset.findByIdAndDelete(dataset._id);

    return res.status(200).json({
      success: true,
      message: 'Dataset and associated storage file deleted successfully.'
    });
  } catch (err) {
    console.error('[DatasetDelete] Error:', err);
    return res.status(500).json({
      error: 'InternalServerError',
      message: 'Failed to delete dataset.'
    });
  }
});

export default router;

