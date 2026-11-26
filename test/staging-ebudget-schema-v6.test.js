'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class FakeRange {
  constructor(sheet, row, column, rowCount = 1, columnCount = 1) {
    Object.assign(this, { sheet, row, column, rowCount, columnCount });
  }
  getValues() {
    const out = [];
    for (let r = 0; r < this.rowCount; r++) {
      const source = this.sheet.rows[this.row + r - 1] || [];
      const values = [];
      for (let c = 0; c < this.columnCount; c++) values.push(source[this.column + c - 1] ?? '');
      out.push(values);
    }
    return out;
  }
  setValues(matrix) {
    matrix.forEach((values, r) => {
      const index = this.row + r - 1;
      while (this.sheet.rows.length <= index) this.sheet.rows.push([]);
      values.forEach((value, c) => { this.sheet.rows[index][this.column + c - 1] = value; });
    });
  }
  setValue(value) { this.setValues([[value]]); }
}
class FakeSheet {
  constructor(name) { this.name = name; this.rows = []; }
  getLastRow() {
    for (let i = this.rows.length - 1; i >= 0; i--) {
      if (this.rows[i].some(v => v !== '' && v !== null && v !== undefined)) return i + 1;
    }
    return 0;
  }
  getLastColumn() {
    const row = this.rows[0] || [];
    let last = row.length;
    while (last && (row[last - 1] === '' || row[last - 1] == null)) last--;
    return last;
  }
  getRange(r, c, nr, nc) { return new FakeRange(this, r, c, nr, nc); }
  getDataRange() {
    return new FakeRange(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn()));
  }
  appendRow(row) { this.rows.push(row.slice()); }
  setFrozenRows() {}
}
class FakeSpreadsheet {
  constructor() { this.sheets = new Map(); }
  getId() { return 'synthetic-staging-sheet'; }
  getSheetByName(name) { return this.sheets.get(name) || null; }
  insertSheet(name) {
    if (this.sheets.has(name)) throw new Error('Sheet already exists');
    const sheet = new FakeSheet(name);
    this.sheets.set(name, sheet);
    return sheet;
  }
}
function loadBundle(filePath, spreadsheet, properties = {}) {
  const props = { ...properties };
  const context = {
    PropertiesService: { getScriptProperties: () => ({
      getProperty: key => props[key] ?? null,
      setProperty: (key, value) => { props[key] = String(value); }
    }) },
    SpreadsheetApp: { openById: () => spreadsheet, create: () => spreadsheet },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: { getUuid: () => 'synthetic-uuid' }
  };
  const source = fs.readFileSync(filePath, 'utf8') +
    '\nglobalThis.__nobi = NOBI; globalThis.__setup = setupNobiDatabase;';
  vm.runInNewContext(source, context, { filename: filePath });
  return { context, props };
}
const apiPath = path.join(__dirname, '..', 'staging', 'api-only', 'Code.gs');
const legacyPath = path.join(__dirname, '..', 'staging', 'browser-import', 'Code.gs');

function makeSchemaV5Spreadsheet() {
  const spreadsheet = new FakeSpreadsheet();
  const legacy = loadBundle(legacyPath, new FakeSpreadsheet()).context.__nobi;
  for (const [name, headers] of Object.entries(legacy.SHEETS)) {
    const sheet = spreadsheet.insertSheet(name);
    sheet.appendRow(headers);
    if (name === 'system_metadata') sheet.appendRow(['schema_version', '5', '2026-11-26T00:00:00.000Z']);
    if (name === 'orders') {
      const row = headers.map((_, i) => i === 0 ? 'synthetic-order-1' : '');
      sheet.appendRow(row);
    }
  }
  return spreadsheet;
}

test('Schema v6 initializes all Wallet tabs on a new isolated database', () => {
  const spreadsheet = new FakeSpreadsheet();
  const { context, props } = loadBundle(apiPath, spreadsheet);
  const result = context.__setup();
  assert.equal(result.ok, true);
  assert.equal(result.schemaVersion, 6);
  assert.equal(result.sheetCount, Object.keys(context.__nobi.SHEETS).length);
  for (const name of ['wallets','wallet_ledger','wallet_topups','wallet_holds',
    'wallet_hold_allocations','wallet_bonus_grants','wallet_recovery_journal']) {
    assert.ok(spreadsheet.getSheetByName(name), name + ' should exist');
  }
  assert.deepEqual(
    spreadsheet.getSheetByName('orders').rows[0].slice(-2),
    ['payment_method','wallet_hold_id']
  );
  assert.equal(props.NOBI_SHEET_ID, spreadsheet.getId());
});

test('Schema v5 to v6 upgrade appends only the two approved order columns and preserves rows', () => {
  const spreadsheet = makeSchemaV5Spreadsheet();
  const oldOrder = Array.from(spreadsheet.getSheetByName('orders').rows[1]);
  const { context } = loadBundle(apiPath, spreadsheet, { NOBI_SHEET_ID: spreadsheet.getId() });
  const result = context.__setup();
  assert.equal(result.schemaVersion, 6);
  const orders = spreadsheet.getSheetByName('orders');
  assert.deepEqual(Array.from(orders.rows[1].slice(0, oldOrder.length)), oldOrder);
  assert.deepEqual(Array.from(orders.rows[0].slice(-2)), ['payment_method','wallet_hold_id']);
  assert.equal(orders.rows[1][oldOrder.length] ?? '', '');
  assert.equal(orders.rows[1][oldOrder.length + 1] ?? '', '');
  assert.equal(spreadsheet.getSheetByName('system_metadata').rows[1][1], '6');
});

test('Schema v5 preflight mismatch aborts before creating Wallet tabs or changing metadata', () => {
  const spreadsheet = makeSchemaV5Spreadsheet();
  spreadsheet.getSheetByName('games').rows[0][0] = 'wrong_header';
  const { context } = loadBundle(apiPath, spreadsheet, { NOBI_SHEET_ID: spreadsheet.getId() });
  assert.throws(() => context.__setup(), /SCHEMA_INCOMPATIBLE: games/);
  assert.equal(spreadsheet.getSheetByName('wallets'), null);
  assert.equal(spreadsheet.getSheetByName('system_metadata').rows[1][1], '5');
});
