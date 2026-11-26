'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'staging', 'api-only', 'Code.gs'),
  'utf8'
);

function loadHelpers(properties = {}) {
  const context = {
    PropertiesService: { getScriptProperties: () => ({
      getProperty: key => Object.prototype.hasOwnProperty.call(properties,key) ? properties[key] : null
    }) },
    Utilities: { computeDigest: () => [] }
  };
  vm.runInNewContext(source + `
    globalThis.__expiry=walletResolveBonusExpiry_;
    globalThis.__method=walletConfiguredTopupMethod_;
    globalThis.__requestKey=walletRequestKey_;
    globalThis.__publicTopup=walletPublicTopup_;
  `, context);
  return context;
}

test('Bonus expiry accepts finite whole-day duration from grant time', () => {
  const ctx = loadHelpers();
  const now = Date.parse('2026-11-26T00:00:00.000Z');
  assert.equal(ctx.__expiry({durationDays:7},now),'2026-12-03T00:00:00.000Z');
  assert.throws(() => ctx.__expiry({durationDays:0},now),/WALLET_BONUS_DURATION_INVALID/);
  assert.throws(() => ctx.__expiry({durationDays:1.5},now),/WALLET_BONUS_DURATION_INVALID/);
  assert.throws(() => ctx.__expiry({durationDays:3651},now),/WALLET_BONUS_DURATION_INVALID/);
});

test('Bonus expiry requires an explicit Bangkok offset or UTC marker and must be future', () => {
  const ctx = loadHelpers();
  const now = Date.parse('2026-11-26T00:00:00.000Z');
  assert.equal(ctx.__expiry({expiresAt:'2026-11-27T23:59:59+07:00'},now),'2026-11-27T16:59:59.000Z');
  assert.throws(() => ctx.__expiry({expiresAt:'2026-11-27T23:59:59'},now),/WALLET_BONUS_EXPIRY_OFFSET_REQUIRED/);
  assert.throws(() => ctx.__expiry({expiresAt:'2026-11-25T23:59:59+07:00'},now),/WALLET_BONUS_EXPIRY_INVALID/);
  assert.throws(() => ctx.__expiry({durationDays:1,expiresAt:'2026-11-27T00:00:00+07:00'},now),/WALLET_BONUS_EXPIRY_AMBIGUOUS/);
});

test('Only already-configured PromptPay is accepted as the initial top-up method', () => {
  const missing = loadHelpers({});
  assert.throws(() => missing.__method('PROMPTPAY'),/WALLET_PAYMENT_METHOD_NOT_CONFIGURED/);
  const configured = loadHelpers({NOBI_PROMPTPAY_ID:'0812345678'});
  assert.equal(configured.__method('promptpay'),'PROMPTPAY');
  assert.throws(() => configured.__method('BANK_TRANSFER'),/WALLET_PAYMENT_METHOD_NOT_CONFIGURED/);
});

test('Top-up request keys are bounded and public top-up projection omits private Drive identifiers', () => {
  const ctx = loadHelpers();
  assert.equal(ctx.__requestKey('client-key-123456'),'client-key-123456');
  assert.throws(() => ctx.__requestKey('short'),/WALLET_REQUEST_KEY_INVALID/);
  const safe = ctx.__publicTopup({
    topup_id:'topup-1',amount_satang:5000,status:'PENDING_REVIEW',
    payment_method:'PROMPTPAY',payment_reference:'ref-1',
    slip_file_id:'private-drive-file-id',slip_mime_type:'image/png',
    submitted_at:'2026-11-26T00:00:00.000Z',created_at:'2026-11-25T00:00:00.000Z'
  });
  assert.equal(safe.topupId,'topup-1');
  assert.equal(Object.hasOwn(safe,'slip_file_id'),false);
  assert.equal(Object.hasOwn(safe,'slipFileId'),false);
});

test('All top-up write entry points enforce the single-writer gate', () => {
  for (const name of ['memberCreateWalletTopup','memberSubmitWalletTopupProof','adminApproveWalletTopup','adminRejectWalletTopup']) {
    const start=source.indexOf('function '+name+'(');
    assert.notEqual(start,-1,name);
    const next=source.indexOf('\nfunction ',start+10);
    const body=source.slice(start,next<0?source.length:next);
    assert.match(body,/walletAssertWriteGateLocked_\(\)/,name+' must use cutover gate');
  }
});

test('Schema v6 recovery journal carries idempotency, top-up and audit recovery payloads', () => {
  assert.match(source,/wallet_recovery_journal: \[[^\]]*'idempotency_key'[^\]]*'payload_hash'[^\]]*'topup_patch_json'[^\]]*'audit_patch_json'/);
  assert.match(source,/function walletPrepareCreditJournalLocked_\(input\)[\s\S]*?priorJournals=repositoryFindByField_\('wallet_recovery_journal','idempotency_key',idempotencyKey\)/);
  assert.match(source,/WALLET_IDEMPOTENCY_CONFLICT/);
});
