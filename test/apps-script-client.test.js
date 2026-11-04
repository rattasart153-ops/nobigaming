'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
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
      assert.equal(options.redirect, 'error');
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
