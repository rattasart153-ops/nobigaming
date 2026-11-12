/** Admin authentication with Schema v1 sessions and bounded lifetime/idle expiry. */

function initializeAdmin() {
  const props = PropertiesService.getScriptProperties();
  const username = String(props.getProperty('NOBI_ADMIN_USERNAME') || '').trim();
  const password = String(props.getProperty('NOBI_ADMIN_PASSWORD') || '');
  if (!/^[A-Za-z0-9._-]{4,40}$/.test(username) || password.length < 14) {
    throw new Error('กำหนด NOBI_ADMIN_USERNAME และ NOBI_ADMIN_PASSWORD ที่มีความยาวอย่างน้อย 14 ตัวอักษรก่อน');
  }
  if (repositoryRows_('admins').length) throw new Error('มีบัญชี Admin อยู่แล้ว ไม่ได้เปลี่ยนแปลงข้อมูล');

  const now = new Date().toISOString();
  const salt = Utilities.getUuid() + Utilities.getUuid();
  const admin = {
    admin_id:Utilities.getUuid(),
    username_normalized:username.toLowerCase(),
    username_display:username,
    password_hash:passwordHash_(password, salt),
    password_salt:salt,
    password_algorithm:'PBKDF2-SHA256-120000',
    status:'Active',
    auth_version:1,
    created_at:now,
    updated_at:now,
    last_login_at:''
  };
  repositoryInsert_('admins', admin);
  props.deleteProperty('NOBI_ADMIN_PASSWORD');
  return {ok:true, message:'สร้างบัญชี Admin แล้ว และลบค่า bootstrap password ออกจาก Script Properties แล้ว'};
}

