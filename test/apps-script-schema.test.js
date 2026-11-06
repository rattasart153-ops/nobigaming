'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

class FakeRange {
  constructor(sheet, row, column, rowCount = 1, columnCount = 1) {
    Object.assign(this, { sheet, row, column, rowCount, columnCount });
  }
  getValues() {
    const result = [];
    for (let r = 0; r < this.rowCount; r++) {
      const source = this.sheet.rows[this.row + r - 1] || [];
      const values = [];
      for (let c = 0; c < this.columnCount; c++) values.push(source[this.column + c - 1] ?? '');
      result.push(values);
    }
    return result;
  }
  setValues(matrix) {
    matrix.forEach((values, r) => {
      const index = this.row + r - 1;
      while (this.sheet.rows.length <= index) this.sheet.rows.push([]);
      values.forEach((value, c) => { this.sheet.rows[index][this.column + c - 1] = value; });
    });
  }
  setValue(value) {
    this.setValues([[value]]);
  }
}

class FakeSheet {
  constructor(name) { this.name = name; this.rows = []; }
  getName() { return this.name; }
  getLastRow() {
    for (let i = this.rows.length - 1; i >= 0; i--) {
      if (this.rows[i].some(value => value !== '' && value !== null && value !== undefined)) return i + 1;
    }
    return 0;
  }
  getLastColumn() {
    const row = this.rows[0] || [];
    let last = row.length;
    while (last > 0 && (row[last - 1] === '' || row[last - 1] == null)) last--;
    return last;
  }
  getRange(row, column, rowCount, columnCount) {
    return new FakeRange(this, row, column, rowCount, columnCount);
  }
  getDataRange() {
    return new FakeRange(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn()));
  }
  appendRow(row) { this.rows.push(row.slice()); }
  setFrozenRows() {}
}

class FakeSpreadsheet {
  constructor() { this.sheets = new Map(); }
  getId() { return 'fake-spreadsheet-id'; }
  getSheetByName(name) { return this.sheets.get(name) || null; }
  insertSheet(name) {
    if (this.sheets.has(name)) throw new Error('Sheet already exists: ' + name);
    const sheet = new FakeSheet(name);
    this.sheets.set(name, sheet);
    return sheet;
  }
}

function loadGasDatabase(spreadsheet, initialProperties = {}) {
  const properties = { ...initialProperties };
  const lock = { waitLock() {}, releaseLock() {} };
  const context = {
    PropertiesService: { getScriptProperties: () => ({
      getProperty: key => properties[key] ?? null,
      setProperty: (key, value) => { properties[key] = String(value); }
    }) },
    SpreadsheetApp: {
      openById: () => spreadsheet,
      create: () => spreadsheet
    },
    LockService: { getScriptLock: () => lock },
    Utilities: { getUuid: () => 'test-uuid-' + Math.random() }
  };
  const gasDir = path.join(__dirname, '..', 'google-apps-script');
  const source = [
    fs.readFileSync(path.join(gasDir, '00_Config.gs'), 'utf8'),
    fs.readFileSync(path.join(gasDir, '02_Database.gs'), 'utf8'),
    fs.readFileSync(path.join(gasDir, '11_Repositories.gs'), 'utf8'),
    fs.readFileSync(path.join(gasDir, '12_Seed.gs'), 'utf8'),
    'globalThis.__nobi = NOBI; globalThis.__setupNobiDatabase = setupNobiDatabase; globalThis.__seedDefaultCatalog = seedDefaultCatalog; globalThis.__repoInsert = repositoryInsert_; globalThis.__repoFind = repositoryFindByField_; globalThis.__repoUpdate = repositoryUpdate_; globalThis.__append = append_; globalThis.__updateById = updateById_;'
  ].join('\n');
  vm.runInNewContext(source, context);
  return { context, properties };
}

