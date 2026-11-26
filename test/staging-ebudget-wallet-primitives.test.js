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

function loadWalletGuards(properties) {
  const context = {
    PropertiesService: { getScriptProperties: () => ({
      getProperty: key => Object.prototype.hasOwnProperty.call(properties,key) ? properties[key] : null
    }) }
  };
  vm.runInNewContext(source + '\nglobalThis.__gate=walletAssertWriteGateLocked_; globalThis.__amount=walletAssertSatang_;', context);
  return context;
}

test('Wallet mutation gate fails closed unless all three single-writer conditions are explicit', () => {
  const blocked = loadWalletGuards({});
  assert.throws(() => blocked.__gate(), /WALLET_WRITES_BLOCKED/);
  const partial = loadWalletGuards({
    NOBI_WALLET_WRITES_ENABLED:'true',
    NOBI_FINANCIAL_WRITER_MODE:'API_ONLY'
  });
  assert.throws(() => partial.__gate(), /WALLET_WRITES_BLOCKED/);
  const enabled = loadWalletGuards({
    NOBI_WALLET_WRITES_ENABLED:'true',
    NOBI_FINANCIAL_WRITER_MODE:'API_ONLY',
    NOBI_LEGACY_WRITER_DISABLED:'true'
  });
  assert.doesNotThrow(() => enabled.__gate());
});

test('Wallet amounts accept only safe integer satang and reject zero for credit grants', () => {
  const context = loadWalletGuards({});
  assert.equal(context.__amount(5000,false),5000);
  for (const value of [0,-1,1.5,'5000',Number.MAX_SAFE_INTEGER+1,null]) {
    assert.throws(() => context.__amount(value,false), /WALLET_INVALID_AMOUNT/);
  }
  assert.equal(context.__amount(0,true),0);
});

test('P1.2 exposes only the implemented top-up and Admin credit actions; checkout and refunds remain disabled', () => {
  const allowlist = source.match(/ALLOWED_ACTIONS:\s*\[([\s\S]*?)\]/);
  assert.ok(allowlist);
  for (const action of [
    'memberWalletSummary','memberCreateWalletOrder','adminRefundWalletOrder',
    'adminCreateWalletOrder','adminWalletReconciliation'
  ]) assert.doesNotMatch(allowlist[1], new RegExp("['\\\"]"+action+"['\\\"]"));
  for (const action of [
    'memberCreateWalletTopup','memberSubmitWalletTopupProof','memberWalletTopups',
    'adminWalletTopups','adminWalletTopupProof','adminApproveWalletTopup','adminRejectWalletTopup',
    'adminGrantPaidCredit','adminCreateBonusGrant'
  ]) assert.match(allowlist[1], new RegExp("['\\\"]"+action+"['\\\"]"));
});

test('Credit journal application is gated and uses immutable transaction lookup before appending', () => {
  assert.match(source,/function walletApplyCreditJournalLocked_\(journal\)\s*\{\s*walletAssertWriteGateLocked_\(\);/);
  assert.match(source,/repositoryFindByField_\('wallet_ledger','transaction_id',ledger\.transaction_id\)/);
  assert.match(source,/walletAssertCacheMatchesLedgerLocked_\(journal\.member_id\)/);
  assert.match(source,/step_state:'COMPLETED'/);
});
