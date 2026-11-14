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
  const start = html.indexOf('<form id="' + id + '"');
  const end = start < 0 ? -1 : html.indexOf('</form>', start);
  assert.ok(start >= 0 && end >= 0, 'missing form markup: ' + id);
  return html.slice(start, end + 7);
}

test('Storefront and Admin static ID selectors resolve to elements in their HTML', () => {
  for (const [file, filePath] of [['Storefront.html', storefrontPath], ['Admin.html', adminPath]]) {
    const html = readHtml(filePath);
    const selectorIds = new Set(Array.from(html.matchAll(/\$\(\s*['"]#([A-Za-z][\w:-]*)['"]/g), match => match[1]));
    const definedIds = new Set(Array.from(html.matchAll(/\bid\s*=\s*['"]([A-Za-z][\w:-]*)['"]/g), match => match[1]));
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
  ]) assert.ok(html.includes('id="' + id + '"'), 'missing member UI element: ' + id);

  assert.ok(html.includes('id="memberModal" hidden'));
  assert.ok(html.includes('id="memberProfile" hidden'));
  assert.ok(html.includes('id="memberRegisterForm" hidden'));
});

test('member registration and password change forms match the 8-200 ASCII alphanumeric policy', () => {
  const html = readHtml(storefrontPath);
  const register = formMarkup(html, 'memberRegisterForm');
  const changePassword = formMarkup(html, 'memberPasswordForm');

  for (const name of ['fullName', 'loginId', 'password']) {
    assert.ok(register.includes('name="' + name + '"'), 'registration form missing ' + name);
  }
  assert.ok(register.includes('pattern="[A-Za-z0-9]{8,200}"'));
  assert.ok(register.includes('minlength="8"'));
  assert.ok(register.includes('maxlength="200"'));

  assert.ok(changePassword.includes('name="currentPassword"'));
  assert.ok(changePassword.includes('name="newPassword"'));
  assert.ok(changePassword.includes('pattern="[A-Za-z0-9]{8,200}"'));
  assert.ok(changePassword.includes('minlength="8"'));
  assert.ok(changePassword.includes('maxlength="200"'));
});


test('Storefront and Admin facade calls map to defined browser wrappers and dispatcher actions', () => {
  const gasDir = path.join(__dirname, '..', 'google-apps-script');
  const storefront = readHtml(storefrontPath);
  const admin = readHtml(adminPath);
  const facade = fs.readFileSync(path.join(gasDir, 'BrowserFacade.gs'), 'utf8');
  const dispatcher = fs.readFileSync(path.join(gasDir, '01_HttpEntry.gs'), 'utf8');

  const definedWrappers = new Set(Array.from(
    facade.matchAll(/^function (nobi[A-Za-z0-9]+)\(/gm),
    match => match[1]
  ));
  const calledWrappers = new Set([
    ...Array.from(storefront.matchAll(/nobiRpc\(\s*['"]([^'"]+)['"]/g), match => match[1]),
    ...Array.from(admin.matchAll(/nobiAdminRpc\(\s*['"]([^'"]+)['"]/g), match => match[1])
  ]);
  const missingWrappers = Array.from(calledWrappers).filter(name => !definedWrappers.has(name));
  assert.deepEqual(missingWrappers, [], 'frontend calls must resolve to named BrowserFacade functions');

  const browserActionsBlock = facade.match(/NOBI_BROWSER_FACADE_ACTIONS_\s*=\s*\[([\s\S]*?)\]/);
  assert.ok(browserActionsBlock, 'BrowserFacade action allowlist must exist');
  const allowedActions = new Set(Array.from(browserActionsBlock[1].matchAll(/['"]([^'"]+)['"]/g), match => match[1]));
  const facadeActions = new Set(Array.from(facade.matchAll(/nobiFacadeCall_\(\s*['"]([^'"]+)['"]/g), match => match[1]));
  const dispatcherActions = new Set(Array.from(dispatcher.matchAll(/case\s+['"]([^'"]+)['"]\s*:/g), match => match[1]));

  assert.deepEqual(Array.from(facadeActions).filter(action => !allowedActions.has(action)), []);
  assert.deepEqual(Array.from(facadeActions).filter(action => !dispatcherActions.has(action)), []);
  assert.deepEqual(Array.from(allowedActions).filter(action => !dispatcherActions.has(action)), []);
});
