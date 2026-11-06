/** Nobi Topup schema-aware Sheets repositories.
 * Call the Locked variants only while holding the Apps Script ScriptLock.
 */

const NOBI_REPOSITORY_UNIQUE_FIELDS = {
  admins: ['username_normalized'],
  games: ['name'],
  admin_sessions: ['token_hash'],
  members: ['login_id_normalized'],
  member_sessions: ['token_hash'],
  coupons: ['code_normalized'],
  coupon_redemptions: ['order_id'],
  orders: ['request_key'],
  idempotency_records: [['scope', 'request_key']],
  system_metadata: ['key'],
  gateway_nonces: ['nonce_hash']
};

function repositorySheet_(tableName) {
  const headers = NOBI.SHEETS[tableName];
  if (!headers) throw new Error('REPOSITORY_TABLE_NOT_ALLOWED');
  const sheet = sheet_(tableName);
  if (!databaseHeadersMatch_(databaseHeaders_(sheet), headers)) {
    throw new Error('REPOSITORY_SCHEMA_MISMATCH: ' + tableName);
  }
  return sheet;
}

function repositoryRowObject_(headers, row) {
  const record = {};
  headers.forEach(function(header, index) {
    const value = row[index];
    record[header] = value instanceof Date ? value.toISOString() : value;
  });
  return record;
}

function repositoryRecordsFromValues_(values) {
  if (!Array.isArray(values) || values.length < 2) return [];
  const headers = values[0].map(String);
  return values.slice(1)
    .filter(function(row) { return row.some(function(value) { return value !== '' && value !== null; }); })
    .map(function(row) { return repositoryRowObject_(headers, row); });
}

function repositoryRows_(tableName) {
  const sheet = repositorySheet_(tableName);
  return repositoryRecordsFromValues_(sheet.getDataRange().getValues());
}

function repositoryGetById_(tableName, id) {
  const headers = NOBI.SHEETS[tableName];
  if (!headers) throw new Error('REPOSITORY_TABLE_NOT_ALLOWED');
  const normalizedId = String(id || '').trim();
  if (!normalizedId) return null;
  const key = headers[0];
  return repositoryRows_(tableName).find(function(record) {
    return String(record[key]) === normalizedId;
  }) || null;
}

function repositoryFindByField_(tableName, field, value) {
  const headers = NOBI.SHEETS[tableName];
  if (!headers || headers.indexOf(field) === -1) throw new Error('REPOSITORY_FIELD_NOT_ALLOWED');
  const expected = String(value == null ? '' : value);
  return repositoryRows_(tableName).filter(function(record) {
    return String(record[field] == null ? '' : record[field]) === expected;
  });
}

function repositoryAssertUniqueLocked_(tableName, record, exceptId, existingRecords) {
  const uniqueConstraints = NOBI_REPOSITORY_UNIQUE_FIELDS[tableName] || [];
  if (!uniqueConstraints.length) return;
  const headers = NOBI.SHEETS[tableName];
  const primaryKey = headers[0];
  const existing = Array.isArray(existingRecords) ? existingRecords : repositoryRows_(tableName);
  uniqueConstraints.forEach(function(constraint) {
    const fields = Array.isArray(constraint) ? constraint : [constraint];
    const values = fields.map(function(field) {
      return String(record[field] == null ? '' : record[field]).trim();
    });
    if (values.every(function(value) { return !value; })) return;
    if (values.some(function(value) { return !value; })) {
      throw new Error('REPOSITORY_UNIQUE_KEY_INCOMPLETE: ' + tableName + '.' + fields.join('+'));
    }
    const duplicate = existing.some(function(candidate) {
      if (exceptId && String(candidate[primaryKey]) === String(exceptId)) return false;
      return fields.every(function(field, index) {
        return String(candidate[field] == null ? '' : candidate[field]).trim() === values[index];
      });
    });
    if (duplicate) throw new Error('REPOSITORY_DUPLICATE: ' + tableName + '.' + fields.join('+'));
  });
}

