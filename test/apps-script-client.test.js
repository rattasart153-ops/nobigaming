'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
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
  assert.throws(() => createAppsScriptClient({ url: 'https://attacker.example/macros/s/test/exec', secret }), error => error.code === 'GATEWAY_NOT_CONFIGURED');
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

test('GAS gateway allowlist matches the dispatcher and HtmlService router is isolated', () => {
  const gasDir = path.join(__dirname, '..', 'google-apps-script');
  const gateway = fs.readFileSync(path.join(gasDir, '13_HttpGateway.gs'), 'utf8');
  const entry = fs.readFileSync(path.join(gasDir, 'Code.gs'), 'utf8');
  const dispatcher = fs.readFileSync(path.join(gasDir, '01_HttpEntry.gs'), 'utf8');
  const allowlistBlock = gateway.match(/ALLOWED_ACTIONS:\s*\[([\s\S]*?)\]/);
  assert.ok(allowlistBlock, 'gateway action allowlist must exist');
  const allowed = Array.from(allowlistBlock[1].matchAll(/'([^']+)'/g), match => match[1]).sort();
  const dispatched = Array.from(dispatcher.matchAll(/case '([^']+)'/g), match => match[1]).sort();
  assert.deepEqual(allowed, dispatched, 'every gateway action must have one explicit dispatcher case');
  assert.ok(gateway.includes('function doPost(e)'), 'GAS HTTP POST entry point must exist');
  assert.ok(gateway.includes('dispatchGatewayAction_('), 'signed requests must use the HTTP dispatcher');
  assert.ok(entry.includes('function doGet(e)'), 'HtmlService web entry point must exist');
  assert.ok(entry.includes('HtmlService.createTemplateFromFile(templateName)'), 'doGet must route through the fixed template allowlist');
  assert.equal(entry.includes('rpc('), false, 'entry point must not expose a generic RPC dispatcher');
  assert.ok(gateway.includes('Utilities.computeHmacSha256Signature'), 'gateway must verify HMAC-SHA256');
  assert.ok(gateway.includes('LockService.getScriptLock'), 'nonce claims must be serialized');
  const config = fs.readFileSync(path.join(gasDir, '00_Config.gs'), 'utf8');
  assert.ok(config.includes("gateway_nonces: ['nonce_hash','created_at']"), 'configuration schema must include nonce ledger');
});

