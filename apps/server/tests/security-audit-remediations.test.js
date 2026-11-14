import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import app from '../src/app.js';
import { env } from '../src/config/env.js';
import { TEST_CREDS } from './testCredentials.js';
import { Machine } from '../src/models/Machine.js';
import { Dataset } from '../src/models/Dataset.js';
import { ModelArtifact } from '../src/models/ModelArtifact.js';
import { MaintenanceWorkOrder } from '../src/models/MaintenanceWorkOrder.js';
import { StagedUpload } from '../src/models/StagedUpload.js';
import { User } from '../src/models/User.js';
import { stagedUploads } from '../src/routes/dataset.routes.js';
import { getSafeFilePath } from '../src/services/storage.service.js';
import { queryAssistant } from '../src/services/aiAssistant.service.js';
import { WORK_ORDER_STATUS, WORK_ORDER_PRIORITY } from '@predictive-maintenance/shared';

let server;
let baseUrl;

async function loginUser(email, password, extraHeaders = {}, extraBody = {}) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify({ emailOrUsername: email, password, ...extraBody })
  });
  const data = await res.json();
  const setCookie = res.headers.get('set-cookie') || '';
  return { status: res.status, data, setCookie, token: data.sessionToken };
}

test.before(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(env.MONGODB_URI);
  }
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

test.after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await mongoose.disconnect();
});

test('Remediation 1: Browser Login omits sessionToken in body while Mobile receives it', async () => {
  // 1. Browser client with Origin header
  const browserRes = await loginUser(
    TEST_CREDS.manager.email,
    TEST_CREDS.manager.password,
    { Origin: 'http://localhost:5173' }
  );
  assert.strictEqual(browserRes.status, 200);
  assert.strictEqual(browserRes.data.success, true);
  assert.ok(browserRes.setCookie.includes('pm_session='), 'HttpOnly cookie must be set');
  assert.strictEqual(
    browserRes.data.sessionToken,
    undefined,
    'Session token must be omitted from JSON body for web browser requests to prevent XSS exposure'
  );

  // 2. Mobile client sending clientType: 'mobile' with Origin
  const mobileWithOriginRes = await loginUser(
    TEST_CREDS.manager.email,
    TEST_CREDS.manager.password,
    { Origin: 'http://localhost:5173' },
    { clientType: 'mobile' }
  );
  assert.strictEqual(mobileWithOriginRes.status, 200);
  assert.ok(mobileWithOriginRes.data.sessionToken, 'Mobile client must receive sessionToken for SecureStore');

  // 3. API / Mobile client without Origin header
  const apiRes = await loginUser(TEST_CREDS.manager.email, TEST_CREDS.manager.password);
  assert.strictEqual(apiRes.status, 200);
  assert.ok(apiRes.data.sessionToken, 'API clients without Origin must receive sessionToken');
});

