'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const gasDir = path.join(__dirname, '..', 'google-apps-script');

function loadEntry() {
  const calls = [];
  const outputs = [];
  const context = {
    HtmlService: {
      XFrameOptionsMode: { DEFAULT: 'DEFAULT' },
      createHtmlOutputFromFile(name) {
        calls.push('partial:' + name);
        return { getContent() { return '<script>/* bundled */</script>'; } };
      },
      createTemplateFromFile(name) {
        calls.push(name);
        return {
          evaluate() {
            const output = {
              title: '',
              meta: [],
              frameMode: '',
              setTitle(value) { this.title = value; return this; },
              addMetaTag(name, content) { this.meta.push([name, content]); return this; },
              setXFrameOptionsMode(value) { this.frameMode = value; return this; }
            };
            outputs.push(output);
            return output;
          }
        };
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(gasDir, 'Code.gs'), 'utf8'), context, { filename: 'Code.gs' });
  return { context, calls, outputs };
}

test('HtmlService doGet routes the default page to Storefront without initializing resources', () => {
  const { context, calls, outputs } = loadEntry();
  const output = context.doGet({});
  assert.deepEqual(calls, ['Storefront']);
  assert.equal(output.title, 'Nobi Topup — เติมเกมออนไลน์');
  assert.deepEqual(output.meta, [['viewport', 'width=device-width, initial-scale=1']]);
  assert.equal(output.frameMode, 'DEFAULT');
  assert.equal(outputs.length, 1);
});

test('HtmlService doGet routes only the explicit admin page to Admin', () => {
  const { context, calls } = loadEntry();
  const output = context.doGet({ parameter: { page: 'ADMIN' } });
  assert.deepEqual(calls, ['Admin']);
  assert.equal(output.title, 'Nobi Topup · Admin');
});

test('unknown page values fail safely to the storefront template', () => {
  const { context, calls } = loadEntry();
  context.doGet({ parameter: { page: '../../Code' } });
  assert.deepEqual(calls, ['Storefront']);
});

test('Migrated HtmlService templates retain the public structure and use the browser facade', () => {
  const sourceStorefront = fs.readFileSync(path.join(__dirname, '..', 'public', 'nobitopup.html'), 'utf8');
  const sourceAdmin = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');
  const templateStorefront = fs.readFileSync(path.join(gasDir, 'Storefront.html'), 'utf8');
  const templateAdmin = fs.readFileSync(path.join(gasDir, 'Admin.html'), 'utf8');
  assert.ok(templateStorefront.includes('<base target="_top">'));
  assert.ok(templateAdmin.includes('<base target="_top">'));
  assert.ok(templateStorefront.includes("<?!= include('QrCode'); ?>"));
  assert.ok(templateStorefront.includes('google.script.run'));
  assert.ok(templateAdmin.includes('google.script.run'));
  assert.ok(templateStorefront.includes('id="paymentQr"'));
  assert.ok(templateAdmin.includes('id="loginForm"'));
  assert.notEqual(templateStorefront, sourceStorefront);
  assert.notEqual(templateAdmin, sourceAdmin);
  assert.throws(() => { const entry = loadEntry(); entry.context.include('Code'); }, /ไม่อนุญาต/);
});
