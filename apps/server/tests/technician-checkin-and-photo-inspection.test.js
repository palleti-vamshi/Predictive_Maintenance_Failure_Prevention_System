import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import app from '../src/app.js';
import { env } from '../src/config/env.js';
import { TEST_CREDS } from './testCredentials.js';
import { MaintenanceWorkOrder } from '../src/models/MaintenanceWorkOrder.js';
import { Machine } from '../src/models/Machine.js';
import { User } from '../src/models/User.js';
import { WORK_ORDER_STATUS, WORK_ORDER_PRIORITY } from '@predictive-maintenance/shared';

let server;
let baseUrl;

async function loginUser(email, password) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emailOrUsername: email, password })
  });
  assert.strictEqual(res.status, 200, `Login failed for ${email}`);
  const data = await res.json();
  return { token: data.sessionToken, user: data.user };
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

test('Technician Check-In: Scoped GPS Check-In requires explicit consent and records coordinates', async (t) => {
  const tech = await loginUser(TEST_CREDS.tech.email, TEST_CREDS.tech.password);
  const machine = await Machine.findOne({ code: 'GB-104' });
  assert.ok(machine, 'Machine GB-104 should exist');

  // Find or create an open work order assigned to this technician
  let wo = await MaintenanceWorkOrder.findOne({
    machineId: machine._id,
    assignedTechnicianId: tech.user._id,
    status: WORK_ORDER_STATUS.OPEN
  });

  if (!wo) {
    wo = await MaintenanceWorkOrder.create({
      factoryId: machine.factoryId,
      machineId: machine._id,
      orderNumber: `WO-CHECKIN-${Date.now().toString().slice(-4)}`,
      title: 'Vibration Transducer Inspection',
      description: 'Check radial transducer mount torque and casing integrity.',
      priority: WORK_ORDER_PRIORITY.HIGH,
      status: WORK_ORDER_STATUS.OPEN,
      dueDate: new Date(Date.now() + 86400000),
      assignedTechnicianId: tech.user._id,
      createdById: tech.user._id,
      statusHistory: [{
        status: WORK_ORDER_STATUS.OPEN,
        changedById: tech.user._id,
        changedByName: tech.user.fullName,
        changedByRole: tech.user.role,
        timestamp: new Date(),
        note: 'Test work order created'
      }]
    });
  }

  // 1. Attempt GPS check-in without consent -> Must fail with 400 ConsentRequired
  const noConsentRes = await fetch(`${baseUrl}/api/work-orders/${wo._id}/check-in`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tech.token}` },
    body: JSON.stringify({
      method: 'gps',
      coordinates: { latitude: 18.7512, longitude: 73.8123, accuracyMeters: 8.5 },
      consentAcknowledged: false
    })
  });
  assert.strictEqual(noConsentRes.status, 400);
  const noConsentData = await noConsentRes.json();
  assert.strictEqual(noConsentData.error, 'ConsentRequired');

  // 2. Perform GPS check-in with explicit consent -> Must succeed with 200
  const gpsRes = await fetch(`${baseUrl}/api/work-orders/${wo._id}/check-in`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tech.token}` },
    body: JSON.stringify({
      method: 'gps',
      coordinates: { latitude: 18.7512, longitude: 73.8123, accuracyMeters: 8.5 },
      consentAcknowledged: true,
      verificationNote: 'Arrived at Chakan Plant Bay 4 extruder drive bay.'
    })
  });
  assert.strictEqual(gpsRes.status, 200);
  const gpsData = await gpsRes.json();
  assert.strictEqual(gpsData.success, true);
  assert.strictEqual(gpsData.checkIn.method, 'gps');
  assert.strictEqual(gpsData.checkIn.consentAcknowledged, true);
  assert.strictEqual(gpsData.checkIn.coordinates.latitude, 18.7512);
  assert.strictEqual(gpsData.workOrderStatus, WORK_ORDER_STATUS.IN_PROGRESS);

  // 3. Perform manual bay check-in alternative
  const manualRes = await fetch(`${baseUrl}/api/work-orders/${wo._id}/check-in`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tech.token}` },
    body: JSON.stringify({
      method: 'manual',
      bayIdentifier: 'Extruder Bay 4-North',
      verificationNote: 'Manual barcode scan on control cabinet.'
    })
  });
  assert.strictEqual(manualRes.status, 200);
  const manualData = await manualRes.json();
  assert.strictEqual(manualData.success, true);
  assert.strictEqual(manualData.checkIn.method, 'manual');
  assert.strictEqual(manualData.checkIn.bayIdentifier, 'Extruder Bay 4-North');
});

test('Inspection Photo & CV Assistance: Analyzes casing photo, returns bounded findings and handles feedback', async (t) => {
  const tech = await loginUser(TEST_CREDS.tech.email, TEST_CREDS.tech.password);
  const machine = await Machine.findOne({ code: 'GB-104' });
  const wo = await MaintenanceWorkOrder.findOne({
    machineId: machine._id,
    assignedTechnicianId: tech.user._id
  });
  assert.ok(wo, 'Should find work order for photo upload');

  // Generate test JPEG binary payload
  const jpegHeader = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
    0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
    0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
    0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20,
    0x24, 0x2e, 0x27, 0x20, 0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29,
    0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27, 0x39, 0x3d, 0x38, 0x32,
    0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
    0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00,
    0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
    0x09, 0x0a, 0x0b, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f,
    0x00, 0xbf, 0x00, 0xff, 0xd9
  ]);
  const photoBase64 = `data:image/jpeg;base64,${jpegHeader.toString('base64')}`;

  // 1. Upload photo with simulated defect
  const photoRes = await fetch(`${baseUrl}/api/work-orders/${wo._id}/photo-inspection`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tech.token}` },
    body: JSON.stringify({
      photoBase64,
      filename: 'extruder_casing_inspection.jpg',
      mimeType: 'image/jpeg',
      simulateDefect: 'corrosion'
    })
  });
  assert.strictEqual(photoRes.status, 201);
  const photoData = await photoRes.json();
  assert.strictEqual(photoData.success, true);
  assert.ok(photoData.photo.visualDefectAnalysis.defectDetected);
  assert.ok(photoData.photo.visualDefectAnalysis.disclaimer.includes('CANNOT diagnose internal gearbox, bearing, or gear-tooth health'));
  assert.strictEqual(photoData.photo.technicianFeedback.status, 'pending');

  const photoIndex = photoData.photoIndex;

  // 2. Submit technician confirmation feedback
  const confirmRes = await fetch(`${baseUrl}/api/work-orders/${wo._id}/photo-inspection/${photoIndex}/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tech.token}` },
    body: JSON.stringify({
      status: 'confirmed',
      feedbackNote: 'Confirmed minor surface oxidation on lower casing flange during physical visual check.'
    })
  });
  assert.strictEqual(confirmRes.status, 200);
  const confirmData = await confirmRes.json();
  assert.strictEqual(confirmData.success, true);
  assert.strictEqual(confirmData.technicianFeedback.status, 'confirmed');

  // 3. Submit alternative rejection feedback
  const rejectRes = await fetch(`${baseUrl}/api/work-orders/${wo._id}/photo-inspection/${photoIndex}/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tech.token}` },
    body: JSON.stringify({
      status: 'rejected',
      feedbackNote: 'Discolored surface was primer overspray, not active corrosion.'
    })
  });
  assert.strictEqual(rejectRes.status, 200);
  const rejectData = await rejectRes.json();
  assert.strictEqual(rejectData.technicianFeedback.status, 'rejected');
});