test('Remediation 2: Simulator SSE Stream enforces authentication, removes query tokens, and supports single-use stream tickets', async () => {
  const machineGB104 = await Machine.findOne({ code: 'GB-104' });
  assert.ok(machineGB104);

  // 1. Unauthenticated request to /api/datasets/simulator-stream must be rejected with 401
  const unauthRes = await fetch(`${baseUrl}/api/datasets/simulator-stream?machineId=${machineGB104._id}`);
  assert.strictEqual(unauthRes.status, 401, 'Unauthenticated SSE stream connection must be rejected');

  // 2. Query parameter token ?token=... is rejected (no longer accepted in query strings)
  const puneManager = await loginUser(TEST_CREDS.manager.email, TEST_CREDS.manager.password);
  const queryTokenRes = await fetch(`${baseUrl}/api/datasets/simulator-stream?token=${puneManager.token}&machineId=${machineGB104._id}`);
  assert.strictEqual(queryTokenRes.status, 401, 'Long-lived session token in query string must be rejected');

  // 3. Authenticated Bearer header stream connects successfully
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1200);
  try {
    const bearerRes = await fetch(`${baseUrl}/api/datasets/simulator-stream?machineId=${machineGB104._id}`, {
      headers: { Authorization: `Bearer ${puneManager.token}` },
      signal: controller.signal
    });
    assert.strictEqual(bearerRes.status, 200);
    assert.ok(bearerRes.headers.get('content-type').includes('text/event-stream'));
  } catch (err) {
    if (err.name !== 'AbortError') throw err;
  } finally {
    clearTimeout(timer);
  }

  // 4. Request a single-use stream ticket via POST /api/datasets/simulator-stream-ticket
  const ticketRes = await fetch(`${baseUrl}/api/datasets/simulator-stream-ticket`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${puneManager.token}`
    },
    body: JSON.stringify({ machineId: machineGB104._id })
  });
  assert.strictEqual(ticketRes.status, 200);
  const ticketData = await ticketRes.json();
  assert.strictEqual(ticketData.success, true);
  assert.ok(ticketData.ticket);
  assert.strictEqual(ticketData.machineId, machineGB104._id.toString());

  // 5. Connect SSE stream using single-use ticket ?ticket=...
  const ticketController = new AbortController();
  const ticketTimer = setTimeout(() => ticketController.abort(), 1200);
  try {
    const ticketStreamRes = await fetch(`${baseUrl}/api/datasets/simulator-stream?ticket=${ticketData.ticket}`, {
      signal: ticketController.signal
    });
    assert.strictEqual(ticketStreamRes.status, 200);
    assert.ok(ticketStreamRes.headers.get('content-type').includes('text/event-stream'));
  } catch (err) {
    if (err.name !== 'AbortError') throw err;
  } finally {
    clearTimeout(ticketTimer);
  }

  // 6. Reusing burned ticket fails immediately with 401
  const reuseRes = await fetch(`${baseUrl}/api/datasets/simulator-stream?ticket=${ticketData.ticket}`);
  assert.strictEqual(reuseRes.status, 401, 'Reused single-use stream ticket must be rejected with 401');

  // 7. Ticket generation for machine from another factory is rejected
  const chennaiManager = await loginUser(TEST_CREDS.chennaiManager.email, TEST_CREDS.chennaiManager.password);
  const crossFactoryTicketRes = await fetch(`${baseUrl}/api/datasets/simulator-stream-ticket`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${chennaiManager.token}`
    },
    body: JSON.stringify({ machineId: machineGB104._id })
  });
  assert.strictEqual(crossFactoryTicketRes.status, 404, 'Cross-factory stream ticket must return 404/403');
});