function adminLogin(username, password) {
  const user = String(username || '').trim();
  const normalized = user.toLowerCase();
  const pass = String(password || '');
  if (!user || !pass) throw new Error('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  consumeLoginAttempt_('ADMIN_LOGIN_ATTEMPT', normalized, 10);
  assertAccountNotBlocked_('ADMIN_ACCOUNT', normalized);

  // Password KDF is intentionally outside ScriptLock so a slow login cannot
  // block order creation, coupon reservations, or other users' sessions.
  const admin = repositoryRows_('admins').find(function(item) {
    return String(item.username_normalized) === normalized && item.status === 'Active';
  });
  const valid = Boolean(admin && passwordVerify_(pass, admin.password_salt, admin.password_hash, admin.password_algorithm));
  if (!valid) {
    const lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try { incrementAccountFailureLocked_('ADMIN_ACCOUNT', normalized, Date.now()); }
    finally { lock.releaseLock(); }
    throw new Error('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    pruneExpiredSessionsLocked_(Date.now());
    assertRateLimitBucketNotBlockedLocked_('ADMIN_ACCOUNT', normalized, Date.now());
    const currentAdmin = repositoryGetById_('admins', admin.admin_id);
    if (!currentAdmin || currentAdmin.status !== 'Active' ||
        String(currentAdmin.password_hash) !== String(admin.password_hash) ||
        Number(currentAdmin.auth_version) !== Number(admin.auth_version)) {
      throw new Error('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    }

    resetAccountFailureLocked_('ADMIN_ACCOUNT', normalized);
    const rawToken = Utilities.getUuid() + '.' + Utilities.getUuid() + '.' + Utilities.getUuid();
    const now = new Date();
    const createdAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + NOBI.SESSION_MAX_LIFETIME_MS).toISOString();
    repositoryInsertLocked_('admin_sessions', {
      session_id:Utilities.getUuid(),
      admin_id:currentAdmin.admin_id,
      token_hash:sha256_(rawToken),
      auth_version:Number(currentAdmin.auth_version || 1),
      created_at:createdAt,
      expires_at:expiresAt,
      last_seen_at:createdAt,
      revoked_at:'',
      created_ip:''
    });
    repositoryUpdateLocked_('admins', currentAdmin.admin_id, {
      last_login_at:createdAt,
      updated_at:createdAt
    });
    appendAdminAuditLogLocked_({
      audit_id:Utilities.getUuid(),
      admin_id:currentAdmin.admin_id,
      action:'ADMIN_LOGIN',
      target_type:'admin',
      target_id:currentAdmin.admin_id,
      request_id:'',
      ip_address:'',
      details_json:'{}',
      created_at:createdAt
    });
    return {ok:true, token:rawToken, expires_at:expiresAt, username:currentAdmin.username_display};
  } finally {
    lock.releaseLock();
  }
}
function adminLogout(token) {
  const tokenHash = sha256_(String(token || ''));
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const session = repositoryFindByField_('admin_sessions', 'token_hash', tokenHash)
      .find(function(item) { return !item.revoked_at; });
    if (session) repositoryUpdateLocked_('admin_sessions', session.session_id, {
      revoked_at:new Date().toISOString()
    });
    return {ok:true};
  } finally {
    lock.releaseLock();
  }
}

function requireAdmin_(token) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { return requireAdminLocked_(token, Date.now()); }
  finally { lock.releaseLock(); }
}

/** Caller must already hold ScriptLock. Used to make privileged multi-step reads atomic with revocation. */
function requireAdminLocked_(token, nowMs) {
  const tokenValue = String(token || '');
  if (!tokenValue) throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
  const tokenHash = sha256_(tokenValue);
  // Re-read and validate under the same lock used by revocation/password changes.
  const session = repositoryFindByField_('admin_sessions', 'token_hash', tokenHash)[0];
  const now = Number(nowMs) || Date.now();
  if (!session || session.revoked_at || !Number.isFinite(Date.parse(session.expires_at)) ||
      Date.parse(session.expires_at) <= now) {
    throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
  }
  const lastSeen = Date.parse(session.last_seen_at || session.created_at);
  if (!Number.isFinite(lastSeen) || now - lastSeen >= NOBI.SESSION_IDLE_TIMEOUT_MS) {
    repositoryUpdateLocked_('admin_sessions', session.session_id, {revoked_at:new Date(now).toISOString()});
    throw new Error('เซสชันไม่มีการใช้งานเกินกำหนด กรุณาเข้าสู่ระบบใหม่');
  }
  const admin = repositoryGetById_('admins', session.admin_id);
  if (!admin || admin.status !== 'Active' ||
      Number(admin.auth_version) !== Number(session.auth_version)) {
    throw new Error('เซสชันถูกเพิกถอน กรุณาเข้าสู่ระบบใหม่');
  }
  repositoryUpdateLocked_('admin_sessions', session.session_id, {
    last_seen_at:new Date(now).toISOString()
  });
  return admin;
}
function memberRegister(fullName, loginId, password) {
  const name = String(fullName || '').trim();
  const login = String(loginId || '').trim();
  const normalized = login.toLowerCase();
  const pass = String(password || '');
  if (!name || name.length > 100 || !/^[A-Za-z0-9]{4,30}$/.test(login) || !/^[A-Za-z0-9]{8,200}$/.test(pass)) {
    throw new Error('กรุณากรอกชื่อ Login ID (ภาษาอังกฤษ/ตัวเลข 4-30 ตัว) และรหัสผ่านภาษาอังกฤษ/ตัวเลข 8-200 ตัว');
  }
  consumeRegistrationAttempt_(normalized);

  // Compute the password KDF before acquiring the global write lock.
  const salt = Utilities.getUuid() + Utilities.getUuid();
  const passwordHash = passwordHash_(pass, salt);
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    if (repositoryFindByField_('members', 'login_id_normalized', normalized).length) {
      throw new Error('Login ID นี้ถูกใช้งานแล้ว');
    }
    const now = new Date().toISOString();
    const member = {
      member_id:Utilities.getUuid(),
      full_name:name,
      login_id_normalized:normalized,
      login_id_display:login,
      password_hash:passwordHash,
      password_salt:salt,
      password_algorithm:'PBKDF2-SHA256-120000',
      status:'Active',
      auth_version:1,
      registered_ip:'',
      last_login_ip:'',
      created_at:now,
      updated_at:now,
      last_login_at:''
    };
    repositoryInsertLocked_('members', member);
    return {ok:true, member_id:member.member_id};
  } finally {
    lock.releaseLock();
  }
}