test('versioned Sheets setup creates the complete approved schema and is idempotent', () => {
  const spreadsheet = new FakeSpreadsheet();
  const { context, properties } = loadGasDatabase(spreadsheet);
  const first = context.__setupNobiDatabase();
  assert.equal(first.ok, true);
  assert.equal(first.schemaVersion, 3);
  assert.equal(first.sheetCount, Object.keys(context.__nobi.SHEETS).length);
  assert.equal(properties.NOBI_SHEET_ID, spreadsheet.getId());
  assert.equal(spreadsheet.getSheetByName('members').rows[0][0], 'member_id');
  assert.equal(spreadsheet.getSheetByName('coupon_redemptions').rows[0][0], 'redemption_id');

  spreadsheet.getSheetByName('games').appendRow(['game-1','RoV','moba','Arena of Valor',true,1,'2026-11-04T00:00:00.000Z','2026-11-04T00:00:00.000Z']);
  const second = context.__setupNobiDatabase();
  assert.equal(second.ok, true);
  assert.equal(spreadsheet.getSheetByName('games').getLastRow(), 2);
  assert.equal(spreadsheet.getSheetByName('games').rows[1][1], 'RoV');
});

test('versioned Sheets setup refuses incompatible legacy headers without changing data', () => {
  const spreadsheet = new FakeSpreadsheet();
  const games = spreadsheet.insertSheet('games');
  games.appendRow(['id','name','category']);
  games.appendRow(['old-1','Legacy Game','moba']);
  const beforeSheets = spreadsheet.sheets.size;
  const { context } = loadGasDatabase(spreadsheet, { NOBI_SHEET_ID: spreadsheet.getId() });
  assert.throws(() => context.__setupNobiDatabase(), /SCHEMA_INCOMPATIBLE/);
  assert.equal(spreadsheet.sheets.size, beforeSheets, 'preflight must fail before creating missing sheets');
  assert.deepEqual(games.rows, [['id','name','category'],['old-1','Legacy Game','moba']]);
});

test('schema v1 database upgrades cumulatively to v3 without changing existing business rows', () => {
  const spreadsheet = new FakeSpreadsheet();
  const { context } = loadGasDatabase(spreadsheet);
  context.__setupNobiDatabase();
  const games = spreadsheet.getSheetByName('games');
  games.appendRow(['game-1','RoV','moba','Arena of Valor',true,1,'2026-11-04T00:00:00.000Z','2026-11-04T00:00:00.000Z']);
  const metadata = spreadsheet.getSheetByName('system_metadata');
  metadata.rows[1][1] = '1';
  spreadsheet.sheets.delete('order_recovery_journal');

  const upgraded = context.__setupNobiDatabase();
  assert.equal(upgraded.ok, true);
  assert.equal(upgraded.schemaVersion, 3);
  assert.deepEqual(games.rows[1], ['game-1','RoV','moba','Arena of Valor',true,1,'2026-11-04T00:00:00.000Z','2026-11-04T00:00:00.000Z']);
  assert.deepEqual(
    Array.from(spreadsheet.getSheetByName('order_recovery_journal').rows[0]),
    Array.from(context.__nobi.SHEETS.order_recovery_journal)
  );
  assert.equal(metadata.rows[1][1], '3');
});

test('versioned Sheets setup refuses unknown schema versions', () => {
  const spreadsheet = new FakeSpreadsheet();
  const metadata = spreadsheet.insertSheet('system_metadata');
  metadata.appendRow(['key','value','updated_at']);
  metadata.appendRow(['schema_version','99','2026-11-04T00:00:00.000Z']);
  const { context } = loadGasDatabase(spreadsheet, { NOBI_SHEET_ID: spreadsheet.getId() });
  assert.throws(() => context.__setupNobiDatabase(), /SCHEMA_VERSION_UNSUPPORTED/);
});

test('Sheets repositories enforce schema, primary keys, unique keys and safe updates', () => {
  const spreadsheet = new FakeSpreadsheet();
  const { context } = loadGasDatabase(spreadsheet);
  context.__setupNobiDatabase();

  const first = context.__repoInsert('members', {
    member_id: 'member-1',
    login_id_normalized: 'nobi1234',
    login_id_display: 'Nobi1234',
    full_name: 'Nobi'
  });
  assert.equal(first.member_id, 'member-1');
  assert.equal(context.__repoFind('members', 'login_id_normalized', 'nobi1234').length, 1);
  assert.throws(() => context.__repoInsert('members', {
    member_id: 'member-2',
    login_id_normalized: 'nobi1234'
  }), /REPOSITORY_DUPLICATE/);

  const updated = context.__repoUpdate('members', 'member-1', { full_name: 'Nobi Topup' });
  assert.equal(updated.full_name, 'Nobi Topup');
  assert.throws(() => context.__repoUpdate('members', 'member-1', { member_id: 'member-3' }), /PRIMARY_KEY_IMMUTABLE/);
  assert.throws(() => context.__repoInsert('members', {
    member_id: 'member-3',
    unknown_column: 'not allowed'
  }), /FIELD_NOT_ALLOWED/);
});