function repositoryNormalizeRecord_(tableName, record, allowPrimaryKey) {
  const headers = NOBI.SHEETS[tableName];
  if (!headers || !record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error('REPOSITORY_INVALID_RECORD');
  }
  Object.keys(record).forEach(function(field) {
    if (headers.indexOf(field) === -1) throw new Error('REPOSITORY_FIELD_NOT_ALLOWED: ' + field);
    if (!allowPrimaryKey && field === headers[0]) throw new Error('REPOSITORY_PRIMARY_KEY_IMMUTABLE');
  });
  return headers.reduce(function(result, field) {
    if (Object.prototype.hasOwnProperty.call(record, field)) result[field] = record[field];
    return result;
  }, {});
}

function repositoryInsertLocked_(tableName, record) {
  const sheet = repositorySheet_(tableName);
  const headers = NOBI.SHEETS[tableName];
  const safe = repositoryNormalizeRecord_(tableName, record, true);
  const primaryKey = String(safe[headers[0]] || '').trim();
  if (!primaryKey) throw new Error('REPOSITORY_PRIMARY_KEY_REQUIRED');
  // Reuse one snapshot for primary-key and unique-key checks. Each getDataRange()
  // is a remote Sheets read, so avoid separate full-sheet reads while holding the lock.
  const values = sheet.getDataRange().getValues();
  const existingRecords = repositoryRecordsFromValues_(values);
  const idIndex = headers.indexOf(headers[0]);
  if (values.slice(1).some(function(row) { return String(row[idIndex] || '') === primaryKey; })) {
    throw new Error('REPOSITORY_DUPLICATE: ' + tableName + '.' + headers[0]);
  }
  repositoryAssertUniqueLocked_(tableName, safe, null, existingRecords);
  sheet.appendRow(headers.map(function(field) {
    return safe[field] === undefined || safe[field] === null ? '' : safe[field];
  }));
  return safe;
}

function repositoryUpdateLocked_(tableName, id, patch) {
  const sheet = repositorySheet_(tableName);
  const headers = NOBI.SHEETS[tableName];
  const primaryKey = headers[0];
  const normalizedId = String(id || '').trim();
  if (!normalizedId) throw new Error('REPOSITORY_PRIMARY_KEY_REQUIRED');
  const safePatch = repositoryNormalizeRecord_(tableName, patch, false);
  const values = sheet.getDataRange().getValues();
  const idIndex = headers.indexOf(primaryKey);
  for (let rowIndex = 1; rowIndex < values.length; rowIndex++) {
    if (String(values[rowIndex][idIndex]) !== normalizedId) continue;
    const current = repositoryRowObject_(headers, values[rowIndex]);
    const next = Object.assign({}, current, safePatch);
    repositoryAssertUniqueLocked_(tableName, next, normalizedId, repositoryRecordsFromValues_(values));
    sheet.getRange(rowIndex + 1, 1, 1, headers.length).setValues([headers.map(function(field) {
      return next[field] === undefined || next[field] === null ? '' : next[field];
    })]);
    return next;
  }
  throw new Error('REPOSITORY_NOT_FOUND');
}

function repositoryInsert_(tableName, record) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try { return repositoryInsertLocked_(tableName, record); }
  finally { lock.releaseLock(); }
}

function repositoryUpdate_(tableName, id, patch) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try { return repositoryUpdateLocked_(tableName, id, patch); }
  finally { lock.releaseLock(); }
}


/** Delete a single schema-keyed row. Caller must already hold ScriptLock. */
function repositoryDeleteLocked_(tableName, id) {
  const sheet = repositorySheet_(tableName);
  const headers = NOBI.SHEETS[tableName];
  const normalizedId = String(id || '').trim();
  if (!normalizedId) throw new Error('REPOSITORY_PRIMARY_KEY_REQUIRED');
  const values = sheet.getDataRange().getValues();
  for (let row = 1; row < values.length; row++) {
    if (String(values[row][0]) !== normalizedId) continue;
    sheet.deleteRow(row + 1);
    return true;
  }
  return false;
}
