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

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const props = PropertiesService.getScriptProperties();
    const throttleKey = 'NOBI_ADMIN_LOGIN_' + sha256_(normalized).slice(0, 40);
    const state = JSON.parse(props.getProperty(throttleKey) || '{"count":0,"until":0}');
    if (Date.now() < Number(state.until || 0)) throw new Error('ลองเข้าสู่ระบบใหม่ภายหลัง');

    const admin = repositoryRows_('admins').find(function(item) {
      return String(item.username_normalized) === normalized && item.status === 'Active';
    });
    if (!admin || !passwordVerify_(pass, admin.password_salt, admin.password_hash, admin.password_algorithm)) {
      state.count = Number(state.count || 0) + 1;
      state.until = state.count >= 5 ? Date.now() + 15 * 60 * 1000 : 0;
      props.setProperty(throttleKey, JSON.stringify(state));
      throw new Error('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    }

    props.deleteProperty(throttleKey);
    const rawToken = Utilities.getUuid() + '.' + Utilities.getUuid() + '.' + Utilities.getUuid();
    const now = new Date();
    const createdAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + NOBI.SESSION_MAX_LIFETIME_MS).toISOString();
    repositoryInsertLocked_('admin_sessions', {
      session_id:Utilities.getUuid(),
      admin_id:admin.admin_id,
      token_hash:sha256_(rawToken),
      auth_version:Number(admin.auth_version || 1),
      created_at:createdAt,
      expires_at:expiresAt,
      last_seen_at:createdAt,
      revoked_at:'',
      created_ip:String(ipAddress || '').slice(0, 100)
    });
    repositoryUpdateLocked_('admins', admin.admin_id, {
      last_login_at:createdAt,
      updated_at:createdAt
    });
    repositoryInsertLocked_('admin_audit_logs', {
      audit_id:Utilities.getUuid(),
      admin_id:admin.admin_id,
      action:'ADMIN_LOGIN',
      target_type:'admin',
      target_id:admin.admin_id,
      request_id:'',
      ip_address:String(ipAddress || '').slice(0, 100),
      details_json:'{}',
      created_at:createdAt
    });
    return {
      ok:true,
      token:rawToken,
      expires_at:expiresAt,
      username:admin.username_display
    };
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
