import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { ModelArtifact } from '../models/ModelArtifact.js';
import { Dataset } from '../models/Dataset.js';
import { AnalysisRun } from '../models/AnalysisRun.js';
import { Alert } from '../models/Alert.js';
import { getSafeFilePath } from './storage.service.js';
import { env } from '../config/env.js';
import {
  MODEL_STATUS,
  MODEL_TYPES,
  ANALYSIS_RUN_STATUS,
  ALERT_STATUSES,
  ALERT_SEVERITIES,
  ALERT_TASK_TYPES
} from '@predictive-maintenance/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Locate repo root and ML service directories
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const ML_SERVICE_DIR = path.resolve(REPO_ROOT, 'services/ml-service');
const VENV_PYTHON = path.resolve(ML_SERVICE_DIR, '.venv/bin/python');
const CLI_PATH = path.resolve(ML_SERVICE_DIR, 'cli.py');

/**
 * Determine the suitable Python executable (preferring ML virtualenv).
 */
export function getPythonExecutable() {
  if (process.env.PYTHON_EXECUTABLE && fs.existsSync(process.env.PYTHON_EXECUTABLE)) {
    return process.env.PYTHON_EXECUTABLE;
  }
  if (fs.existsSync(VENV_PYTHON)) {
    return VENV_PYTHON;
  }
  return 'python3';
}

/**
 * Low-level child_process execution for python cli.py.
 */
