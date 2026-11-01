import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/app.js';
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { TEST_CREDS } from './testCredentials.js';

let server;
let baseUrl;

// Helper to parse cookies from Set-Cookie header
function extractCookie(res) {
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) return null;
  const match = setCookie.match(/pm_session=([^;]+)/);
  return match ? match[1] : null;
}

test.before(async () => {
  // Ensure DB connection
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(env.MONGODB_URI);
  }

  // Start server on an ephemeral port
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

test('Authentication Flow: Login with valid credentials returns session and strips passwordHash', async () => {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      emailOrUsername: TEST_CREDS.tech.email,
      password: TEST_CREDS.tech.password
    })
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.ok(data.sessionToken, 'Must provide sessionToken for mobile clients');
  assert.equal(data.user.email, TEST_CREDS.tech.email);
  assert.equal(data.user.role, 'technician');
  assert.equal(data.user.passwordHash, undefined, 'Must NEVER return passwordHash');

  const cookie = extractCookie(res);
  assert.ok(cookie, 'Must set pm_session HttpOnly cookie for web clients');
});

test('Authentication Flow: Invalid password returns 401 Unauthorized', async () => {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      emailOrUsername: TEST_CREDS.tech.email,
      password: 'WrongPassword999!'
    })
  });

  assert.equal(res.status, 401);
  const data = await res.json();
  assert.equal(data.error, 'Unauthorized');
});

