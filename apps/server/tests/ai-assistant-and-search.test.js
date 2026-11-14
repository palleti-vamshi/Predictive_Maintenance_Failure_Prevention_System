import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app.js';
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { TEST_CREDS } from './testCredentials.js';
import { MaintenanceWorkOrder } from '../src/models/MaintenanceWorkOrder.js';

let server;
let baseUrl;

async function loginUser(creds) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: creds.email,
      password: creds.password
    })
  });
  const data = await res.json();
  assert.equal(res.status, 200, `Login failed for ${creds.email}: ${JSON.stringify(data)}`);
  return data.sessionToken;
}

test.before(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(env.MONGODB_URI);
  }

  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
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

test('Access Control: Unauthenticated requests to assistant and search are rejected with 401', async () => {
  const resStatus = await fetch(`${baseUrl}/api/assistant/status`);
  assert.equal(resStatus.status, 401);

  const resQuery = await fetch(`${baseUrl}/api/assistant/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'What is the status of GB-104?' })
  });
  assert.equal(resQuery.status, 401);

  const resSearch = await fetch(`${baseUrl}/api/search?q=gearbox`);
  assert.equal(resSearch.status, 401);
});

test('Unconfigured Provider Behavior: Returns honest fallback status without fabricating answers', async () => {
  const token = await loginUser(TEST_CREDS.manager);

  const res = await fetch(`${baseUrl}/api/assistant/status`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(res.status, 200);
  const data = await res.json();

  assert.equal(data.success, true);
  assert.equal(data.provider.configured, false);
  assert.equal(data.provider.status, 'unconfigured_fallback');
  assert.match(data.provider.note, /GEMINI_API_KEY not configured/i);
  assert.equal(data.scope.isManager, true);
  assert.ok(data.scope.scopedMachineCount > 0);
});

test('Role & Factory Scoping: Technician has narrower scope than Manager and cannot access other factories', async () => {
  const managerToken = await loginUser(TEST_CREDS.manager);
  const techToken = await loginUser(TEST_CREDS.tech);
  const chennaiTechToken = await loginUser(TEST_CREDS.chennaiTech);

  // Pune Manager status
  const mgrRes = await fetch(`${baseUrl}/api/assistant/status`, {
    headers: { Authorization: `Bearer ${managerToken}` }
  });
  const mgrData = await mgrRes.json();

  // Pune Technician status
  const techRes = await fetch(`${baseUrl}/api/assistant/status`, {
    headers: { Authorization: `Bearer ${techToken}` }
  });
  const techData = await techRes.json();

  // Technician machine scope is restricted to assigned machines
  assert.equal(techData.scope.isManager, false);
  assert.ok(techData.scope.scopedMachineCount <= mgrData.scope.scopedMachineCount);

  // Chennai Technician status
  const chennaiRes = await fetch(`${baseUrl}/api/assistant/status`, {
    headers: { Authorization: `Bearer ${chennaiTechToken}` }
  });
  const chennaiData = await chennaiRes.json();

  assert.notEqual(chennaiData.scope.factoryId, mgrData.scope.factoryId);

  // Chennai technician searching for Pune machine GB-104 gets 0 machines
  const searchCross = await fetch(`${baseUrl}/api/search?q=GB-104&type=machines`, {
    headers: { Authorization: `Bearer ${chennaiTechToken}` }
  });
  const searchCrossData = await searchCross.json();
  assert.equal(searchCrossData.counts.machines, 0);
});

test('Retrieval & Grounding: Assistant provides factual grounding, model explanations, and citations', async () => {
  const token = await loginUser(TEST_CREDS.manager);

  // 1. Query about GB-104
  const resGb = await fetch(`${baseUrl}/api/assistant/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query: 'What is the diagnostic condition of GB-104?' })
  });
  assert.equal(resGb.status, 200);
  const gbData = await resGb.json();

  assert.equal(gbData.success, true);
  assert.ok(Array.isArray(gbData.facts), 'Must return factual observations');
  assert.ok(Array.isArray(gbData.recommendations), 'Must return recommendations');
  assert.ok(Array.isArray(gbData.citations), 'Must return source citations');
  assert.ok(gbData.citations.some((c) => c.code === 'GB-104' && c.url.includes('#/machines/')));

  // 2. Query explaining SHAP and Random Forest
  const resShap = await fetch(`${baseUrl}/api/assistant/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query: 'Explain how SHAP and Random Forest work in this app' })
  });
  assert.equal(resShap.status, 200);
  const shapData = await resShap.json();

  assert.match(shapData.answer, /TreeSHAP/);
  assert.match(shapData.answer, /Random Forest/);
  assert.ok(shapData.modelOutputs.length > 0);
  assert.equal(shapData.mode, 'factory');
});

test('Dual-Mode Handling: Unconfigured provider truthfully explains general AI is unavailable while plant records remain queryable', async () => {
  const token = await loginUser(TEST_CREDS.manager);

  // 1. General question in auto mode
  const resGenAuto = await fetch(`${baseUrl}/api/assistant/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query: 'What causes gear tooth pitting in industrial transmissions?' })
  });
  assert.equal(resGenAuto.status, 200);
  const genAutoData = await resGenAuto.json();

  assert.equal(genAutoData.success, true);
  assert.equal(genAutoData.mode, 'general_unavailable');
  assert.match(genAutoData.answer, /General AI Answers Unavailable/i);
  assert.match(genAutoData.answer, /local factory-records mode/i);

  // 2. Explicit mode: 'general'
  const resGenExplicit = await fetch(`${baseUrl}/api/assistant/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query: 'ISO 10816 vibration standards', mode: 'general' })
  });
  assert.equal(resGenExplicit.status, 200);
  const genExplicitData = await resGenExplicit.json();
  assert.equal(genExplicitData.mode, 'general_unavailable');

  // 3. Explicit mode: 'factory'
  const resFactoryExplicit = await fetch(`${baseUrl}/api/assistant/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query: 'Show active alerts', mode: 'factory' })
  });
  assert.equal(resFactoryExplicit.status, 200);
  const factoryData = await resFactoryExplicit.json();
  assert.equal(factoryData.mode, 'factory');
  assert.ok(Array.isArray(factoryData.facts));
});

