'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function makeAuthContext() {
  const now = Date.now();
  let lockHeld = false;
  const data = {
    admin_sessions:[{session_id:'as-1',admin_id:'a-1',token_hash:crypto.createHash('sha256').update('admin-token').digest('hex'),auth_version:2,created_at:new Date(now-1000).toISOString(),last_seen_at:new Date(now-1000).toISOString(),expires_at:new Date(now+3600000).toISOString(),revoked_at:''}],
    member_sessions:[{session_id:'ms-1',member_id:'m-1',token_hash:crypto.createHash('sha256').update('member-token').digest('hex'),auth_version:3,created_at:new Date(now-1000).toISOString(),last_seen_at:new Date(now-1000).toISOString(),expires_at:new Date(now+3600000).toISOString(),revoked_at:''}],
    admins:[{admin_id:'a-1',status:'Active',auth_version:2}],
    members:[{member_id:'m-1',status:'Active',auth_version:3}]
  };
  const context = {
    Date,
    NOBI:{SESSION_IDLE_TIMEOUT_MS:30*60*1000},
    LockService:{getScriptLock:()=>({
      waitLock:()=>{assert.equal(lockHeld,false);lockHeld=true;},
      releaseLock:()=>{assert.equal(lockHeld,true);lockHeld=false;}
    })},
    sha256_:value=>crypto.createHash('sha256').update(String(value)).digest('hex'),
    repositoryFindByField_:(table,field,value)=>{
      assert.equal(lockHeld,true,'session and account state must be read while ScriptLock is held');
      return (data[table]||[]).filter(row=>String(row[field])===String(value));
    },
    repositoryGetById_:(table,id)=>{
      assert.equal(lockHeld,true,'account state must be read while ScriptLock is held');
      return (data[table]||[]).find(row=>String(row[table==='admins'?'admin_id':'member_id'])===String(id))||null;
    },
    repositoryUpdateLocked_:(table,id,patch)=>{
      assert.equal(lockHeld,true);
      const row=(data[table]||[]).find(item=>item.session_id===id);
      if(!row)throw new Error('missing session');
      Object.assign(row,patch);
    }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..','google-apps-script','07_Auth.gs'),'utf8'),context,{filename:'07_Auth.gs'});
  return {context,data};
}

test('Admin session and account are revalidated while holding ScriptLock',()=>{
  const {context,data}=makeAuthContext();
  assert.equal(context.requireAdmin_('admin-token').admin_id,'a-1');
  assert.ok(data.admin_sessions[0].last_seen_at);
  data.admin_sessions[0].revoked_at=new Date().toISOString();
  assert.throws(()=>context.requireAdmin_('admin-token'),/เซสชันหมดอายุ/);
});

test('Member session and account are revalidated while holding ScriptLock',()=>{
  const {context,data}=makeAuthContext();
  assert.equal(context.requireMember_('member-token').member_id,'m-1');
  assert.ok(data.member_sessions[0].last_seen_at);
  data.members[0].status='Suspended';
  assert.throws(()=>context.requireMember_('member-token'),/บัญชีสมาชิกถูกระงับ/);
});

test('optional Member identity treats invalid sessions as Guest but propagates infrastructure failures',()=>{
  const {context,data}=makeAuthContext();
  vm.runInContext(
    fs.readFileSync(path.join(__dirname,'..','google-apps-script','01_HttpEntry.gs'),'utf8'),
    context,
    {filename:'01_HttpEntry.gs'}
  );

  assert.equal(context.gatewayOptionalMemberId_('member-token'),'m-1');
  assert.equal(context.gatewayOptionalMemberId_(''),'');
  
  data.member_sessions[0].expires_at=new Date(Date.now()-1000).toISOString();
  assert.equal(context.gatewayOptionalMemberId_('member-token'),'',
    'expired Member sessions must fall back to Guest coupon eligibility');

  data.member_sessions[0].expires_at=new Date(Date.now()+3600000).toISOString();
  data.member_sessions[0].last_seen_at=new Date(Date.now()-31*60*1000).toISOString();
  assert.equal(context.gatewayOptionalMemberId_('member-token'),'',
    'idle-expired Member sessions must fall back to Guest coupon eligibility');

  data.member_sessions[0].last_seen_at=new Date().toISOString();
  data.members[0].status='Suspended';
  assert.equal(context.gatewayOptionalMemberId_('member-token'),'',
    'suspended Member sessions must fall back to Guest coupon eligibility');

  context.requireMember_=()=>{throw new Error('SHEETS_READ_FAILED');};
  assert.throws(()=>context.gatewayOptionalMemberId_('member-token'),/SHEETS_READ_FAILED/,
    'infrastructure failures must not be hidden as Guest sessions');
});


test('revoked session is rejected before last-seen can be refreshed',()=>{
  const {context,data}=makeAuthContext();
  data.admin_sessions[0].revoked_at=new Date().toISOString();
  const before=data.admin_sessions[0].last_seen_at;
  assert.throws(()=>context.requireAdmin_('admin-token'),/เซสชันหมดอายุ/);
  assert.equal(data.admin_sessions[0].last_seen_at,before);
});
