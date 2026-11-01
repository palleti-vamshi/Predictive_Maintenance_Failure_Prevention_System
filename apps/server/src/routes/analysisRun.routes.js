import { Router } from 'express';
import mongoose from 'mongoose';
import { AnalysisRun } from '../models/AnalysisRun.js';
import { ModelArtifact } from '../models/ModelArtifact.js';
import { Dataset } from '../models/Dataset.js';
import { Machine } from '../models/Machine.js';
import { authenticate } from '../middleware/authenticate.js';
import { startAnalysisRunJob, runResearchEvaluationCli } from '../services/mlJob.service.js';
import {
  ANALYSIS_RUN_STATUS,
  MODEL_STATUS,
  DATASET_STATUS,
  USER_ROLES
} from '@predictive-maintenance/shared';

const router = Router();

// All analysis run routes require authentication
router.use(authenticate);

/**
 * POST /api/analysis-runs
 * Initiates an inference analysis run on an uploaded operational dataset or approved reference dataset
 * using a versioned trained model artifact.
 *
 * Enforces strict pre-flight compatibility checks (signals, required features, component type, factory scope).
 */
router.post('/', async (req, res) => {
  try {
    const userFactoryId = (req.user.factoryId?._id || req.user.factoryId).toString();
    const {
      datasetId,
      modelArtifactId,
      machineId,
      configuration = {},
      sync = false
    } = req.body;

    // 1. Input validations
    if (!datasetId || !mongoose.Types.ObjectId.isValid(datasetId)) {
      return res.status(400).json({
        error: 'ValidationError',
        message: 'Valid datasetId is required.'
      });
    }

    if (!modelArtifactId || !mongoose.Types.ObjectId.isValid(modelArtifactId)) {
      return res.status(400).json({
        error: 'ValidationError',
        message: 'Valid modelArtifactId is required.'
      });
    }

    if (!machineId || !mongoose.Types.ObjectId.isValid(machineId)) {
      return res.status(400).json({
        error: 'ValidationError',
        message: 'Valid machineId is required.'
      });
    }

    // 2. Machine verification and factory scoping
    const machine = await Machine.findById(machineId);
    if (!machine || machine.factoryId.toString() !== userFactoryId) {
      return res.status(404).json({
        error: 'NotFound',
        message: 'Machine not found within your authorized factory.'
      });
    }

    // Technicians & Viewers must be assigned to this machine
    if (req.user.role !== USER_ROLES.FACTORY_MANAGER) {
      const isAssigned = (req.user.assignedMachines || []).some(
        (m) => (m._id || m).toString() === machine._id.toString()
      );
      if (!isAssigned) {
        return res.status(403).json({
          error: 'Forbidden',
          message: `Access denied. You do not have permissions for machine "${machine.code}".`
        });
      }
    }

    // 3. Dataset verification
    const dataset = await Dataset.findById(datasetId);
    if (!dataset) {
      return res.status(404).json({
        error: 'NotFound',
        message: 'Dataset record not found.'
      });
    }

    // Check factory scope (operational dataset must match factory; reference dataset can be shared if factory matches or globally approved)
    const isReference = dataset.datasetType === 'reference';
    if (!isReference && dataset.factoryId.toString() !== userFactoryId) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Dataset belongs to another factory.'
      });
    }

    if (dataset.status !== DATASET_STATUS.READY) {
      return res.status(400).json({
        error: 'BadRequest',
        message: `Dataset "${dataset.title}" is in status '${dataset.status}'. Only 'ready' datasets can be analyzed.`
      });
    }

    // 4. Model verification
    const model = await ModelArtifact.findById(modelArtifactId);
    if (!model) {
      return res.status(404).json({
        error: 'NotFound',
        message: 'Model artifact not found.'
      });
    }

    if (model.factoryId.toString() !== userFactoryId) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Model artifact belongs to another factory.'
      });
    }

    if (model.status !== MODEL_STATUS.READY) {
      return res.status(400).json({
        error: 'BadRequest',
        message: `Model "${model.name}" is in status '${model.status}'. Only 'ready' models can be used for analysis.`
      });
    }

    // 5. Strict Signal and Schema Pre-Flight Compatibility Check
    const datasetComponent = (
      dataset.referenceDetails?.machineType ||
      dataset.componentType ||
      (dataset.title?.toLowerCase().includes('bearing') ? 'bearing' : 'gearbox')
    ).toLowerCase();
    const modelComponent = (model.componentType || 'gearbox').toLowerCase();

    if (
      (datasetComponent.includes('bearing') && modelComponent.includes('gear')) ||
      (datasetComponent.includes('gear') && modelComponent.includes('bearing'))
    ) {
      return res.status(400).json({
        error: 'IncompatibleDatasetError',
        message: `Incompatible component type: Model "${model.name}" is designed for "${modelComponent}", but dataset "${dataset.title}" represents "${datasetComponent}".`
      });
    }

    const datasetCols = dataset.columns || dataset.columnMappings || [];
    const mappedSignalNames = datasetCols
      .filter((c) => c.mappedSignal)
      .map((c) => c.rawHeader || c.name);

    if (mappedSignalNames.length === 0) {
      return res.status(400).json({
        error: 'IncompatibleDatasetError',
        message: `Dataset "${dataset.title}" has no mapped sensor signal channels. Cannot run analysis.`
      });
    }

    if (model.featureNames && model.featureNames.length > 0) {
      const primaryVibrationFeatures = model.featureNames.filter((fn) =>
        fn.includes('vib') || fn.includes('accel')
      );
      if (primaryVibrationFeatures.length > 0) {
        const hasVibMatch = mappedSignalNames.some(
          (sig) =>
            (sig.includes('vib') || sig.includes('accel')) &&
            primaryVibrationFeatures.some((fn) => fn.startsWith(sig) || fn.includes(sig))
        );
        if (!hasVibMatch) {
          return res.status(400).json({
            error: 'IncompatibleDatasetError',
            message: `Incompatible dataset: Mapped signals [${mappedSignalNames.join(', ')}] do not produce the primary vibration channels required by model "${model.name}".`
          });
        }
      }

      const hasSignalMatch = mappedSignalNames.some((sig) =>
        model.featureNames.some((fn) => fn.startsWith(sig) || fn.includes(sig))
      );
      if (!hasSignalMatch) {
        return res.status(400).json({
          error: 'IncompatibleDatasetError',
          message: `Incompatible dataset: Mapped signals [${mappedSignalNames.join(', ')}] do not match any feature channels required by model "${model.name}".`
        });
      }
    }

    // 6. Create AnalysisRun record
    const analysisRun = await AnalysisRun.create({
      factoryId: userFactoryId,
      siteId: machine.siteId || null,
      machineId: machine._id,
      datasetId: dataset._id,
      modelArtifactId: model._id,
      datasetTitle: dataset.title,
      fileChecksumSha256: dataset.fileChecksumSha256 || dataset.checksumSha256 || null,
      modelName: model.name,
      modelType: model.modelType,
      modelVersion: model.version || '1.0.0',
      featurePipelineVersion: '1.0.0',
      targetDomain: model.targetDomain,
      componentType: machine.componentType || model.componentType || 'gearbox',
      mappedSignals: mappedSignalNames,
      configuration: {
        windowSize: configuration.windowSize || 256,
        overlapRatio: configuration.overlapRatio || 0.5,
        samplingRateHz: configuration.samplingRateHz || null,
        shaftSpeedRpm: configuration.shaftSpeedRpm || null,
        pinionTeeth: configuration.pinionTeeth || null,
        thresholdOverride: configuration.thresholdOverride || null
      },
      status: ANALYSIS_RUN_STATUS.QUEUED,
      createdById: req.user._id,
      createdByName: req.user.fullName,
      isImmutable: true
    });

    // 7. Trigger Runner
    let resultRun = analysisRun;
    if (sync) {
      resultRun = await startAnalysisRunJob(analysisRun._id, { sync: true });
    } else {
      startAnalysisRunJob(analysisRun._id, { sync: false }).catch((err) => {
        console.error(`[AnalysisRunRoute] Background runner error:`, err);
      });
    }

    return res.status(201).json({
      success: true,
      message: `Analysis run "${analysisRun._id}" initiated.`,
      analysisRun: resultRun
    });
  } catch (err) {
    console.error('[AnalysisRunRoute:Create] Error:', err);
    return res.status(500).json({
      error: 'InternalServerError',
      message: err.message || 'Failed to initiate analysis run.'
    });
  }
});

