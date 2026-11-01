import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import app from '../src/app.js';
import { ModelArtifact } from '../src/models/ModelArtifact.js';
import { Dataset } from '../src/models/Dataset.js';
import { MODEL_TYPES, MODEL_STATUS, FAULT_DOMAINS } from '@predictive-maintenance/shared';

let server;
let baseUrl;

test.before(async () => {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/predictive_maintenance');
  await ModelArtifact.deleteMany({ name: /^Test / });
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

test.after(async () => {
  await ModelArtifact.deleteMany({ name: /^Test / });
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
});

async function loginUser(email, password) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emailOrUsername: email, password })
  });
  const data = await res.json();
  return { status: res.status, data, token: data.sessionToken };
}

test('ML Model Listing & Retrieval: Manager retrieves seeded models with verified metrics', async () => {
  const { token } = await loginUser('manager@detroit.factory', 'Manager123!');

  // List all models in Detroit factory
  const listRes = await fetch(`${baseUrl}/api/models`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(listRes.status, 200);
  const listData = await listRes.json();
  assert.equal(listData.success, true);
  assert.ok(listData.count >= 2, `Expected at least 2 seeded models, got ${listData.count}`);

  // Find Random Forest Gear Fault Classifier
  const rfModel = listData.models.find(
    (m) => m.modelType === MODEL_TYPES.RANDOM_FOREST && m.targetDomain === FAULT_DOMAINS.GEAR_FAULTS
  );
  assert.ok(rfModel, 'Random Forest gear fault classifier must be present in models list');
  assert.equal(rfModel.status, MODEL_STATUS.READY);

  // Retrieve full model by ID
  const getRes = await fetch(`${baseUrl}/api/models/${rfModel._id}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(getRes.status, 200);
  const { model } = await getRes.json();

  // Verify Evaluation Metrics
  assert.ok(model.metrics.accuracy > 0.9, 'Accuracy must be > 0.9');
  assert.ok(model.metrics.macroF1 > 0.9, 'Macro-F1 must be > 0.9');
  assert.ok(Array.isArray(model.metrics.confusionMatrix), 'Confusion matrix must be an array');
  assert.equal(model.metrics.classes.length, 3, 'Must have 3 classes');

  // Verify SHAP Explanations & Additivity Verification
  assert.ok(model.shapSummary, 'SHAP summary must be present');
  assert.equal(model.shapSummary.additivityVerified, true, 'SHAP additivity must be verified true');
  assert.ok(
    model.shapSummary.maxAdditivityDiscrepancy < 1e-4,
    `SHAP discrepancy ${model.shapSummary.maxAdditivityDiscrepancy} must be strictly < 10^-4`
  );
  assert.ok(
    Array.isArray(model.shapSummary.topContributingFeatures) &&
      model.shapSummary.topContributingFeatures.length > 0,
    'Top contributing features must be present'
  );
});

test('ML Model Listing & Retrieval: Isolation Forest Anomaly Detector has calibrated threshold', async () => {
  const { token } = await loginUser('manager@detroit.factory', 'Manager123!');

  const listRes = await fetch(`${baseUrl}/api/models?modelType=isolation_forest`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(listRes.status, 200);
  const { models } = await listRes.json();
  assert.ok(models.length > 0, 'Must have seeded Isolation Forest model');

  const iso = models[0];
  assert.equal(iso.modelType, MODEL_TYPES.ISOLATION_FOREST);
  assert.ok(iso.metrics.rocAuc > 0.9, 'ROC-AUC must be > 0.9');
  assert.ok(iso.metrics.calibratedThreshold !== null, 'Calibrated threshold must be recorded');
  assert.equal(iso.shapSummary.additivityVerified, true, 'KernelExplainer additivity must be verified');
});

test('Dataset Compatibility: Rejects Random Forest training on unlabeled operational dataset', async () => {
  const { token } = await loginUser('manager@detroit.factory', 'Manager123!');

  // Find operational dataset GB-104 (unlabeled telemetry)
  const dsRes = await fetch(`${baseUrl}/api/datasets`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const { datasets } = await dsRes.json();
  const unlabeledDs = datasets.find((d) => d.datasetType === 'operational');
  assert.ok(unlabeledDs, 'Operational dataset must exist');

  // Attempt to train supervised Random Forest on unlabeled dataset
  const trainRes = await fetch(`${baseUrl}/api/models/train`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: 'Invalid RF on Unlabeled Data',
      modelType: MODEL_TYPES.RANDOM_FOREST,
      datasetId: unlabeledDs._id,
      sync: true
    })
  });

  assert.equal(trainRes.status, 400);
  const errData = await trainRes.json();
  assert.equal(errData.error, 'IncompatibleDataset');
  assert.ok(
    errData.message.includes('Random Forest') && errData.message.includes('label'),
    `Expected clear rejection message, got: ${errData.message}`
  );
});

test('RBAC Enforcement: Technician cannot initiate model training (403 Forbidden)', async () => {
  const { token } = await loginUser('tech@detroit.factory', 'Tech123!');

  // Technician attempts to start training
  const trainRes = await fetch(`${baseUrl}/api/models/train`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: 'Technician Unauthorized Model',
      modelType: MODEL_TYPES.ISOLATION_FOREST,
      datasetId: new mongoose.Types.ObjectId()
    })
  });

  assert.equal(trainRes.status, 403);
});

test('Cross-Factory Isolation: Cleveland manager cannot access Detroit model', async () => {
  const { token: detroitToken } = await loginUser('manager@detroit.factory', 'Manager123!');
  const { token: clevelandToken } = await loginUser('manager@cleveland.factory', 'Manager123!');

  // Get Detroit model ID
  const detroitList = await fetch(`${baseUrl}/api/models`, {
    headers: { Authorization: `Bearer ${detroitToken}` }
  });
  const { models } = await detroitList.json();
  const detroitModel = models[0];

  // Cleveland manager attempts to view Detroit model
  const crossRes = await fetch(`${baseUrl}/api/models/${detroitModel._id}`, {
    headers: { Authorization: `Bearer ${clevelandToken}` }
  });

  assert.equal(crossRes.status, 404, 'Must return 404 for equipment outside factory scope');
});

test('Live Training Pipeline: Manager trains Random Forest on reference dataset with exact TreeSHAP verification', async () => {
  const { token } = await loginUser('manager@detroit.factory', 'Manager123!');

  // Find MFPT reference dataset
  const dsRes = await fetch(`${baseUrl}/api/datasets/reference-catalog`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const { datasets } = await dsRes.json();
  const mfptDs = datasets.find((d) => d.title.includes('MFPT'));
  assert.ok(mfptDs, 'MFPT reference dataset must be present');

  // Trigger synchronous training
  const trainRes = await fetch(`${baseUrl}/api/models/train`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: 'Test Live RF Gear Classifier',
      modelType: MODEL_TYPES.RANDOM_FOREST,
      datasetId: mfptDs._id,
      targetDomain: FAULT_DOMAINS.GEAR_FAULTS,
      parameters: {
        window_size: 16,
        overlap_ratio: 0.5,
        n_estimators: 25,
        random_state: 42
      },
      sync: true
    })
  });

  assert.equal(trainRes.status, 201);
  const trainData = await trainRes.json();
  assert.equal(trainData.success, true);
  const model = trainData.model;

  assert.equal(model.status, MODEL_STATUS.READY);
  assert.ok(model.metrics.accuracy >= 0.7, 'Accuracy should be >= 0.7');
  assert.ok(Array.isArray(model.metrics.confusionMatrix), 'Confusion matrix must be populated');
  assert.equal(model.shapSummary.additivityVerified, true, 'TreeSHAP additivity must be verified true');
  assert.ok(
    model.shapSummary.maxAdditivityDiscrepancy < 1e-4,
    `SHAP discrepancy ${model.shapSummary.maxAdditivityDiscrepancy} must be strictly < 10^-4`
  );

  // Clean up test model
  await fetch(`${baseUrl}/api/models/${model._id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });
});
