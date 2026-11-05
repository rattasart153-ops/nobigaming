'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const headers = {
  members:['member_id','registered_ip','last_login_ip','created_at','last_login_at'],
  member_sessions:['session_id','created_ip','created_at'],
  admin_sessions:['session_id','created_ip','created_at'],
  member_login_logs:['log_id','ip_address','created_at'],
  admin_audit_logs:['audit_id','ip_address','created_at']
};

class FakeSheet {
  constructor(name, rows) { this.name=name; this.rows=[headers[name].slice(), ...rows.map(row=>headers[name].map(key=>row[key] ?? ''))]; }
  getDataRange() {
    const sheet=this;
    return {getValues(){return sheet.rows.map(row=>row.slice());}};
  }
  getRange(row,column) {
    const sheet=this;
    return {setValue(value){sheet.rows[row-1][column-1]=value;}};
  }
  deleteRow(row) { this.rows.splice(row-1,1); }
  records() {
    return this.rows.slice(1).map(row=>Object.fromEntries(headers[this.name].map((key,index)=>[key,row[index]])));
  }
}

function makeRetentionHarness() {
  const now=Date.parse('2026-11-05T04:00:00.000Z');
  const cutoff=new Date(now-90*24*60*60*1000).toISOString();
  const sheets={
    members:new FakeSheet('members',[
      {member_id:'member-old',registered_ip:'203.0.113.1',last_login_ip:'203.0.113.2',created_at:'2026-08-07T03:59:59.999Z',last_login_at:'2026-08-07T03:59:59.999Z'},
      {member_id:'member-boundary',registered_ip:'203.0.113.3',last_login_ip:'203.0.113.4',created_at:cutoff,last_login_at:cutoff},
      {member_id:'member-recent',registered_ip:'203.0.113.5',last_login_ip:'203.0.113.6',created_at:'2026-10-01T00:00:00.000Z',last_login_at:'2026-10-02T00:00:00.000Z'},
      {member_id:'member-invalid',registered_ip:'203.0.113.7',last_login_ip:'203.0.113.8',created_at:'bad-date',last_login_at:''}
    ]),
    member_sessions:new FakeSheet('member_sessions',[
      {session_id:'member-session-old',created_ip:'198.51.100.1',created_at:'2026-08-01T00:00:00.000Z'},
      {session_id:'member-session-new',created_ip:'198.51.100.2',created_at:'2026-11-01T00:00:00.000Z'},
      {session_id:'member-session-invalid',created_ip:'198.51.100.3',created_at:'invalid'}
    ]),
    admin_sessions:new FakeSheet('admin_sessions',[
      {session_id:'admin-session-old',created_ip:'198.51.100.4',created_at:'2026-08-01T00:00:00.000Z'},
      {session_id:'admin-session-new',created_ip:'198.51.100.5',created_at:'2026-11-01T00:00:00.000Z'}
    ]),
    member_login_logs:new FakeSheet('member_login_logs',[
      {log_id:'member-log-old',ip_address:'192.0.2.1',created_at:'2026-08-01T00:00:00.000Z'},
      {log_id:'member-log-boundary',ip_address:'192.0.2.2',created_at:cutoff},
      {log_id:'member-log-invalid',ip_address:'192.0.2.3',created_at:'invalid'},
      {log_id:'member-log-new',ip_address:'192.0.2.4',created_at:'2026-11-01T00:00:00.000Z'}
    ]),
    admin_audit_logs:new FakeSheet('admin_audit_logs',[
      {audit_id:'admin-log-old',ip_address:'192.0.2.5',created_at:'2026-08-01T00:00:00.000Z'},
      {audit_id:'admin-log-boundary',ip_address:'192.0.2.6',created_at:cutoff}
    ])
  };
  const triggers=[];
  let triggerCreates=0;
  const context={
    Date,
    NOBI:{LOG_RETENTION_DAYS:90,SHEETS:{
      members:['member_id','registered_ip','last_login_ip','created_at','last_login_at'],
      member_sessions:['session_id','created_ip','created_at'],
      admin_sessions:['session_id','created_ip','created_at'],
      member_login_logs:['log_id','ip_address','created_at'],
      admin_audit_logs:['audit_id','ip_address','created_at']
    }},
    LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
    repositorySheet_:name=>sheets[name],
    ScriptApp:{
      getProjectTriggers:()=>triggers.slice(),
      deleteTrigger:trigger=>{const i=triggers.indexOf(trigger);if(i>=0)triggers.splice(i,1);},
      newTrigger:handler=>{
        const config={handler};
        const builder={
          timeBased(){return builder;},
          everyDays(days){config.days=days;return builder;},
          atHour(hour){config.hour=hour;return builder;},
          inTimezone(timezone){config.timezone=timezone;return builder;},
          create(){const trigger={getHandlerFunction:()=>config.handler,config};triggers.push(trigger);triggerCreates++;return trigger;}
        };
        return builder;
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..','google-apps-script','14_Retention.gs'),'utf8'),context);
  return {context,sheets,triggers,get triggerCreates(){return triggerCreates;},now,cutoff};
}

test('90-day cleanup clears aged member and session IP fields and removes expired IP-history rows',()=>{
  const {context,sheets,now,cutoff}=makeRetentionHarness();
  const result=context.runNobiRetentionCleanupLocked_(now);
  assert.equal(result.cutoff_at,cutoff);
  const members=sheets.members.records();
  assert.equal(members.find(x=>x.member_id==='member-old').registered_ip,'');
  assert.equal(members.find(x=>x.member_id==='member-old').last_login_ip,'');
  assert.equal(members.find(x=>x.member_id==='member-boundary').registered_ip,'');
  assert.equal(members.find(x=>x.member_id==='member-boundary').last_login_ip,'');
  assert.equal(members.find(x=>x.member_id==='member-recent').last_login_ip,'203.0.113.6');
  assert.equal(members.find(x=>x.member_id==='member-invalid').registered_ip,'');
  assert.equal(members.find(x=>x.member_id==='member-invalid').last_login_ip,'');

  const memberSessions=sheets.member_sessions.records();
  assert.equal(memberSessions.find(x=>x.session_id==='member-session-old').created_ip,'');
  assert.equal(memberSessions.find(x=>x.session_id==='member-session-invalid').created_ip,'');
  assert.equal(memberSessions.find(x=>x.session_id==='member-session-new').created_ip,'198.51.100.2');
  assert.equal(sheets.admin_sessions.records().find(x=>x.session_id==='admin-session-old').created_ip,'');

  assert.deepEqual(sheets.member_login_logs.records().map(x=>x.log_id),['member-log-new']);
  assert.deepEqual(sheets.admin_audit_logs.records().map(x=>x.audit_id),[]);
  assert.equal(result.member_login_logs_deleted,3);
  assert.equal(result.admin_audit_logs_deleted,2);
});

test('retention cleanup acquires the shared ScriptLock before touching IP-bearing sheets',()=>{
  const {context}=makeRetentionHarness();
  let acquired=false,released=false;
  context.LockService.getScriptLock=()=>({waitLock(){acquired=true;},releaseLock(){released=true;}});
  const result=context.runNobiRetentionCleanup();
  assert.equal(result.ok,true);
  assert.equal(acquired,true);
  assert.equal(released,true);
});

test('retention trigger setup is idempotent and creates a Bangkok daily trigger only when missing',()=>{
  const {context,triggers}=makeRetentionHarness();
  const first=context.ensureNobiRetentionTrigger();
  assert.equal(first.created,true);
  assert.equal(triggers.length,1);
  assert.equal(triggers[0].config.days,1);
  assert.equal(triggers[0].config.hour,3);
  assert.equal(triggers[0].config.timezone,'Asia/Bangkok');
  const second=context.ensureNobiRetentionTrigger();
  assert.equal(second.created,false);
  assert.equal(triggers.length,1);
});

test('retention trigger setup removes duplicates without creating another trigger',()=>{
  const {context,triggers}=makeRetentionHarness();
  context.ensureNobiRetentionTrigger();
  const duplicate={getHandlerFunction:()=>'runNobiRetentionCleanup'};
  triggers.push(duplicate);
  const result=context.ensureNobiRetentionTrigger();
  assert.equal(result.duplicates_removed,1);
  assert.equal(triggers.length,1);
});