/**
 * GET /api/analysis-runs
 * Lists analysis runs scoped to the user's factory.
 */
router.get('/', async (req, res) => {
  try {
    const userFactoryId = (req.user.factoryId?._id || req.user.factoryId).toString();
    const { machineId, status, modelType } = req.query;

    const query = { factoryId: userFactoryId };

    if (machineId) {
      query.machineId = machineId;
    }
    if (status) {
      query.status = status;
    }
    if (modelType) {
      query.modelType = modelType;
    }

    // Technicians & Viewers: restrict to assigned machines
    if (req.user.role !== USER_ROLES.FACTORY_MANAGER) {
      const assignedMachineIds = (req.user.assignedMachines || []).map((m) => m._id || m);
      if (query.machineId) {
        if (!assignedMachineIds.map((id) => id.toString()).includes(query.machineId.toString())) {
          return res.status(403).json({
            error: 'Forbidden',
            message: 'You do not have access to this machine.'
          });
        }
      } else {
        query.machineId = { $in: assignedMachineIds };
      }
    }

    const runs = await AnalysisRun.find(query)
      .populate('machineId', 'code name status')
      .populate('datasetId', 'title datasetType totalRows')
      .populate('modelArtifactId', 'name modelType version metrics')
      .sort({ createdAt: -1 });

    return res.status(200).json({
      count: runs.length,
      runs
    });
  } catch (err) {
    console.error('[AnalysisRunRoute:List] Error:', err);
    return res.status(500).json({
      error: 'InternalServerError',
      message: 'Failed to retrieve analysis runs.'
    });
  }
});

