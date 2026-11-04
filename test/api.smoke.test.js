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

  // Admin CRUD characterization using isolated synthetic records.
  const adminHeaders = {
    cookie: cookie.split(';')[0],
    'content-type': 'application/json'
  };
  const createdGameResponse = await fetch(`${baseUrl}/api/admin/games`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ name: 'CI Synthetic Game', category: 'test', description: 'CI only' })
  });
  assert.equal(createdGameResponse.status, 201);
  const game = await createdGameResponse.json();

  const updatedGameResponse = await fetch(`${baseUrl}/api/admin/games/${game.id}`, {
    method: 'PUT',
    headers: adminHeaders,
    body: JSON.stringify({ name: 'CI Synthetic Game Updated', category: 'test', description: 'Updated in CI', active: true })
  });
  assert.equal(updatedGameResponse.status, 200);
  assert.equal((await updatedGameResponse.json()).name, 'CI Synthetic Game Updated');

  const createdPackageResponse = await fetch(`${baseUrl}/api/admin/packages`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ game_id: game.id, name: 'Synthetic 100 Gems', amount: 100, unit: 'Gems', price: 20 })
  });
  assert.equal(createdPackageResponse.status, 201);
  const pack = await createdPackageResponse.json();

  const updatedPackageResponse = await fetch(`${baseUrl}/api/admin/packages/${pack.id}`, {
    method: 'PUT',
    headers: adminHeaders,
    body: JSON.stringify({ game_id: game.id, name: 'Synthetic 100 Gems Updated', amount: 100, unit: 'Gems', price: 22 })
  });
  assert.equal(updatedPackageResponse.status, 200);
  assert.equal((await updatedPackageResponse.json()).price, 22);

  const createdCouponResponse = await fetch(`${baseUrl}/api/admin/coupons`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ code: 'CISYNTHETIC', discount_type: 'fixed', discount_value: 2, game_id: game.id })
  });
  assert.equal(createdCouponResponse.status, 201);
  const coupon = await createdCouponResponse.json();

  const couponValidation = await fetch(`${baseUrl}/api/public/coupons/validate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: 'CISYNTHETIC', gameId: game.id, subtotal: 22, playerId: 'CI-PLAYER-01' })
  });
  assert.equal(couponValidation.status, 200);
  assert.equal((await couponValidation.json()).discount, 2);

  const createdPromotionResponse = await fetch(`${baseUrl}/api/admin/promotions`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ title: 'CI Synthetic Promotion', subtitle: 'CI only' })
  });
  assert.equal(createdPromotionResponse.status, 201);
  const promotion = await createdPromotionResponse.json();

  const updatedPromotionResponse = await fetch(`${baseUrl}/api/admin/promotions/${promotion.id}`, {
    method: 'PUT',
    headers: adminHeaders,
    body: JSON.stringify({ title: 'CI Synthetic Promotion Updated', subtitle: 'Updated in CI' })
  });
  assert.equal(updatedPromotionResponse.status, 200);
  assert.equal((await updatedPromotionResponse.json()).title, 'CI Synthetic Promotion Updated');

  // Upload a synthetic PNG only; never use a real payment slip in CI.
  const form = new FormData();
  form.append('gameId', String(game.id));
  form.append('packageId', String(pack.id));
  form.append('playerId', 'CI-PLAYER-01');
  form.append('couponCode', coupon.code);
  form.append('slip', new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' }), 'synthetic.png');
  const orderResponse = await fetch(`${baseUrl}/api/public/orders`, {
    method: 'POST',
    headers: { cookie: cookie.split(';')[0] },
    body: form
  });
  assert.equal(orderResponse.status, 201);
  const order = (await orderResponse.json()).order;
  assert.equal(order.status, 'Pending');
  assert.equal(order.total, 20);

  const completedResponse = await fetch(`${baseUrl}/api/admin/orders/${order.id}/status`, {
    method: 'PATCH',
    headers: adminHeaders,
    body: JSON.stringify({ status: 'Completed' })
  });
  assert.equal(completedResponse.status, 200);
  assert.equal((await completedResponse.json()).status, 'Completed');

  const ordersResponse = await fetch(`${baseUrl}/api/admin/orders`, {
    headers: { cookie: cookie.split(';')[0] }
  });
  assert.equal(ordersResponse.status, 200);
  const orders = await ordersResponse.json();
  assert.ok(orders.some(item => item.id === order.id && item.status === 'Completed'));

  const invalidStatus = await fetch(`${baseUrl}/api/admin/orders/${order.id}/status`, {
    method: 'PATCH',
    headers: adminHeaders,
    body: JSON.stringify({ status: 'Paid' })
  });
  assert.equal(invalidStatus.status, 400);

  const rejectedDelete = await fetch(`${baseUrl}/api/admin/games/${game.id}`, {
    method: 'DELETE',
    headers: { cookie: cookie.split(';')[0] }
  });
  assert.equal(rejectedDelete.status, 409);

  const badUploadForm = new FormData();
  badUploadForm.append('image', new Blob(['not an image'], { type: 'text/plain' }), 'not-image.txt');
  const badUpload = await fetch(`${baseUrl}/api/admin/upload`, {
    method: 'POST',
    headers: { cookie: cookie.split(';')[0] },
    body: badUploadForm
  });
  assert.equal(badUpload.status, 400);

  const deletePromotion = await fetch(`${baseUrl}/api/admin/promotions/${promotion.id}`, {
    method: 'DELETE',
    headers: { cookie: cookie.split(';')[0] }
  });
  assert.equal(deletePromotion.status, 200);

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