test('idempotency repository uniqueness is scoped by both scope and request key', () => {
  const spreadsheet = new FakeSpreadsheet();
  const { context } = loadGasDatabase(spreadsheet);
  context.__setupNobiDatabase();
  context.__repoInsert('idempotency_records', {
    idempotency_id: 'idem-1', scope: 'create-order', request_key: 'key-1', payload_hash: 'hash-1'
  });
  context.__repoInsert('idempotency_records', {
    idempotency_id: 'idem-2', scope: 'member-login', request_key: 'key-1', payload_hash: 'hash-2'
  });
  assert.throws(() => context.__repoInsert('idempotency_records', {
    idempotency_id: 'idem-3', scope: 'create-order', request_key: 'key-1', payload_hash: 'hash-3'
  }), /REPOSITORY_DUPLICATE/);
});


test('legacy write helpers fail closed on schema and field mismatches without writing data', () => {
  const spreadsheet = new FakeSpreadsheet();
  const { context } = loadGasDatabase(spreadsheet);
  context.__setupNobiDatabase();
  const games = spreadsheet.getSheetByName('games');
  const before = games.rows.map(row => row.slice());

  assert.throws(() => context.__append('games', {
    id: 'legacy-game-1', name: 'RoV', category: 'moba'
  }), /DATABASE_FIELD_NOT_ALLOWED|DATABASE_PRIMARY_KEY_REQUIRED|REPOSITORY_FIELD_NOT_ALLOWED|REPOSITORY_PRIMARY_KEY_REQUIRED/);
  assert.throws(() => context.__updateById('games', 'game-1', {
    name: 'Changed', legacy_column: 'not allowed'
  }), /DATABASE_FIELD_NOT_ALLOWED|REPOSITORY_FIELD_NOT_ALLOWED/);
  assert.deepEqual(games.rows, before, 'invalid legacy writes must not change Sheets data');
});

test('legacy write helpers reject unknown tables and primary-key mutation', () => {
  const spreadsheet = new FakeSpreadsheet();
  const { context } = loadGasDatabase(spreadsheet);
  context.__setupNobiDatabase();

  assert.throws(() => context.__append('unknown_table', { id: 'x' }), /DATABASE_TABLE_NOT_ALLOWED|REPOSITORY_TABLE_NOT_ALLOWED/);
  assert.throws(() => context.__updateById('games', 'game-1', { game_id: 'game-2' }), /DATABASE_PRIMARY_KEY_IMMUTABLE|REPOSITORY_PRIMARY_KEY_IMMUTABLE/);
});


test('Apps Script PBKDF2-SHA256 helper matches the Node.js reference implementation', () => {
  const utilitiesSource = fs.readFileSync(
    path.join(__dirname, '..', 'google-apps-script', '10_Utilities.gs'), 'utf8'
  );
  const context = {
    Utilities: {
      Charset: { UTF_8: 'UTF-8' },
      newBlob: value => ({ getBytes: () => Array.from(Buffer.from(String(value), 'utf8')) }),
      computeHmacSha256Signature: (value, key) => Array.from(
        crypto.createHmac('sha256', Buffer.from(key.map(v => (v + 256) % 256))).update(Buffer.from(value.map(v => (v + 256) % 256))).digest()
      ).map(v => v > 127 ? v - 256 : v),
      base64EncodeWebSafe: bytes => Buffer.from(bytes.map(v => (v + 256) % 256)).toString('base64url')
    }
  };
  vm.runInNewContext(
    utilitiesSource + '\nglobalThis.__passwordHash = passwordHash_;',
    context
  );
  const password = 'Correct Horse Battery Staple 2026!';
  const salt = 'fixed-test-salt-for-pbkdf2';
  const expected = crypto.pbkdf2Sync(password, salt, 120000, 32, 'sha256').toString('base64url');
  assert.equal(context.__passwordHash(password, salt), expected);
});