export function runPythonCli({ csvPath, modelType, config, outputDir }) {
  return new Promise((resolve, reject) => {
    const pythonBin = getPythonExecutable();

    if (!fs.existsSync(csvPath)) {
      return reject(new Error(`Dataset CSV not found at: ${csvPath}`));
    }
    if (!fs.existsSync(CLI_PATH)) {
      return reject(new Error(`ML service CLI script not found at: ${CLI_PATH}`));
    }

    fs.mkdirSync(outputDir, { recursive: true });

    const args = [
      CLI_PATH,
      'train',
      '--csv-path',
      csvPath,
      '--model-type',
      modelType,
      '--config',
      JSON.stringify(config),
      '--output-dir',
      outputDir
    ];

    const child = spawn(pythonBin, args, {
      cwd: ML_SERVICE_DIR,
      env: {
        ...process.env,
        PYTHONPATH: ML_SERVICE_DIR
      }
    });

    let stdoutData = '';
    let stderrData = '';

    child.stdout.on('data', (chunk) => {
      stdoutData += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderrData += chunk.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        try {
          const parsed = JSON.parse(stdoutData.trim());
          if (parsed.success && parsed.data) {
            return resolve(parsed.data);
          }
          return resolve(parsed);
        } catch (parseErr) {
          // If stdout had extra logs, attempt to read results.json directly
          const resultsJsonPath = path.join(outputDir, 'results.json');
          if (fs.existsSync(resultsJsonPath)) {
            try {
              const fileData = JSON.parse(fs.readFileSync(resultsJsonPath, 'utf-8'));
              return resolve(fileData);
            } catch (fileErr) {
              return reject(new Error(`Failed to parse results.json: ${fileErr.message}`));
            }
          }
          return reject(
            new Error(`Failed to parse ML service stdout: ${parseErr.message}\n${stdoutData}`)
          );
        }
      } else {
        let errorMsg = `ML process exited with code ${code}`;
        try {
          const errObj = JSON.parse(stderrData.trim());
          if (errObj.message) {
            errorMsg = errObj.message;
          }
        } catch {
          if (stderrData.trim()) {
            errorMsg = stderrData.trim();
          }
        }
        return reject(new Error(errorMsg));
      }
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to spawn Python process: ${err.message}`));
    });
  });
}

/**
 * End-to-end model training orchestrator.
 * Supports synchronous await or non-blocking async execution.
 */
export async function startModelTrainingJob(modelArtifactId, { sync = false } = {}) {
  const model = await ModelArtifact.findById(modelArtifactId);
  if (!model) {
    throw new Error(`ModelArtifact ${modelArtifactId} not found`);
  }

  const dataset = await Dataset.findById(model.datasetId);
  if (!dataset) {
    await ModelArtifact.findByIdAndUpdate(modelArtifactId, {
      status: MODEL_STATUS.FAILED,
      failureReason: 'Associated Dataset record not found.'
    });
    throw new Error('Dataset not found');
  }

  // Resolve safe CSV path
  const csvPath = getSafeFilePath(dataset.storageKey);
  const outputDir = path.resolve(env.FILE_STORAGE_DIR, 'models', modelArtifactId.toString());

  // Mark status as TRAINING
  model.status = MODEL_STATUS.TRAINING;
  await model.save();

  // Prepare config for python pipeline
  const trainingConfig = {
    column_mappings: dataset.columns || dataset.columnMappings || [],
    window_size: model.parameters?.window_size || 256,
    overlap_ratio: model.parameters?.overlap_ratio || 0.5,
    sampling_rate_hz: model.parameters?.sampling_rate_hz || null,
    shaft_speed_rpm: model.parameters?.shaft_speed_rpm || null,
    pinion_teeth: model.parameters?.pinion_teeth || null,
    random_state: model.parameters?.random_state || 42
  };

  const execute = async () => {
    try {
      const results = await runPythonCli({
        csvPath,
        modelType: model.modelType,
        config: trainingConfig,
        outputDir
      });

      // Map Python results to ModelArtifact fields
      const evalData = results.evaluation || {};
      const shapData = results.shap_explanation || {};
      const dsSummary = results.dataset_summary || {};

      const classMapping = {};
      if (evalData.classes && Array.isArray(evalData.classes)) {
        evalData.classes.forEach((cls, idx) => {
          classMapping[idx] = cls;
        });
      }

      const updated = await ModelArtifact.findByIdAndUpdate(
        modelArtifactId,
        {
          status: MODEL_STATUS.READY,
          failureReason: null,
          featureNames: dsSummary.feature_names || [],
          classMapping,
          metrics: {
            accuracy: evalData.accuracy ?? null,
            macroF1: evalData.macro_f1 ?? null,
            classes: evalData.classes || [],
            perClassMetrics: evalData.per_class_metrics || {},
            confusionMatrix: evalData.confusion_matrix || [],
            rocAuc: evalData.roc_auc_score ?? evalData.roc_auc ?? null,
            falsePositiveRate: evalData.false_positive_rate_healthy ?? evalData.false_positive_rate_on_normal ?? null,
            faultRecall: evalData.fault_recall_anomalous ?? evalData.fault_recall_on_defects ?? null,
            calibratedThreshold: evalData.calibrated_decision_threshold ?? evalData.calibrated_threshold ?? null,
            trainSamples: evalData.train_samples_fitted ?? evalData.train_samples ?? null,
            testSamples: evalData.test_samples_evaluated ?? evalData.test_samples ?? null,
            splitMethod: evalData.split_method ?? null
          },
          featureImportance: results.feature_importance || [],
          shapSummary: {
            explainerType: shapData.explainer_type || 'SHAP Explainer',
            additivityVerified: Boolean(shapData.additivity_verified),
            maxAdditivityDiscrepancy: shapData.max_additivity_discrepancy ?? 0,
            baselineExpectedValue: shapData.baseline_expected_value ?? shapData.baseline_expected_decision ?? null,
            topContributingFeatures: shapData.top_contributing_features || [],
            globalFeatureImportance: shapData.global_feature_importance || [],
            sampleExplanations: shapData.sample_explanations || []
          },
          datasetSummary: {
            datasetTitle: dataset.title,
            datasetType: dataset.datasetType,
            totalRawRows: dsSummary.total_raw_rows || 0,
            mappedSignals: dsSummary.mapped_signals || [],
            windowSize: dsSummary.window_size || trainingConfig.window_size,
            overlapRatio: dsSummary.overlap_ratio || trainingConfig.overlap_ratio,
            totalExtractedWindows: dsSummary.total_extracted_windows || 0,
            featureCount: dsSummary.feature_count || 0
          },
          storageKey: path.join('models', modelArtifactId.toString(), 'model.joblib')
        },
        { new: true }
      );

      return updated;
    } catch (err) {
      console.error(`[MlJob] Training failed for model ${modelArtifactId}:`, err);
      const failed = await ModelArtifact.findByIdAndUpdate(
        modelArtifactId,
        {
          status: MODEL_STATUS.FAILED,
          failureReason: err.message || 'Pipeline execution failed'
        },
        { new: true }
      );
      if (sync) throw err;
      return failed;
    }
  };

  if (sync) {
    return await execute();
  } else {
    // Non-blocking async execution
    execute().catch((err) => {
      console.error(`[MlJob] Background job error: ${err.message}`);
    });
    return model;
  }
}

/**
 * Child process execution for python cli.py analyze.
 */
export function runPythonAnalysisCli({ csvPath, modelPath, config, outputDir }) {
  return new Promise((resolve, reject) => {
    const pythonBin = getPythonExecutable();

    if (!fs.existsSync(csvPath)) {
      return reject(new Error(`Dataset CSV not found at: ${csvPath}`));
    }
    if (!fs.existsSync(modelPath)) {
      return reject(new Error(`Model artifact not found at: ${modelPath}`));
    }
    if (!fs.existsSync(CLI_PATH)) {
      return reject(new Error(`ML service CLI script not found at: ${CLI_PATH}`));
    }

    fs.mkdirSync(outputDir, { recursive: true });

    const args = [
      CLI_PATH,
      'analyze',
      '--csv-path',
      csvPath,
      '--model-path',
      modelPath,
      '--config',
      JSON.stringify(config),
      '--output-dir',
      outputDir
    ];

    const child = spawn(pythonBin, args, {
      cwd: ML_SERVICE_DIR,
      env: {
        ...process.env,
        PYTHONPATH: ML_SERVICE_DIR
      }
    });

    let stdoutData = '';
    let stderrData = '';

    child.stdout.on('data', (chunk) => {
      stdoutData += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderrData += chunk.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        try {
          const parsed = JSON.parse(stdoutData.trim());
          if (parsed.success && parsed.data) {
            return resolve(parsed.data);
          }
          return resolve(parsed);
        } catch (parseErr) {
          const analysisJsonPath = path.join(outputDir, 'analysis_results.json');
          if (fs.existsSync(analysisJsonPath)) {
            try {
              const fileData = JSON.parse(fs.readFileSync(analysisJsonPath, 'utf-8'));
              return resolve(fileData);
            } catch (fileErr) {
              return reject(new Error(`Failed to parse analysis_results.json: ${fileErr.message}`));
            }
          }
          return reject(
            new Error(`Failed to parse ML analysis stdout: ${parseErr.message}\n${stdoutData}`)
          );
        }
      } else {
        let errorMsg = `Analysis process exited with code ${code}`;
        try {
          const errObj = JSON.parse(stderrData.trim());
          if (errObj.message) {
            errorMsg = errObj.message;
          }
        } catch {
          if (stderrData.trim()) {
            errorMsg = stderrData.trim();
          }
        }
        return reject(new Error(errorMsg));
      }
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to spawn Python process: ${err.message}`));
    });
  });
}