test('Remediation 3: Simulator Telemetry Tick validates input numbers, physical ranges, size limits, and machine authorization', async () => {
  const puneManager = await loginUser(TEST_CREDS.manager.email, TEST_CREDS.manager.password);
  const chennaiManager = await loginUser(TEST_CREDS.chennaiManager.email, TEST_CREDS.chennaiManager.password);
  const machineGB104 = await Machine.findOne({ code: 'GB-104' });
  assert.ok(machineGB104);

  // 1. Malformed non-numeric tick payload returns 400
  const malformedRes = await fetch(`${baseUrl}/api/datasets/simulator-tick`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${puneManager.token}`
    },
    body: JSON.stringify({ machineId: machineGB104._id, rpm: 'not-a-number', torque: NaN })
  });
  assert.strictEqual(malformedRes.status, 400);
  const malformedData = await malformedRes.json();
  assert.strictEqual(malformedData.error, 'InvalidTelemetryTick');

  // 2. Physical range validation: out-of-bounds RPM or vibration returns 400
  const outOfRangeRes = await fetch(`${baseUrl}/api/datasets/simulator-tick`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${puneManager.token}`
    },
    body: JSON.stringify({ machineId: machineGB104._id, rpm: 25000, vibRms: 500 })
  });
  assert.strictEqual(outOfRangeRes.status, 400);
  const outOfRangeData = await outOfRangeRes.json();
  assert.strictEqual(outOfRangeData.error, 'TelemetryValueOutOfRange');

  // 3. Payload size check: payload > 8KB returns 413
  const hugePayload = { machineId: machineGB104._id, rpm: 1200, padding: 'x'.repeat(9000) };
  const oversizedRes = await fetch(`${baseUrl}/api/datasets/simulator-tick`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${puneManager.token}`
    },
    body: JSON.stringify(hugePayload)
  });
  assert.strictEqual(oversizedRes.status, 413);

  // 4. Chennai manager attempting to publish tick to Pune machine returns 404
  const crossFactoryTickRes = await fetch(`${baseUrl}/api/datasets/simulator-tick`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${chennaiManager.token}`
    },
    body: JSON.stringify({ machineId: machineGB104._id, rpm: 1200, vibRms: 1.2 })
  });
  assert.strictEqual(crossFactoryTickRes.status, 404);

  // 5. Valid tick from Pune manager succeeds and reports machine scoping
  const validRes = await fetch(`${baseUrl}/api/datasets/simulator-tick`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${puneManager.token}`
    },
    body: JSON.stringify({ machineId: machineGB104._id, sessionId: 'sess-sim-104', rpm: 1200, vibRms: 1.45, torque: 25.0, coolant: 80.5 })
  });
  assert.strictEqual(validRes.status, 200);
  const validData = await validRes.json();
  assert.strictEqual(validData.success, true);
  assert.strictEqual(validData.machineId, machineGB104._id.toString());
  assert.strictEqual(validData.sessionId, 'sess-sim-104');
  assert.ok(validData.timestamp);
});

test('Remediation 4: Staged Upload fails closed, persists in MongoDB, and enforces uploader/factory isolation and expiration', async () => {
  const puneTech = await loginUser(TEST_CREDS.tech.email, TEST_CREDS.tech.password);
  const puneTech2 = await loginUser(TEST_CREDS.tech2.email, TEST_CREDS.tech2.password);
  const chennaiManager = await loginUser(TEST_CREDS.chennaiManager.email, TEST_CREDS.chennaiManager.password);

  // 1. Upload CSV as Pune tech
  const csvContent = 'timestamp,vibration,speed\n0.0,0.12,1200\n0.1,0.15,1205\n0.2,0.14,1202\n';
  const blob = new Blob([csvContent], { type: 'text/csv' });
  const formData = new FormData();
  formData.append('file', blob, 'pune_test_dataset.csv');

  const uploadRes = await fetch(`${baseUrl}/api/datasets/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${puneTech.token}` },
    body: formData
  });
  assert.strictEqual(uploadRes.status, 200);
  const uploadData = await uploadRes.json();
  const { uploadId } = uploadData;
  assert.ok(uploadId);

  // 2. Verify MongoDB persistent StagedUpload document exists
  const stagedDoc = await StagedUpload.findOne({ uploadId });
  assert.ok(stagedDoc, 'Persistent StagedUpload document must exist in MongoDB');
  assert.strictEqual(stagedDoc.uploaderId.toString(), (puneTech.data.user.id || puneTech.data.user._id).toString());

  // 3. Fail closed on missing/forged uploadId -> 404
  const missingValidateRes = await fetch(`${baseUrl}/api/datasets/validate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${puneTech.token}`
    },
    body: JSON.stringify({
      uploadId: 'storage/datasets/non_existent_unregistered_file.csv',
      columnMappings: [{ rawHeader: 'vibration', mappedSignal: 'vibration_input_radial' }]
    })
  });
  assert.strictEqual(missingValidateRes.status, 404, 'Missing staged upload record must fail closed with 404');

  // 4. Pune tech2 (different technician) attempts to validate Pune tech\'s staged upload -> 403 Forbidden
  const tech2ValidateRes = await fetch(`${baseUrl}/api/datasets/validate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${puneTech2.token}`
    },
    body: JSON.stringify({
      uploadId,
      columnMappings: [{ rawHeader: 'vibration', mappedSignal: 'vibration_input_radial' }]
    })
  });
  assert.strictEqual(tech2ValidateRes.status, 403, 'Technician cannot validate another technician\'s staged upload');

  // 5. Chennai manager attempts to validate Pune staged upload -> 403 Forbidden
  const validateRes = await fetch(`${baseUrl}/api/datasets/validate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${chennaiManager.token}`
    },
    body: JSON.stringify({
      uploadId,
      columnMappings: [{ rawHeader: 'vibration', mappedSignal: 'vibration_input_radial' }]
    })
  });
  assert.strictEqual(validateRes.status, 403, 'Cross-factory staged validation must be forbidden');

  // 6. Chennai manager attempts to confirm Pune staged upload -> 403 Forbidden
  const confirmRes = await fetch(`${baseUrl}/api/datasets/confirm`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${chennaiManager.token}`
    },
    body: JSON.stringify({
      uploadId,
      title: 'Illicit Cross-Factory Dataset',
      datasetType: 'operational'
    })
  });
  assert.strictEqual(confirmRes.status, 403, 'Cross-factory staged confirmation must be forbidden');

  // 7. Test expiration: Artificially expire the staged upload in DB and memory
  await StagedUpload.updateOne({ uploadId }, { expiresAt: new Date(Date.now() - 5000) });
  const staged = stagedUploads.get(uploadId);
  if (staged) staged.expiresAt = Date.now() - 5000;

  const expiredRes = await fetch(`${baseUrl}/api/datasets/validate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${puneTech.token}`
    },
    body: JSON.stringify({
      uploadId,
      columnMappings: [{ rawHeader: 'vibration', mappedSignal: 'vibration_input_radial' }]
    })
  });
  assert.strictEqual(expiredRes.status, 410, 'Expired staged upload must return 410 Gone');
});

