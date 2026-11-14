import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import app from '../src/app.js';
import { isOriginAllowed } from '../src/config/cors.js';
import { isDatabaseConnected } from '../src/config/database.js';

let server;
let baseUrl;

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '0.0.0.0', () => {
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
});

test('Health Probe: Separates API reachability from database connectivity', async () => {
  const res = await fetch(`${baseUrl}/api/health`);
  assert.strictEqual(res.status, 200);

  const data = await res.json();
  assert.strictEqual(data.api.reachable, true, 'API must be reported as reachable');
  assert.strictEqual(data.api.status, 'healthy', 'API status must be healthy');
  assert.strictEqual(typeof data.api.uptimeSeconds, 'number');
  assert.strictEqual(typeof data.database.connected, 'boolean');
  assert.strictEqual(typeof data.database.hasActiveConnection, 'boolean');

  if (data.database.connected) {
    assert.strictEqual(data.status, 'healthy');
  } else {
    assert.strictEqual(data.status, 'degraded');
  }
});

test('CORS Policy: Allows local RFC 1918 private IPv4 networks in development', () => {
  // Test local development network origins
  assert.strictEqual(isOriginAllowed('http://localhost:5173'), true);
  assert.strictEqual(isOriginAllowed('http://127.0.0.1:8081'), true);
  assert.strictEqual(isOriginAllowed('http://192.168.1.100:8081'), true);
  assert.strictEqual(isOriginAllowed('http://192.168.137.189:8081'), true);
  assert.strictEqual(isOriginAllowed('http://10.39.163.51:5001'), true);
  assert.strictEqual(isOriginAllowed('http://172.20.10.5:8081'), true);
  assert.strictEqual(isOriginAllowed('exp://192.168.1.100:8081'), true);

  // Test disallowed external / public internet origins
  assert.strictEqual(isOriginAllowed('http://evil-attacker.com'), false);
  assert.strictEqual(isOriginAllowed('http://8.8.8.8:8081'), false);
  assert.strictEqual(isOriginAllowed('http://142.250.190.46:5001'), false);
});

test('CORS Preflight: Returns 204 with credentials for private LAN IP origin', async () => {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://192.168.137.189:8081',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'Content-Type,Authorization'
    }
  });

  assert.strictEqual(res.status, 204);
  assert.strictEqual(res.headers.get('access-control-allow-origin'), 'http://192.168.137.189:8081');
  assert.strictEqual(res.headers.get('access-control-allow-credentials'), 'true');
});

test('Database Fail-Fast: Endpoint returns 503 DATABASE_UNAVAILABLE immediately when DB disconnected', async () => {
  // Simulate disconnected state temporarily if connected
  const originalState = mongoose.connection.readyState;
  Object.defineProperty(mongoose.connection, 'readyState', { value: 0, configurable: true });

  try {
    assert.strictEqual(isDatabaseConnected(), false);

    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        emailOrUsername: 'manager@pune.bharatdynamics.demo',
        password: 'Manager123!'
      })
    });

    assert.strictEqual(res.status, 503, 'Must return HTTP 503 Service Unavailable');
    const data = await res.json();
    assert.strictEqual(data.code, 'DATABASE_UNAVAILABLE');
    assert.match(data.message, /MongoDB is offline/i);
  } finally {
    // Restore readyState
    Object.defineProperty(mongoose.connection, 'readyState', { value: originalState, configurable: true });
  }
});

