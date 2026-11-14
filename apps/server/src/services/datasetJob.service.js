import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DatasetJob } from '../models/DatasetJob.js';
import { Dataset } from '../models/Dataset.js';
import { StagedUpload } from '../models/StagedUpload.js';
import { getSafeFilePath } from './storage.service.js';
import { isArchiveFile, validateAndExtractArchive } from './archiveValidator.service.js';
import { streamProfileCsv } from './streamingCsvProfiler.service.js';
import {
  DATASET_JOB_STATUS,
  DATASET_JOB_STAGES,
  DATASET_STATUS
} from '@predictive-maintenance/shared';

// In-memory active job cancellation tokens: jobId -> { cancelled: boolean }
const activeJobTokens = new Map();

/**
 * Creates and initiates an asynchronous dataset ingestion and profiling job.
 * Runs in background without blocking the HTTP connection.
 */
export async function createAndStartDatasetJob({
  datasetId,
  uploadId,
  factoryId,
  userId,
  options = {}
}) {
  const jobId = crypto.randomUUID();

  const job = await DatasetJob.create({
    jobId,
    datasetId,
    uploadId,
    factoryId,
    createdById: userId,
    jobType: 'DATASET_INGESTION_AND_PROFILING',
    status: DATASET_JOB_STATUS.QUEUED,
    stage: DATASET_JOB_STAGES.QUEUED,
    progress: 0,
    stageMessage: 'Dataset queued for background stream processing',
    startedAt: new Date()
  });

  const cancellationToken = { cancelled: false };
  activeJobTokens.set(jobId, cancellationToken);

  // Execute asynchronously in background
  setImmediate(() => {
    executeDatasetJob(jobId, cancellationToken, options).catch((err) => {
      console.error(`[DatasetJob ${jobId}] Unhandled failure:`, err);
    });
  });

  return job;
}

/**
 * Request cancellation of a running background job.
 */
export async function cancelDatasetJob(jobId, reason = 'Cancelled by user') {
  const token = activeJobTokens.get(jobId);
  if (token) {
    token.cancelled = true;
  }

  const job = await DatasetJob.findOne({ jobId });
  if (!job) {
    const err = new Error('Dataset job not found');
    err.status = 404;
    throw err;
  }

  if (job.status === DATASET_JOB_STATUS.COMPLETE) {
    const err = new Error('Cannot cancel a completed dataset job');
    err.status = 400;
    throw err;
  }

  job.status = DATASET_JOB_STATUS.CANCELLED;
  job.stage = DATASET_JOB_STAGES.CANCELLED;
  job.stageMessage = reason;
  job.cancellationRequested = true;
  job.completedAt = new Date();
  await job.save();

  if (job.datasetId) {
    await Dataset.findByIdAndUpdate(job.datasetId, {
      status: DATASET_STATUS.REJECTED
    }).catch(() => {});
  }

  activeJobTokens.delete(jobId);
  return job;
}

/**
 * Core asynchronous background job executor.
 */