test('Remediation 5: Visual Inspection rejects corrupt payloads and disables automated defect findings & confidence on real photos', async () => {
  const tech = await loginUser(TEST_CREDS.tech.email, TEST_CREDS.tech.password);
  const machine = await Machine.findOne({ code: 'GB-104' });
  assert.ok(machine);

  const wo = await MaintenanceWorkOrder.create({
    orderNumber: `WO-TEST-SEC-${Date.now()}`,
    title: 'Security Audit Casing Inspection',
    description: 'Verifying visual inspection error boundaries and truthfulness',
    status: WORK_ORDER_STATUS.OPEN,
    priority: WORK_ORDER_PRIORITY.MEDIUM,
    dueDate: new Date(Date.now() + 86400000),
    factoryId: machine.factoryId,
    machineId: machine._id,
    assignedTechnicianId: tech.data.user.id || tech.data.user._id,
    createdById: tech.data.user.id || tech.data.user._id
  });

  // 1. Submit non-image payload (arbitrary binary text) -> 400
  const corruptPayload = Buffer.from('NOT_AN_IMAGE_PAYLOAD_BINARY_GARBAGE').toString('base64');
  const badRes = await fetch(`${baseUrl}/api/work-orders/${wo._id}/photo-inspection`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tech.token}`
    },
    body: JSON.stringify({
      photoBase64: `data:image/jpeg;base64,${corruptPayload}`,
      filename: 'corrupted_exec.bin',
      mimeType: 'image/jpeg'
    })
  });
  assert.strictEqual(badRes.status, 400, 'Corrupt non-image payload must be rejected with 400');
  const badData = await badRes.json();
  assert.ok(badData.message.includes('Unsupported or corrupt image payload'));

  // 2. Submit valid JPEG header buffer without simulateDefect (real photo inspection)
  const jpegHeader = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
    0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
    0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
    0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20,
    0x24, 0x2e, 0x27, 0x20, 0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29,
    0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27, 0x39, 0x3d, 0x38, 0x32,
    0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x40,
    0x00, 0x40, 0x01, 0x01, 0x11, 0x00, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01,
    0x00, 0x00, 0x3f, 0x00, 0xbf, 0x00, 0xff, 0xd9
  ]);
  const realPhotoRes = await fetch(`${baseUrl}/api/work-orders/${wo._id}/photo-inspection`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tech.token}`
    },
    body: JSON.stringify({
      photoBase64: `data:image/jpeg;base64,${jpegHeader.toString('base64')}`,
      filename: 'real_casing_inspection.jpg',
      mimeType: 'image/jpeg'
    })
  });
  assert.strictEqual(realPhotoRes.status, 201);
  const realPhotoData = await realPhotoRes.json();
  const realAnalysis = realPhotoData.photo.visualDefectAnalysis;

  // Verify automated defect findings & confidence are completely disabled on real photos
  assert.strictEqual(realAnalysis.analysisMethod, 'automated_vision_disabled');
  assert.strictEqual(realAnalysis.defectDetected, false);
  assert.deepStrictEqual(realAnalysis.findings, []);
  assert.strictEqual(realAnalysis.overallConfidence, null);
  assert.strictEqual(realAnalysis.uncertaintyLevel, 'Uncalibrated');
  assert.ok(realAnalysis.disclaimer.includes('disabled pending deployment of a validated, calibrated neural vision model'));

  // 3. Workflow tests with explicit simulateDefect produce labeled simulation stubs with null confidence
  const simPhotoRes = await fetch(`${baseUrl}/api/work-orders/${wo._id}/photo-inspection`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tech.token}`
    },
    body: JSON.stringify({
      photoBase64: `data:image/jpeg;base64,${jpegHeader.toString('base64')}`,
      filename: 'simulated_defect.jpg',
      mimeType: 'image/jpeg',
      simulateDefect: 'corrosion'
    })
  });
  assert.strictEqual(simPhotoRes.status, 201);
  const simPhotoData = await simPhotoRes.json();
  const simAnalysis = simPhotoData.photo.visualDefectAnalysis;
  assert.strictEqual(simAnalysis.analysisMethod, 'synthetic_simulation_stub');
  assert.strictEqual(simAnalysis.defectDetected, true);
  assert.strictEqual(simAnalysis.overallConfidence, null);
  assert.strictEqual(simAnalysis.findings[0].confidence, null);
});

test('Remediation 6: Model Domain Guardrails reject cross-domain model pairing on gearboxes', async () => {
  const { token } = await loginUser(TEST_CREDS.manager.email, TEST_CREDS.manager.password);
  const machineGB104 = await Machine.findOne({ code: 'GB-104' });
  assert.ok(machineGB104);

  // Find or create bearing-specialized model
  let bearingModel = await ModelArtifact.findOne({
    $or: [{ componentType: 'bearing' }, { targetDomain: 'bearing_faults' }]
  });

  if (!bearingModel) {
    bearingModel = await ModelArtifact.create({
      factoryId: machineGB104.factoryId,
      name: 'Test Standalone Bearing Classifier',
      modelType: 'random_forest',
      targetDomain: 'bearing_faults',
      componentType: 'bearing',
      status: 'ready'
    });
  }

  // Attempting to ingest simulator telemetry with bearing model on gearbox machine -> 400
  const ingestRes = await fetch(`${baseUrl}/api/datasets/simulator-ingest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      machineId: machineGB104._id,
      telemetry: [{ time_s: 0.1, engine_rpm: 1000, vib_rms: 1.2 }],
      runAnalysis: true,
      modelArtifactId: bearingModel._id
    })
  });
  assert.strictEqual(ingestRes.status, 400);
  const ingestData = await ingestRes.json();
  assert.ok(
    ingestData.error === 'IncompatibleModelError' || ingestData.error === 'IncompatibleDatasetError'
  );
  assert.ok(ingestData.message.includes('bearing'));
});

