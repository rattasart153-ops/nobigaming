/** Nobi Topup versioned, non-destructive Google Sheets setup and data helpers. */

function setupNobiDatabase() {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const props = PropertiesService.getScriptProperties();
    const configuredId = String(props.getProperty('NOBI_SHEET_ID') || '').trim();
    const ss = configuredId
      ? SpreadsheetApp.openById(configuredId)
      : SpreadsheetApp.create('Nobi Topup Database');

    // Preflight every existing sheet before making any schema changes.
    const metadataSheet = ss.getSheetByName('system_metadata');
    let currentVersion = '';
    if (metadataSheet) {
      const metadataHeaders = databaseHeaders_(metadataSheet);
      if (metadataHeaders.length && !databaseHeadersMatch_(metadataHeaders, NOBI.SHEETS.system_metadata)) {
        throw new Error('SCHEMA_INCOMPATIBLE: system_metadata headers do not match the expected schema.');
      }
      const metadataValues = metadataSheet.getLastRow() > 1
        ? metadataSheet.getDataRange().getValues().slice(1)
        : [];
      const versionRow = metadataValues.find(row => String(row[0]) === NOBI.SCHEMA_VERSION_KEY);
      if (versionRow) currentVersion = String(versionRow[1] || '');
      else if (metadataValues.length) {
        throw new Error('SCHEMA_VERSION_MISSING: existing metadata has no schema version; manual review is required.');
      }
    }

    if (currentVersion && currentVersion !== String(NOBI.SCHEMA_VERSION)) {
      throw new Error('SCHEMA_VERSION_UNSUPPORTED: expected version ' + NOBI.SCHEMA_VERSION + ' but found ' + currentVersion + '.');
    }

    Object.keys(NOBI.SHEETS).forEach(function(name) {
      const sheet = ss.getSheetByName(name);
      if (!sheet) return;
      const headers = databaseHeaders_(sheet);
      if (headers.length && !databaseHeadersMatch_(headers, NOBI.SHEETS[name])) {
        throw new Error('SCHEMA_INCOMPATIBLE: ' + name + ' headers do not match the expected schema. No data was changed.');
      }
      if (sheet.getLastRow() > 1 && !currentVersion) {
        throw new Error('SCHEMA_VERSION_MISSING: ' + name + ' contains rows but the database has no schema version. No data was changed.');
      }
    });

    // Only after the full preflight succeeds may missing/empty sheets be initialized.
    Object.keys(NOBI.SHEETS).forEach(function(name) {
      let sheet = ss.getSheetByName(name);
      if (!sheet) sheet = ss.insertSheet(name);
      if (sheet.getLastRow() === 0) {
        sheet.getRange(1, 1, 1, NOBI.SHEETS[name].length).setValues([NOBI.SHEETS[name]]);
      }
      sheet.setFrozenRows(1);
    });

    const metadata = ss.getSheetByName('system_metadata');
    const values = metadata.getDataRange().getValues();
    const versionIndex = values.findIndex(function(row, index) {
      return index > 0 && String(row[0]) === NOBI.SCHEMA_VERSION_KEY;
    });
    const now = new Date().toISOString();
    if (versionIndex === -1) {
      metadata.appendRow([NOBI.SCHEMA_VERSION_KEY, String(NOBI.SCHEMA_VERSION), now]);
    } else {
      metadata.getRange(versionIndex + 1, 2).setValue(String(NOBI.SCHEMA_VERSION));
      metadata.getRange(versionIndex + 1, 3).setValue(now);
    }

    // Persist the spreadsheet reference only after every schema check and write succeeds.
    props.setProperty('NOBI_SHEET_ID', ss.getId());
    return {
      ok: true,
      schemaVersion: NOBI.SCHEMA_VERSION,
      sheetCount: Object.keys(NOBI.SHEETS).length,
      message: 'Versioned database schema initialized. No catalog data or Admin account was seeded.'
    };
  } finally {
    lock.releaseLock();
  }
}

function databaseHeaders_(sheet) {
  const lastColumn = sheet.getLastColumn();
  if (sheet.getLastRow() === 0 || lastColumn === 0) return [];
  return sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(String);
}

function databaseHeadersMatch_(actual, expected) {
  return actual.length === expected.length && expected.every(function(header, index) {
    return actual[index] === header;
  });
}

function sheet_(name) {
  if (!NOBI.SHEETS[name]) throw new Error('DATABASE_TABLE_NOT_ALLOWED: ' + name);
  const id = PropertiesService.getScriptProperties().getProperty('NOBI_SHEET_ID');
  if (!id) throw new Error('Run setupNobiDatabase first.');
  const sheet = SpreadsheetApp.openById(id).getSheetByName(name);
  if (!sheet) throw new Error('Missing sheet: ' + name);
  return sheet;
}

function rows_(name) {
  return repositoryRows_(name);
}

function databaseAssertSchema_(name) {
  const headers = NOBI.SHEETS[name];
  if (!headers) throw new Error('DATABASE_TABLE_NOT_ALLOWED: ' + name);
  const sh = sheet_(name);
  if (!databaseHeadersMatch_(databaseHeaders_(sh), headers)) {
    throw new Error('DATABASE_SCHEMA_MISMATCH: ' + name);
  }
  return { sheet: sh, headers: headers };
}

function databaseAssertRecordFields_(name, record, allowPrimaryKey) {
  const schema = NOBI.SHEETS[name];
  if (!schema || !record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error('DATABASE_INVALID_RECORD');
  }
  Object.keys(record).forEach(function(field) {
    if (schema.indexOf(field) === -1) {
      throw new Error('DATABASE_FIELD_NOT_ALLOWED: ' + name + '.' + field);
    }
    if (!allowPrimaryKey && field === schema[0]) {
      throw new Error('DATABASE_PRIMARY_KEY_IMMUTABLE: ' + name + '.' + field);
    }
  });
  return schema;
}

function append_(name, record) {
  return repositoryInsert_(name, record);
}

function deleteById_(name, id) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try { return repositoryDeleteLocked_(name, id); }
  finally { lock.releaseLock(); }
}

function updateById_(name, id, patch) {
  return repositoryUpdate_(name, id, patch);
}