async function executeDatasetJob(jobId, token, options = {}) {
  const startTime = Date.now();
  let job = await DatasetJob.findOne({ jobId });
  if (!job) return;

  const updateStage = async (stage, progress, message, extra = {}) => {
    await DatasetJob.updateOne(
      { jobId },
      {
        $set: {
          stage,
          progress: Math.min(100, Math.max(0, progress)),
          stageMessage: message,
          status: DATASET_JOB_STATUS.PROCESSING,
          ...extra
        }
      }
    );
  };

  try {
    const dataset = await Dataset.findById(job.datasetId);
    if (!dataset) {
      throw new Error(`Target Dataset ${job.datasetId} not found`);
    }

    // 1. Stage: VALIDATING_INTEGRITY
    await updateStage(
      DATASET_JOB_STAGES.VALIDATING_INTEGRITY,
      10,
      'Verifying cryptographic storage integrity and file bounds'
    );

    let activeStorageKey = dataset.storageKey;
    let activeFilePath = getSafeFilePath(activeStorageKey);

    const fileStats = await fs.promises.stat(activeFilePath);

    if (token.cancelled) throw new Error('Processing cancelled by user');

    // 2. Stage: ARCHIVE INSPECTION & SAFE EXTRACTION
    let archiveInfo = null;
    if (isArchiveFile(dataset.originalFilename || activeStorageKey)) {
      await updateStage(
        DATASET_JOB_STAGES.INSPECTING_ARCHIVE,
        20,
        'Inspecting archive headers and verifying safe extraction limits'
      );

      const extractionDir = path.join(path.dirname(activeFilePath), `extracted_${job.uploadId}`);
      archiveInfo = await validateAndExtractArchive({
        archivePath: activeFilePath,
        outputDir: extractionDir
      });

      if (token.cancelled) {
        await fs.promises.rm(extractionDir, { recursive: true, force: true }).catch(() => {});
        throw new Error('Processing cancelled by user');
      }

      await updateStage(
        DATASET_JOB_STAGES.EXTRACTING_ARCHIVE,
        35,
        `Safely extracted tabular specimen: ${archiveInfo.extractedFilename}`
      );

      // Point profiler to extracted CSV
      activeFilePath = archiveInfo.extractedPath;
      activeStorageKey = path.relative(path.dirname(activeFilePath), activeFilePath);
    }

    // 3. Stage: STREAM_PROFILING
    await updateStage(
      DATASET_JOB_STAGES.STREAM_PROFILING,
      40,
      'Initiating constant-memory streaming parser and statistics calculator'
    );

    const profile = await streamProfileCsv(activeFilePath, {
      fileSizeBytes: fileStats.size,
      columnMappings: dataset.columns,
      checkCancelled: () => token.cancelled,
      onProgress: ({ progressPercent, totalRows, processedBytes }) => {
        // Map 0-100% of profiling to 40-90% of overall job
        const mappedProgress = Math.round(40 + (progressPercent * 0.5));
        DatasetJob.updateOne(
          { jobId },
          {
            $set: {
              progress: mappedProgress,
              stageMessage: `Profiling row stream: ${totalRows.toLocaleString()} rows processed`,
              'metrics.totalRows': totalRows,
              'metrics.processedBytes': processedBytes,
              'metrics.totalBytes': fileStats.size
            }
          }
        ).catch(() => {});
      }
    });

    if (token.cancelled) throw new Error('Processing cancelled by user');

    // 4. Stage: EVALUATING_COMPATIBILITY
    await updateStage(
      DATASET_JOB_STAGES.EVALUATING_COMPATIBILITY,
      95,
      'Evaluating engineering signal compliance and model task compatibility'
    );

    // 5. Update Dataset document with profiled results
    dataset.delimiter = profile.delimiter;
    dataset.totalRows = profile.totalRows;
    dataset.totalColumns = profile.totalColumns;
    dataset.columns = profile.columns;
    dataset.previewRows = profile.previewRows;
    dataset.qualityFindings = profile.qualityFindings;
    dataset.labelDistribution = profile.labelDistribution;
    dataset.modality = profile.modality;
    dataset.timeRange = profile.timeRange;
    dataset.samplingRateHz = profile.samplingRateHz;
    dataset.samplingIntervalMeanMs = profile.samplingIntervalMeanMs;
    dataset.aiTaskCompatibility = profile.aiTaskCompatibility;

    // Preserve archive provenance if applicable
    if (archiveInfo) {
      dataset.referenceDetails = {
        ...(dataset.referenceDetails || {}),
        sourceArchiveName: archiveInfo.originalArchiveName,
        extractedTabularFile: archiveInfo.extractedFilename,
        archiveType: archiveInfo.archiveType
      };
    }

    const hasErrors = profile.qualityFindings.some((q) => q.severity === 'error');
    dataset.status = hasErrors ? DATASET_STATUS.NEEDS_REVIEW : DATASET_STATUS.READY;
    await dataset.save();

    // 6. Stage: COMPLETE
    const durationMs = Date.now() - startTime;
    await DatasetJob.updateOne(
      { jobId },
      {
        $set: {
          status: DATASET_JOB_STATUS.COMPLETE,
          stage: DATASET_JOB_STAGES.COMPLETE,
          progress: 100,
          stageMessage: `Dataset processing complete: ${profile.totalRows.toLocaleString()} rows verified and ready.`,
          completedAt: new Date(),
          metrics: {
            totalRows: profile.totalRows,
            totalColumns: profile.totalColumns,
            processedBytes: fileStats.size,
            totalBytes: fileStats.size,
            durationMs,
            samplingRateHz: profile.samplingRateHz
          }
        }
      }
    );
  } catch (err) {
    console.error(`[DatasetJob ${jobId}] Job execution failed:`, err);
    await DatasetJob.updateOne(
      { jobId },
      {
        $set: {
          status: token.cancelled ? DATASET_JOB_STATUS.CANCELLED : DATASET_JOB_STATUS.FAILED,
          stage: token.cancelled ? DATASET_JOB_STAGES.CANCELLED : DATASET_JOB_STAGES.FAILED,
          errorMessage: err.message || 'Dataset processing failed',
          stageMessage: token.cancelled ? 'Job cancelled by user' : `Failed: ${err.message}`,
          completedAt: new Date()
        }
      }
    ).catch(() => {});

    if (job.datasetId) {
      await Dataset.findByIdAndUpdate(job.datasetId, {
        status: DATASET_STATUS.REJECTED
      }).catch(() => {});
    }
  } finally {
    activeJobTokens.delete(jobId);
  }
}