/**
 * End-to-end analysis run orchestrator.
 * Supports synchronous await or non-blocking async execution.
 */
export async function startAnalysisRunJob(analysisRunId, { sync = false } = {}) {
  const analysisRun = await AnalysisRun.findById(analysisRunId);
  if (!analysisRun) {
    throw new Error(`AnalysisRun ${analysisRunId} not found`);
  }

  const dataset = await Dataset.findById(analysisRun.datasetId);
  if (!dataset) {
    await AnalysisRun.findByIdAndUpdate(analysisRunId, {
      status: ANALYSIS_RUN_STATUS.FAILED,
      failureReason: 'Associated Dataset record not found.'
    });
    throw new Error('Dataset record not found.');
  }

  const model = await ModelArtifact.findById(analysisRun.modelArtifactId);
  if (!model) {
    await AnalysisRun.findByIdAndUpdate(analysisRunId, {
      status: ANALYSIS_RUN_STATUS.FAILED,
      failureReason: 'Associated ModelArtifact record not found.'
    });
    throw new Error('ModelArtifact record not found.');
  }

  if (model.status !== MODEL_STATUS.READY) {
    await AnalysisRun.findByIdAndUpdate(analysisRunId, {
      status: ANALYSIS_RUN_STATUS.FAILED,
      failureReason: `Model ${model.name} is in status '${model.status}', not '${MODEL_STATUS.READY}'.`
    });
    throw new Error(`Model is not ready for analysis (current status: ${model.status}).`);
  }

  const csvPath = getSafeFilePath(dataset.storageKey);
  const modelPath = getSafeFilePath(model.storageKey);
  const outputDir = path.resolve(env.FILE_STORAGE_DIR, 'analysis_runs', analysisRunId.toString());

  // Signal compatibility pre-check
  const datasetCols = dataset.columns || dataset.columnMappings || [];
  const mappedSignalNames = datasetCols
    .filter((c) => c.mappedSignal)
    .map((c) => c.rawHeader || c.name);

  if (model.featureNames && model.featureNames.length > 0) {
    const hasSignalMatch = mappedSignalNames.some((sig) =>
      model.featureNames.some((fn) => fn.startsWith(sig) || fn.includes(sig))
    );
    if (!hasSignalMatch) {
      const errReason = `Incompatible dataset: Mapped signals [${mappedSignalNames.join(', ')}] do not produce the feature channels required by model '${model.name}'.`;
      await AnalysisRun.findByIdAndUpdate(analysisRunId, {
        status: ANALYSIS_RUN_STATUS.FAILED,
        failureReason: errReason
      });
      throw new Error(errReason);
    }
  }

  // Set running state
  analysisRun.status = ANALYSIS_RUN_STATUS.RUNNING;
  analysisRun.startedAt = new Date();
  await analysisRun.save();

  const analysisConfig = {
    column_mappings: datasetCols,
    window_size: analysisRun.configuration?.windowSize || 256,
    overlap_ratio: analysisRun.configuration?.overlapRatio || 0.5,
    sampling_rate_hz: analysisRun.configuration?.samplingRateHz || null,
    shaft_speed_rpm: analysisRun.configuration?.shaftSpeedRpm || null,
    pinion_teeth: analysisRun.configuration?.pinionTeeth || null,
    threshold_override: analysisRun.configuration?.thresholdOverride || null
  };

  const execute = async () => {
    try {
      const results = await runPythonAnalysisCli({
        csvPath,
        modelPath,
        config: analysisConfig,
        outputDir
      });

      const summaryData = results.summary || {};
      const intervals = results.intervals || [];

      // Update AnalysisRun
      const updatedRun = await AnalysisRun.findByIdAndUpdate(
        analysisRunId,
        {
          status: ANALYSIS_RUN_STATUS.COMPLETED,
          completedAt: new Date(),
          failureReason: null,
          summary: {
            totalWindows: summaryData.total_windows || 0,
            anomalousWindowsCount: summaryData.anomalous_windows_count || 0,
            intervalsCount: summaryData.intervals_count || intervals.length,
            maxAnomalyScore: summaryData.max_anomaly_score || 0,
            dataSufficiencyScore: summaryData.data_sufficiency_score ?? 1.0,
            missingValuePct: summaryData.missing_value_pct ?? 0,
            steadyStateConfirmed: summaryData.steady_state_confirmed ?? true
          },
          intervals,
          isImmutable: true
        },
        { new: true }
      );

      // Generate Alert records for each detected interval
      for (const intv of intervals) {
        const isAnomTask = results.analysis_task === 'anomaly_detection';
        const title = isAnomTask
          ? `Statistical Anomaly Detected in ${analysisRun.componentType || 'Gearbox'}`
          : `Predicted Defect: ${intv.predicted_class} in ${analysisRun.componentType || 'Gearbox'}`;

        const alertDoc = new Alert({
          factoryId: analysisRun.factoryId,
          siteId: analysisRun.siteId,
          machineId: analysisRun.machineId,
          datasetId: analysisRun.datasetId,
          analysisRunId: analysisRun._id,
          modelArtifactId: analysisRun.modelArtifactId,
          title,
          severity: intv.severity || ALERT_SEVERITIES.WARNING,
          severityMethod: intv.severity_method || 'calibrated_threshold',
          severityNote:
            intv.severity_note ||
            intv.disclaimer ||
            'Calibrated statistical deviation; model prediction does not prove physical failure.',
          status: ALERT_STATUSES.OPEN,
          analysisTask: results.analysis_task,
          modelDetails: {
            modelName: analysisRun.modelName,
            modelType: analysisRun.modelType,
            version: analysisRun.modelVersion,
            pipelineVersion: analysisRun.featurePipelineVersion,
            isVerifiedModel: true
          },
          interval: {
            intervalIndex: intv.interval_index ?? intv.interval_idx ?? 0,
            startIdx: intv.start_idx ?? intv.start_sample ?? 0,
            endIdx: intv.end_idx ?? intv.end_sample ?? 0,
            startTime: intv.start_time || null,
            endTime: intv.end_time || null,
            sampleCount: intv.sample_count || 0,
            predictedClass: intv.predicted_class || null
          },
          scores: {
            peakScore: intv.score || 0,
            calibratedThreshold: intv.calibrated_threshold ?? intv.threshold ?? 0,
            isCalibrated: intv.is_threshold_calibrated !== false,
            decisionValue: intv.decision_value ?? null,
            confidence: intv.confidence ?? null
          },
          contributingSignals: (intv.contributing_signals || []).map((cs) => ({
            signal: cs.signal,
            peakValue: typeof cs.peak_value === 'number' ? cs.peak_value : parseFloat(cs.value) || 0,
            baselineMean: typeof cs.baseline_mean === 'number' ? cs.baseline_mean : parseFloat(cs.baseline) || 0,
            deviationRatio: typeof cs.deviation_ratio === 'number' ? cs.deviation_ratio : parseFloat(cs.delta) / 100 || 0,
            unit: cs.unit || 'g'
          })),
          contributingFeatures: (intv.contributing_features || []).map((cf) => ({
            feature: cf.feature,
            attribution: cf.attribution,
            importance: cf.importance,
            interpretation: cf.interpretation,
            value: cf.value
          })),
          shapAttribution: {
            explainerType: intv.shap_attribution?.explainer_type || null,
            modelOutput: intv.shap_attribution?.model_output || null,
            approximation: intv.shap_attribution?.approximation || null,
            additivityVerified: Boolean(intv.shap_attribution?.additivity_verified),
            maxDiscrepancy: intv.shap_attribution?.max_discrepancy || 0,
            baselineExpectedValue: intv.shap_attribution?.baseline_expected_value || 0,
            featureContributions: intv.shap_attribution?.feature_contributions || []
          },
          dataQuality: {
            sufficiencyScore: summaryData.data_sufficiency_score ?? 1.0,
            missingValuePct: summaryData.missing_value_pct ?? 0,
            steadyStateConfirmed: summaryData.steady_state_confirmed ?? true
          },
          limitations: [
            `Model inference performed on ${analysisRun.modelType} version ${analysisRun.modelVersion}.`,
            'Pattern deviation or classification likelihood does not constitute physical proof of mechanical failure.',
            'Operating load or speed fluctuations outside baseline conditions may affect model score.'
          ],
          trendExcerpt: intv.trend_excerpt || []
        });

        await alertDoc.save();
      }

      return updatedRun;
    } catch (err) {
      console.error(`[MlJob] Analysis run failed for ${analysisRunId}:`, err);
      const failed = await AnalysisRun.findByIdAndUpdate(
        analysisRunId,
        {
          status: ANALYSIS_RUN_STATUS.FAILED,
          failureReason: err.message || 'Analysis pipeline execution failed'
        },
        { new: true }
      );
      if (sync) throw err;
      return failed;
    }
  };

  if (sync) {
    return await execute();
  } else {
    execute().catch((err) => {
      console.error(`[MlJob] Background analysis run error: ${err.message}`);
    });
    return analysisRun;
  }
}

