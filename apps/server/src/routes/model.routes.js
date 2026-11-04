import { Router } from 'express';
import mongoose from 'mongoose';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { ModelArtifact } from '../models/ModelArtifact.js';
import { Dataset } from '../models/Dataset.js';
import { Machine } from '../models/Machine.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireManager } from '../middleware/authorize.js';
import { startModelTrainingJob } from '../services/mlJob.service.js';
import { env } from '../config/env.js';
import {
  MODEL_TYPES,
  MODEL_STATUS,
  FAULT_DOMAINS,
  DATASET_TYPES,
  DATASET_STATUS,
  USER_ROLES
} from '@predictive-maintenance/shared';

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// All model routes require authentication
router.use(authenticate);

// Validate id parameter format across all routes
router.param('id', (req, res, next, id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({
      error: 'BadRequest',
      message: 'Invalid model ID format.'
    });
  }
  next();
});

/**
 * POST /api/models/train
 * Initiates training for Random Forest classifier or Isolation Forest anomaly detector.
 * Enforces dataset compatibility checks and scoped factory access.
 */
router.post('/train', requireManager, async (req, res) => {
  try {
    const userFactoryId = req.user.factoryId?._id?.toString() || req.user.factoryId?.toString();
    const {
      name,
      modelType,
      datasetId,
      machineId,
      targetDomain = FAULT_DOMAINS.GEAR_FAULTS,
      componentType = 'gearbox',
      parameters = {},
      sync = false
    } = req.body;

    // 1. Validate required inputs
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({
        error: 'ValidationError',
        message: 'Model name is required.'
      });
    }

    if (!modelType || !Object.values(MODEL_TYPES).includes(modelType)) {
      return res.status(400).json({
        error: 'ValidationError',
        message: `Invalid modelType '${modelType}'. Allowed: [${Object.values(MODEL_TYPES).join(', ')}]`
      });
    }

    if (!datasetId || !mongoose.Types.ObjectId.isValid(datasetId)) {
      return res.status(400).json({
        error: 'ValidationError',
        message: 'Valid datasetId is required.'
      });
    }

    // 2. Fetch dataset and verify scope
    const dataset = await Dataset.findById(datasetId);
    if (!dataset) {
      return res.status(404).json({
        error: 'NotFound',
        message: 'Dataset not found.'
      });
    }

    // Check factory access: dataset must belong to user factory or be reference
    const dsFactoryId = dataset.factoryId?.toString();
    if (dataset.datasetType !== DATASET_TYPES.REFERENCE && dsFactoryId !== userFactoryId) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'You are not authorized to train models using datasets from another factory.'
      });
    }

    // Check dataset status
    if (dataset.status === DATASET_STATUS.REJECTED) {
      return res.status(400).json({
        error: 'IncompatibleDataset',
        message: 'Cannot train model: dataset was rejected during validation.'
      });
    }

    // 3. Strict Task & Dataset Compatibility Checks
    const colMappings = dataset.columns || dataset.columnMappings || [];
    const hasLabel = colMappings.some(
      (m) => m.isLabel || ['label', 'fault_class', 'target'].includes(m.rawHeader?.toLowerCase())
    );
    const numericSignalCols = colMappings.filter(
      (m) => m.dataType === 'numeric' && !m.isTimestamp && !m.isLabel
    );

    if (modelType === MODEL_TYPES.RANDOM_FOREST) {
      // Supervised classification requires ground truth labels with >= 2 distinct classes
      if (!hasLabel) {
        return res.status(400).json({
          error: 'IncompatibleDataset',
          message:
            'Random Forest fault classification requires a labeled dataset with ground truth fault classes. The selected dataset has no mapped label column.'
        });
      }

      const labelDist = dataset.labelDistribution
        ? Object.keys(dataset.labelDistribution)
        : [];
      if (labelDist.length > 0 && labelDist.length < 2) {
        return res.status(400).json({
          error: 'IncompatibleDataset',
          message: `Random Forest classifier requires at least 2 distinct fault classes. Found only: [${labelDist.join(', ')}]`
        });
      }
    } else if (modelType === MODEL_TYPES.ISOLATION_FOREST) {
      // Unsupervised anomaly detection requires numeric sensor signals
      if (numericSignalCols.length === 0 && (!dataset.previewRows || dataset.previewRows.length === 0)) {
        return res.status(400).json({
          error: 'IncompatibleDataset',
          message:
            'Isolation Forest anomaly detection requires at least one continuous numeric sensor channel.'
        });
      }
    }

    // 4. Resolve machine association
    let targetMachine = null;
    let siteId = null;
    const resolvedMachineId = machineId || dataset.machineId;

    if (resolvedMachineId) {
      targetMachine = await Machine.findById(resolvedMachineId);
      if (targetMachine && targetMachine.factoryId.toString() === userFactoryId) {
        siteId = targetMachine.siteId;
      }
    }

    // 5. Create ModelArtifact record
    const model = await ModelArtifact.create({
      name: name.trim(),
      modelType,
      factoryId: targetMachine ? targetMachine.factoryId : userFactoryId,
      siteId,
      machineId: targetMachine ? targetMachine._id : null,
      datasetId: dataset._id,
      createdById: req.user._id,
      createdByName: req.user.fullName,
      targetDomain,
      componentType,
      parameters: {
        window_size: parameters.window_size || 256,
        overlap_ratio: parameters.overlap_ratio || 0.5,
        sampling_rate_hz: parameters.sampling_rate_hz || (targetMachine ? 100 : null),
        shaft_speed_rpm: parameters.shaft_speed_rpm || (targetMachine?.ratedSpeedRpm || null),
        pinion_teeth: parameters.pinion_teeth || null,
        random_state: parameters.random_state || 42
      },
      status: MODEL_STATUS.PENDING
    });

    // 6. Launch Training Pipeline
    const isSync = sync === true || sync === 'true' || req.query.sync === 'true';

    if (isSync) {
      const trainedModel = await startModelTrainingJob(model._id, { sync: true });
      return res.status(201).json({
        success: true,
        message: 'Model trained successfully.',
        model: trainedModel
      });
    } else {
      // Non-blocking background launch
      startModelTrainingJob(model._id, { sync: false }).catch((err) => {
        console.error(`[ModelRoutes] Async train job failure: ${err.message}`);
      });

      return res.status(202).json({
        success: true,
        message: 'Model training pipeline initiated.',
        modelId: model._id,
        status: MODEL_STATUS.TRAINING
      });
    }
  } catch (err) {
    console.error('[ModelRoutes] Training initiation error:', err);
    return res.status(err.status || 500).json({
      error: err.name || 'InternalServerError',
      message: err.message || 'Failed to initiate model training.'
    });
  }
});