test('Manager Work Order Approval: Approves AI draft proposal with strict human approval boundary', async (t) => {
  const manager = await loginUser(TEST_CREDS.manager.email, TEST_CREDS.manager.password);
  const techUser = await User.findOne({ username: 'tech_pune' });
  assert.ok(techUser, 'tech_pune must exist');

  const draftPayload = {
    machineCode: 'GB-104',
    title: 'Precision Shaft Bearing Alignment and Sump Flush',
    description: 'Inspect input pinion bearing radial runout and replenish synthetic lubricant.',
    priority: WORK_ORDER_PRIORITY.HIGH,
    assignedTechnicianId: techUser._id.toString(),
    dueDate: new Date(Date.now() + 172800000).toISOString(),
    managerNotes: 'Approved per predictive vibration anomaly findings.'
  };

  // 1. Technician attempting manager approval -> 403 Forbidden
  const tech = await loginUser(TEST_CREDS.tech.email, TEST_CREDS.tech.password);
  const unauthRes = await fetch(`${baseUrl}/api/assistant/approve-draft-work-order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tech.token}` },
    body: JSON.stringify(draftPayload)
  });
  assert.strictEqual(unauthRes.status, 403);

  // 2. Manager approves and issues work order -> 201 Created
  const approveRes = await fetch(`${baseUrl}/api/assistant/approve-draft-work-order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${manager.token}` },
    body: JSON.stringify(draftPayload)
  });
  assert.strictEqual(approveRes.status, 201);
  const approveData = await approveRes.json();
  assert.strictEqual(approveData.success, true);
  assert.ok(approveData.workOrder.orderNumber.startsWith('WO-GB-104-'));
  assert.strictEqual(approveData.workOrder.status, WORK_ORDER_STATUS.OPEN);
  assert.strictEqual(approveData.workOrder.assignedTechnicianId.toString(), techUser._id.toString());
});

test('Simulator SSE Stream: Connects to live stream and receives broadcasted ticks', async (t) => {
  const manager = await loginUser(TEST_CREDS.manager.email, TEST_CREDS.manager.password);

  // Broadcast a tick via POST /api/datasets/simulator-tick
  const tickPayload = {
    rpm: 1024,
    vibRms: 2.14,
    torque: 32.5,
    coolant: 83.2,
    running: true
  };

  const tickRes = await fetch(`${baseUrl}/api/datasets/simulator-tick`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${manager.token}` },
    body: JSON.stringify(tickPayload)
  });
  assert.strictEqual(tickRes.status, 200);
  const tickData = await tickRes.json();
  assert.strictEqual(tickData.success, true);
  assert.ok(tickData.timestamp);
});
