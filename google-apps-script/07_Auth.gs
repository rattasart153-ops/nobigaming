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

function adminLogin(username, password, ipAddress) {
  const user = String(username || '').trim();
  const normalized = user.toLowerCase();
  const pass = String(password || '');
  if (!user || !pass) throw new Error('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');

  const props = PropertiesService.getScriptProperties();
  const throttleKey = 'NOBI_ADMIN_LOGIN_' + sha256_(normalized).slice(0, 40);
  const initialState = JSON.parse(props.getProperty(throttleKey) || '{"count":0,"until":0}');
  if (Date.now() < Number(initialState.until || 0)) throw new Error('ลองเข้าสู่ระบบใหม่ภายหลัง');

  // Password KDF is intentionally outside ScriptLock so a slow login cannot
  // block order creation, coupon reservations, or other users' sessions.
  const admin = repositoryRows_('admins').find(function(item) {
    return String(item.username_normalized) === normalized && item.status === 'Active';
  });
  const valid = Boolean(admin && passwordVerify_(pass, admin.password_salt, admin.password_hash, admin.password_algorithm));
  if (!valid) {
    const lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      const state = JSON.parse(props.getProperty(throttleKey) || '{"count":0,"until":0}');
      state.count = Number(state.count || 0) + 1;
      state.until = state.count >= 5 ? Date.now() + 15 * 60 * 1000 : 0;
      props.setProperty(throttleKey, JSON.stringify(state));
    } finally {
      lock.releaseLock();
    }
    throw new Error('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const currentState = JSON.parse(props.getProperty(throttleKey) || '{"count":0,"until":0}');
    if (Date.now() < Number(currentState.until || 0)) throw new Error('ลองเข้าสู่ระบบใหม่ภายหลัง');
    const currentAdmin = repositoryGetById_('admins', admin.admin_id);
    if (!currentAdmin || currentAdmin.status !== 'Active' ||
        String(currentAdmin.password_hash) !== String(admin.password_hash) ||
        Number(currentAdmin.auth_version) !== Number(admin.auth_version)) {
      throw new Error('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    }

    props.deleteProperty(throttleKey);
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
      created_ip:String(ipAddress || '').slice(0, 100)
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
      ip_address:String(ipAddress || '').slice(0, 100),
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
  const tokenValue = String(token || '');
  if (!tokenValue) throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
  const tokenHash = sha256_(tokenValue);
  const session = repositoryFindByField_('admin_sessions', 'token_hash', tokenHash)[0];
  const now = Date.now();
  if (!session || session.revoked_at || !Number.isFinite(Date.parse(session.expires_at)) ||
      Date.parse(session.expires_at) <= now) {
    throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
  }

  const lastSeen = Date.parse(session.last_seen_at || session.created_at);
  if (!Number.isFinite(lastSeen) || now - lastSeen >= NOBI.SESSION_IDLE_TIMEOUT_MS) {
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      repositoryUpdateLocked_('admin_sessions', session.session_id, {revoked_at:new Date().toISOString()});
    } finally {
      lock.releaseLock();
    }
    throw new Error('เซสชันไม่มีการใช้งานเกินกำหนด กรุณาเข้าสู่ระบบใหม่');
  }

  const admin = repositoryGetById_('admins', session.admin_id);
  if (!admin || admin.status !== 'Active' ||
      Number(admin.auth_version) !== Number(session.auth_version)) {
    throw new Error('เซสชันถูกเพิกถอน กรุณาเข้าสู่ระบบใหม่');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    repositoryUpdateLocked_('admin_sessions', session.session_id, {
      last_seen_at:new Date(now).toISOString()
    });
  } finally {
    lock.releaseLock();
  }
  return admin;
}


function memberRegister(fullName, loginId, password, ipAddress) {
  const name = String(fullName || '').trim();
  const login = String(loginId || '').trim();
  const normalized = login.toLowerCase();
  const pass = String(password || '');
  if (!name || name.length > 100 || !/^[A-Za-z0-9]{4,30}$/.test(login) || pass.length < 10 || pass.length > 200) {
    throw new Error('กรุณากรอกชื่อ Login ID (ภาษาอังกฤษ/ตัวเลข 4-30 ตัว) และรหัสผ่านอย่างน้อย 10 ตัวอักษร');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    if (repositoryFindByField_('members', 'login_id_normalized', normalized).length) {
      throw new Error('Login ID นี้ถูกใช้งานแล้ว');
    }
    const now = new Date().toISOString();
    const salt = Utilities.getUuid() + Utilities.getUuid();
    const member = {
      member_id:Utilities.getUuid(),
      full_name:name,
      login_id_normalized:normalized,
      login_id_display:login,
      password_hash:passwordHash_(pass, salt),
      password_salt:salt,
      password_algorithm:'PBKDF2-SHA256-120000',
      status:'Active',
      auth_version:1,
      registered_ip:String(ipAddress || '').slice(0, 100),
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

function memberLogin(loginId, password, ipAddress, userAgent) {
  const login = String(loginId || '').trim();
  const normalized = login.toLowerCase();
  const pass = String(password || '');
  const ip = String(ipAddress || '').slice(0, 100);
  const agent = String(userAgent || '').slice(0, 300);
  if (!login || !pass) throw new Error('Login ID หรือรหัสผ่านไม่ถูกต้อง');

  const props = PropertiesService.getScriptProperties();
  const throttleKey = 'NOBI_MEMBER_LOGIN_' + sha256_(normalized).slice(0, 40);
  const initialState = JSON.parse(props.getProperty(throttleKey) || '{"count":0,"until":0}');
  if (Date.now() < Number(initialState.until || 0)) {
    const lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      appendMemberLoginLogLocked_('', normalized, ip, false, 'Failure', 'RATE_LIMITED', agent, new Date().toISOString());
    } finally {
      lock.releaseLock();
    }
    throw new Error('ลองเข้าสู่ระบบใหม่ภายหลัง');
  }

  // PBKDF2 verification stays outside ScriptLock to avoid blocking checkout writes.
  const member = repositoryFindByField_('members', 'login_id_normalized', normalized)[0];
  const valid = Boolean(member && member.status === 'Active' &&
    passwordVerify_(pass, member.password_salt, member.password_hash, member.password_algorithm));
  if (!valid) {
    const lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      const state = JSON.parse(props.getProperty(throttleKey) || '{"count":0,"until":0}');
      state.count = Number(state.count || 0) + 1;
      state.until = state.count >= 5 ? Date.now() + 15 * 60 * 1000 : 0;
      props.setProperty(throttleKey, JSON.stringify(state));
      appendMemberLoginLogLocked_(member ? member.member_id : '', normalized, ip, false, 'Failure', 'INVALID_CREDENTIALS', agent, new Date().toISOString());
    } finally {
      lock.releaseLock();
    }
    throw new Error('Login ID หรือรหัสผ่านไม่ถูกต้อง');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const state = JSON.parse(props.getProperty(throttleKey) || '{"count":0,"until":0}');
    if (Date.now() < Number(state.until || 0)) {
      appendMemberLoginLogLocked_(member.member_id, normalized, ip, false, 'Failure', 'RATE_LIMITED', agent, new Date().toISOString());
      throw new Error('ลองเข้าสู่ระบบใหม่ภายหลัง');
    }
    const currentMember = repositoryGetById_('members', member.member_id);
    if (!currentMember || currentMember.status !== 'Active' ||
        String(currentMember.password_hash) !== String(member.password_hash) ||
        Number(currentMember.auth_version) !== Number(member.auth_version)) {
      appendMemberLoginLogLocked_(member.member_id, normalized, ip, false, 'Failure', 'CREDENTIALS_CHANGED', agent, new Date().toISOString());
      throw new Error('Login ID หรือรหัสผ่านไม่ถูกต้อง');
    }

    props.deleteProperty(throttleKey);
    const now = new Date();
    const nowIso = now.toISOString();
    const isNewIp = !currentMember.last_login_ip || String(currentMember.last_login_ip) !== ip;
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
      created_ip:ip
    });
    repositoryUpdateLocked_('members', currentMember.member_id, {
      last_login_ip:ip,
      last_login_at:nowIso,
      updated_at:nowIso
    });
    appendMemberLoginLogLocked_(currentMember.member_id, normalized, ip, isNewIp, 'Success', '', agent, nowIso);
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
  const tokenValue = String(token || '');
  if (!tokenValue) throw new Error('กรุณาเข้าสู่ระบบสมาชิก');
  const session = repositoryFindByField_('member_sessions', 'token_hash', sha256_(tokenValue))[0];
  const now = Date.now();
  if (!session || session.revoked_at || !Number.isFinite(Date.parse(session.expires_at)) ||
      Date.parse(session.expires_at) <= now) {
    throw new Error('เซสชันสมาชิกหมดอายุ กรุณาเข้าสู่ระบบใหม่');
  }
  const lastSeen = Date.parse(session.last_seen_at || session.created_at);
  if (!Number.isFinite(lastSeen) || now - lastSeen >= NOBI.SESSION_IDLE_TIMEOUT_MS) {
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try { repositoryUpdateLocked_('member_sessions', session.session_id, {revoked_at:new Date().toISOString()}); }
    finally { lock.releaseLock(); }
    throw new Error('เซสชันสมาชิกไม่มีการใช้งานเกินกำหนด กรุณาเข้าสู่ระบบใหม่');
  }
  const member = repositoryGetById_('members', session.member_id);
  if (!member || member.status !== 'Active' ||
      Number(member.auth_version) !== Number(session.auth_version)) {
    throw new Error('บัญชีสมาชิกถูกระงับหรือเซสชันถูกเพิกถอน');
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    repositoryUpdateLocked_('member_sessions', session.session_id, {last_seen_at:new Date(now).toISOString()});
  } finally {
    lock.releaseLock();
  }
  return member;
}

function memberMe(token) {
  const member = requireMember_(token);
  return {
    authenticated:true,
    member:{member_id:member.member_id, full_name:member.full_name, login_id:member.login_id_display}
  };
}

function appendMemberLoginLogLocked_(memberId, loginId, ip, isNewIp, result, reason, userAgent, createdAt) {
  repositoryInsertLocked_('member_login_logs', {
    log_id:Utilities.getUuid(),
    member_id:memberId,
    login_id_normalized:loginId,
    ip_address:ip,
    is_new_ip:Boolean(isNewIp),
    login_result:result,
    failure_reason_code:reason,
    user_agent:userAgent,
    created_at:createdAt
  });
  pruneMemberLoginLogsLocked_(Date.parse(createdAt));
}

function pruneMemberLoginLogsLocked_(nowMs) {
  const cutoff = nowMs - NOBI.LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const sheet = repositorySheet_('member_login_logs');
  const values = sheet.getDataRange().getValues();
  const headers = NOBI.SHEETS.member_login_logs;
  const createdIndex = headers.indexOf('created_at');
  for (let row = values.length - 1; row >= 1; row--) {
    const created = Date.parse(String(values[row][createdIndex] || ''));
    if (Number.isFinite(created) && created < cutoff) sheet.deleteRow(row + 1);
  }
}


function memberChangePassword(token, currentPassword, newPassword) {
  const authenticated = requireMember_(token);
  const nextPassword = String(newPassword || '');
  if (nextPassword.length < 10 || nextPassword.length > 200) throw new Error('รหัสผ่านใหม่ต้องมีความยาว 10-200 ตัวอักษร');
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const member = repositoryGetById_('members', authenticated.member_id);
    if (!member || !passwordVerify_(String(currentPassword || ''), member.password_salt, member.password_hash, member.password_algorithm)) {
      throw new Error('รหัสผ่านปัจจุบันไม่ถูกต้อง');
    }
    const now = new Date().toISOString();
    const salt = Utilities.getUuid() + Utilities.getUuid();
    repositoryUpdateLocked_('members', member.member_id, {
      password_hash:passwordHash_(nextPassword, salt),
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
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const admin = repositoryGetById_('admins', authenticated.admin_id);
    if (!admin || !passwordVerify_(String(currentPassword || ''), admin.password_salt, admin.password_hash, admin.password_algorithm)) {
      throw new Error('รหัสผ่านปัจจุบันไม่ถูกต้อง');
    }
    const now = new Date().toISOString();
    const salt = Utilities.getUuid() + Utilities.getUuid();
    repositoryUpdateLocked_('admins', admin.admin_id, {
      password_hash:passwordHash_(nextPassword, salt),
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