/**
 * GET /api/models
 * Lists trained models scoped to user's factory and equipment.
 */
router.get('/', async (req, res) => {
  try {
    const userFactoryId = req.user.factoryId?._id?.toString() || req.user.factoryId?.toString();
    const { machineId, modelType, status, targetDomain } = req.query;

    const query = {};

    if (modelType) query.modelType = modelType;
    if (status) query.status = status;
    if (targetDomain) query.targetDomain = targetDomain;

    // Scoping
    if (req.user.role === USER_ROLES.FACTORY_MANAGER) {
      query.factoryId = userFactoryId;
    } else {
      // Technicians and viewers see models for their assigned machines or global models in factory
      const assignedIds = (req.user.assignedMachines || []).map((m) =>
        (m._id || m).toString()
      );
      query.factoryId = userFactoryId;
      if (assignedIds.length > 0) {
        query.$or = [{ machineId: { $in: assignedIds } }, { machineId: null }];
      }
    }

    if (machineId) {
      query.machineId = machineId;
    }

    const models = await ModelArtifact.find(query)
      .populate('datasetId', 'title datasetType referenceDetails')
      .populate('machineId', 'code name operationalStatus')
      .populate('siteId', 'name code')
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: models.length,
      models
    });
  } catch (err) {
    console.error('[ModelRoutes] Listing error:', err);
    return res.status(500).json({
      error: 'InternalServerError',
      message: 'Failed to retrieve models.'
    });
  }
});

