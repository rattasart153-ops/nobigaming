'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const auth = fs.readFileSync(path.join(__dirname, '..', 'google-apps-script', '07_Auth.gs'), 'utf8');

function functionSource(name, nextName) {
  const start = auth.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, name + ' must exist');
  const end = nextName ? auth.indexOf('function ' + nextName + '(', start + 1) : auth.length;
  assert.notEqual(end, -1, nextName + ' must exist after ' + name);
  return auth.slice(start, end);
}

test('member registration enforces 8-200 ASCII alphanumeric password characters', () => {
  const source = functionSource('memberRegister', 'memberLogin');
  assert.match(source, /!\/\^\[A-Za-z0-9\]\{8,200\}\$\//);
  assert.match(source, /รหัสผ่านภาษาอังกฤษ\/ตัวเลข 8-200 ตัว/);
});

test('member password change enforces the same 8-200 ASCII alphanumeric policy', () => {
  const source = functionSource('memberChangePassword', 'adminChangePassword');
  assert.match(source, /!\/\^\[A-Za-z0-9\]\{8,200\}\$\//);
  assert.match(source, /รหัสผ่านใหม่ต้องเป็นภาษาอังกฤษ\/ตัวเลข 8-200 ตัว/);
});

test('password policy boundaries accept 8 and 200 alphanumeric characters only', () => {
  const policy = /^[A-Za-z0-9]{8,200}$/;
  assert.equal(policy.test('Abc12345'), true);
  assert.equal(policy.test('A'.repeat(200)), true);
  assert.equal(policy.test('Abc1234'), false);
  assert.equal(policy.test('A'.repeat(201)), false);
  assert.equal(policy.test('Abc1234!'), false);
  assert.equal(policy.test('Abc1234 '), false);
  assert.equal(policy.test('Abc1234ก'), false);
});

test('admin password policy remains stricter and unchanged', () => {
  const source = functionSource('adminChangePassword');
  assert.match(source, /nextPassword\.length < 14 \|\| nextPassword\.length > 200/);
});
