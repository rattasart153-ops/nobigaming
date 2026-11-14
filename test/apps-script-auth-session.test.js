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
    admins:[{admin_id:'a-1',status:'Active',auth_version:2,password_hash:'admin-old-hash',password_salt:'admin-salt',password_algorithm:'PBKDF2-SHA256-120000'}],
    members:[{member_id:'m-1',status:'Active',auth_version:3,password_hash:'member-old-hash',password_salt:'member-salt',password_algorithm:'PBKDF2-SHA256-120000'}],
    admin_audit_logs:[]
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
      const row=(data[table]||[]).find(item=>String(item[table==='admins'?'admin_id':'member_id'])===String(id));
      return row ? {...row} : null;
    },
    repositoryRows_:table=>{
      assert.equal(lockHeld,true,'session lists must be read while ScriptLock is held');
      return (data[table]||[]).slice();
    },
    repositoryUpdateLocked_:(table,id,patch)=>{
      assert.equal(lockHeld,true);
      const keyField=table==='admins'?'admin_id':table==='members'?'member_id':'session_id';
      const row=(data[table]||[]).find(item=>item[keyField]===id);
      if(!row)throw new Error('missing record');
      Object.assign(row,patch);
    },
    Utilities:{getUuid:()=>'test-uuid'},
    passwordVerify_:(password,salt,hash)=>password==='current-password'&&Boolean(salt)&&Boolean(hash),
    passwordHash_:(password,salt)=>'new-hash:'+password+':'+salt,
    appendAdminAuditLogLocked_:entry=>{
      assert.equal(lockHeld,true,'Admin audit writes must occur while ScriptLock is held');
      data.admin_audit_logs.push({...entry});
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
  data.member_sessions[0].revoked_at='';
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


test('Admin absolute eight-hour expiry is enforced even when the session was recently active',()=>{
  const {context,data}=makeAuthContext();
  data.admin_sessions[0].expires_at=new Date(Date.now()-1).toISOString();
  data.admin_sessions[0].last_seen_at=new Date().toISOString();
  const before=data.admin_sessions[0].last_seen_at;
  assert.throws(()=>context.requireAdmin_('admin-token'),/เซสชันหมดอายุ/);
  assert.equal(data.admin_sessions[0].last_seen_at,before);
});

test('Member absolute eight-hour expiry is enforced independently of idle activity',()=>{
  const {context,data}=makeAuthContext();
  data.member_sessions[0].expires_at=new Date(Date.now()-1).toISOString();
  data.member_sessions[0].last_seen_at=new Date().toISOString();
  const before=data.member_sessions[0].last_seen_at;
  assert.throws(()=>context.requireMember_('member-token'),/เซสชันสมาชิกหมดอายุ/);
  assert.equal(data.member_sessions[0].last_seen_at,before);
});

test('Admin idle timeout revokes the session at the thirty-minute boundary',()=>{
  const {context,data}=makeAuthContext();
  data.admin_sessions[0].last_seen_at=new Date(Date.now()-30*60*1000).toISOString();
  assert.throws(()=>context.requireAdmin_('admin-token'),/ไม่มีการใช้งานเกินกำหนด/);
  assert.ok(data.admin_sessions[0].revoked_at);
});

test('Member idle timeout revokes the session at the thirty-minute boundary',()=>{
  const {context,data}=makeAuthContext();
  data.member_sessions[0].last_seen_at=new Date(Date.now()-30*60*1000).toISOString();
  assert.throws(()=>context.requireMember_('member-token'),/ไม่มีการใช้งานเกินกำหนด/);
  assert.ok(data.member_sessions[0].revoked_at);
});

test('Admin and Member sessions are rejected when the account auth_version changes',()=>{
  const admin=makeAuthContext();
  admin.data.admins[0].auth_version++;
  assert.throws(()=>admin.context.requireAdmin_('admin-token'),/เซสชันถูกเพิกถอน/);

  const member=makeAuthContext();
  member.data.members[0].auth_version++;
  assert.throws(()=>member.context.requireMember_('member-token'),/บัญชีสมาชิกถูกระงับหรือเซสชันถูกเพิกถอน/);
});

test('Admin and Member logout revoke their matching sessions and make reuse impossible',()=>{
  const {context,data}=makeAuthContext();
  assert.equal(context.adminLogout('admin-token').ok,true);
  assert.equal(context.memberLogout('member-token').ok,true);
  assert.ok(data.admin_sessions[0].revoked_at);
  assert.ok(data.member_sessions[0].revoked_at);
  assert.throws(()=>context.requireAdmin_('admin-token'),/เซสชันหมดอายุ/);
  assert.throws(()=>context.requireMember_('member-token'),/เซสชันสมาชิกหมดอายุ/);
});

test('malformed Admin and Member expiry or idle timestamps fail closed',()=>{
  const admin=makeAuthContext();
  admin.data.admin_sessions[0].expires_at='not-a-date';
  assert.throws(()=>admin.context.requireAdmin_('admin-token'),/เซสชันหมดอายุ/);

  const member=makeAuthContext();
  member.data.member_sessions[0].last_seen_at='not-a-date';
  assert.throws(()=>member.context.requireMember_('member-token'),/ไม่มีการใช้งานเกินกำหนด/);
  assert.ok(member.data.member_sessions[0].revoked_at);
});


test('Member password change increments auth_version and revokes every active Member session',()=>{
  const {context,data}=makeAuthContext();
  data.member_sessions.push({
    session_id:'ms-2',member_id:'m-1',
    token_hash:crypto.createHash('sha256').update('member-other-token').digest('hex'),
    auth_version:3,created_at:new Date().toISOString(),last_seen_at:new Date().toISOString(),
    expires_at:new Date(Date.now()+3600000).toISOString(),revoked_at:''
  });
  const result=context.memberChangePassword('member-token','current-password','newMemberPassword123');
  assert.equal(result.ok,true);
  assert.equal(data.members[0].auth_version,4);
  assert.match(data.members[0].password_hash,/^new-hash:newMemberPassword123:/);
  assert.ok(data.member_sessions.every(session=>Boolean(session.revoked_at)));
  assert.throws(()=>context.requireMember_('member-token'),/เซสชันสมาชิกหมดอายุ/);
});

test('Admin password change increments auth_version, revokes all Admin sessions and writes a non-IP audit event',()=>{
  const {context,data}=makeAuthContext();
  data.admin_sessions.push({
    session_id:'as-2',admin_id:'a-1',
    token_hash:crypto.createHash('sha256').update('admin-other-token').digest('hex'),
    auth_version:2,created_at:new Date().toISOString(),last_seen_at:new Date().toISOString(),
    expires_at:new Date(Date.now()+3600000).toISOString(),revoked_at:''
  });
  const result=context.adminChangePassword('admin-token','current-password','new-admin-password-longer');
  assert.equal(result.ok,true);
  assert.equal(data.admins[0].auth_version,3);
  assert.match(data.admins[0].password_hash,/^new-hash:new-admin-password-longer:/);
  assert.ok(data.admin_sessions.every(session=>Boolean(session.revoked_at)));
  assert.equal(data.admin_audit_logs.length,1);
  assert.equal(data.admin_audit_logs[0].action,'ADMIN_PASSWORD_CHANGED');
  assert.equal(data.admin_audit_logs[0].ip_address,'');
  assert.throws(()=>context.requireAdmin_('admin-token'),/เซสชันหมดอายุ/);
});


test('Member password change rejects a stale credential snapshot if another change wins during KDF',()=>{
  const {context,data}=makeAuthContext();
  context.passwordHash_=()=>{
    data.members[0].password_hash='concurrent-newer-hash';
    data.members[0].auth_version=4;
    return 'stale-request-hash';
  };
  assert.throws(
    ()=>context.memberChangePassword('member-token','current-password','requestedPassword123'),
    /เซสชันถูกเพิกถอน/
  );
  assert.equal(data.members[0].password_hash,'concurrent-newer-hash');
  assert.equal(data.members[0].auth_version,4);
  assert.equal(data.member_sessions[0].revoked_at,'',
    'the losing request must not partially revoke or mutate sessions');
});

test('Admin password change rejects a stale credential snapshot if another change wins during KDF',()=>{
  const {context,data}=makeAuthContext();
  context.passwordHash_=()=>{
    data.admins[0].password_hash='concurrent-newer-hash';
    data.admins[0].auth_version=3;
    return 'stale-request-hash';
  };
  assert.throws(
    ()=>context.adminChangePassword('admin-token','current-password','requestedPasswordLong123'),
    /เซสชันถูกเพิกถอน/
  );
  assert.equal(data.admins[0].password_hash,'concurrent-newer-hash');
  assert.equal(data.admins[0].auth_version,3);
  assert.equal(data.admin_sessions[0].revoked_at,'',
    'the losing request must not partially revoke or mutate sessions');
});
