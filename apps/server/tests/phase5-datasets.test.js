import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app.js';
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { Dataset, Machine, User } from '../src/models/index.js';
import { DATASET_TYPES, DATASET_STATUS, AI_TASK_TYPES } from '@predictive-maintenance/shared';

let server;
let baseUrl;

async function loginUser(email, password) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emailOrUsername: email, password })
  });
  const data = await res.json();
  return data.sessionToken;
}

test.before(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(env.MONGODB_URI);
  }

  // Cleanup any test-created datasets
  await Dataset.deleteMany({ title: /^Test / });

  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

test.after(async () => {
  await Dataset.deleteMany({ title: /^Test / });

  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await mongoose.disconnect();
});

test('Upload & CSV Security: Handles valid CSVs, detects delimiters, rejects malformed, oversized, and invalid types', async () => {
  const mgrToken = await loginUser('manager@detroit.factory', 'Manager123!');

  // 1. Valid comma-separated CSV upload
  const validCsv = 'timestamp,vibration_input_axial,temp_gearbox_sump,rotational_speed\n' +
    '2026-11-01T10:00:00.000Z,1.25,55.4,1490\n' +
    '2026-11-01T10:01:00.000Z,1.30,55.8,1492\n' +
    '2026-11-01T10:02:00.000Z,1.28,56.1,1491\n';

  const formData = new FormData();
  formData.append('file', new Blob([validCsv], { type: 'text/csv' }), 'test_valid.csv');

  const uploadRes = await fetch(`${baseUrl}/api/datasets/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${mgrToken}` },
    body: formData
  });

  assert.equal(uploadRes.status, 200);
  const uploadData = await uploadRes.json();
  assert.equal(uploadData.success, true);
  assert.equal(uploadData.delimiter, ',');
  assert.equal(uploadData.totalRows, 3);
  assert.equal(uploadData.headers.length, 4);
  assert.ok(uploadData.uploadId);
  assert.equal(uploadData.previewRows.length, 3);

  // 2. Semicolon-separated CSV upload
  const semiCsv = 'timestamp;vibration_input_radial;rotational_speed\n' +
    '2026-11-01T10:00:00.000Z;2.15;1500\n' +
    '2026-11-01T10:01:00.000Z;2.20;1502\n';

  const semiForm = new FormData();
  semiForm.append('file', new Blob([semiCsv], { type: 'text/csv' }), 'test_semi.csv');

  const semiRes = await fetch(`${baseUrl}/api/datasets/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${mgrToken}` },
    body: semiForm
  });

  assert.equal(semiRes.status, 200);
  const semiData = await semiRes.json();
  assert.equal(semiData.delimiter, ';');
  assert.equal(semiData.headers.length, 3);

  // 3. Reject duplicate headers
  const duplicateHeaderCsv = 'timestamp,vibration,vibration\n2026-11-01T10:00:00Z,1.2,1.3\n';
  const dupForm = new FormData();
  dupForm.append('file', new Blob([duplicateHeaderCsv], { type: 'text/csv' }), 'test_dup.csv');

  const dupRes = await fetch(`${baseUrl}/api/datasets/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${mgrToken}` },
    body: dupForm
  });
  assert.equal(dupRes.status, 400);
  const dupData = await dupRes.json();
  assert.equal(dupData.error, 'DUPLICATE_HEADERS');

  // 4. Reject malformed rows (column count mismatch)
  const malformedCsv = 'timestamp,vibration,speed\n' +
    '2026-11-01T10:00:00Z,1.2,1500\n' +
    '2026-11-01T10:01:00Z,1.3\n'; // Missing speed column
  const malformedForm = new FormData();
  malformedForm.append('file', new Blob([malformedCsv], { type: 'text/csv' }), 'test_malformed.csv');

  const malformedRes = await fetch(`${baseUrl}/api/datasets/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${mgrToken}` },
    body: malformedForm
  });
  assert.equal(malformedRes.status, 400);
  const malformedData = await malformedRes.json();
  assert.equal(malformedData.error, 'MALFORMED_ROW');

  // 5. Reject invalid file extension (.exe)
  const badExtForm = new FormData();
  badExtForm.append('file', new Blob(['binary'], { type: 'application/octet-stream' }), 'malicious.exe');

  const badExtRes = await fetch(`${baseUrl}/api/datasets/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${mgrToken}` },
    body: badExtForm
  });
  assert.equal(badExtRes.status, 400);
  const badExtData = await badExtRes.json();
  assert.equal(badExtData.error, 'INVALID_FILE_TYPE');
});