/**
 * GET /api/analysis-runs/research-comparison
 * Evaluates research comparison metrics across global vs regime-conditioned baselines,
 * signal-path isolates (vibration-only, thermal-only, fused), and benchmark provenance.
 */
router.get('/research-comparison', async (req, res) => {
  try {
    const data = await runResearchEvaluationCli();
    return res.status(200).json({
      success: true,
      comparison: data,
      evaluation: data
    });
  } catch (err) {
    console.error('[AnalysisRunRoute:ResearchComparison] Error:', err);
    return res.status(500).json({
      error: 'InternalServerError',
      message: 'Failed to generate research comparison metrics: ' + err.message
    });
  }
});

/**
 * GET /api/analysis-runs/:id
 * Retrieves a single analysis run by ID with full intervals and model evidence.
 */
router.get('/:id', async (req, res) => {
  try {
    const userFactoryId = (req.user.factoryId?._id || req.user.factoryId).toString();
    const run = await AnalysisRun.findById(req.params.id)
      .populate('machineId', 'code name status arrangement stages')
      .populate('datasetId', 'title datasetType totalRows columns')
      .populate('modelArtifactId', 'name modelType version metrics featureNames')
      .populate('createdById', 'fullName role');

    if (!run || run.factoryId.toString() !== userFactoryId) {
      return res.status(404).json({
        error: 'NotFound',
        message: 'Analysis run not found within your factory scope.'
      });
    }

    // Permission check for technicians / viewers
    if (req.user.role !== USER_ROLES.FACTORY_MANAGER) {
      const assignedMachineIds = (req.user.assignedMachines || []).map((m) => (m._id || m).toString());
      if (!assignedMachineIds.includes(run.machineId?._id?.toString())) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Access denied. You do not have permissions for this machine.'
        });
      }
    }

    return res.status(200).json({ analysisRun: run });
  } catch (err) {
    console.error('[AnalysisRunRoute:GetById] Error:', err);
    return res.status(500).json({
      error: 'InternalServerError',
      message: 'Failed to retrieve analysis run.'
    });
  }
});

export default router;
