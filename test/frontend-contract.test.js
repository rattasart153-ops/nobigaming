'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function readInlineScripts(file) {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', file), 'utf8');
  const scripts = [];
  let cursor = 0;
  while ((cursor = html.indexOf('<script', cursor)) !== -1) {
    const openEnd = html.indexOf('>', cursor);
    const close = html.indexOf('</script>', openEnd + 1);
    if (openEnd < 0 || close < 0) break;
    scripts.push(html.slice(openEnd + 1, close));
    cursor = close + 9;
  }
  return scripts;
}

test('storefront and admin inline scripts parse and use REST API, not Apps Script RPC', () => {
  for (const file of ['nobitopup.html', 'admin.html']) {
    const scripts = readInlineScripts(file);
    assert.ok(scripts.length > 0, file + ' should contain an inline application script');
    scripts.forEach((source, index) => assert.doesNotThrow(() => new vm.Script(source, { filename: file + '#script-' + index }), file + ' inline script syntax'));
    const source = scripts.join('\\n');
    assert.equal(source.includes('google.script.run'), false);
    assert.equal(source.includes('google.script'), false);
    assert.ok(source.includes('fetch('));
  }
  const storefront = readInlineScripts('nobitopup.html').join('\\n');
  for (const contract of ['/api/public/catalog', '/api/public/coupons/validate', '/api/public/orders', 'Idempotency-Key', 'nobi_active_checkout', 'payment_expires_at']) assert.ok(storefront.includes(contract), 'missing storefront contract: ' + contract);
  assert.equal(storefront.includes('checkout_token'), false, 'checkout token must not be exposed to storefront JavaScript');
  assert.equal(storefront.includes('Authorization:\'Bearer '), false, 'checkout token must not be sent as a JavaScript-readable Bearer token');
  assert.ok(storefront.includes('nobi_order_attempt'), 'idempotency key must survive a retry in the current browser session');
  const admin = readInlineScripts('admin.html').join('\\n');
  for (const contract of ["credentials:'same-origin'", 'has_slip', '/api/admin/orders/']) assert.ok(admin.includes(contract), 'missing Admin contract: ' + contract);
  assert.equal(admin.includes('nobi_admin_token'), false);
  assert.equal(admin.includes('slip_file_id'), false);
});