test('all Apps Script modules parse and define unique top-level functions', () => {
  const gasDir = path.join(__dirname, '..', 'google-apps-script');
  const files = fs.readdirSync(gasDir).filter(name => name.endsWith('.gs')).sort();
  assert.ok(files.length >= 12, 'focused GAS modules must be present');
  const definitions = new Map();
  for (const file of files) {
    const source = fs.readFileSync(path.join(gasDir, file), 'utf8');
    assert.doesNotThrow(() => new vm.Script(source, { filename: file }), file + ' must parse as JavaScript');
    assert.equal(/\bHtmlService\b/.test(source), file === 'Code.gs', file + ' may use HtmlService only in Code.gs');
    assert.equal(/google\.script\.run/.test(source), false, file + ' must not contain client RPC code');
    assert.equal(/\bfunction\s+rpc\s*\(/.test(source), false, file + ' must not define legacy rpc()');
    for (const match of source.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
      const name = match[1];
      assert.equal(definitions.has(name), false, 'duplicate GAS global function: ' + name + ' (' + file + ' and ' + definitions.get(name) + ')');
      definitions.set(name, file);
    }
  }
});


function makeGatewayVerifier({schemaAvailable=true}={}) {
  const rows=[['nonce_hash','created_at']];
  const sheet={
    getLastRow:()=>rows.length,
    getRange:(row,column,rowCount=1,columnCount=1)=>({
      getValue:()=>rows[row-1]?.[column-1]??'',
      getValues:()=>Array.from({length:rowCount},(_,r)=>Array.from({length:columnCount},(_,c)=>rows[row+r-1]?.[column+c-1]??''))
    }),
    deleteRows:(start,count)=>rows.splice(start-1,count),
    appendRow:row=>rows.push(row.slice())
  };
  const context={
    Date,
    PropertiesService:{getScriptProperties:()=>({getProperty:key=>key==='NOBI_GATEWAY_SECRET'?secret:'test-sheet-id'})},
    Utilities:{
      computeHmacSha256Signature:(value,key)=>Array.from(crypto.createHmac('sha256',key).update(value).digest()).map(byte=>byte>127?byte-256:byte)
    },
    LockService:{getScriptLock:()=>({waitLock:()=>{},releaseLock:()=>{}})},
    databaseAssertSchema_:name=>{
      if(!schemaAvailable||name!=='gateway_nonces')throw new Error('GATEWAY_SCHEMA_MISSING');
      return {sheet};
    },
    sha256_:value=>crypto.createHash('sha256').update(String(value)).digest('hex')
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..','google-apps-script','13_HttpGateway.gs'),'utf8'),context,{filename:'13_HttpGateway.gs'});
  return {context,rows};
}

function signedGatewayEnvelope(overrides={}) {
  const envelope={
    version:1,
    timestamp:Date.now(),
    nonce:'nonce-for-gateway-test-123456',
    action:'catalog',
    args:{},
    ...overrides
  };
  envelope.signature=crypto.createHmac('sha256',secret).update(canonicalEnvelope(envelope)).digest('hex');
  return envelope;
}

test('GAS gateway rejects bad signatures, stale timestamps and unlisted actions before claiming a nonce',()=>{
  const {context,rows}=makeGatewayVerifier();
  const bad=signedGatewayEnvelope({nonce:'nonce-bad-signature-123456'});
  bad.signature='0'.repeat(64);
  assert.equal(context.verifyGatewayEnvelope_(bad).error.code,'INVALID_SIGNATURE');
  assert.equal(context.verifyGatewayEnvelope_(signedGatewayEnvelope({
    timestamp:Date.now()-10*60*1000,nonce:'nonce-stale-request-123456'
  })).error.code,'STALE_REQUEST');
  assert.equal(context.verifyGatewayEnvelope_(signedGatewayEnvelope({
    action:'deleteEverything',nonce:'nonce-invalid-action-123456'
  })).error.code,'ACTION_NOT_ALLOWED');
  assert.equal(rows.length,1,'rejected requests must not consume nonce records');
});

test('GAS gateway HMAC binds action arguments and rejects tampering before nonce claim',()=>{
  const {context,rows}=makeGatewayVerifier();
  const envelope=signedGatewayEnvelope({nonce:'nonce-args-tamper-1234567890'});
  envelope.args={admin:true,token:'forged'};
  const result=context.verifyGatewayEnvelope_(envelope);
  assert.equal(result.ok,false);
  assert.equal(result.error.code,'INVALID_SIGNATURE');
  assert.equal(rows.length,1,'tampered requests must not consume nonce records');
});

test('GAS gateway fails closed when the nonce ledger schema is missing and rejects replayed signed requests',()=>{
  const missing=makeGatewayVerifier({schemaAvailable:false});
  assert.throws(()=>missing.context.verifyGatewayEnvelope_(signedGatewayEnvelope({
    nonce:'nonce-missing-schema-123456'
  })),/GATEWAY_SCHEMA_MISSING/);
  const valid=makeGatewayVerifier();
  const envelope=signedGatewayEnvelope({nonce:'nonce-valid-replay-123456'});
  assert.equal(valid.context.verifyGatewayEnvelope_(envelope).ok,true);
  assert.equal(valid.context.verifyGatewayEnvelope_(envelope).error.code,'REPLAYED_REQUEST');
  assert.equal(valid.rows.length,2,'only the first signed request should claim a nonce');
});