test('Approval Boundaries: Assistant drafts work order proposal without writing to DB until Manager approves', async () => {
  const managerToken = await loginUser(TEST_CREDS.manager);

  // Count existing work orders in DB
  const initialCount = await MaintenanceWorkOrder.countDocuments();

  // Call draft-work-order
  const res = await fetch(`${baseUrl}/api/assistant/draft-work-order`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${managerToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ machineCode: 'GB-104' })
  });
  assert.equal(res.status, 200);
  const data = await res.json();

  assert.equal(data.success, true);
  assert.equal(data.requiresManagerApproval, true);
  assert.equal(data.proposal.approvalStatus, 'draft_proposal');
  assert.equal(data.proposal.machineCode, 'GB-104');
  assert.ok(Array.isArray(data.proposal.checklist));
  assert.ok(data.proposal.checklist.length >= 3);

  // DB count must NOT have changed: drafting is not creating!
  const finalCount = await MaintenanceWorkOrder.countDocuments();
  assert.equal(finalCount, initialCount, 'Assistant must NOT create or modify DB records directly without manager approval');
});

test('Operational Search: Multi-entity search with filters, excerpts, and accurate labeling', async () => {
  const token = await loginUser(TEST_CREDS.manager);

  // General query for gearbox
  const res = await fetch(`${baseUrl}/api/search?q=gearbox&type=all`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(res.status, 200);
  const data = await res.json();

  assert.equal(data.success, true);
  assert.equal(data.searchMethod, 'Indexed Operational Record Search (Factory Scoped)');
  assert.ok(data.total > 0);
  assert.ok(data.results.length > 0);

  // Check result structure
  const first = data.results[0];
  assert.ok(first.resultType);
  assert.ok(first.title);
  assert.ok(first.url);
  assert.ok(first.factory);
  assert.ok(typeof first.excerpt === 'string');

  // Filter query for only machines
  const resMachines = await fetch(`${baseUrl}/api/search?q=gearbox&type=machines`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const dataMachines = await resMachines.json();
  assert.ok(dataMachines.results.every((r) => r.resultType === 'machine'));
});

test('Dynamic Page-Aware Suggestions: Generates contextual suggestions based on route and machine', async () => {
  const managerToken = await loginUser(TEST_CREDS.manager);
  const techToken = await loginUser(TEST_CREDS.tech);

  // Machine page suggestions
  const resMachine = await fetch(`${baseUrl}/api/assistant/suggestions?route=machines&machineCode=GB-104`, {
    headers: { Authorization: `Bearer ${managerToken}` }
  });
  assert.equal(resMachine.status, 200);
  const dataMachine = await resMachine.json();
  assert.equal(dataMachine.success, true);
  assert.equal(dataMachine.machineCode, 'GB-104');
  assert.ok(dataMachine.suggestions.length >= 3);
  assert.ok(dataMachine.suggestions.some((s) => s.query.includes('GB-104')));

  // Alerts page suggestions
  const resAlerts = await fetch(`${baseUrl}/api/assistant/suggestions?route=alerts`, {
    headers: { Authorization: `Bearer ${managerToken}` }
  });
  const dataAlerts = await resAlerts.json();
  assert.ok(dataAlerts.suggestions.some((s) => s.label.toLowerCase().includes('alert')));

  // Maintenance page suggestions: role differences (Manager vs Tech)
  const resMgrMaint = await fetch(`${baseUrl}/api/assistant/suggestions?route=maintenance`, {
    headers: { Authorization: `Bearer ${managerToken}` }
  });
  const dataMgrMaint = await resMgrMaint.json();
  assert.ok(dataMgrMaint.suggestions.some((s) => s.query.includes('shift briefing')));

  const resTechMaint = await fetch(`${baseUrl}/api/assistant/suggestions?route=maintenance`, {
    headers: { Authorization: `Bearer ${techToken}` }
  });
  const dataTechMaint = await resTechMaint.json();
  assert.ok(dataTechMaint.suggestions.some((s) => s.query.includes('assigned to me')));
});

test('Copilot Briefings & Checklists: Factory shift briefing, assigned work, and inspection checklists', async () => {
  const managerToken = await loginUser(TEST_CREDS.manager);
  const techToken = await loginUser(TEST_CREDS.tech);

  // 1. Shift briefing for manager
  const resBriefing = await fetch(`${baseUrl}/api/assistant/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${managerToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query: 'Provide factory shift briefing' })
  });
  assert.equal(resBriefing.status, 200);
  const dataBriefing = await resBriefing.json();
  assert.match(dataBriefing.answer, /Factory Shift Briefing/i);
  assert.match(dataBriefing.answer, /Equipment Status/i);
  assert.ok(dataBriefing.facts.length > 0);
  assert.ok(dataBriefing.citations.length > 0);

  // 2. Assigned work for technician
  const resAssigned = await fetch(`${baseUrl}/api/assistant/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${techToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query: 'What work is assigned to me?' })
  });
  assert.equal(resAssigned.status, 200);
  const dataAssigned = await resAssigned.json();
  assert.match(dataAssigned.answer, /Assigned Maintenance Briefing/i);

  // 3. Inspection checklist proposal
  const resChecklist = await fetch(`${baseUrl}/api/assistant/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${managerToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query: 'Draft inspection checklist for GB-104' })
  });
  assert.equal(resChecklist.status, 200);
  const dataChecklist = await resChecklist.json();
  assert.ok(dataChecklist.workOrderDraft);
  assert.equal(dataChecklist.workOrderDraft.requiresManagerApproval, true);
  assert.ok(dataChecklist.workOrderDraft.checklist.length >= 4);
  assert.match(dataChecklist.answer, /5-point mechanical inspection checklist/i);

  // 4. Unknown machine query: honest scoping without hallucination
  const resUnknown = await fetch(`${baseUrl}/api/assistant/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${managerToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query: 'What is the diagnostic status of GB-999?' })
  });
  assert.equal(resUnknown.status, 200);
  const dataUnknown = await resUnknown.json();
  assert.match(dataUnknown.answer, /Equipment Not Found in Authorized Factory Scope/i);
  assert.match(dataUnknown.answer, /GB-999/);
  assert.ok(dataUnknown.recommendations.length > 0);
});