/**
 * GET /api/models/benchmarks
 * Returns verified benchmark evaluation reports for CWRU and NASA IMS.
 */
router.get('/benchmarks', async (req, res) => {
  try {
    const benchmarksDir = path.resolve(
      __dirname,
      '../../../../services/ml-service/artifacts/benchmarks'
    );
    const cwruPath = path.join(benchmarksDir, 'cwru_evaluation_report.json');
    const imsPath = path.join(benchmarksDir, 'nasa_ims_evaluation_report.json');

    let cwru = null;
    let nasaIms = null;

    if (fs.existsSync(cwruPath)) {
      cwru = JSON.parse(fs.readFileSync(cwruPath, 'utf8'));
    }
    if (fs.existsSync(imsPath)) {
      nasaIms = JSON.parse(fs.readFileSync(imsPath, 'utf8'));
    }

    return res.status(200).json({
      success: true,
      benchmarks: {
        cwru,
        nasaIms
      }
    });
  } catch (err) {
    console.error('[ModelRoutes:benchmarks] Error:', err);
    return res.status(500).json({
      error: 'InternalServerError',
      message: 'Failed to retrieve benchmark evaluations.'
    });
  }
});

/**
 * GET /api/models/:id
 * Retrieves a single model by ID with full metrics, confusion matrix, and SHAP explanation.
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        error: 'ValidationError',
        message: 'Invalid model ID.'
      });
    }

    const userFactoryId = req.user.factoryId?._id?.toString() || req.user.factoryId?.toString();
    const model = await ModelArtifact.findById(id)
      .populate('datasetId', 'title datasetType referenceDetails qualityFindings')
      .populate('machineId', 'code name operationalStatus gearRatio ratedSpeedRpm')
      .populate('siteId', 'name code');

    if (!model) {
      return res.status(404).json({
        error: 'NotFound',
        message: 'Model artifact not found.'
      });
    }

    // Scoping check
    if (model.factoryId.toString() !== userFactoryId) {
      return res.status(404).json({
        error: 'NotFound',
        message: 'Model artifact not found within your factory scope.'
      });
    }

    return res.status(200).json({
      success: true,
      model
    });
  } catch (err) {
    console.error('[ModelRoutes] Get error:', err);
    return res.status(500).json({
      error: 'InternalServerError',
      message: 'Failed to retrieve model.'
    });
  }
});

/**
 * DELETE /api/models/:id
 * Delete model artifact and associated stored files.
 */
router.delete('/:id', requireManager, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        error: 'ValidationError',
        message: 'Invalid model ID.'
      });
    }

    const userFactoryId = req.user.factoryId?._id?.toString() || req.user.factoryId?.toString();
    const model = await ModelArtifact.findById(id);

    if (!model || model.factoryId.toString() !== userFactoryId) {
      return res.status(404).json({
        error: 'NotFound',
        message: 'Model not found.'
      });
    }

    // Remove artifacts from disk if present
    const artifactFolder = path.resolve(env.FILE_STORAGE_DIR, 'models', id);
    if (fs.existsSync(artifactFolder)) {
      try {
        fs.rmSync(artifactFolder, { recursive: true, force: true });
      } catch (rmErr) {
        console.warn(`[ModelRoutes] Failed to cleanup folder ${artifactFolder}:`, rmErr);
      }
    }

    await ModelArtifact.findByIdAndDelete(id);

    return res.status(200).json({
      success: true,
      message: 'Model artifact deleted successfully.'
    });
  } catch (err) {
    console.error('[ModelRoutes] Delete error:', err);
    return res.status(500).json({
      error: 'InternalServerError',
      message: 'Failed to delete model.'
    });
  }
});

export default router;
