import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import app from '../src/app.js';
import { env } from '../src/config/env.js';
import { isOriginAllowed, getAllowedOrigins } from '../src/config/cors.js';

let server;
let baseUrl;

test.before(async () => {
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(env.MONGODB_URI);
  }

  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
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

test('Security & CORS: Allowed local dev origins include Vite fallback 5174 and 5175', async (t) => {
  const allowed = getAllowedOrigins();
  assert.ok(allowed.includes('http://localhost:5173'), 'Must allow 5173');
  assert.ok(allowed.includes('http://localhost:5174'), 'Must allow Vite fallback 5174');
  assert.ok(allowed.includes('http://localhost:5175'), 'Must allow Vite fallback 5175');
  assert.ok(allowed.includes('http://127.0.0.1:5174'), 'Must allow 127.0.0.1:5174');

  assert.strictEqual(isOriginAllowed('http://localhost:5174'), true);
  assert.strictEqual(isOriginAllowed('http://127.0.0.1:5174'), true);
  assert.strictEqual(isOriginAllowed('http://malicious-hacker.com'), false);
  assert.strictEqual(isOriginAllowed(null), true, 'Native requests with no origin should be allowed');
});

test('Security & CORS: In production environment, localhost dev origins are strictly disallowed', async (t) => {
  const originalEnv = process.env.NODE_ENV;
  const originalCors = process.env.CORS_ORIGIN;
  try {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGIN = 'https://app.mechguard.ai,https://admin.mechguard.ai';

    const prodOrigins = getAllowedOrigins();
    assert.strictEqual(prodOrigins.includes('http://localhost:5173'), false, 'Production must not allow localhost:5173');
    assert.strictEqual(prodOrigins.includes('http://localhost:5174'), false, 'Production must not allow localhost:5174');
    assert.strictEqual(prodOrigins.includes('http://localhost:5175'), false, 'Production must not allow localhost:5175');
    assert.ok(prodOrigins.includes('https://app.mechguard.ai'), 'Production must include explicit app domain');
    assert.ok(prodOrigins.includes('https://admin.mechguard.ai'), 'Production must include explicit admin domain');
    assert.strictEqual(isOriginAllowed('http://localhost:5174'), false, 'localhost:5174 must be rejected in production');
    assert.strictEqual(isOriginAllowed('https://app.mechguard.ai'), true, 'Configured domain must be accepted');
  } finally {
    process.env.NODE_ENV = originalEnv;
    process.env.CORS_ORIGIN = originalCors;
  }
});

test('Security & CORS: Preflight OPTIONS request from http://localhost:5174 is accepted with credentials', async (t) => {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://localhost:5174',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'Content-Type'
    }
  });

  assert.strictEqual(res.status, 204, 'CORS preflight should return 204 No Content');
  assert.strictEqual(res.headers.get('access-control-allow-origin'), 'http://localhost:5174');
  assert.strictEqual(res.headers.get('access-control-allow-credentials'), 'true');
});

test('Security & CORS: Preflight from unauthorized origin is refused without 500 crash', async (t) => {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://unauthorized-evil.com',
      'Access-Control-Request-Method': 'POST'
    }
  });

  // Express CORS returns 204 or no allow-origin for rejected preflight without throwing 500
  assert.notStrictEqual(res.status, 500, 'Must NOT crash with 500 error on disallowed origin');
  assert.strictEqual(res.headers.get('access-control-allow-origin'), null, 'Must NOT include allow-origin header');
});

test('Security Headers: Verifies security response headers and omission of X-Powered-By', async (t) => {
  const res = await fetch(`${baseUrl}/api/health`);
  assert.strictEqual(res.status, 200);

  // Security headers
  assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff');
  assert.strictEqual(res.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.strictEqual(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');

  // Fingerprint prevention
  assert.strictEqual(res.headers.get('x-powered-by'), null, 'X-Powered-By header must be removed');
});

test('Input Validation & Anti-Crash: Invalid ObjectId returns 400 instead of 500 CastError', async (t) => {
  // Login first as manager
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'manager@pune.bharatdynamics.demo',
      password: process.env.DEMO_MANAGER_PASSWORD || 'Manager123!'
    })
  });
  assert.strictEqual(loginRes.status, 200);
  const { sessionToken } = await loginRes.json();

  // Test invalid ObjectId string on alert
  const badAlertRes = await fetch(`${baseUrl}/api/alerts/invalid-id-format`, {
    headers: { Authorization: `Bearer ${sessionToken}` }
  });
  assert.strictEqual(badAlertRes.status, 400, 'Invalid alert ID should return 400');
  const alertJson = await badAlertRes.json();
  assert.strictEqual(alertJson.error, 'BadRequest');

  // Test invalid ObjectId string on work order
  const badWoRes = await fetch(`${baseUrl}/api/work-orders/not-a-mongo-id`, {
    headers: { Authorization: `Bearer ${sessionToken}` }
  });
  assert.strictEqual(badWoRes.status, 400, 'Invalid work order ID should return 400');

  // Test invalid ObjectId string on site
  const badSiteRes = await fetch(`${baseUrl}/api/sites/bad-site-123`, {
    headers: { Authorization: `Bearer ${sessionToken}` }
  });
  assert.strictEqual(badSiteRes.status, 400, 'Invalid site ID should return 400');
});

test('Security & OTP Policy: OTP endpoint is disabled with 501 NotImplemented', async (t) => {
  const res = await fetch(`${baseUrl}/api/auth/otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '+919876543210' })
  });

  assert.strictEqual(res.status, 501, 'OTP endpoint should be disabled with 501');
  const data = await res.json();
  assert.strictEqual(data.error, 'NotImplemented');
  assert.match(data.message, /OTP authentication is disabled/i);
});

test('Security & Recovery Policy: Self-service recovery is disabled with 501 NotImplemented', async (t) => {
  const res = await fetch(`${baseUrl}/api/auth/password-recovery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'manager@pune.bharatdynamics.demo' })
  });

  assert.strictEqual(res.status, 501, 'Password recovery endpoint should be disabled with 501');
  const data = await res.json();
  assert.strictEqual(data.error, 'NotImplemented');
});

