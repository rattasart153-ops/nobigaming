'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sourcePath = path.join(__dirname, '..', 'google-apps-script', 'BrowserFacade.gs');
const plain = value => JSON.parse(JSON.stringify(value));

function loadFacade() {
  const calls = [];
  const context = {
    dispatchGatewayAction_(action, args) {
      calls.push({ action, args });
      return { action, args };
    }
  };
  vm.createContext(context);
  const source = fs.readFileSync(sourcePath, 'utf8');
  vm.runInContext(source, context, { filename: 'BrowserFacade.gs' });
  return { context, calls, source };
}

test('public facade exposes named functions for every existing business action', () => {
  const { source } = loadFacade();
  const names = Array.from(source.matchAll(/^function (nobi[A-Za-z0-9]+)\(/gm), match => match[1]);
  assert.equal(names.length, 28);
  for (const name of [
    'nobiGetCatalog','nobiGetPromotions','nobiValidateCoupon','nobiGetCouponSuggestions',
    'nobiGetPaymentInfo','nobiCreateOrder','nobiSubmitOrderSlip','nobiRegisterMember',
    'nobiLoginMember','nobiGetMemberSession','nobiLogoutMember','nobiChangeMemberPassword',
    'nobiLoginAdmin','nobiGetAdminSession','nobiLogoutAdmin','nobiChangeAdminPassword',
    'nobiGetAdminDashboard','nobiGetAdminOrders','nobiGetAdminSlip','nobiSetAdminOrderStatus',
    'nobiListAdminRecords','nobiUpsertAdminRecord','nobiDeleteAdminRecord',
    'nobiGetAdminMemberLoginLogs','nobiGetAdminMembers','nobiSetAdminMemberStatus',
    'nobiUploadAdminMedia','nobiGetPublicMedia'
  ]) assert.ok(names.includes(name), 'missing callable facade function: ' + name);
  assert.match(source, /function nobiFacadeCall_\(/, 'internal dispatcher must remain private by trailing underscore');
  assert.doesNotMatch(source, /^function (?:api|callAction|dispatch|nobiCall)[A-Za-z0-9]*\(/m,
    'no generic browser action dispatcher may be exposed');
});

test('coupon facade derives Member identity only from the optional verified token', () => {
  const { context, calls } = loadFacade();
  context.nobiValidateCoupon({ code: 'SAVE10', gameId: 'game-1', subtotal: 100, playerId: 'uid-1', memberToken: 'member-token' });
  assert.deepEqual(plain(calls[0]), {
    action: 'coupon',
    args: { code: 'SAVE10', gameId: 'game-1', subtotal: 100, playerId: 'uid-1', member_token: 'member-token' }
  });
  assert.throws(() => context.nobiValidateCoupon({
    code: 'SAVE10', gameId: 'game-1', subtotal: 100, ipAddress: '203.0.113.1'
  }), /ฟิลด์ที่ไม่อนุญาต/);
  assert.equal(calls.length, 1, 'invalid arguments must not reach business handlers');
});

test('create-order facade maps only approved checkout fields and keeps server-owned identity', () => {
  const { context, calls } = loadFacade();
  context.nobiCreateOrder({
    requestKey: 'request-key-12345678', gameId: 'g1', packageId: 'p1',
    playerId: 'player-1', serverId: 'server-1', couponCode: 'SAVE10', memberToken: 'member-token'
  });
  assert.deepEqual(plain(calls[0].args), {
    request_key: 'request-key-12345678', game_id: 'g1', package_id: 'p1',
    player_id: 'player-1', server_id: 'server-1', coupon_code: 'SAVE10',
    member_token: 'member-token'
  });
  assert.equal(Object.hasOwn(calls[0].args, 'member_id'), false);
  assert.throws(() => context.nobiCreateOrder({
    requestKey: 'request-key-12345678', gameId: 'g1', packageId: 'p1',
    playerId: 'player-1', member_id: 'forged-member'
  }), /ฟิลด์ที่ไม่อนุญาต/);
});

test('slip and media facade enforce bounded image payloads and strict nested fields', () => {
  const { context, calls } = loadFacade();
  context.nobiSubmitOrderSlip({
    orderId: 'order-1', checkoutToken: 'checkout-token',
    slip: { name: 'slip.png', mimeType: 'image/png', base64: 'c2xp cA==' }
  });
  assert.equal(calls[0].action, 'submitOrderSlip');
  assert.equal(calls[0].args.order_id, 'order-1');
  assert.equal(calls[0].args.slip.mimeType, 'image/png');
  assert.throws(() => context.nobiSubmitOrderSlip({
    orderId: 'order-1', checkoutToken: 'checkout-token',
    slip: { mimeType: 'image/png', base64: 'x', ipAddress: 'forged' }
  }), /ฟิลด์ที่ไม่อนุญาต/);
  assert.throws(() => context.nobiUploadAdminMedia({
    token: 'admin-token', media: { mimeType: 'image/png', base64: 'x'.repeat(4200001) }
  }), /ขนาดเกินกำหนด/);
  assert.equal(calls.length, 1, 'invalid image payloads must not reach business handlers');
});

test('Admin facade accepts no browser-supplied IP and keeps CRUD table names explicit', () => {
  const { context, calls } = loadFacade();
  context.nobiLoginAdmin({ username: 'NobiAdmin', password: 'long-password' });
  assert.deepEqual(calls[0], {
    action: 'adminLogin', args: { username: 'NobiAdmin', password: 'long-password' }
  });
  context.nobiListAdminRecords({ token: 'admin-token', tableName: 'games' });
  assert.deepEqual(plain(calls[1].args), { token: 'admin-token', tableName: 'games' });
  context.nobiUpsertAdminRecord({ token: 'admin-token', tableName: 'games', record: { name: 'RoV' } });
  assert.deepEqual(plain(calls[2].args.record), { name: 'RoV' });
  assert.throws(() => context.nobiLoginAdmin({
    username: 'NobiAdmin', password: 'long-password', ipAddress: '203.0.113.1'
  }), /ฟิลด์ที่ไม่อนุญาต/);
  assert.equal(calls.length, 3);
});

test('every named browser wrapper maps to one fixed existing business action', () => {
  const { context, calls } = loadFacade();
  context.nobiGetCatalog();
  context.nobiGetPromotions();
  context.nobiValidateCoupon({ gameId: 'g', subtotal: 1 });
  context.nobiGetCouponSuggestions({ gameId: 'g', subtotal: 1 });
  context.nobiGetPaymentInfo({});
  context.nobiCreateOrder({ requestKey: '1234567890123456', gameId: 'g', packageId: 'p', playerId: 'uid' });
  context.nobiSubmitOrderSlip({ orderId: 'o', checkoutToken: 'c', slip: { mimeType: 'image/png', base64: 'x' } });
  context.nobiLoginAdmin({ username: 'admin', password: 'password' });
  context.nobiRegisterMember({ fullName: 'Member', loginId: 'user1', password: 'password123' });
  context.nobiLoginMember({ loginId: 'user1', password: 'password123' });
  context.nobiGetMemberSession('member-token');
  context.nobiLogoutMember('member-token');
  context.nobiChangeMemberPassword({ token: 'member-token', currentPassword: 'old', newPassword: 'new' });
  context.nobiChangeAdminPassword({ token: 'admin-token', currentPassword: 'old', newPassword: 'new' });
  context.nobiGetAdminSession('admin-token');
  context.nobiLogoutAdmin('admin-token');
  context.nobiGetAdminDashboard('admin-token');
  context.nobiGetAdminOrders('admin-token');
  context.nobiGetAdminSlip({ token: 'admin-token', orderId: 'o' });
  context.nobiSetAdminOrderStatus({ token: 'admin-token', orderId: 'o', status: 'Completed' });
  context.nobiListAdminRecords({ token: 'admin-token', tableName: 'games' });
  context.nobiUpsertAdminRecord({ token: 'admin-token', tableName: 'games', record: { name: 'RoV' } });
  context.nobiDeleteAdminRecord({ token: 'admin-token', tableName: 'games', id: 'g' });
  context.nobiGetAdminMemberLoginLogs({ token: 'admin-token' });
  context.nobiGetAdminMembers({ token: 'admin-token' });
  context.nobiSetAdminMemberStatus({ token: 'admin-token', memberId: 'm', status: 'Active' });
  context.nobiUploadAdminMedia({ token: 'admin-token', media: { mimeType: 'image/png', base64: 'x' } });
  context.nobiGetPublicMedia('media-id');
  assert.deepEqual(calls.map(call => call.action), [
    'catalog','promotions','coupon','couponSuggestions','paymentInfo','createOrder',
    'submitOrderSlip','adminLogin','memberRegister','memberLogin','memberMe',
    'memberLogout','memberChangePassword','adminChangePassword','adminMe','adminLogout',
    'adminDashboard','adminOrders','adminSlipData','adminSetOrderStatus','adminList',
    'adminUpsert','adminDelete','adminMemberLoginLogs','adminMembers',
    'adminSetMemberStatus','adminStoreMedia','publicMediaData'
  ]);
});

test('token and file identifiers reject invalid types and oversized values', () => {
  const { context, calls } = loadFacade();
  assert.throws(() => context.nobiGetAdminDashboard({ token: 'admin-token' }), /โทเคนไม่ถูกต้อง/);
  assert.throws(() => context.nobiGetPublicMedia('x'.repeat(201)), /รหัสรูปภาพไม่ถูกต้อง/);
  assert.equal(calls.length, 0);
});
