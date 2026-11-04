'use strict';

const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nobi-topup-test-'));
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-only-session-secret-not-for-production';
process.env.ADMIN_USERNAME = 'TestAdmin';
process.env.ADMIN_PASSWORD = 'TestPassword123';
process.env.NOBI_DATA_DIR = path.join(tempRoot, 'data');
process.env.NOBI_UPLOAD_DIR = path.join(tempRoot, 'uploads');

let app;
let server;
let baseUrl;

before(async () => {
  app = require('../server');
  server = app.listen(0);
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('API baseline: public endpoints, Admin session lifecycle, and protected routes', async () => {
  const health = await fetch(`${baseUrl}/api/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true, service: 'Nobi Topup API' });

  const catalogResponse = await fetch(`${baseUrl}/api/public/catalog`);
  assert.equal(catalogResponse.status, 200);
  const catalog = await catalogResponse.json();
  assert.ok(Array.isArray(catalog.games));
  assert.ok(Array.isArray(catalog.packages));
  assert.ok(catalog.games.length > 0);
  assert.ok(catalog.packages.length > 0);

  const promotionsResponse = await fetch(`${baseUrl}/api/public/promotions`);
  assert.equal(promotionsResponse.status, 200);
  assert.ok(Array.isArray(await promotionsResponse.json()));

  const invalidCoupon = await fetch(`${baseUrl}/api/public/coupons/validate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: '', gameId: 1, subtotal: 10 })
  });
  assert.equal(invalidCoupon.status, 422);
  assert.equal((await invalidCoupon.json()).ok, false);

  const unauthorized = await fetch(`${baseUrl}/api/admin/dashboard`);
  assert.equal(unauthorized.status, 401);

  const login = await fetch(`${baseUrl}/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'TestAdmin', password: 'TestPassword123' })
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie');
  assert.ok(cookie, 'Admin login should issue a session cookie');

  const dashboard = await fetch(`${baseUrl}/api/admin/dashboard`, {
    headers: { cookie: cookie.split(';')[0] }
  });
  assert.equal(dashboard.status, 200);
  const stats = await dashboard.json();
  assert.equal(typeof stats.orders, 'number');
  assert.equal(typeof stats.games, 'number');

  const logout = await fetch(`${baseUrl}/api/admin/logout`, {
    method: 'POST',
    headers: { cookie: cookie.split(';')[0] }
  });
  assert.equal(logout.status, 200);

  const afterLogout = await fetch(`${baseUrl}/api/admin/dashboard`, {
    headers: { cookie: cookie.split(';')[0] }
  });
  assert.equal(afterLogout.status, 401);
});
