import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app.js';
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { Site, Machine, MaintenanceWorkOrder } from '../src/models/index.js';

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

  // Guarantee clean slate for test-created items
  await Site.deleteMany({ code: { $in: ['ASY_BAY_3', 'TECH_BAY'] } });
  await Machine.deleteMany({ code: { $in: ['GB-305', 'GB-401', 'GB-BAD', 'GB-CROSS'] } });
  await MaintenanceWorkOrder.deleteMany({
    title: /Inspect Intermediate Planet Carrier Bearings|Unassigned Gearbox Task/
  });

  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

test.after(async () => {
  await Site.deleteMany({ code: { $in: ['ASY_BAY_3', 'TECH_BAY'] } });
  await Machine.deleteMany({ code: { $in: ['GB-305', 'GB-401', 'GB-BAD', 'GB-CROSS'] } });
  await MaintenanceWorkOrder.deleteMany({
    title: /Inspect Intermediate Planet Carrier Bearings|Unassigned Gearbox Task/
  });

  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await mongoose.disconnect();
});

test('Site CRUD: Manager can create, read, update, and archive factory sites', async () => {
  const mgrToken = await loginUser('manager@detroit.factory', 'Manager123!');

  // 1. Create a new site
  const createRes = await fetch(`${baseUrl}/api/sites`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${mgrToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: 'Assembly Bay 3',
      code: 'ASY_BAY_3',
      area: 'Final Powertrain Assembly',
      description: 'End-of-line transmission testing and assembly'
    })
  });

  assert.equal(createRes.status, 201);
  const createData = await createRes.json();
  assert.equal(createData.site.code, 'ASY_BAY_3');
  const siteId = createData.site._id;

  // 2. Reject duplicate code in same factory
  const duplicateRes = await fetch(`${baseUrl}/api/sites`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${mgrToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: 'Another Bay',
      code: 'ASY_BAY_3'
    })
  });
  assert.equal(duplicateRes.status, 409, 'Duplicate site code in factory must return 409 Conflict');

  // 3. Update site
  const updateRes = await fetch(`${baseUrl}/api/sites/${siteId}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${mgrToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      description: 'Updated transmission assembly description'
    })
  });
  assert.equal(updateRes.status, 200);

  // 4. Archive site (empty site)
  const archiveRes = await fetch(`${baseUrl}/api/sites/${siteId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${mgrToken}` }
  });
  assert.equal(archiveRes.status, 200);

  // 5. Technician is rejected from creating a site
  const techToken = await loginUser('tech@detroit.factory', 'Tech123!');
  const techCreateRes = await fetch(`${baseUrl}/api/sites`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${techToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ name: 'Tech Bay', code: 'TECH_BAY' })
  });
  assert.equal(techCreateRes.status, 403, 'Technician must be rejected from site creation with 403 Forbidden');
});

test('Gearbox Machine CRUD: Manager can create with stages and soft-decommission', async () => {
  const mgrToken = await loginUser('manager@detroit.factory', 'Manager123!');

  // Get existing site
  const sitesRes = await fetch(`${baseUrl}/api/sites`, {
    headers: { Authorization: `Bearer ${mgrToken}` }
  });
  const { sites } = await sitesRes.json();
  const targetSite = sites[0];

  // 1. Create a multi-stage gearbox
  const newMachineRes = await fetch(`${baseUrl}/api/machines`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${mgrToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      code: 'GB-305',
      name: 'Feed Extruder Auxiliary Drive',
      siteId: targetSite._id,
      manufacturer: 'Hansen Industrial Transmissions',
      model: 'P4-Multi',
      serialNumber: 'SN-HN-2024-912',
      arrangement: 'Multi-Stage Planetary',
      stageCount: 2,
      gearRatio: '22.5:1',
      ratedSpeedRpm: 1500,
      ratedTorqueNm: 750,
      stages: [
        { stage: 1, type: 'Planetary Stage', ratio: '4.5:1', conditionNotes: 'Nominal' },
        { stage: 2, type: 'Helical Reduction', ratio: '5.0:1', conditionNotes: 'Nominal' }
      ],
      bearingPositions: [
        { position: 'Input Shaft', bearingType: 'Tapered Roller', bearingModel: 'SKF 32212' }
      ],
      lubrication: {
        oilType: 'Synthetic Hydrocarbon',
        isoVgGrade: 'ISO VG 320',
        capacityLiters: 12.0,
        serviceIntervalHours: 5000
      }
    })
  });

  assert.equal(newMachineRes.status, 201);
  const newMachineData = await newMachineRes.json();
  assert.equal(newMachineData.machine.code, 'GB-305');
  assert.equal(newMachineData.machine.stages.length, 2);
  assert.equal(newMachineData.machine.operationalStatus, 'operational');
  assert.equal(newMachineData.machine.isDecommissioned, false);

  // 2. Reject invalid stage missing ratio
  const badStageRes = await fetch(`${baseUrl}/api/machines`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${mgrToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      code: 'GB-BAD',
      name: 'Invalid Gearbox',
      siteId: targetSite._id,
      stages: [{ stage: 1, type: 'Helical', ratio: '' }]
    })
  });
  assert.equal(badStageRes.status, 400, 'Empty stage ratio must be rejected with 400');

  // 3. Reject cross-factory site reference
  // Note: TEST_BAY_1 belongs to Cleveland
  const clevelandMgrToken = await loginUser('manager@cleveland.factory', 'Manager123!');
  const clevelandSitesRes = await fetch(`${baseUrl}/api/sites`, {
    headers: { Authorization: `Bearer ${clevelandMgrToken}` }
  });
  const { sites: clevelandSites } = await clevelandSitesRes.json();
  const clevelandSite = clevelandSites[0];

  const crossSiteRes = await fetch(`${baseUrl}/api/machines`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${mgrToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      code: 'GB-CROSS',
      name: 'Cross Factory Site Attempt',
      siteId: clevelandSite._id
    })
  });
  assert.equal(crossSiteRes.status, 400, 'Cross-factory site reference must return 400 Bad Request');

  // 4. Soft-decommission GB-305
  const decommissionRes = await fetch(`${baseUrl}/api/machines/GB-305/decommission`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${mgrToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ reason: 'Replaced with newer servo drive system' })
  });
  assert.equal(decommissionRes.status, 200);
  const decommissionData = await decommissionRes.json();
  assert.equal(decommissionData.machine.isDecommissioned, true);
  assert.equal(decommissionData.machine.operationalStatus, 'decommissioned');
});

test('Technician Assignment: Manager can assign technicians and reject cross-factory users', async () => {
  const mgrToken = await loginUser('manager@detroit.factory', 'Manager123!');

  // Get existing site
  const sitesRes = await fetch(`${baseUrl}/api/sites`, {
    headers: { Authorization: `Bearer ${mgrToken}` }
  });
  const { sites } = await sitesRes.json();
  const targetSite = sites[0];

  // Create machine GB-401 for assignment test
  const createMachineRes = await fetch(`${baseUrl}/api/machines`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${mgrToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      code: 'GB-401',
      name: 'Secondary Grinding Drive',
      siteId: targetSite._id,
      arrangement: 'Parallel Shaft Helical',
      stages: [{ stage: 1, type: 'Helical', ratio: '3.2:1' }]
    })
  });
  assert.equal(createMachineRes.status, 201);

  // Get Detroit technician Alex Mercer
  const usersRes = await fetch(`${baseUrl}/api/admin/factory-users`, {
    headers: { Authorization: `Bearer ${mgrToken}` }
  });
  const { users } = await usersRes.json();
  const detroitTech = users.find((u) => u.email === 'tech@detroit.factory');
  assert.ok(detroitTech);

  // 1. Assign Detroit technician to GB-401
  const assignRes = await fetch(`${baseUrl}/api/machines/GB-401/assign`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${mgrToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ technicianIds: [detroitTech._id] })
  });
  assert.equal(assignRes.status, 200);

  // Now Detroit technician must be able to read GB-401
  const techToken = await loginUser('tech@detroit.factory', 'Tech123!');
  const readRes = await fetch(`${baseUrl}/api/machines/GB-401`, {
    headers: { Authorization: `Bearer ${techToken}` }
  });
  assert.equal(readRes.status, 200, 'Technician assigned to GB-401 must have access');

  // 2. Reject assigning a technician from another factory
  const clevelandMgrToken = await loginUser('manager@cleveland.factory', 'Manager123!');
  const clevelandUsersRes = await fetch(`${baseUrl}/api/admin/factory-users`, {
    headers: { Authorization: `Bearer ${clevelandMgrToken}` }
  });
  const { users: clevelandUsers } = await clevelandUsersRes.json();
  const clevelandManager = clevelandUsers[0];

  const crossAssignRes = await fetch(`${baseUrl}/api/machines/GB-401/assign`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${mgrToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ technicianIds: [clevelandManager._id] })
  });
  assert.equal(crossAssignRes.status, 400, 'Cross-factory user assignment must be rejected with 400');
});

test('Work Orders: Manager creates task; Technician accepts and completes; Manager reviews', async () => {
  const mgrToken = await loginUser('manager@detroit.factory', 'Manager123!');
  const techToken = await loginUser('tech@detroit.factory', 'Tech123!');

  // Get Detroit tech ID
  const usersRes = await fetch(`${baseUrl}/api/admin/factory-users`, {
    headers: { Authorization: `Bearer ${mgrToken}` }
  });
  const { users } = await usersRes.json();
  const detroitTech = users.find((u) => u.email === 'tech@detroit.factory');

  // 1. Manager creates a work order for GB-104 assigned to Alex Mercer
  const createOrderRes = await fetch(`${baseUrl}/api/machines/GB-104/work-orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${mgrToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      title: 'Inspect Intermediate Planet Carrier Bearings',
      description: 'Perform ultrasonic acoustic emission check on planet carrier bearings.',
      priority: 'high',
      dueDate: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
      assignedTechnicianId: detroitTech._id
    })
  });

  assert.equal(createOrderRes.status, 201);
  const { workOrder } = await createOrderRes.json();
  assert.equal(workOrder.status, 'open');
  assert.ok(workOrder.orderNumber.startsWith('WO-GB-104-'));
  const orderId = workOrder._id;

  // 2. Reject work order assignment to technician not assigned to the machine
  // De-assign tech from GB-201 first
  await fetch(`${baseUrl}/api/machines/GB-201/assign`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${mgrToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ technicianIds: [] })
  });

  const unassignedWorkOrderRes = await fetch(`${baseUrl}/api/machines/GB-201/work-orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${mgrToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      title: 'Unassigned Gearbox Task',
      description: 'Should fail because technician is not assigned to GB-201',
      priority: 'low',
      dueDate: new Date().toISOString(),
      assignedTechnicianId: detroitTech._id
    })
  });
  assert.equal(
    unassignedWorkOrderRes.status,
    400,
    'Must reject work order if technician is not assigned to machine'
  );

  // 3. Technician views assigned tasks via /api/work-orders/my-tasks
  const myTasksRes = await fetch(`${baseUrl}/api/work-orders/my-tasks`, {
    headers: { Authorization: `Bearer ${techToken}` }
  });
  assert.equal(myTasksRes.status, 200);
  const myTasksData = await myTasksRes.json();
  const foundTask = myTasksData.workOrders.find((w) => w._id === orderId);
  assert.ok(foundTask, 'Technician must see the assigned work order');

  // 4. Technician marks work order in progress
  const inProgressRes = await fetch(`${baseUrl}/api/work-orders/${orderId}/status`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${techToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      status: 'in_progress',
      note: 'Sensor probe mounted on carrier inspection hole'
    })
  });
  assert.equal(inProgressRes.status, 200);

  // 5. Technician completes work order with findings and work performed
  const completeRes = await fetch(`${baseUrl}/api/work-orders/${orderId}/status`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${techToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      status: 'completed',
      findings: 'Acoustic emissions normal. No cage fracture or spalling detected.',
      workPerformed: 'Completed 3-point acoustic recording and torqued inspection port bolts.',
      followUpNeeded: 'Re-inspect at 3000 running hours.',
      note: 'Field inspection completed successfully.'
    })
  });
  assert.equal(completeRes.status, 200);
  const completedOrder = await completeRes.json();
  assert.equal(completedOrder.workOrder.status, 'completed');
  assert.ok(completedOrder.workOrder.completedAt);
  assert.equal(
    completedOrder.workOrder.technicianFeedback.findings,
    'Acoustic emissions normal. No cage fracture or spalling detected.'
  );

  // 6. Technician CANNOT mark work order as reviewed (manager only)
  const techReviewRes = await fetch(`${baseUrl}/api/work-orders/${orderId}/status`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${techToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ status: 'reviewed', note: 'Attempting closure' })
  });
  assert.equal(techReviewRes.status, 403, 'Technician must receive 403 when attempting review closure');

  // 7. Manager reviews and closes work order
  const managerReviewRes = await fetch(`${baseUrl}/api/work-orders/${orderId}/status`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${mgrToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      status: 'reviewed',
      note: 'Findings confirmed and maintenance history logged.'
    })
  });
  assert.equal(managerReviewRes.status, 200);
  const reviewedOrder = await managerReviewRes.json();
  assert.equal(reviewedOrder.workOrder.status, 'reviewed');
  assert.ok(reviewedOrder.workOrder.reviewedAt);

  // 8. Viewer is rejected from updating work order status
  const viewerToken = await loginUser('viewer@detroit.factory', 'Viewer123!');
  const viewerUpdateRes = await fetch(`${baseUrl}/api/work-orders/${orderId}/status`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${viewerToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ status: 'in_progress' })
  });
  assert.equal(viewerUpdateRes.status, 403, 'Viewer must be rejected with 403 Forbidden');
});