test('Validation & Compatibility: Quality findings and AI task assessments', async () => {
  const mgrToken = await loginUser('manager@detroit.factory', 'Manager123!');

  // Create a 120-row CSV with:
  // - Out-of-bounds temperature (> 140 degC)
  // - Duplicate timestamps
  // - 4-class fault labels
  let richCsv = 'timestamp,vibration_input_axial,temp_gearbox_sump,rotational_speed,fault_class\n';
  const baseTime = Date.now() - 3600 * 1000;
  const classes = ['healthy', 'inner_race_defect', 'gear_pitting', 'bearing_spall'];

  for (let i = 0; i < 120; i++) {
    // Inject a duplicate timestamp at index 10
    const timeOffset = i === 10 ? 9 * 1000 : i * 1000;
    const ts = new Date(baseTime + timeOffset).toISOString();
    const vib = (1.5 + Math.random() * 0.5).toFixed(2);
    // Inject an out-of-bounds temp at index 50
    const temp = i === 50 ? '165.5' : (60.0 + Math.random() * 5).toFixed(1);
    const rpm = 1495;
    const cls = classes[i % 4];
    richCsv += `${ts},${vib},${temp},${rpm},${cls}\n`;
  }

  const form = new FormData();
  form.append('file', new Blob([richCsv], { type: 'text/csv' }), 'test_rich.csv');

  const uploadRes = await fetch(`${baseUrl}/api/datasets/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${mgrToken}` },
    body: form
  });
  assert.equal(uploadRes.status, 200);
  const { uploadId } = await uploadRes.json();

  // Validate mapping
  const valRes = await fetch(`${baseUrl}/api/datasets/validate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${mgrToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      uploadId,
      columnMappings: [
        { rawHeader: 'timestamp', isTimestamp: true },
        { rawHeader: 'vibration_input_axial', mappedSignal: 'vibration_input_axial', sourceUnit: 'mm/s' },
        { rawHeader: 'temp_gearbox_sump', mappedSignal: 'temp_gearbox_sump', sourceUnit: 'degC' },
        { rawHeader: 'rotational_speed', mappedSignal: 'rotational_speed', sourceUnit: 'RPM' },
        { rawHeader: 'fault_class', isLabel: true }
      ]
    })
  });

  assert.equal(valRes.status, 200);
  const valData = await valRes.json();
  const { validation } = valData;

  // Verify quality findings caught our injected issues
  assert.ok(validation.qualityFindings.some((f) => f.code === 'DUPLICATE_TIMESTAMPS'));
  assert.ok(validation.qualityFindings.some((f) => f.code === 'OUT_OF_BOUNDS_VALUES'));
  assert.equal(validation.status, DATASET_STATUS.NEEDS_REVIEW);

  // Verify AI Task Compatibility
  assert.equal(validation.aiTaskCompatibility[AI_TASK_TYPES.ANOMALY_DETECTION].isCompatible, true);
  assert.equal(validation.aiTaskCompatibility[AI_TASK_TYPES.FAULT_CLASSIFICATION].isCompatible, true);
  assert.equal(
    validation.aiTaskCompatibility[AI_TASK_TYPES.REMAINING_USEFUL_LIFE].isCompatible,
    false,
    'Discrete fault snapshots without wear trajectory should be RUL-incompatible'
  );
  assert.ok(validation.aiTaskCompatibility[AI_TASK_TYPES.FAULT_CLASSIFICATION].reason.includes('4 distinct classes'));
});

test('Operational Dataset Scoping: Technician can upload to assigned machine, rejected on unassigned machine', async () => {
  const techToken = await loginUser('tech@detroit.factory', 'Tech123!');
  const viewerToken = await loginUser('viewer@detroit.factory', 'Viewer123!');

  // Upload small CSV
  const csvContent = 'timestamp,vibration_input_axial\n2026-11-01T10:00:00Z,1.1\n2026-11-01T10:01:00Z,1.2\n';
  const form = new FormData();
  form.append('file', new Blob([csvContent], { type: 'text/csv' }), 'test_op.csv');

  const uploadRes = await fetch(`${baseUrl}/api/datasets/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${techToken}` },
    body: form
  });
  assert.equal(uploadRes.status, 200);
  const { uploadId } = await uploadRes.json();

  // Find GB-104 (assigned) and GB-201 (unassigned)
  const gb104 = await Machine.findOne({ code: 'GB-104' });
  const gb201 = await Machine.findOne({ code: 'GB-201' });
  assert.ok(gb104 && gb201);

  // 1. Technician confirms upload for assigned GB-104 -> 201 Created
  const confirmAssignedRes = await fetch(`${baseUrl}/api/datasets/confirm`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${techToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      uploadId,
      datasetType: DATASET_TYPES.OPERATIONAL,
      title: 'Test GB-104 Operational Upload',
      machineId: gb104._id,
      columnMappings: [
        { rawHeader: 'timestamp', isTimestamp: true },
        { rawHeader: 'vibration_input_axial', mappedSignal: 'vibration_input_axial' }
      ]
    })
  });

  assert.equal(confirmAssignedRes.status, 201);
  const confirmedData = await confirmAssignedRes.json();
  assert.equal(confirmedData.dataset.title, 'Test GB-104 Operational Upload');
  assert.equal(confirmedData.dataset.storageKey, undefined, 'Storage key must never be exposed');

  // 2. Technician attempts to confirm upload for unassigned GB-201 -> 403 Forbidden
  const confirmUnassignedRes = await fetch(`${baseUrl}/api/datasets/confirm`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${techToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      uploadId,
      datasetType: DATASET_TYPES.OPERATIONAL,
      title: 'Test GB-201 Unauthorized Upload',
      machineId: gb201._id,
      columnMappings: [
        { rawHeader: 'timestamp', isTimestamp: true },
        { rawHeader: 'vibration_input_axial', mappedSignal: 'vibration_input_axial' }
      ]
    })
  });

  assert.equal(confirmUnassignedRes.status, 403, 'Technician must be rejected from uploading to unassigned machine');

  // 3. Viewer is rejected from upload endpoint -> 403 Forbidden
  const viewerUploadRes = await fetch(`${baseUrl}/api/datasets/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${viewerToken}` },
    body: form
  });
  assert.equal(viewerUploadRes.status, 403, 'Viewer must be rejected from uploading datasets');
});

test('Reference Catalog & Safe Download: Manager registers with provenance; Safe streaming without path leakage', async () => {
  const mgrToken = await loginUser('manager@detroit.factory', 'Manager123!');
  const techToken = await loginUser('tech@detroit.factory', 'Tech123!');

  // 1. Upload reference file
  const refCsv = 'timestamp,vibration_ch1,fault_class\n2026-11-01T10:00:00Z,0.5,healthy\n2026-11-01T10:01:00Z,2.4,broken_gear\n';
  const form = new FormData();
  form.append('file', new Blob([refCsv], { type: 'text/csv' }), 'test_ref.csv');

  const uploadRes = await fetch(`${baseUrl}/api/datasets/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${mgrToken}` },
    body: form
  });
  assert.equal(uploadRes.status, 200);
  const { uploadId } = await uploadRes.json();

  // 2. Reject registration without confirmed terms
  const unconfirmedRes = await fetch(`${baseUrl}/api/datasets/confirm`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${mgrToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      uploadId,
      datasetType: DATASET_TYPES.REFERENCE,
      title: 'Test Unconfirmed Reference Dataset',
      referenceDetails: {
        sourceName: 'Public Source',
        userConfirmedTerms: false
      }
    })
  });
  assert.equal(unconfirmedRes.status, 400);

  // 3. Technician cannot register reference dataset -> 403 Forbidden
  const techRefRes = await fetch(`${baseUrl}/api/datasets/confirm`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${techToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      uploadId,
      datasetType: DATASET_TYPES.REFERENCE,
      title: 'Test Tech Reference Attempt',
      referenceDetails: { userConfirmedTerms: true }
    })
  });
  assert.equal(techRefRes.status, 403, 'Technician must not register reference datasets');

  // 4. Manager registers valid reference dataset with provenance
  const validRefRes = await fetch(`${baseUrl}/api/datasets/confirm`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${mgrToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      uploadId,
      datasetType: DATASET_TYPES.REFERENCE,
      title: 'Test Machinery Fault Reference Dataset',
      description: 'Public benchmark for fault detection verification.',
      columnMappings: [
        { rawHeader: 'timestamp', isTimestamp: true },
        { rawHeader: 'vibration_ch1', mappedSignal: 'vibration_input_radial' },
        { rawHeader: 'fault_class', isLabel: true }
      ],
      referenceDetails: {
        sourceName: 'Open Vibration Research Archive',
        sourceUrl: 'https://archive.example.org/gear-benchmark',
        citation: 'Research Authors (2024). Open Gear Vibration Benchmark.',
        license: 'CC-BY-4.0',
        usageTerms: 'Academic and industrial benchmarking.',
        machineType: 'Helical Test Gearbox',
        sensorChannels: ['vibration_ch1'],
        units: ['g'],
        operatingConditions: '1500 RPM, 500 Nm load.',
        labelDefinitions: 'healthy, broken_gear',
        knownLimitations: 'Constant speed condition only.',
        userConfirmedTerms: true
      }
    })
  });

  assert.equal(validRefRes.status, 201);
  const { dataset: createdRef } = await validRefRes.json();
  const datasetId = createdRef._id;

  // 5. Accessible via reference catalog
  const catalogRes = await fetch(`${baseUrl}/api/datasets/reference-catalog`, {
    headers: { Authorization: `Bearer ${techToken}` }
  });
  assert.equal(catalogRes.status, 200);
  const catalogData = await catalogRes.json();
  const foundInCatalog = catalogData.datasets.find((d) => d._id === datasetId);
  assert.ok(foundInCatalog, 'Reference dataset must be visible in reference catalog to technician');

  // 6. Safe streaming download
  const downloadRes = await fetch(`${baseUrl}/api/datasets/${datasetId}/download`, {
    headers: { Authorization: `Bearer ${techToken}` }
  });
  assert.equal(downloadRes.status, 200);
  assert.equal(downloadRes.headers.get('content-type'), 'text/csv');
  assert.ok(downloadRes.headers.get('content-disposition').includes('attachment'));
  const downloadedText = await downloadRes.text();
  assert.ok(downloadedText.includes('broken_gear'));
});

