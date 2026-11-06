'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const auth = read('google-apps-script/07_Auth.gs');
const admin = read('google-apps-script/08_Admin.gs');
const ui = read('public/admin.html');
const retention = read('google-apps-script/14_Retention.gs');
const utilities = read('google-apps-script/10_Utilities.gs');

function section(source, start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a);
  assert.notEqual(a, -1, 'missing section start: ' + start);
  assert.notEqual(b, -1, 'missing section end: ' + end);
  return source.slice(a, b);
}

test('Member registration and login never consume or persist a caller-supplied IP', () => {
  const register = section(auth, 'function memberRegister(', 'function memberLogin(');
  const login = section(auth, 'function memberLogin(', 'function memberLogout(');
  assert.match(register, /consumeRegistrationAttempt_\(normalized\)/);
  assert.match(register, /registered_ip:''/);
  assert.doesNotMatch(register, /consumeRegistrationIpAttempt_|ipAddress\s*\|\|/);
  assert.match(login, /consumeLoginAttempt_\('MEMBER_LOGIN_ATTEMPT', normalized, 10\)/);
  assert.match(login, /created_ip:''/);
  assert.match(login, /last_login_ip:''/);
  assert.doesNotMatch(login, /consumeAuthIpAttempt_|ipAddress|\bip\b/);
  const logWriter = section(auth, 'function appendMemberLoginLogLocked_', 'function pruneMemberLoginLogsLocked_');
  assert.match(logWriter, /ip_address:''/);
  assert.match(logWriter, /is_new_ip:false/);
});

test('Admin authentication and HtmlService dispatcher do not forward client IP values', () => {
  const adminLogin = section(auth, 'function adminLogin(', 'function adminLogout(');
  assert.match(adminLogin, /consumeLoginAttempt_\('ADMIN_LOGIN_ATTEMPT', normalized, 10\)/);
  assert.match(adminLogin, /created_ip:''/);
  assert.doesNotMatch(adminLogin, /ipAddress/);
  const entry = read('google-apps-script/01_HttpEntry.gs');
  assert.match(entry, /case 'memberRegister': return memberRegister\(args.fullName, args.loginId, args.password\)/);
  assert.match(entry, /case 'memberLogin': return memberLogin\(args.loginId, args.password, args.userAgent\)/);
  assert.doesNotMatch(entry, /args\.ipAddress/);
  assert.doesNotMatch(admin, /function [A-Za-z0-9_]+\([^)]*ipAddress/);
  assert.ok(admin.split('\n').filter(line => line.includes('ip_address:')).every(line => /ip_address:\s*''/.test(line)));
});

test('Admin member APIs never return Member IP fields or IP history', () => {
  const members = section(admin, 'function adminMembers(', 'function adminSetMemberStatus(');
  const logs = section(admin, 'function adminMemberLoginLogs(', 'function adminStoreMedia(');
  assert.doesNotMatch(members, /registered_ip|last_login_ip/);
  assert.doesNotMatch(logs, /ip_address|is_new_ip|\.map\(clean_\)/);
});

test('Admin UI preserves login history without exposing IP history', () => {
  assert.match(ui, /data-tab="member-logs">🛡️ ประวัติล็อกอิน/);
  assert.match(ui, /member-login-logs\?limit=500/);
  assert.match(ui, /function renderMemberLogs\(\)/);
  assert.doesNotMatch(ui, /ประวัติ IP|IP สมัคร|IP ล่าสุด|IP Address|IP ใหม่/);
  const logRenderer = section(ui, 'function renderMemberLogs()', 'function renderOrders()');
  assert.doesNotMatch(logRenderer, /ip_address|is_new_ip/);
});

test('Rate limiting uses account-scoped HMAC buckets, not claimed source IP', () => {
  assert.match(utilities, /function consumeLoginAttempt_\(scope, identity, limit\)/);
  assert.match(utilities, /function consumeRegistrationAttempt_\(loginId\)/);
  assert.doesNotMatch(utilities, /function consumeAuthIpAttempt_|function consumeRegistrationIpAttempt_/);
});

test('Retention clears legacy IP fields immediately but keeps non-IP login events for 90 days', () => {
  assert.match(retention, /clearTableField_\('members', 'registered_ip'\)/);
  assert.match(retention, /clearTableField_\('members', 'last_login_ip'\)/);
  assert.match(retention, /clearTableField_\('member_login_logs', 'ip_address'\)/);
  assert.match(retention, /clearTableField_\('member_login_logs', 'is_new_ip'\)/);
  assert.match(retention, /member_login_logs_deleted:deleteExpiredRetentionRows_\('member_login_logs', cutoffMs\)/);
});
