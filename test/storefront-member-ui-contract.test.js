'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const storefrontPath = path.join(__dirname, '..', 'google-apps-script', 'Storefront.html');
const adminPath = path.join(__dirname, '..', 'google-apps-script', 'Admin.html');

function readHtml(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function inlineScripts(html) {
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

function formMarkup(html, id) {
  const match = html.match(new RegExp('<form\\b(?=[^>]*\\bid=["\\']' + id + '["\\'])[^>]*>[\\s\\S]*?<\\/form>', 'i'));
  assert.ok(match, 'missing form markup: ' + id);
  return match[0];
}

test('Storefront and Admin static ID selectors resolve to elements in their HTML', () => {
  for (const [file, filePath] of [['Storefront.html', storefrontPath], ['Admin.html', adminPath]]) {
    const html = readHtml(filePath);
    const selectorIds = new Set(Array.from(html.matchAll(/\\$\\(\\s*['"]#([A-Za-z][\\w:-]*)['"]/g), match => match[1]));
    const definedIds = new Set(Array.from(html.matchAll(/\\bid\\s*=\\s*['"]([A-Za-z][\\w:-]*)['"]/g), match => match[1]));
    const missing = Array.from(selectorIds).filter(id => !definedIds.has(id));
    assert.deepEqual(missing, [], file + ' contains selectors for missing DOM elements');
    const scripts = inlineScripts(html);
    assert.ok(scripts.length > 0, file + ' must contain inline scripts');
    scripts.forEach((source, index) => {
      assert.doesNotThrow(() => new vm.Script(source, { filename: file + '#script-' + index }));
    });
  }
});

test('member account modal supplies every element required by the storefront member controller', () => {
  const html = readHtml(storefrontPath);
  for (const id of [
    'memberModal', 'memberAuthPanel', 'memberProfile', 'memberMessage',
    'memberLoginForm', 'memberRegisterForm', 'memberPasswordForm',
    'memberProfileName', 'closeMemberModal', 'memberLoginTab',
    'memberRegisterTab', 'memberLogoutBtn'
  ]) assert.match(html, new RegExp('\\bid=["\\']' + id + '["\\']'));

  assert.match(html, /id=["']memberModal["'][^>]*\\bhidden/);
  assert.match(html, /id=["']memberProfile["'][^>]*\\bhidden/);
  assert.match(html, /id=["']memberRegisterForm["'][^>]*\\bhidden/);
});

test('member registration and password change forms match the 8-200 ASCII alphanumeric policy', () => {
  const html = readHtml(storefrontPath);
  const register = formMarkup(html, 'memberRegisterForm');
  const changePassword = formMarkup(html, 'memberPasswordForm');

  for (const name of ['fullName', 'loginId', 'password']) {
    assert.match(register, new RegExp('\\bname=["\\']' + name + '["\\']'));
  }
  assert.match(register, /name=["']password["'][^>]*pattern=["'][[]A-Za-z0-9[]]{8,200}["']/);
  assert.match(register, /name=["']password["'][^>]*minlength=["']8["']/);
  assert.match(register, /name=["']password["'][^>]*maxlength=["']200["']/);

  assert.match(changePassword, /name=["']currentPassword["']/);
  assert.match(changePassword, /name=["']newPassword["'][^>]*pattern=["'][[]A-Za-z0-9[]]{8,200}["']/);
  assert.match(changePassword, /name=["']newPassword["'][^>]*minlength=["']8["']/);
  assert.match(changePassword, /name=["']newPassword["'][^>]*maxlength=["']200["']/);
});
