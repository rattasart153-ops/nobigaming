'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function readInlineScripts(file) {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', file), 'utf8');
  return [...html.matchAll(/<script(?:\\s[^>]*)?>([\\s\\S]*?)<\\/script>/gi)].map(match => match[1]);
}

test('storefront and admin inline scripts parse and use the REST API, not Apps Script RPC', () => {
  for (const file of ['nobitopup.html', 'admin.html']) {
    const scripts = readInlineScripts(file);
    assert.ok(scripts.length > 0, file + ' should contain an inline application script');
    scripts.forEach((source, index) => assert.doesNotThrow(() => new vm.Script(source, { filename: file + '#script-' + index }), file + ' inline script syntax'));
    const source = scripts.join('\\n');
    assert.doesNotMatch(source, /google\\.script\\.run|google\\.script/);
    assert.match(source, /fetch\\(/);
  }

  const storefront = readInlineScripts('nobitopup.html').join('\\n');
  assert.match(storefront, /\\/api\\/public\\/catalog/);
  assert.match(storefront, /\\/api\\/public\\/coupons\\/validate/);
  assert.match(storefront, /\\/api\\/public\\/orders/);
  assert.match(storefront, /checkout_token/);
  assert.match(storefront, /payment_expires_at/);

  const admin = readInlineScripts('admin.html').join('\\n');
  assert.match(admin, /credentials:\\s*['"]same-origin['"]/);
  assert.match(admin, /has_slip/);
  assert.match(admin, /\\/api\\/admin\\/orders\\//);
  assert.doesNotMatch(admin, /nobi_admin_token|slip_file_id/);
});