test('Session Lifecycle: Logout immediately revokes server session', async () => {
  // 1. Log in
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      emailOrUsername: TEST_CREDS.tech.email,
      password: TEST_CREDS.tech.password
    })
  });
  const { sessionToken } = await loginRes.json();

  // 2. Access /api/auth/me -> 200
  const meRes = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${sessionToken}` }
  });
  assert.equal(meRes.status, 200);

  // 3. Logout -> 200
  const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${sessionToken}` }
  });
  assert.equal(logoutRes.status, 200);

  // 4. Access /api/auth/me again with revoked token -> 401
  const afterLogoutRes = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${sessionToken}` }
  });
  assert.equal(afterLogoutRes.status, 401);
});

test('Scoped Access: Factory Manager sees all machines in Pune', async () => {
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      emailOrUsername: TEST_CREDS.manager.email,
      password: TEST_CREDS.manager.password
    })
  });
  const { sessionToken } = await loginRes.json();

  const res = await fetch(`${baseUrl}/api/machines`, {
    headers: { Authorization: `Bearer ${sessionToken}` }
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  const machineCodes = data.machines.map((m) => m.code);

  assert.ok(machineCodes.includes('GB-104'), 'Manager must see GB-104');
  assert.ok(machineCodes.includes('GB-201'), 'Manager must see GB-201');
  assert.ok(!machineCodes.includes('GB-999'), 'Pune manager must NEVER see Chennai GB-999');
});

test('Scoped Access: Technician sees ONLY assigned machines', async () => {
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      emailOrUsername: TEST_CREDS.tech.email,
      password: TEST_CREDS.tech.password
    })
  });
  const { sessionToken } = await loginRes.json();

  const res = await fetch(`${baseUrl}/api/machines`, {
    headers: { Authorization: `Bearer ${sessionToken}` }
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  const machineCodes = data.machines.map((m) => m.code);

  assert.ok(machineCodes.includes('GB-104'), 'Technician must see assigned GB-104');
  assert.ok(!machineCodes.includes('GB-201'), 'Technician must NOT see unassigned GB-201');
  assert.ok(!machineCodes.includes('GB-999'), 'Technician must NOT see Chennai GB-999');
});

test('Cross-Factory Isolation: User requesting machine from another factory gets 404', async () => {
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      emailOrUsername: TEST_CREDS.manager.email,
      password: TEST_CREDS.manager.password
    })
  });
  const { sessionToken } = await loginRes.json();

  // GB-999 exists in Chennai Factory
  const res = await fetch(`${baseUrl}/api/machines/GB-999`, {
    headers: { Authorization: `Bearer ${sessionToken}` }
  });

  // Must return 404 Not Found to prevent cross-factory identification
  assert.equal(res.status, 404);
  const data = await res.json();
  assert.equal(data.error, 'NotFound');
});

test('Role Authorization: Manager endpoint rejects Technician and Viewer with 403', async () => {
  // Technician login
  const techLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      emailOrUsername: TEST_CREDS.tech.email,
      password: TEST_CREDS.tech.password
    })
  });
  const { sessionToken: techToken } = await techLogin.json();

  const techAdminRes = await fetch(`${baseUrl}/api/admin/factory-users`, {
    headers: { Authorization: `Bearer ${techToken}` }
  });
  assert.equal(techAdminRes.status, 403, 'Technician must be rejected with 403 Forbidden');

  // Manager login
  const managerLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      emailOrUsername: TEST_CREDS.manager.email,
      password: TEST_CREDS.manager.password
    })
  });
  const { sessionToken: mgrToken } = await managerLogin.json();

  const mgrAdminRes = await fetch(`${baseUrl}/api/admin/factory-users`, {
    headers: { Authorization: `Bearer ${mgrToken}` }
  });
  assert.equal(mgrAdminRes.status, 200, 'Manager must receive 200 OK');
  const data = await mgrAdminRes.json();
  assert.ok(data.users.length > 0);
});

test('Write Authorization: Viewer cannot add maintenance notes (403), Technician on assigned machine can (201)', async () => {
  // Viewer login
  const viewerLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      emailOrUsername: TEST_CREDS.viewer.email,
      password: TEST_CREDS.viewer.password
    })
  });
  const { sessionToken: viewerToken } = await viewerLogin.json();

  // Viewer tries to post note
  const viewerPostRes = await fetch(`${baseUrl}/api/machines/GB-104/notes`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${viewerToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ content: 'Unauthorized viewer test note' })
  });
  assert.equal(viewerPostRes.status, 403, 'Viewer must receive 403 Forbidden');

  // Technician login
  const techLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      emailOrUsername: TEST_CREDS.tech.email,
      password: TEST_CREDS.tech.password
    })
  });
  const { sessionToken: techToken } = await techLogin.json();

  // Technician posts note to assigned GB-104
  const techPostRes = await fetch(`${baseUrl}/api/machines/GB-104/notes`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${techToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      content: 'Replenished 100ml synthetic oil. Cleaned breather port.',
      category: 'Lubrication'
    })
  });
  assert.equal(techPostRes.status, 201, 'Technician must succeed on assigned machine');
  const postData = await techPostRes.json();
  assert.equal(postData.success, true);
  assert.equal(postData.note.content, 'Replenished 100ml synthetic oil. Cleaned breather port.');

  // Technician attempts to post note to unassigned GB-201 in the same factory -> 403 Forbidden
  const techUnassignedPostRes = await fetch(`${baseUrl}/api/machines/GB-201/notes`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${techToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      content: 'Attempting to modify unassigned gearbox',
      category: 'Inspection'
    })
  });
  assert.equal(techUnassignedPostRes.status, 403, 'Technician must be rejected with 403 on unassigned machine');
});

test('Authentication Enforcement: Missing or malformed credentials return 401 Unauthorized', async () => {
  // 1. Missing credentials entirely
  const noCredsRes = await fetch(`${baseUrl}/api/machines`);
  assert.equal(noCredsRes.status, 401, 'Request with no credentials must return 401');
  const noCredsData = await noCredsRes.json();
  assert.equal(noCredsData.error, 'Unauthorized');

  // 2. Malformed Bearer header
  const badBearerRes = await fetch(`${baseUrl}/api/machines`, {
    headers: { Authorization: 'Bearer totally-invalid-random-token-12345' }
  });
  assert.equal(badBearerRes.status, 401, 'Invalid Bearer token must return 401');
  const badBearerData = await badBearerRes.json();
  assert.equal(badBearerData.error, 'Unauthorized');
});