function memberLogin(loginId, password, userAgent) {
  const login = String(loginId || '').trim();
  const normalized = login.toLowerCase();
  const pass = String(password || '');
  const agent = String(userAgent || '').slice(0, 300);
  if (!login || !pass) throw new Error('Login ID หรือรหัสผ่านไม่ถูกต้อง');
  consumeLoginAttempt_('MEMBER_LOGIN_ATTEMPT', normalized, 10);
  try {
    assertAccountNotBlocked_('MEMBER_ACCOUNT', normalized);
  } catch (error) {
    const lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      appendMemberLoginLogLocked_('', normalized, 'Failure', 'RATE_LIMITED', agent, new Date().toISOString());
    } finally { lock.releaseLock(); }
    throw error;
  }

  // PBKDF2 verification stays outside ScriptLock to avoid blocking checkout writes.
  const member = repositoryFindByField_('members', 'login_id_normalized', normalized)[0];
  const valid = Boolean(member && member.status === 'Active' &&
    passwordVerify_(pass, member.password_salt, member.password_hash, member.password_algorithm));
  if (!valid) {
    const lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      incrementAccountFailureLocked_('MEMBER_ACCOUNT', normalized, Date.now());
      appendMemberLoginLogLocked_(member ? member.member_id : '', normalized, 'Failure', 'INVALID_CREDENTIALS', agent, new Date().toISOString());
    } finally { lock.releaseLock(); }
    throw new Error('Login ID หรือรหัสผ่านไม่ถูกต้อง');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    pruneExpiredSessionsLocked_(Date.now());
    assertRateLimitBucketNotBlockedLocked_('MEMBER_ACCOUNT', normalized, Date.now());
    const currentMember = repositoryGetById_('members', member.member_id);
    if (!currentMember || currentMember.status !== 'Active' ||
        String(currentMember.password_hash) !== String(member.password_hash) ||
        Number(currentMember.auth_version) !== Number(member.auth_version)) {
      appendMemberLoginLogLocked_(member.member_id, normalized, 'Failure', 'CREDENTIALS_CHANGED', agent, new Date().toISOString());
      throw new Error('Login ID หรือรหัสผ่านไม่ถูกต้อง');
    }

    resetAccountFailureLocked_('MEMBER_ACCOUNT', normalized);
    const now = new Date();
    const nowIso = now.toISOString();
    const rawToken = Utilities.getUuid() + '.' + Utilities.getUuid() + '.' + Utilities.getUuid();
    const expiresAt = new Date(now.getTime() + NOBI.SESSION_MAX_LIFETIME_MS).toISOString();
    repositoryInsertLocked_('member_sessions', {
      session_id:Utilities.getUuid(),
      member_id:currentMember.member_id,
      token_hash:sha256_(rawToken),
      auth_version:Number(currentMember.auth_version || 1),
      created_at:nowIso,
      expires_at:expiresAt,
      last_seen_at:nowIso,
      revoked_at:'',
      created_ip:''
    });
    repositoryUpdateLocked_('members', currentMember.member_id, {
      last_login_ip:'',
      last_login_at:nowIso,
      updated_at:nowIso
    });
    appendMemberLoginLogLocked_(currentMember.member_id, normalized, 'Success', '', agent, nowIso);
    return {
      ok:true,
      token:rawToken,
      expires_at:expiresAt,
      member:{member_id:currentMember.member_id, full_name:currentMember.full_name, login_id:currentMember.login_id_display}
    };
  } finally {
    lock.releaseLock();
  }
}
function memberLogout(token) {
  const hash = sha256_(String(token || ''));
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const session = repositoryFindByField_('member_sessions', 'token_hash', hash)
      .find(function(item) { return !item.revoked_at; });
    if (session) repositoryUpdateLocked_('member_sessions', session.session_id, {
      revoked_at:new Date().toISOString()
    });
    return {ok:true};
  } finally {
    lock.releaseLock();
  }
}

