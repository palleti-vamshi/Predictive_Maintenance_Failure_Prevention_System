import { Router } from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { Dataset } from '../models/Dataset.js';
import { Machine } from '../models/Machine.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireManager, requireTechnicianOrManager } from '../middleware/authorize.js';
import {
  saveUploadedFile,
  readStoredFile,
  getSafeFilePath,
  deleteStoredFile
} from '../services/storage.service.js';
import { parseAndProfileCsv } from '../services/csv.service.js';
import { validateDatasetContent } from '../services/datasetValidator.service.js';
import {
  DATASET_TYPES,
  DATASET_STATUS,
  MAX_UPLOAD_SIZE_BYTES,
  USER_ROLES
} from '@predictive-maintenance/shared';

const router = Router();

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

// All dataset endpoints require authentication
router.use(authenticate);

/**
 * POST /api/datasets/upload
 * Stage 1: Uploads file, saves it securely to storage, and generates preview & candidate signal mappings.
 */
router.post('/upload', requireTechnicianOrManager, handleMulterUpload, async (req, res) => {
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

    // 2. Read stored file and perform final validation
    const buffer = await readStoredFile(uploadId);
    const contentString = buffer.toString('utf-8');
    const profile = parseAndProfileCsv(contentString);
    const validation = validateDatasetContent(profile.allRows, columnMappings || []);

    // 3. Create Dataset Document
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
      fileSizeBytes: buffer.length,
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
      referenceDetails: datasetType === DATASET_TYPES.REFERENCE ? referenceDetails : undefined
    });

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
