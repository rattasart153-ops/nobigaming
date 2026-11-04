'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createAppsScriptClient, AppsScriptGatewayError, canonicalEnvelope } = require('../src/clients/apps-script.client');

const secret = 'test-shared-secret-that-is-long-enough-for-hmac';

test('Apps Script client signs versioned requests and returns gateway result', async () => {
  let captured;
  const client = createAppsScriptClient({
    url: 'https://script.google.com/macros/s/test/exec',
    secret,
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://script.google.com/macros/s/test/exec');
      assert.equal(options.method, 'POST');
      assert.equal(options.redirect, 'manual');
      captured = JSON.parse(options.body);
      const expected = crypto.createHmac('sha256', secret).update(canonicalEnvelope(captured)).digest('hex');
      assert.equal(captured.signature, expected);
      assert.equal(captured.version, 1);
      assert.equal(captured.action, 'catalog');
      assert.deepEqual(captured.args, { includeInactive: false });
      assert.match(captured.nonce, /^[A-Za-z0-9_-]{20,100}$/);
      return { ok: true, json: async () => ({ ok: true, version: 1, result: { games: [], packages: [] } }) };
    }
  });
  assert.deepEqual(await client.call('catalog', { includeInactive: false }), { games: [], packages: [] });
  assert.ok(captured.timestamp > 0);
});

test('Apps Script client fails closed when gateway configuration is missing', () => {
  assert.throws(() => createAppsScriptClient({ url: '', secret }), AppsScriptGatewayError);
  assert.throws(() => createAppsScriptClient({ url: 'https://script.google.com/macros/s/test/exec', secret: 'short' }), AppsScriptGatewayError);
});

test('Apps Script client validates ContentService redirect before following it', async () => {
  let calls = 0;
  const allowed = createAppsScriptClient({
    url: 'https://script.google.com/macros/s/test/exec',
    secret,
    fetchImpl: async (url, options) => {
      calls++;
      if (calls === 1) {
        assert.equal(options.method, 'POST');
        return { status: 302, headers: { get: name => name === 'location' ? 'https://script.googleusercontent.com/macros/echo?key=test' : null } };
      }
      assert.equal(url, 'https://script.googleusercontent.com/macros/echo?key=test');
      assert.equal(options.method, 'GET', 'signed POST body must not be forwarded');
      return { status: 200, ok: true, url, json: async () => ({ ok: true, version: 1, result: 'ok' }) };
    }
  });
  assert.equal(await allowed.call('catalog'), 'ok');
  assert.equal(calls, 2);

  const blocked = createAppsScriptClient({
    url: 'https://script.google.com/macros/s/test/exec',
    secret,
    fetchImpl: async () => ({ status: 302, headers: { get: name => name === 'location' ? 'https://attacker.example/redirect' : null } })
  });
  await assert.rejects(blocked.call('catalog'), error => error.code === 'UNTRUSTED_GATEWAY_REDIRECT');
});

test('Apps Script client maps signed gateway rejections to typed errors', async () => {
  const client = createAppsScriptClient({
    url: 'https://script.google.com/macros/s/test/exec',
    secret,
    fetchImpl: async () => ({ ok: true, json: async () => ({ ok: false, version: 1, error: { code: 'INVALID_SIGNATURE', message: 'Request authentication failed' } }) })
  });
  await assert.rejects(client.call('catalog'), error => error.code === 'INVALID_SIGNATURE' && error.status === 502);
});

test('Apps Script client does not retry a failed mutation implicitly', async () => {
  let calls = 0;
  const client = createAppsScriptClient({
    url: 'https://script.google.com/macros/s/test/exec',
    secret,
    fetchImpl: async () => { calls++; throw new Error('network down'); }
  });
  await assert.rejects(client.call('createOrder', { request_key: 'stable-key-123456' }), error => error.code === 'GATEWAY_UNREACHABLE');
  assert.equal(calls, 1);
});

test('GAS gateway action allowlist matches the legacy rpc dispatcher and replay schema', () => {
  const gateway = fs.readFileSync(path.join(__dirname, '..', 'google-apps-script', '13_HttpGateway.gs'), 'utf8');
  const code = fs.readFileSync(path.join(__dirname, '..', 'google-apps-script', 'Code.gs'), 'utf8');
  const allowlistBlock = gateway.match(/ALLOWED_ACTIONS:\s*\[([\s\S]*?)\]/);
  assert.ok(allowlistBlock, 'gateway action allowlist must exist');
  const allowed = Array.from(allowlistBlock[1].matchAll(/'([^']+)'/g), match => match[1]).sort();
  const dispatched = Array.from(code.matchAll(/case '([^']+)'/g), match => match[1]).sort();
  assert.deepEqual(allowed, dispatched, 'every gateway action must have an explicit rpc dispatcher case and vice versa');
  assert.ok(gateway.includes('function doPost(e)'), 'GAS HTTP entry point must exist');
  assert.ok(code.includes('function doGet()'), 'minimal gateway health endpoint must exist');
  assert.equal(code.includes('HtmlService'), false, 'GAS project must not depend on HtmlService frontend files');
  assert.ok(gateway.includes('Utilities.computeHmacSha256Signature'), 'gateway must verify HMAC-SHA256');
  assert.ok(gateway.includes('LockService.getScriptLock'), 'nonce claims must be serialized');
  assert.ok(code.includes("gateway_nonces: ['nonce_hash','created_at']"), 'database setup must create the nonce ledger');
});