function requireMember_(token) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { return requireMemberLocked_(token, Date.now()); }
  finally { lock.releaseLock(); }
}

/** Caller must already hold ScriptLock. */
function requireMemberLocked_(token, nowMs) {
  const tokenValue = String(token || '');
  if (!tokenValue) throw new Error('กรุณาเข้าสู่ระบบสมาชิก');
  const session = repositoryFindByField_('member_sessions', 'token_hash', sha256_(tokenValue))[0];
  const now = Number(nowMs) || Date.now();
  if (!session || session.revoked_at || !Number.isFinite(Date.parse(session.expires_at)) ||
      Date.parse(session.expires_at) <= now) {
    throw new Error('เซสชันสมาชิกหมดอายุ กรุณาเข้าสู่ระบบใหม่');
  }
  const lastSeen = Date.parse(session.last_seen_at || session.created_at);
  if (!Number.isFinite(lastSeen) || now - lastSeen >= NOBI.SESSION_IDLE_TIMEOUT_MS) {
    repositoryUpdateLocked_('member_sessions', session.session_id, {revoked_at:new Date(now).toISOString()});
    throw new Error('เซสชันสมาชิกไม่มีการใช้งานเกินกำหนด กรุณาเข้าสู่ระบบใหม่');
  }
  const member = repositoryGetById_('members', session.member_id);
  if (!member || member.status !== 'Active' ||
      Number(member.auth_version) !== Number(session.auth_version)) {
    throw new Error('บัญชีสมาชิกถูกระงับหรือเซสชันถูกเพิกถอน');
  }
  repositoryUpdateLocked_('member_sessions', session.session_id, {
    last_seen_at:new Date(now).toISOString()
  });
  return member;
}
function memberMe(token) {
  const member = requireMember_(token);
  return {
    authenticated:true,
    member:{member_id:member.member_id, full_name:member.full_name, login_id:member.login_id_display}
  };
}

function appendMemberLoginLogLocked_(memberId, loginId, result, reason, userAgent, createdAt) {
  repositoryInsertLocked_('member_login_logs', {
    log_id:Utilities.getUuid(),
    member_id:memberId,
    login_id_normalized:loginId,
    ip_address:'',
    is_new_ip:false,
    login_result:result,
    failure_reason_code:reason,
    user_agent:userAgent,
    created_at:createdAt
  });
  pruneMemberLoginLogsLocked_(Date.parse(createdAt));
}

function pruneMemberLoginLogsLocked_(nowMs) {
  const cutoff = nowMs - NOBI.LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  repositoryRows_('member_login_logs').filter(function(log) {
    const created = Date.parse(String(log.created_at || ''));
    return Number.isFinite(created) && created < cutoff;
  }).forEach(function(log) {
    repositoryDeleteLocked_('member_login_logs', log.log_id);
  });
}