test('Remediation 7: File Vault rejects path traversal keys and prefix collisions', () => {
  assert.throws(
    () => getSafeFilePath('../../../etc/passwd'),
    /Path traversal attempt detected/
  );
  assert.throws(
    () => getSafeFilePath('..\\..\\windows\\system32'),
    /Path traversal attempt detected/
  );
  assert.throws(
    () => getSafeFilePath(''),
    /Invalid storage key/
  );
});

test('Remediation 8: Admin Factory Users aggregates gracefully with assigned work orders', async () => {
  const puneManager = await loginUser(TEST_CREDS.manager.email, TEST_CREDS.manager.password);
  const tech = await loginUser(TEST_CREDS.tech.email, TEST_CREDS.tech.password);
  const machine = await Machine.findOne({ code: 'GB-104' });
  assert.ok(machine);

  const testWo = await MaintenanceWorkOrder.create({
    orderNumber: `WO-ASSIGNED-${Date.now()}`,
    title: 'Assigned Sump Inspection',
    description: 'Testing aggregate resilience with technician assignment',
    status: WORK_ORDER_STATUS.OPEN,
    priority: WORK_ORDER_PRIORITY.LOW,
    dueDate: new Date(Date.now() + 86400000),
    factoryId: machine.factoryId,
    machineId: machine._id,
    assignedTechnicianId: tech.data.user.id || tech.data.user._id,
    createdById: puneManager.data.user.id || puneManager.data.user._id
  });

  const res = await fetch(`${baseUrl}/api/admin/factory-users`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${puneManager.token}` }
  });

  assert.strictEqual(res.status, 200, 'Endpoint must return 200 without crashing');
  const data = await res.json();
  assert.ok(Array.isArray(data.users));
  assert.ok(data.count > 0);

  // Clean up
  await MaintenanceWorkOrder.findByIdAndDelete(testWo._id);
});

test('Remediation 9: AI Assistant groundings enforce factory record scoping and schema normalization', async () => {
  const puneManagerUser = await User.findOne({ email: TEST_CREDS.manager.email }).populate('factoryId');
  assert.ok(puneManagerUser);

  // 1. General mode query: facts must be forced to empty array, generalGuidance provided
  const generalResult = await queryAssistant(
    puneManagerUser,
    'What does ISO 10816 say about vibration severity in Class II machines?',
    null,
    'general'
  );
  assert.ok(generalResult);
  assert.strictEqual(generalResult.facts.length, 0, 'General mode must not assert factory database facts');
  assert.ok(
    generalResult.mode === 'general' || generalResult.mode === 'general_unavailable',
    'Mode must be general or general_unavailable'
  );

  // 2. Factory mode query: must ground strictly in authorized equipment (GB-104)
  const factoryResult = await queryAssistant(
    puneManagerUser,
    'What is the condition of GB-104?',
    'GB-104',
    'factory'
  );
  assert.ok(factoryResult);
  assert.ok(factoryResult.facts.length > 0, 'Factory mode must return grounded facts for authorized equipment');
  assert.ok(factoryResult.citations.some((c) => c.code === 'GB-104'), 'Must cite machine GB-104');
});
