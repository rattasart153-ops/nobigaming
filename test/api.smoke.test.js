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
process.env.NOBI_PRIVATE_SLIP_DIR = path.join(tempRoot, 'private-slips');

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
  assert.ok(health.headers.get('content-security-policy-report-only'), 'CSP should be delivered in report-only mode');

  const unauthorizedSlip = await fetch(`${baseUrl}/api/admin/orders/unknown/slip`);
  assert.equal(unauthorizedSlip.status, 401);

  const paymentInfo = await fetch(`${baseUrl}/api/public/payment-info`);
  assert.equal(paymentInfo.status, 200);
  assert.equal((await paymentInfo.json()).configured, false);

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

  const crossOriginLogin = await fetch(`${baseUrl}/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://attacker.example' },
    body: JSON.stringify({ username: 'TestAdmin', password: 'TestPassword123' })
  });
  assert.equal(crossOriginLogin.status, 403);

  const missingOriginLogin = await fetch(`${baseUrl}/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'TestAdmin', password: 'TestPassword123' })
  });
  assert.equal(missingOriginLogin.status, 403);

  const crossSiteLogin = await fetch(`${baseUrl}/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: baseUrl, 'sec-fetch-site': 'cross-site' },
    body: JSON.stringify({ username: 'TestAdmin', password: 'TestPassword123' })
  });
  assert.equal(crossSiteLogin.status, 403);

  const login = await fetch(`${baseUrl}/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: baseUrl },
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
    'content-type': 'application/json',
    origin: baseUrl
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

  const suggestions = await fetch(`${baseUrl}/api/public/coupons/suggestions?gameId=${game.id}&subtotal=22&playerId=CI-PLAYER-01`);
  assert.equal(suggestions.status, 200);
  assert.equal((await suggestions.json()).suggestion.code, 'CISYNTHETIC');

  const updatedCouponResponse = await fetch(`${baseUrl}/api/admin/coupons/${coupon.id}`, {
    method: 'PUT',
    headers: adminHeaders,
    body: JSON.stringify({ code: 'CISYNTHETIC', discount_type: 'fixed', discount_value: 3, game_id: game.id })
  });
  assert.equal(updatedCouponResponse.status, 200);
  assert.equal((await updatedCouponResponse.json()).discount_value, 3);

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

  for (const endpoint of ['/api/admin/games', '/api/admin/packages', '/api/admin/coupons', '/api/admin/promotions']) {
    const listResponse = await fetch(`${baseUrl}${endpoint}`, {
      headers: { cookie: cookie.split(';')[0] }
    });
    assert.equal(listResponse.status, 200, `${endpoint} should be available to Admin`);
    assert.ok(Array.isArray(await listResponse.json()), `${endpoint} should return an array`);
  }

  // Invalid checkout payloads must not leave orphaned uploaded files.
  const uploadCount = () => fs.readdirSync(process.env.NOBI_PRIVATE_SLIP_DIR).length;
  const beforeInvalidGame = uploadCount();
  const invalidGameForm = new FormData();
  invalidGameForm.append('gameId', '999999');
  invalidGameForm.append('packageId', String(pack.id));
  invalidGameForm.append('playerId', 'CI-PLAYER-INVALID-GAME');
  invalidGameForm.append('slip', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=', 'base64')], { type: 'image/png' }), 'invalid-game.png');
  const invalidGameOrder = await fetch(`${baseUrl}/api/public/orders`, {
    method: 'POST',
    headers: { cookie: cookie.split(';')[0] },
    body: invalidGameForm
  });
  assert.equal(invalidGameOrder.status, 400);
  assert.equal(uploadCount(), beforeInvalidGame);

  const beforeInvalidPlayer = uploadCount();
  const invalidPlayerForm = new FormData();
  invalidPlayerForm.append('gameId', String(game.id));
  invalidPlayerForm.append('packageId', String(pack.id));
  invalidPlayerForm.append('playerId', '');
  invalidPlayerForm.append('slip', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=', 'base64')], { type: 'image/png' }), 'invalid-player.png');
  const invalidPlayerOrder = await fetch(`${baseUrl}/api/public/orders`, {
    method: 'POST',
    headers: { cookie: cookie.split(';')[0] },
    body: invalidPlayerForm
  });
  assert.equal(invalidPlayerOrder.status, 400);
  assert.equal(uploadCount(), beforeInvalidPlayer);

  const beforeInvalidCoupon = uploadCount();
  const invalidCouponForm = new FormData();
  invalidCouponForm.append('gameId', String(game.id));
  invalidCouponForm.append('packageId', String(pack.id));
  invalidCouponForm.append('playerId', 'CI-PLAYER-INVALID-COUPON');
  invalidCouponForm.append('couponCode', 'NOT-A-REAL-COUPON');
  invalidCouponForm.append('slip', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=', 'base64')], { type: 'image/png' }), 'invalid-coupon.png');
  const invalidCouponOrder = await fetch(`${baseUrl}/api/public/orders`, {
    method: 'POST',
    headers: { cookie: cookie.split(';')[0] },
    body: invalidCouponForm
  });
  assert.equal(invalidCouponOrder.status, 422);
  assert.equal(uploadCount(), beforeInvalidCoupon);

  // Upload a synthetic PNG only; never use a real payment slip in CI.
  const form = new FormData();
  form.append('gameId', String(game.id));
  form.append('packageId', String(pack.id));
  form.append('playerId', 'CI-PLAYER-01');
  form.append('couponCode', coupon.code);
  form.append('slip', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=', 'base64')], { type: 'image/png' }), 'synthetic.png');
  const orderResponse = await fetch(`${baseUrl}/api/public/orders`, {
    method: 'POST',
    headers: { cookie: cookie.split(';')[0] },
    body: form
  });
  assert.equal(orderResponse.status, 201);
  const order = (await orderResponse.json()).order;
  assert.equal(order.status, 'Pending');
  assert.equal(order.total, 19);
  assert.equal((await fetch(`${baseUrl}/api/admin/orders/${order.id}/slip`)).status, 401);
  const privateSlip = await fetch(`${baseUrl}/api/admin/orders/${order.id}/slip`, { headers: { cookie: cookie.split(';')[0] } });
  assert.equal(privateSlip.status, 200);
  assert.equal(privateSlip.headers.get('content-type'), 'image/png');
  assert.equal(privateSlip.headers.get('cache-control'), 'private, no-store');
  const privateFilename = fs.readdirSync(process.env.NOBI_PRIVATE_SLIP_DIR)[0];
  assert.ok(privateFilename);
  assert.equal((await fetch(`${baseUrl}/uploads/${privateFilename}`)).status, 404);

  const completedResponse = await fetch(`${baseUrl}/api/admin/orders/${order.id}/status`, {
    method: 'PATCH',
    headers: adminHeaders,
    body: JSON.stringify({ status: 'Completed' })
  });
  assert.equal(completedResponse.status, 200);
  assert.equal((await completedResponse.json()).status, 'Completed');

  const unchangedStatus = await fetch(`${baseUrl}/api/admin/orders/${order.id}/status`, {
    method: 'PATCH',
    headers: adminHeaders,
    body: JSON.stringify({ status: 'Completed' })
  });
  assert.equal(unchangedStatus.status, 200);

  const forbiddenReverseTransition = await fetch(`${baseUrl}/api/admin/orders/${order.id}/status`, {
    method: 'PATCH',
    headers: adminHeaders,
    body: JSON.stringify({ status: 'Rejected' })
  });
  assert.equal(forbiddenReverseTransition.status, 409);

  // Checkout can be created before payment; the customer gets 15 minutes to submit a slip.
  const prepayForm = new FormData();
  prepayForm.append('gameId', String(game.id));
  prepayForm.append('packageId', String(pack.id));
  prepayForm.append('playerId', 'CI-PREPAY-15M');
  const prepayResponse = await fetch(`${baseUrl}/api/public/orders`, { method: 'POST', body: prepayForm });
  assert.equal(prepayResponse.status, 201);
  const prepay = await prepayResponse.json();
  assert.equal(prepay.order.status, 'Pending');
  assert.equal(prepay.order.slip_submitted_at, null);
  assert.ok(Date.parse(prepay.order.payment_expires_at) - Date.now() > 14 * 60 * 1000);
  assert.ok(Date.parse(prepay.order.payment_expires_at) - Date.now() <= 15 * 60 * 1000);
  const prematureCompletion = await fetch(`${baseUrl}/api/admin/orders/${prepay.order.id}/status`, { method: 'PATCH', headers: adminHeaders, body: JSON.stringify({ status: 'Completed' }) });
  assert.equal(prematureCompletion.status, 409);
  const prepaySlipForm = new FormData();
  prepaySlipForm.append('slip', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=', 'base64')], { type: 'image/png' }), 'prepay.png');
  const prepaySlip = await fetch(`${baseUrl}/api/public/orders/${prepay.order.id}/slip`, { method: 'POST', headers: { authorization: `Bearer ${prepay.checkout_token}` }, body: prepaySlipForm });
  assert.equal(prepaySlip.status, 201);
  const prepayCompleted = await fetch(`${baseUrl}/api/admin/orders/${prepay.order.id}/status`, { method: 'PATCH', headers: adminHeaders, body: JSON.stringify({ status: 'Completed' }) });
  assert.equal(prepayCompleted.status, 200);

  // A dated coupon grants the whole Bangkok expiry date, not an extra 15-minute cap.
  const datedCouponResponse = await fetch(`${baseUrl}/api/admin/coupons`, {
    method: 'POST', headers: adminHeaders,
    body: JSON.stringify({ code: 'CI-DATED-RESERVE', discount_type: 'fixed', discount_value: 1, game_id: game.id, expires_at: '2099-12-31', usage_limit: 1 })
  });
  assert.equal(datedCouponResponse.status, 201);
  const datedCoupon = await datedCouponResponse.json();
  const datedOrderForm = new FormData();
  datedOrderForm.append('gameId', String(game.id)); datedOrderForm.append('packageId', String(pack.id));
  datedOrderForm.append('playerId', 'CI-DATED-COUPON'); datedOrderForm.append('couponCode', datedCoupon.code);
  const datedOrderResponse = await fetch(`${baseUrl}/api/public/orders`, { method: 'POST', body: datedOrderForm });
  assert.equal(datedOrderResponse.status, 201);
  const datedOrder = (await datedOrderResponse.json()).order;
  assert.equal(datedOrder.payment_expires_at, '2099-12-31T17:00:00.000Z');
  const blockedByReservationForm = new FormData();
  blockedByReservationForm.append('gameId', String(game.id)); blockedByReservationForm.append('packageId', String(pack.id));
  blockedByReservationForm.append('playerId', 'CI-DATED-COUPON-2'); blockedByReservationForm.append('couponCode', datedCoupon.code);
  const blockedByReservation = await fetch(`${baseUrl}/api/public/orders`, { method: 'POST', body: blockedByReservationForm });
  assert.equal(blockedByReservation.status, 422);
  const db = require('../src/db/sqlite');
  assert.equal(db.prepare('SELECT used_count FROM coupons WHERE id=?').get(datedCoupon.id).used_count, 1);
  const rejectDatedOrder = await fetch(`${baseUrl}/api/admin/orders/${datedOrder.id}/status`, { method: 'PATCH', headers: adminHeaders, body: JSON.stringify({ status: 'Rejected' }) });
  assert.equal(rejectDatedOrder.status, 200);
  assert.equal(db.prepare('SELECT used_count FROM coupons WHERE id=?').get(datedCoupon.id).used_count, 0);
  const expiredOrderForm = new FormData();
  expiredOrderForm.append('gameId', String(game.id)); expiredOrderForm.append('packageId', String(pack.id));
  expiredOrderForm.append('playerId', 'CI-DATED-EXPIRE'); expiredOrderForm.append('couponCode', datedCoupon.code);
  const expiredOrderResponse = await fetch(`${baseUrl}/api/public/orders`, { method: 'POST', body: expiredOrderForm });
  assert.equal(expiredOrderResponse.status, 201);
  const expiredOrder = (await expiredOrderResponse.json()).order;
  db.prepare("UPDATE orders SET payment_expires_at=? WHERE id=?").run(new Date(Date.now() - 1000).toISOString(), expiredOrder.id);
  await fetch(`${baseUrl}/api/health`);
  assert.equal(db.prepare('SELECT status FROM orders WHERE id=?').get(expiredOrder.id).status, 'Expired');
  assert.equal(db.prepare('SELECT used_count FROM coupons WHERE id=?').get(datedCoupon.id).used_count, 0);

  const ordersResponse = await fetch(`${baseUrl}/api/admin/orders`, {
    headers: { cookie: cookie.split(';')[0] }
  });
  assert.equal(ordersResponse.status, 200);
  const orders = await ordersResponse.json();
  assert.ok(orders.some(item => item.id === order.id && item.status === 'Completed' && item.has_slip === true));
  assert.ok(orders.every(item => !Object.hasOwn(item, 'slip_path')), 'Admin list must not expose private filesystem paths');

  const invalidStatus = await fetch(`${baseUrl}/api/admin/orders/${order.id}/status`, {
    method: 'PATCH',
    headers: adminHeaders,
    body: JSON.stringify({ status: 'Paid' })
  });
  assert.equal(invalidStatus.status, 400);

  const rejectedDelete = await fetch(`${baseUrl}/api/admin/games/${game.id}`, {
    method: 'DELETE',
    headers: { cookie: cookie.split(';')[0], origin: baseUrl }
  });
  assert.equal(rejectedDelete.status, 409);

  const publicUploadCount = () => fs.readdirSync(path.join(process.env.NOBI_UPLOAD_DIR, 'public')).length;
  const beforeForgedUpload = publicUploadCount();
  const forgedImageForm = new FormData();
  forgedImageForm.append('image', new Blob(['not a PNG'], { type: 'image/png' }), 'forged.png');
  const forgedImage = await fetch(`${baseUrl}/api/admin/upload`, {
    method: 'POST',
    headers: { cookie: cookie.split(';')[0], origin: baseUrl },
    body: forgedImageForm
  });
  assert.equal(forgedImage.status, 415);
  assert.equal(publicUploadCount(), beforeForgedUpload, 'forged image should be deleted');

  const badUploadForm = new FormData();
  badUploadForm.append('image', new Blob(['not an image'], { type: 'text/plain' }), 'not-image.txt');
  const badUpload = await fetch(`${baseUrl}/api/admin/upload`, {
    method: 'POST',
    headers: { cookie: cookie.split(';')[0], origin: baseUrl },
    body: badUploadForm
  });
  assert.equal(badUpload.status, 400);

  const oversizedForm = new FormData();
  oversizedForm.append('image', new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: 'image/png' }), 'oversized.png');
  const oversizedUpload = await fetch(`${baseUrl}/api/admin/upload`, {
    method: 'POST',
    headers: { cookie: cookie.split(';')[0], origin: baseUrl },
    body: oversizedForm
  });
  const oversizedBody = await oversizedUpload.json();
  assert.equal(oversizedUpload.status, 400, JSON.stringify(oversizedBody));
  assert.match(oversizedBody.error, /5 MB/);

  const deletePromotion = await fetch(`${baseUrl}/api/admin/promotions/${promotion.id}`, {
    method: 'DELETE',
    headers: { cookie: cookie.split(';')[0], origin: baseUrl }
  });
  assert.equal(deletePromotion.status, 200);

  const logout = await fetch(`${baseUrl}/api/admin/logout`, {
    method: 'POST',
    headers: { cookie: cookie.split(';')[0], origin: baseUrl }
  });
  assert.equal(logout.status, 200);

  const afterLogout = await fetch(`${baseUrl}/api/admin/dashboard`, {
    headers: { cookie: cookie.split(';')[0] }
  });
  assert.equal(afterLogout.status, 401);
});
