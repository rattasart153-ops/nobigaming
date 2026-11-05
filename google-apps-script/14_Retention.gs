/** Enforce the approved 90-day retention policy for IP-bearing records.
 * The cleanup is intentionally not invoked by database setup. Install the daily
 * trigger separately with ensureNobiRetentionTrigger() after reviewing deployment.
 */

function runNobiRetentionCleanup() {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return runNobiRetentionCleanupLocked_(Date.now());
  } finally {
    lock.releaseLock();
  }
}

/** Caller must already hold ScriptLock. */
function runNobiRetentionCleanupLocked_(nowMs) {
  const cutoffMs = Number(nowMs) - NOBI.LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  if (!Number.isFinite(cutoffMs)) throw new Error('RETENTION_INVALID_CLOCK');

  const result = {
    ok:true,
    cutoff_at:new Date(cutoffMs).toISOString(),
    member_registered_ips_cleared:clearMemberIpFieldByDate_('registered_ip', 'created_at', cutoffMs),
    member_last_login_ips_cleared:clearMemberIpFieldByDate_('last_login_ip', 'last_login_at', cutoffMs),
    member_session_ips_cleared:clearSessionIpFieldByDate_('member_sessions', cutoffMs),
    admin_session_ips_cleared:clearSessionIpFieldByDate_('admin_sessions', cutoffMs),
    member_login_logs_deleted:deleteExpiredRetentionRows_('member_login_logs', cutoffMs),
    admin_audit_logs_deleted:deleteExpiredRetentionRows_('admin_audit_logs', cutoffMs)
  };
  return result;
}

function clearMemberIpFieldByDate_(ipField, timestampField, cutoffMs) {
  const sheet = repositorySheet_('members');
  const values = sheet.getDataRange().getValues();
  const headers = NOBI.SHEETS.members;
  const ipIndex = headers.indexOf(ipField);
  const timestampIndex = headers.indexOf(timestampField);
  if (ipIndex < 0 || timestampIndex < 0) throw new Error('RETENTION_SCHEMA_INVALID: members');
  let cleared = 0;
  for (let row = 1; row < values.length; row++) {
    const ip = String(values[row][ipIndex] || '');
    if (!ip) continue;
    const timestamp = Date.parse(String(values[row][timestampIndex] || ''));
    if (!Number.isFinite(timestamp) || timestamp < cutoffMs) {
      sheet.getRange(row + 1, ipIndex + 1).setValue('');
      cleared++;
    }
  }
  return cleared;
}

function clearSessionIpFieldByDate_(tableName, cutoffMs) {
  const sheet = repositorySheet_(tableName);
  const values = sheet.getDataRange().getValues();
  const headers = NOBI.SHEETS[tableName];
  const ipIndex = headers.indexOf('created_ip');
  const timestampIndex = headers.indexOf('created_at');
  if (ipIndex < 0 || timestampIndex < 0) throw new Error('RETENTION_SCHEMA_INVALID: ' + tableName);
  let cleared = 0;
  for (let row = 1; row < values.length; row++) {
    const ip = String(values[row][ipIndex] || '');
    if (!ip) continue;
    const timestamp = Date.parse(String(values[row][timestampIndex] || ''));
    if (!Number.isFinite(timestamp) || timestamp < cutoffMs) {
      sheet.getRange(row + 1, ipIndex + 1).setValue('');
      cleared++;
    }
  }
  return cleared;
}

function deleteExpiredRetentionRows_(tableName, cutoffMs) {
  const sheet = repositorySheet_(tableName);
  const values = sheet.getDataRange().getValues();
  const headers = NOBI.SHEETS[tableName];
  const timestampIndex = headers.indexOf('created_at');
  if (timestampIndex < 0) throw new Error('RETENTION_SCHEMA_INVALID: ' + tableName);
  let deleted = 0;
  for (let row = values.length - 1; row >= 1; row--) {
    const timestamp = Date.parse(String(values[row][timestampIndex] || ''));
    // Invalid timestamps cannot justify retaining IP-bearing history indefinitely.
    if (!Number.isFinite(timestamp) || timestamp < cutoffMs) {
      sheet.deleteRow(row + 1);
      deleted++;
    }
  }
  return deleted;
}

/** Create one daily 03:00 Asia/Bangkok trigger; repeated calls are safe.
 * This function must be run manually by an authorized project owner.
 */
function ensureNobiRetentionTrigger() {
  const handler = 'runNobiRetentionCleanup';
  const existing = ScriptApp.getProjectTriggers().filter(function(trigger) {
    return trigger.getHandlerFunction() === handler;
  });
  if (existing.length === 1) {
    return {ok:true, created:false, duplicates_removed:0, message:'Retention trigger already exists.'};
  }
  if (existing.length > 1) {
    existing.slice(1).forEach(function(trigger) { ScriptApp.deleteTrigger(trigger); });
    return {ok:true, created:false, duplicates_removed:existing.length - 1, message:'Duplicate retention triggers removed.'};
  }
  ScriptApp.newTrigger(handler)
    .timeBased()
    .everyDays(1)
    .atHour(3)
    .inTimezone('Asia/Bangkok')
    .create();
  return {ok:true, created:true, duplicates_removed:0, message:'Daily retention trigger created for approximately 03:00 Asia/Bangkok.'};
}