test('Approval Boundaries: Manager can approve drafted work order; Technician is rejected', async () => {
  const managerToken = await loginUser(TEST_CREDS.manager);
  const techToken = await loginUser(TEST_CREDS.tech);

  // 1. Technician attempting approval is rejected with 403
  const resTechApprove = await fetch(`${baseUrl}/api/assistant/approve-draft-work-order`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${techToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      draft: {
        machineCode: 'GB-104',
        title: 'Unauthorized Technician Work Order',
        description: 'Should be rejected'
      }
    })
  });
  assert.equal(resTechApprove.status, 403);

  // 2. Manager approving valid draft succeeds and creates work order
  const resMgrApprove = await fetch(`${baseUrl}/api/assistant/approve-draft-work-order`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${managerToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      draft: {
        machineCode: 'GB-104',
        title: 'Manager Approved Corrective Inspection',
        description: 'Vibration harmonics elevated on intermediate shaft. Verified dial runout.'
      }
    })
  });
  assert.equal(resMgrApprove.status, 201);
  const dataMgrApprove = await resMgrApprove.json();
  assert.equal(dataMgrApprove.success, true);
  assert.ok(dataMgrApprove.workOrder);
  assert.match(dataMgrApprove.workOrder.orderNumber, /^WO-GB-104-/);
  assert.equal(dataMgrApprove.workOrder.status, 'open');
});

