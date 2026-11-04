'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('startup fails closed when session secret is missing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nobi-config-session-'));
  try {
    const env = {
      ...process.env,
      NODE_ENV: 'test',
      SESSION_SECRET: '',
      ADMIN_USERNAME: 'TestAdmin',
      ADMIN_PASSWORD: 'TestPassword123',
      NOBI_DATA_DIR: path.join(root, 'data')
    };
    const result = spawnSync(process.execPath, ['-e', "require('./src/middleware/session')"], {
      cwd: path.resolve(__dirname, '..'),
      env,
      encoding: 'utf8'
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /SESSION_SECRET must be configured/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('startup fails closed when Admin bootstrap credentials are missing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nobi-config-admin-'));
  try {
    const env = {
      ...process.env,
      NODE_ENV: 'test',
      SESSION_SECRET: 'test-only-secret-for-config-check',
      ADMIN_USERNAME: '',
      ADMIN_PASSWORD: '',
      NOBI_DATA_DIR: path.join(root, 'data'),
      NOBI_UPLOAD_DIR: path.join(root, 'uploads'),
      NOBI_PRIVATE_SLIP_DIR: path.join(root, 'private-slips')
    };
    const result = spawnSync(process.execPath, ['-e', "require('./server')"], {
      cwd: path.resolve(__dirname, '..'),
      env,
      encoding: 'utf8'
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /ADMIN_USERNAME and ADMIN_PASSWORD must be configured/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
