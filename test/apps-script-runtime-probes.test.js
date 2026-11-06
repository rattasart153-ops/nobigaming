'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const headers = ['game_id', 'name', 'value'];

function makeRepositoryHarness(options = {}) {
  const state = {
    rows:[headers.slice()],
    lockHeld:false,
    lockWaits:[],
    lockAcquires:0,
    lockReleases:0,
    reads:0,
    appends:0,
    updates:0,
    nestedAttempted:false,
    nestedError:null
  };
  const sheet = {
    getDataRange() {
      return {
        getValues() {
          state.reads++;
          if (options.failRead) throw new Error('SIMULATED_SHEETS_READ_QUOTA');
          if (options.onRead && !state.nestedAttempted) {
            state.nestedAttempted = true;
            options.onRead();
          }
          return state.rows.map(row => row.slice());
        }
      };
    },
    appendRow(row) {
      state.appends++;
      if (options.failAppend) throw new Error('SIMULATED_SHEETS_WRITE_QUOTA');
      state.rows.push(row.slice());
    },
    getRange(row, column, rowCount, columnCount) {
      return {
        setValues(values) {
          state.updates++;
          if (options.failUpdate) throw new Error('SIMULATED_SHEETS_WRITE_QUOTA');
          state.rows[row - 1] = values[0].slice();
        }
      };
    }
  };
  const context = vm.createContext({
    NOBI:{SHEETS:{games:headers}},
    sheet_:()=>sheet,
    databaseHeaders_:()=>headers,
    databaseHeadersMatch_:(actual, expected)=>JSON.stringify(actual)===JSON.stringify(expected),
    LockService:{getScriptLock:()=>({
      waitLock(timeoutMs) {
        state.lockWaits.push(timeoutMs);
        if (options.lockTimeout || state.lockHeld) throw new Error('SIMULATED_LOCK_TIMEOUT');
        state.lockHeld = true;
        state.lockAcquires++;
      },
      releaseLock() {
        assert.equal(state.lockHeld, true, 'only an acquired lock may be released');
        state.lockHeld = false;
        state.lockReleases++;
      }
    })}
  });
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'google-apps-script', '11_Repositories.gs'), 'utf8'),
    context,
    {filename:'11_Repositories.gs'}
  );
  return {context,state};
}

function sampleRecord(id, uniqueKey) {
  return {game_id:id, name:uniqueKey, value:'synthetic'};
}

test('Sheets read quota failure fails closed and always releases ScriptLock', () => {
  const {context,state}=makeRepositoryHarness({failRead:true});
  assert.throws(()=>context.repositoryInsert_('games',sampleRecord('r1','key-1')),/SIMULATED_SHEETS_READ_QUOTA/);
  assert.equal(state.appends,0);
  assert.equal(state.rows.length,1);
  assert.equal(state.lockHeld,false);
  assert.equal(state.lockReleases,1);
});

test('Sheets append quota failure does not report success and always releases ScriptLock', () => {
  const {context,state}=makeRepositoryHarness({failAppend:true});
  assert.throws(()=>context.repositoryInsert_('games',sampleRecord('r1','key-1')),/SIMULATED_SHEETS_WRITE_QUOTA/);
  assert.equal(state.appends,1);
  assert.equal(state.rows.length,1,'the injected failure occurs before the mock commits a row');
  assert.equal(state.lockHeld,false);
  assert.equal(state.lockReleases,1);
});

test('Sheets update quota failure preserves the prior row in the mock and releases ScriptLock', () => {
  const {context,state}=makeRepositoryHarness({failUpdate:true});
  state.rows.push(['r1','key-1','before']);
  assert.throws(()=>context.repositoryUpdate_('games','r1',{value:'after'}),/SIMULATED_SHEETS_WRITE_QUOTA/);
  assert.deepEqual(state.rows[1],['r1','key-1','before']);
  assert.equal(state.updates,1);
  assert.equal(state.lockHeld,false);
  assert.equal(state.lockReleases,1);
});

test('ScriptLock timeout fails closed before any Sheets read or write', () => {
  const {context,state}=makeRepositoryHarness({lockTimeout:true});
  assert.throws(()=>context.repositoryInsert_('games',sampleRecord('r1','key-1')),/SIMULATED_LOCK_TIMEOUT/);
  assert.equal(state.reads,0);
  assert.equal(state.appends,0);
  assert.equal(state.lockAcquires,0);
  assert.equal(state.lockReleases,0);
});

test('overlapping repository insert is blocked by ScriptLock and retry detects the committed duplicate', () => {
  let context;
  const {state, ...rest}=makeRepositoryHarness({
    onRead() {
      try {
        context.repositoryInsert_('games',sampleRecord('r2','key-2'));
      } catch (error) {
        state.nestedError=error;
      }
    }
  });
  context=rest.context;
  const outer=context.repositoryInsert_('games',sampleRecord('r1','key-1'));
  assert.equal(outer.game_id,'r1');
  assert.match(state.nestedError.message,/SIMULATED_LOCK_TIMEOUT/);
  assert.equal(state.appends,1,'the competing request must not write while the first request holds the lock');
  assert.equal(state.lockReleases,1);
  assert.throws(()=>context.repositoryInsert_('games',sampleRecord('r3','key-1')),/REPOSITORY_DUPLICATE/);
  assert.equal(state.appends,1);
  assert.equal(state.lockHeld,false);
});
