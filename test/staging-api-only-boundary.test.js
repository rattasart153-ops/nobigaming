'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'staging', 'api-only', 'Code.gs'),
  'utf8'
);

test('API-only Apps Script bundle exposes signed doPost without an HtmlService page renderer', () => {
  assert.match(source, /function doPost\(e\)/);
  assert.doesNotMatch(source, /function doGet\s*\(/);
  assert.doesNotMatch(source, /function include\s*\(/);
  assert.doesNotMatch(source, /HtmlService\.createTemplateFromFile/);
});

test('API-only gateway allowlists the banners action handled by its dispatcher', () => {
  const allowlist = source.match(/ALLOWED_ACTIONS:\s*\[([\s\S]*?)\]/);
  const dispatcher = source.match(/function dispatchGatewayAction_\(action, args\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(allowlist, 'gateway allowlist must exist');
  assert.ok(dispatcher, 'gateway dispatcher must exist');
  assert.match(allowlist[1], /'banners'/);
  assert.match(dispatcher[1], /case 'banners':\s*return publicBanners\(\)/);
});


test('top-up expiry worker has a gated, manual, idempotent trigger installer', () => {
  assert.match(source, /function ensureWalletTopupExpiryTrigger\(\)/);
  const installer = source.match(/function ensureWalletTopupExpiryTrigger\(\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(installer, 'trigger installer must exist');
  assert.match(installer[1], /walletAssertWriteGateLocked_\(\)/);
  assert.match(installer[1], /getProjectTriggers\(\)/);
  assert.match(installer[1], /everyMinutes\(15\)/);
  assert.match(installer[1], /newTrigger\(handler\)/);
  assert.match(installer[1], /NOBI_WALLET_TOPUP_EXPIRY_TRIGGER_ID/);
  assert.match(installer[1], /getUniqueId\(\)/);
  assert.match(installer[1], /existing\.forEach\(function\(trigger\) \{ ScriptApp\.deleteTrigger\(trigger\); \}\)/);
  assert.doesNotMatch(installer[1], /ScriptApp\.newTrigger\(handler\)[\s\S]*?\}\s*ensureWalletTopupExpiryTrigger\(/);
});