test('Schema v3 business modules no longer call legacy field-based Sheets helpers', () => {
  const gasDir = path.join(__dirname, '..', 'google-apps-script');
  const migrated = ['03_Catalog.gs','04_Coupons.gs','06_Orders.gs','07_Auth.gs','08_Admin.gs'];
  for (const file of migrated) {
    const source = fs.readFileSync(path.join(gasDir, file), 'utf8');
    assert.doesNotMatch(source, /\brows_\s*\(/, file + ' must read through the schema-aware repository');
    assert.doesNotMatch(source, /\bappend_\s*\(|\bupdateById_\s*\(/, file + ' must write through the schema-aware repository');
  }
  const repositoryOnlyWriters = ['03_Catalog.gs','04_Coupons.gs','06_Orders.gs','07_Auth.gs','08_Admin.gs','10_Utilities.gs'];
  for (const file of repositoryOnlyWriters) {
    const source = fs.readFileSync(path.join(gasDir, file), 'utf8');
    assert.doesNotMatch(
      source,
      /\.(?:appendRow|setValues|setValue|deleteRow|deleteRows)\s*\(/,
      file + ' must not mutate Sheets outside the repository layer'
    );
  }
  const auth = fs.readFileSync(path.join(gasDir, '07_Auth.gs'), 'utf8');
  assert.match(auth, /admin_sessions/);
  assert.match(auth, /SESSION_IDLE_TIMEOUT_MS/);
  assert.match(auth, /PBKDF2-SHA256-120000/);
  const orders = fs.readFileSync(path.join(gasDir, '06_Orders.gs'), 'utf8');
  assert.match(orders, /coupon_redemptions/);
  assert.match(orders, /payment_expires_at/);
  assert.match(orders, /submitOrderSlip/);
});


test('shared Sheets rate limits use keyed account HMACs and enforce fixed-window thresholds', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'google-apps-script', '10_Utilities.gs'), 'utf8'
  );
  const rows = [];
  let lockCalls = 0;
  const secret = 'test-shared-secret-for-rate-limit-hmac-123456';
  const context = {
    Date,
    NOBI:{LOG_RETENTION_DAYS:90},
    LockService:{getScriptLock:()=>({waitLock:()=>{lockCalls++;},releaseLock:()=>{}})},
    PropertiesService:{getScriptProperties:()=>({getProperty:key=>key==='NOBI_GATEWAY_SECRET'?secret:''})},
    Utilities:{
      Charset:{UTF_8:'UTF-8'},
      computeHmacSha256Signature:(value,key)=>Array.from(crypto.createHmac('sha256',String(key)).update(String(value),'utf8').digest()).map(v=>v>127?v-256:v)
    },
    repositoryGetById_:(table,id)=>rows.find(row=>row.bucket_key_hash===id)||null,
    repositoryInsertLocked_:(table,record)=>{rows.push({...record});},
    repositoryUpdateLocked_:(table,id,patch)=>{const row=rows.find(item=>item.bucket_key_hash===id);Object.assign(row,patch);},
    repositoryDeleteLocked_:(table,id)=>{const i=rows.findIndex(item=>item.bucket_key_hash===id);if(i>=0)rows.splice(i,1);},
    repositoryRows_:()=>rows,
    repositorySheet_:()=>({getLastRow:()=>rows.length+1})
  };
  vm.runInNewContext(
    source + '\nglobalThis.__consumeLoginAttempt = consumeLoginAttempt_; globalThis.__consumeRegistrationAttempt = consumeRegistrationAttempt_; globalThis.__rateLimitHash = rateLimitBucketHash_;',
    context
  );

  const loginId = 'Member.One';
  const normalizedLogin = 'member.one';
  const expectedLoginHash = crypto.createHmac('sha256',secret)
    .update('MEMBER_LOGIN_ATTEMPT:' + normalizedLogin).digest('hex');
  assert.equal(context.__rateLimitHash('MEMBER_LOGIN_ATTEMPT',normalizedLogin),expectedLoginHash);
  for(let i=0;i<10;i++) context.__consumeLoginAttempt('MEMBER_LOGIN_ATTEMPT',loginId,10);
  assert.throws(()=>context.__consumeLoginAttempt('MEMBER_LOGIN_ATTEMPT',loginId,10),/RATE_LIMITED/);
  const loginBucket = rows.find(row=>row.bucket_key_hash===expectedLoginHash);
  assert.equal(loginBucket.attempt_count,10);
  assert.equal(loginBucket.bucket_key_hash,expectedLoginHash);

  const registerId = 'Member.Register';
  const expectedRegisterHash = crypto.createHmac('sha256',secret)
    .update('MEMBER_REGISTER_ACCOUNT:member.register').digest('hex');
  for(let i=0;i<5;i++) context.__consumeRegistrationAttempt(registerId);
  assert.throws(()=>context.__consumeRegistrationAttempt(registerId),/RATE_LIMITED/);
  const registerBucket = rows.find(row=>row.bucket_key_hash===expectedRegisterHash);
  assert.equal(registerBucket.attempt_count,5);
  assert.equal(registerBucket.bucket_key_hash,expectedRegisterHash);
  assert.equal(JSON.stringify(rows).includes(loginId),false);
  assert.equal(JSON.stringify(rows).includes(registerId),false);
  assert.ok(lockCalls>=17);
});

test('default catalog seed creates the legacy nine games and 54 packages idempotently',()=>{
  const spreadsheet=new FakeSpreadsheet();
  const {context}=loadGasDatabase(spreadsheet);
  context.__setupNobiDatabase();
  const first=context.__seedDefaultCatalog();
  assert.equal(first.ok,true);
  assert.equal(first.gamesAdded,9);
  assert.equal(first.packagesAdded,54);
  const games=spreadsheet.getSheetByName('games');
  const packages=spreadsheet.getSheetByName('packages');
  assert.equal(games.getLastRow()-1,9);
  assert.equal(packages.getLastRow()-1,54);
  const second=context.__seedDefaultCatalog();
  assert.equal(second.alreadySeeded,true);
  assert.equal(packages.getLastRow()-1,54);
  assert.equal(packages.rows.slice(1).filter(row=>row[8]===true).length,9);
});

test('default catalog seed preserves an existing custom package catalog',()=>{
  const spreadsheet=new FakeSpreadsheet();
  const {context}=loadGasDatabase(spreadsheet);
  context.__setupNobiDatabase();
  const games=spreadsheet.getSheetByName('games');
  games.appendRow(['custom-game','Custom Game','other','Custom',true,1,'2026-11-05T00:00:00.000Z','2026-11-05T00:00:00.000Z']);
  const packages=spreadsheet.getSheetByName('packages');
  packages.appendRow(['custom-package','custom-game','Custom Pack',10,'Coins',1000,'','','',true,1,'2026-11-05T00:00:00.000Z','2026-11-05T00:00:00.000Z']);
  const result=context.__seedDefaultCatalog();
  assert.equal(result.status,'SKIPPED_EXISTING_PACKAGES');
  assert.equal(packages.getLastRow()-1,1);
  assert.equal(games.getLastRow()-1,10);
});


test('schema v2 database upgrades to v3 while preserving recovery journal and business rows',()=>{
  const spreadsheet=new FakeSpreadsheet();
  const {context}=loadGasDatabase(spreadsheet);
  context.__setupNobiDatabase();
  const games=spreadsheet.getSheetByName('games');
  games.appendRow(['game-v2','Legacy v2 Game','moba','Preserve me',true,1,'2026-11-05T00:00:00.000Z','2026-11-05T00:00:00.000Z']);
  const journal=spreadsheet.getSheetByName('order_recovery_journal');
  journal.appendRow(['journal-v2','order-v2','CREATE','','','','','','','Pending',2,'RECOVERY_RETRY','2026-11-05T00:00:00.000Z','2026-11-05T00:01:00.000Z']);
  const metadata=spreadsheet.getSheetByName('system_metadata');
  metadata.rows[1][1]='2';

  const upgraded=context.__setupNobiDatabase();
  assert.equal(upgraded.ok,true);
  assert.equal(upgraded.schemaVersion,3);
  assert.deepEqual(games.rows[1],['game-v2','Legacy v2 Game','moba','Preserve me',true,1,'2026-11-05T00:00:00.000Z','2026-11-05T00:00:00.000Z']);
  assert.deepEqual(journal.rows[1],['journal-v2','order-v2','CREATE','','','','','','','Pending',2,'RECOVERY_RETRY','2026-11-05T00:00:00.000Z','2026-11-05T00:01:00.000Z']);
  assert.equal(metadata.rows[1][1],'3');
});
