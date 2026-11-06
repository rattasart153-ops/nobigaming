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


test('HtmlService storefront and Admin use named google.script.run facade with memory-only auth tokens', () => {
  for (const file of ['Storefront.html','Admin.html']) {
    const html=fs.readFileSync(path.join(__dirname,'..','google-apps-script',file),'utf8');
    const scripts=[];let cursor=0;
    while((cursor=html.indexOf('<script',cursor))!==-1){
      const openEnd=html.indexOf('>',cursor),close=html.indexOf('</script>',openEnd+1);
      if(openEnd<0||close<0)break;
      scripts.push(html.slice(openEnd+1,close));cursor=close+9;
    }
    assert.ok(scripts.length>0,file+' should contain an inline script');
    scripts.forEach((source,index)=>assert.doesNotThrow(()=>new vm.Script(source,{filename:file+'#script-'+index})));
    const source=scripts.join('\\n');
    assert.ok(source.includes('google.script.run'),file+' must use the named Apps Script facade');
    assert.equal(source.includes('fetch('),false,file+' must not call legacy REST');
    assert.equal(source.includes("setItem('nobi_member_token'"),false);
    assert.equal(source.includes("setItem('nobi_admin_token'"),false);
  }
  const storefront=fs.readFileSync(path.join(__dirname,'..','google-apps-script','Storefront.html'),'utf8');
  const admin=fs.readFileSync(path.join(__dirname,'..','google-apps-script','Admin.html'),'utf8');
  assert.ok(storefront.includes("let nobiMemberToken = ''"));
  assert.ok(storefront.includes("let nobiCheckoutToken = ''"));
  assert.ok(storefront.includes('new QRCode(qrHost'));
  assert.equal(storefront.includes('nobi_active_checkout'),false);
  assert.ok(storefront.includes('nobi_order_attempt'));
  assert.ok(admin.includes("let nobiAdminToken=''"));
  assert.equal(admin.includes('nobi_admin_token'),false);
  assert.equal(admin.includes('localStorage'),false);
  assert.equal(admin.includes('sessionStorage'),false);
});

test('bundled QRCode asset is local, parseable, and carries its MIT notice', () => {
  const html=fs.readFileSync(path.join(__dirname,'..','google-apps-script','QrCode.html'),'utf8');
  const open=html.indexOf('<script>'),close=html.indexOf('</script>',open+8);
  assert.ok(open>=0&&close>open,'QR asset must include a script block');
  const source=html.slice(open+8,close);
  assert.ok(html.includes('MIT License'));
  assert.doesNotThrow(()=>new vm.Script(source,{filename:'QrCode.html'}));
  assert.ok(source.includes('function QRCodeModel'));
});
