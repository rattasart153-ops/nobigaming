'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class NonceSheet {
  constructor(rows=[['nonce_hash','created_at']]) { this.rows=rows.map(row=>row.slice()); }
  getLastRow() { return this.rows.length; }
  getRange(row,column,rowCount=1,columnCount=1) {
    return {
      getValue:()=>this.rows[row-1]?.[column-1] ?? '',
      getValues:()=>{
        const out=[];
        for(let r=0;r<rowCount;r++){
          const values=[];
          for(let c=0;c<columnCount;c++)values.push(this.rows[row+r-1]?.[column+c-1] ?? '');
          out.push(values);
        }
        return out;
      }
    };
  }
  deleteRows(start,count) { this.rows.splice(start-1,count); }
  appendRow(row) { this.rows.push(row.slice()); }
}

function makeContext(sheet) {
  const context={
    Date,
    NOBI:{},
    NOBI_GATEWAY:{VERSION:1,MAX_CLOCK_SKEW_MS:5*60*1000,MAX_BODY_CHARS:7*1024*1024,NONCE_RETENTION_MS:10*60*1000,ALLOWED_ACTIONS:[]},
    LockService:{getScriptLock:()=>({waitLock:()=>{},releaseLock:()=>{}})},
    PropertiesService:{getScriptProperties:()=>({getProperty:key=>key==='NOBI_SHEET_ID'?'sheet-id':'secret'})},
    databaseAssertSchema_:name=>({sheet}),
    sha256_:value=>crypto.createHash('sha256').update(String(value)).digest('hex'),
    ContentService:{}
  };
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname,'..','google-apps-script','13_HttpGateway.gs'),'utf8')+
    '\nglobalThis.__claimNonce=claimGatewayNonce_;',
    context,
    {filename:'13_HttpGateway.gs'}
  );
  return context;
}

test('nonce replay is rejected while a fresh nonce is stored once',()=>{
  const sheet=new NonceSheet();
  const context=makeContext(sheet);
  assert.equal(context.__claimNonce('nonce-value-1234567890',Date.now()),true);
  assert.equal(context.__claimNonce('nonce-value-1234567890',Date.now()),false);
  assert.equal(sheet.rows.length,2);
});

test('expired nonce rows are pruned before replay scan and retention stays bounded',()=>{
  const now=Date.now();
  const old=Array.from({length:1100},(_,i)=>['old-'+i,new Date(now-60*60*1000+i).toISOString()]);
  const fresh=[['fresh-hash',new Date(now-1000).toISOString()]];
  const sheet=new NonceSheet([['nonce_hash','created_at'],...old,...fresh]);
  const context=makeContext(sheet);
  assert.equal(context.__claimNonce('new-nonce-value-1234567890',now),true);
  assert.equal(sheet.rows.length,3);
  assert.equal(sheet.rows[1][0],'fresh-hash');
});

test('nonce ledger fails closed when too many fresh replay records accumulate',()=>{
  const now=Date.now();
  const active=Array.from({length:5000},(_,i)=>['hash-'+i,new Date(now-1000+i).toISOString()]);
  const sheet=new NonceSheet([['nonce_hash','created_at'],...active]);
  const context=makeContext(sheet);
  assert.throws(()=>context.__claimNonce('new-nonce-value-1234567890',now),/NONCE_STORE_FULL/);
  assert.equal(sheet.rows.length,5001);
});

test('corrupt nonce timestamps fail closed instead of dropping replay history',()=>{
  const sheet=new NonceSheet([['nonce_hash','created_at'],['hash','not-a-date']]);
  const context=makeContext(sheet);
  assert.throws(()=>context.__claimNonce('new-nonce-value-1234567890',Date.now()),/GATEWAY_NONCE_LEDGER_CORRUPT/);
});