function memberChangePassword(token, currentPassword, newPassword) {
  const authenticated = requireMember_(token);
  const nextPassword = String(newPassword || '');
  if (!/^[A-Za-z0-9]{8,200}$/.test(nextPassword)) throw new Error('รหัสผ่านใหม่ต้องเป็นภาษาอังกฤษ/ตัวเลข 8-200 ตัว');

  // Run the expensive KDF outside ScriptLock; re-check the credential snapshot before commit.
  if (!passwordVerify_(String(currentPassword || ''), authenticated.password_salt,
      authenticated.password_hash, authenticated.password_algorithm)) {
    throw new Error('รหัสผ่านปัจจุบันไม่ถูกต้อง');
  }
  const salt = Utilities.getUuid() + Utilities.getUuid();
  const nextHash = passwordHash_(nextPassword, salt);
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    // Revalidate the live session under the same lock used by logout and revocation.
    const member = requireMemberLocked_(token, Date.now());
    if (String(member.member_id) !== String(authenticated.member_id) ||
        String(member.password_hash) !== String(authenticated.password_hash) ||
        Number(member.auth_version) !== Number(authenticated.auth_version)) {
      throw new Error('ข้อมูลบัญชีเปลี่ยนแปลง กรุณาเข้าสู่ระบบใหม่');
    }
    const now = new Date().toISOString();
    repositoryUpdateLocked_('members', member.member_id, {
      password_hash:nextHash,
      password_salt:salt,
      password_algorithm:'PBKDF2-SHA256-120000',
      auth_version:Number(member.auth_version || 1) + 1,
      updated_at:now
    });
    repositoryRows_('member_sessions').filter(function(session) {
      return String(session.member_id) === String(member.member_id) && !session.revoked_at;
    }).forEach(function(session) {
      repositoryUpdateLocked_('member_sessions', session.session_id, {revoked_at:now});
    });
    return {ok:true, message:'เปลี่ยนรหัสผ่านแล้ว กรุณาเข้าสู่ระบบใหม่'};
  } finally {
    lock.releaseLock();
  }
}

function adminChangePassword(token, currentPassword, newPassword) {
  const authenticated = requireAdmin_(token);
  const nextPassword = String(newPassword || '');
  if (nextPassword.length < 14 || nextPassword.length > 200) throw new Error('รหัสผ่านใหม่ต้องมีความยาว 14-200 ตัวอักษร');

  // Run the expensive KDF outside ScriptLock; re-check the credential snapshot before commit.
  if (!passwordVerify_(String(currentPassword || ''), authenticated.password_salt,
      authenticated.password_hash, authenticated.password_algorithm)) {
    throw new Error('รหัสผ่านปัจจุบันไม่ถูกต้อง');
  }
  const salt = Utilities.getUuid() + Utilities.getUuid();
  const nextHash = passwordHash_(nextPassword, salt);
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    // Revalidate the live session under the same lock used by logout and revocation.
    const admin = requireAdminLocked_(token, Date.now());
    if (String(admin.admin_id) !== String(authenticated.admin_id) ||
        String(admin.password_hash) !== String(authenticated.password_hash) ||
        Number(admin.auth_version) !== Number(authenticated.auth_version)) {
      throw new Error('ข้อมูลบัญชีเปลี่ยนแปลง กรุณาเข้าสู่ระบบใหม่');
    }
    const now = new Date().toISOString();
    repositoryUpdateLocked_('admins', admin.admin_id, {
      password_hash:nextHash,
      password_salt:salt,
      password_algorithm:'PBKDF2-SHA256-120000',
      auth_version:Number(admin.auth_version || 1) + 1,
      updated_at:now
    });
    repositoryRows_('admin_sessions').filter(function(session) {
      return String(session.admin_id) === String(admin.admin_id) && !session.revoked_at;
    }).forEach(function(session) {
      repositoryUpdateLocked_('admin_sessions', session.session_id, {revoked_at:now});
    });
    appendAdminAuditLogLocked_({
      audit_id:Utilities.getUuid(), admin_id:admin.admin_id,
      action:'ADMIN_PASSWORD_CHANGED', target_type:'admin',
      target_id:admin.admin_id, request_id:'', ip_address:'',
      details_json:'{}', created_at:now
    });
    return {ok:true, message:'เปลี่ยนรหัสผ่านแล้ว กรุณาเข้าสู่ระบบใหม่'};
  } finally {
    lock.releaseLock();
  }
}
