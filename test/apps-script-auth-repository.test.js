'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function makeRetentionContext() {
  const data={member_login_logs:[],admin_audit_logs:[]};
  const deleted=[];
  const inserted=[];
  const context={
    Date,
    NOBI:{LOG_RETENTION_DAYS:90},
    Utilities:{getUuid:()=> 'generated-log-id'},
    repositoryRows_:table=>data[table]||[],
    repositoryInsertLocked_:(table,record)=>{data[table].push({...record});inserted.push({table,record:{...record}});},
    repositoryDeleteLocked_:(table,id)=>{
      const key=table==='member_login_logs'?'log_id':'audit_id';
      const index=data[table].findIndex(row=>String(row[key])===String(id));
      if(index<0)return false;
      data[table].splice(index,1);
      deleted.push({table,id});
      return true;
    },
    repositorySheet_:()=>{throw new Error('RETENTION MUST NOT BYPASS REPOSITORY');}
  };
  vm.createContext(context);
  const gasDir=path.join(__dirname,'..','google-apps-script');
  for(const file of ['10_Utilities.gs','07_Auth.gs']) {
    vm.runInContext(fs.readFileSync(path.join(gasDir,file),'utf8'),context,{filename:file});
  }
  return {context,data,deleted,inserted};
}

test('Member login log retention deletes old records through the repository only',()=>{
  const {context,data,deleted}=makeRetentionContext();
  const now=Date.now(), day=24*60*60*1000;
  data.member_login_logs.push(
    {log_id:'old',created_at:new Date(now-91*day).toISOString()},
    {log_id:'recent',created_at:new Date(now-89*day).toISOString()},
    {log_id:'invalid',created_at:'not-a-date'}
  );
  context.pruneMemberLoginLogsLocked_(now);
  assert.deepEqual(data.member_login_logs.map(row=>row.log_id),['recent','invalid']);
  assert.deepEqual(deleted,[{table:'member_login_logs',id:'old'}]);
});

test('Admin audit retention inserts and prunes through repositories without direct Sheet mutation',()=>{
  const {context,data,deleted,inserted}=makeRetentionContext();
  const now=Date.now(), day=24*60*60*1000;
  data.admin_audit_logs.push(
    {audit_id:'old',created_at:new Date(now-91*day).toISOString()},
    {audit_id:'recent',created_at:new Date(now-89*day).toISOString()}
  );
  context.appendAdminAuditLogLocked_({
    audit_id:'new',admin_id:'admin-1',action:'TEST',target_type:'test',
    target_id:'target-1',request_id:'',ip_address:'',details_json:'{}',
    created_at:new Date(now).toISOString()
  });
  assert.deepEqual(data.admin_audit_logs.map(row=>row.audit_id),['recent','new']);
  assert.equal(inserted.length,1);
  assert.deepEqual(deleted,[{table:'admin_audit_logs',id:'old'}]);
});
