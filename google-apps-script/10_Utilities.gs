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


/** HMAC-hash bucket identities; never persist raw IP addresses or login identifiers. */
function rateLimitBucketHash_(scope, identity) {
  const secret = String(PropertiesService.getScriptProperties().getProperty('NOBI_GATEWAY_SECRET') || '');
  if (secret.length < 32) throw new Error('GATEWAY_NOT_CONFIGURED');
  const signature = Utilities.computeHmacSha256Signature(
    String(scope) + ':' + String(identity),
    secret,
    Utilities.Charset.UTF_8
  );
  return signature.map(function(byte) {
    return ('0' + ((byte + 256) % 256).toString(16)).slice(-2);
  }).join('');
}

/** Caller must hold ScriptLock. Uses a fixed 15-minute window in the shared Sheets ledger. */
function consumeRateLimitBucketLocked_(scope, identity, limit, nowMs) {
  const now = Number(nowMs) || Date.now();
  const nowIso = new Date(now).toISOString();
  const bucketHash = rateLimitBucketHash_(scope, identity);
  const existing = repositoryGetById_('security_rate_limits', bucketHash);
  const windowMs = 15 * 60 * 1000;
  let record;

  if (!existing) {
    record = {
      bucket_key_hash:bucketHash,
      window_start:nowIso,
      attempt_count:1,
      blocked_until:Number(limit) <= 1 ? new Date(now + windowMs).toISOString() : '',
      updated_at:nowIso
    };
    repositoryInsertLocked_('security_rate_limits', record);
  } else {
    const blockedUntil = Date.parse(existing.blocked_until || '');
    if (Number.isFinite(blockedUntil) && blockedUntil > now) throw new Error('RATE_LIMITED');
    const windowStart = Date.parse(existing.window_start || '');
    if (!Number.isFinite(windowStart) || now - windowStart >= windowMs) {
      record = {window_start:nowIso,attempt_count:1,blocked_until:'',updated_at:nowIso};
    } else {
      const count = Number(existing.attempt_count || 0);
      if (count >= Number(limit)) {
        repositoryUpdateLocked_('security_rate_limits', bucketHash, {
          blocked_until:new Date(now + windowMs).toISOString(),
          updated_at:nowIso
        });
        throw new Error('RATE_LIMITED');
      }
      record = {
        attempt_count:count + 1,
        blocked_until:count + 1 >= Number(limit) ? new Date(now + windowMs).toISOString() : existing.blocked_until,
        updated_at:nowIso
      };
    }
    repositoryUpdateLocked_('security_rate_limits', bucketHash, record);
  }

  const sheet = repositorySheet_('security_rate_limits');
  let rowCount = Math.max(0, sheet.getLastRow() - 1);
  if (rowCount > 1000) {
    const cutoff = now - 24 * 60 * 60 * 1000;
    repositoryRows_('security_rate_limits').filter(function(row) {
      return Date.parse(row.updated_at || '') < cutoff;
    }).slice(0, 250).forEach(function(row) {
      repositoryDeleteLocked_('security_rate_limits', row.bucket_key_hash);
    });
    rowCount = Math.max(0, repositorySheet_('security_rate_limits').getLastRow() - 1);
  }
  if (rowCount > 5000) throw new Error('RATE_LIMIT_STORE_FULL');
}

/** Caller must hold ScriptLock. */
function assertRateLimitBucketNotBlockedLocked_(scope, identity, nowMs) {
  const hash = rateLimitBucketHash_(scope, identity);
  const record = repositoryGetById_('security_rate_limits', hash);
  const blockedUntil = record ? Date.parse(record.blocked_until || '') : NaN;
  if (Number.isFinite(blockedUntil) && blockedUntil > (Number(nowMs) || Date.now())) {
    throw new Error('RATE_LIMITED');
  }
}

/** Caller must hold ScriptLock. */
function incrementAccountFailureLocked_(scope, identity, nowMs) {
  consumeRateLimitBucketLocked_(scope, identity, 5, nowMs);
}

/** Caller must hold ScriptLock. */
function resetAccountFailureLocked_(scope, identity) {
  const hash = rateLimitBucketHash_(scope, identity);
  repositoryDeleteLocked_('security_rate_limits', hash);
}

function consumeLoginAttempt_(scope, identity, limit) {
  const value = String(identity || '').trim().toLowerCase();
  if (!value) throw new Error('LOGIN_ID_REQUIRED');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { consumeRateLimitBucketLocked_(scope, value, Number(limit) || 10, Date.now()); }
  finally { lock.releaseLock(); }
}

function consumeRegistrationAttempt_(loginId) {
  const value = String(loginId || '').trim().toLowerCase();
  if (!value) throw new Error('LOGIN_ID_REQUIRED');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { consumeRateLimitBucketLocked_('MEMBER_REGISTER_ACCOUNT', value, 5, Date.now()); }
  finally { lock.releaseLock(); }
}

function assertAccountNotBlocked_(scope, identity) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { assertRateLimitBucketNotBlockedLocked_(scope, identity, Date.now()); }
  finally { lock.releaseLock(); }
}
