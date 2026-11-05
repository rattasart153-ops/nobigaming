/** Shared security, encoding and money helpers. */

const NOBI_PASSWORD_ITERATIONS = 120000;

function passwordHash_(password, salt) {
  const saltBytes = Utilities.newBlob(String(salt), 'text/plain').getBytes();
  const passwordBytes = Utilities.newBlob(String(password), 'text/plain').getBytes();
  const block = saltBytes.concat([0, 0, 0, 1]);
  let u = Utilities.computeHmacSha256Signature(block, passwordBytes);
  const derived = u.slice();
  for (let i = 1; i < NOBI_PASSWORD_ITERATIONS; i++) {
    u = Utilities.computeHmacSha256Signature(u, passwordBytes);
    for (let j = 0; j < derived.length; j++) derived[j] = derived[j] ^ u[j];
  }
  return Utilities.base64EncodeWebSafe(derived).replace(/=+$/g, '');
}

function passwordVerify_(password, salt, expectedHash, algorithm) {
  if (String(algorithm) !== 'PBKDF2-SHA256-120000') return false;
  const actual = passwordHash_(password, salt);
  const expected = String(expectedHash || '');
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function sha256_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value), Utilities.Charset.UTF_8)
    .map(function(byte) { return ('0' + ((byte + 256) % 256).toString(16)).slice(-2); }).join('');
}

function money_(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function truth_(value) {
  return value === true || value === 1 || String(value).toLowerCase() === 'true';
}

function clean_(record) {
  const output = {};
  Object.keys(record).forEach(function(key) {
    if (key !== 'password_hash' && key !== 'password_salt' && key !== 'token_hash' &&
        key !== 'checkout_token_hash') {
      const value = record[key];
      output[key] = value instanceof Date ? value.toISOString() : value;
    }
  });
  return output;
}


/** Insert Admin audit records and enforce the approved 90-day retention. Caller holds ScriptLock. */
function appendAdminAuditLogLocked_(record) {
  repositoryInsertLocked_('admin_audit_logs', record);
  const cutoff = Date.now() - NOBI.LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const sheet = repositorySheet_('admin_audit_logs');
  const values = sheet.getDataRange().getValues();
  const createdIndex = NOBI.SHEETS.admin_audit_logs.indexOf('created_at');
  for (let row = values.length - 1; row >= 1; row--) {
    const created = Date.parse(String(values[row][createdIndex] || ''));
    if (Number.isFinite(created) && created < cutoff) sheet.deleteRow(row + 1);
  }
}


/** Prune revoked/expired opaque session hashes after the approved 90-day retention. Caller holds ScriptLock. */
function pruneExpiredSessionsLocked_(nowMs) {
  const cutoff = (Number(nowMs) || Date.now()) - NOBI.LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  ['admin_sessions','member_sessions'].forEach(function(tableName) {
    repositoryRows_(tableName).filter(function(session) {
      const terminalAt = session.revoked_at ? Date.parse(session.revoked_at) : Date.parse(session.expires_at);
      return Number.isFinite(terminalAt) && terminalAt < cutoff;
    }).forEach(function(session) {
      repositoryDeleteLocked_(tableName, session.session_id);
    });
  });
}


/** Shared cross-instance auth throttling stored in Script Properties, keyed by a one-way IP hash. */
function consumeAuthIpAttempt_(ipAddress) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const props = PropertiesService.getScriptProperties();
    const keyName = 'NOBI_AUTH_IP_RATE_STATE';
    let state = {};
    try { state = JSON.parse(props.getProperty(keyName) || '{}'); } catch (ignored) { state = {}; }
    const now = Date.now();
    const windowMs = 15 * 60 * 1000;
    Object.keys(state).forEach(function(key) {
      if (!state[key] || now - Number(state[key].started_at || 0) >= windowMs) delete state[key];
    });
    const ipHash = sha256_(String(ipAddress || 'unknown')).slice(0, 32);
    const bucket = state[ipHash] || {started_at:now,count:0};
    if (Number(bucket.count || 0) >= 30) throw new Error('RATE_LIMITED');
    bucket.count = Number(bucket.count || 0) + 1;
    state[ipHash] = bucket;
    const keys = Object.keys(state);
    if (keys.length > 1000) {
      keys.sort(function(a,b) { return Number(state[a].started_at || 0) - Number(state[b].started_at || 0); });
      keys.slice(0, keys.length - 1000).forEach(function(key) { delete state[key]; });
    }
    props.setProperty(keyName, JSON.stringify(state));
  } finally {
    lock.releaseLock();
  }
}
