/** Nobi Topup Apps Script 07_Auth module. */

function initializeAdmin() {
  const props = PropertiesService.getScriptProperties();
  const username = String(props.getProperty('NOBI_ADMIN_USERNAME') || '').trim();
  const password = String(props.getProperty('NOBI_ADMIN_PASSWORD') || '');
  if (!username || password.length < 14) throw new Error('Set NOBI_ADMIN_USERNAME and a strong NOBI_ADMIN_PASSWORD (14+ characters) in Script Properties first.');
  const existing = rows_('admins').find(r => String(r.username).toLowerCase() === username.toLowerCase());
  if (existing) throw new Error('That username already exists; no changes made.');
  const salt = Utilities.getUuid() + Utilities.getUuid();
  const id = Utilities.getUuid();
  append_('admins', {id:id, username:username, password_salt:salt, password_hash:passwordHash_(password,salt), auth_version:1, active:true, created_at:new Date().toISOString()});
  // Remove bootstrap credentials so they are not retained longer than necessary.
  props.deleteProperty('NOBI_ADMIN_PASSWORD');
  return {ok:true, message:'Admin created. Bootstrap password property removed.'};
}

function adminLogin(username, password) {
  const user = String(username || '').trim();
  const pass = String(password || '');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const props = PropertiesService.getScriptProperties();
    const key = 'NOBI_LOGIN_FAIL_' + Utilities.base64EncodeWebSafe(user.toLowerCase()).slice(0,60);
    const state = JSON.parse(props.getProperty(key) || '{"count":0,"until":0}');
    if (Date.now() < state.until) throw new Error('ลองเข้าสู่ระบบใหม่ภายหลัง');
    const admin = rows_('admins').find(r => String(r.username).toLowerCase() === user.toLowerCase() && truth_(r.active));
    if (!admin || passwordHash_(pass, String(admin.password_salt)) !== String(admin.password_hash)) {
      state.count = Number(state.count||0)+1;
      state.until = state.count >= 5 ? Date.now()+15*60*1000 : 0;
      props.setProperty(key, JSON.stringify(state));
      throw new Error('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    }
    props.deleteProperty(key);
    const raw = Utilities.getUuid() + '.' + Utilities.getUuid() + '.' + Utilities.getUuid();
    const now = new Date();
    append_('sessions',{id:Utilities.getUuid(),admin_id:admin.id,token_hash:sha256_(raw),auth_version:admin.auth_version,created_at:now.toISOString(),expires_at:new Date(now.getTime()+NOBI.SESSION_MS).toISOString(),revoked:false});
    return {ok:true,token:raw,expires_at:new Date(now.getTime()+NOBI.SESSION_MS).toISOString(),username:admin.username};
  } finally { lock.releaseLock(); }
}

function adminLogout(token) {
  const hash = sha256_(String(token || ''));
  const session = rows_('sessions').find(r => String(r.token_hash) === hash && !truth_(r.revoked));
  if (session) updateById_('sessions',session.id,{revoked:true});
  return {ok:true};
}

function requireAdmin_(token) {
  const hash = sha256_(String(token || ''));
  const s = rows_('sessions').find(r=>String(r.token_hash)===hash && !truth_(r.revoked) && Date.parse(r.expires_at)>Date.now());
  if (!s) throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
  const a = rows_('admins').find(r=>String(r.id)===String(s.admin_id) && truth_(r.active));
  if (!a || Number(a.auth_version)!==Number(s.auth_version)) throw new Error('เซสชันถูกเพิกถอน กรุณาเข้าสู่ระบบใหม่');
  return a;
}
