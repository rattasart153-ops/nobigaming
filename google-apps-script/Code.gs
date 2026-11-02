/** Nobi Topup Google Apps Script backend scaffold.
 * Deploy as a Web App only after reviewing docs/GOOGLE_APPS_SCRIPT_SETUP.md.
 * Do not expose the slip folder or place secrets in source control.
 */
const NOBI = {
  SHEETS: {
    admins: ['id','username','password_salt','password_hash','auth_version','active','created_at'],
    games: ['id','name','category','description','active','created_at'],
    packages: ['id','game_id','name','amount','unit','price','image_url','popular','active','created_at'],
    coupons: ['id','code','discount_type','discount_value','min_spend','game_id','expires_at','usage_limit','used_count','active','created_at'],
    promotions: ['id','title','subtitle','image_url','link_url','active','sort_order','starts_at','ends_at','created_at'],
    orders: ['id','game_id','package_id','game_name','package_name','player_id','server_id','coupon_id','coupon_code','subtotal','discount','total','slip_file_id','status','created_at','updated_at','request_key'],
    sessions: ['id','admin_id','token_hash','auth_version','created_at','expires_at','revoked']
  },
  SESSION_MS: 8 * 60 * 60 * 1000,
  MAX_SLIP_BYTES: 5 * 1024 * 1024
};

function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, service: 'Nobi Topup GAS backend', version: 1 }))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Run once manually from the Apps Script editor. Creates sheets and private Drive folder. */
function setupNobiDatabase() {
  const props = PropertiesService.getScriptProperties();
  const ssId = props.getProperty('NOBI_SHEET_ID');
  let ss = ssId ? SpreadsheetApp.openById(ssId) : SpreadsheetApp.create('Nobi Topup Database');
  props.setProperty('NOBI_SHEET_ID', ss.getId());
  Object.keys(NOBI.SHEETS).forEach(function(name) {
    let sh = ss.getSheetByName(name) || ss.insertSheet(name);
    const headers = NOBI.SHEETS[name];
    if (sh.getLastRow() === 0) sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  });
  const folderId = props.getProperty('NOBI_PRIVATE_DRIVE_FOLDER_ID');
  if (!folderId) {
    const folder = DriveApp.createFolder('Nobi Topup Private Files');
    props.setProperty('NOBI_PRIVATE_DRIVE_FOLDER_ID', folder.getId());
  }
  return { spreadsheetId: ss.getId(), message: 'Database sheets and private file folder prepared. Keep the spreadsheet and folder private.' };
}

/** Set NOBI_ADMIN_USERNAME and NOBI_ADMIN_PASSWORD in Project Settings > Script Properties, then run once. */
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

function publicCatalog() {
  const games = rows_('games').filter(r => truth_(r.active));
  const packages = rows_('packages').filter(r => truth_(r.active));
  return { games: games.map(clean_), packages: packages.map(clean_) };
}

function publicPromotions() {
  const now = Date.now();
  return rows_('promotions').filter(r => truth_(r.active) && (!r.starts_at || Date.parse(r.starts_at) <= now) && (!r.ends_at || Date.parse(r.ends_at) >= now)).sort((a,b) => Number(a.sort_order||0)-Number(b.sort_order||0)).map(clean_);
}

function validateCoupon(code, gameId, subtotal) {
  const normalized = String(code || '').trim().toUpperCase();
  const amount = Number(subtotal);
  if (!normalized || !Number.isFinite(amount) || amount < 0) return { valid:false, error:'ข้อมูลคูปองไม่ถูกต้อง' };
  const c = rows_('coupons').find(r => String(r.code).toUpperCase() === normalized && truth_(r.active));
  if (!c) return { valid:false, error:'ไม่พบคูปองหรือคูปองปิดใช้งาน' };
  if (c.expires_at && Date.parse(c.expires_at) < Date.now()) return { valid:false, error:'คูปองหมดอายุแล้ว' };
  if (amount < Number(c.min_spend || 0)) return { valid:false, error:'ยอดซื้อไม่ถึงขั้นต่ำ' };
  if (c.game_id && String(c.game_id) !== String(gameId)) return { valid:false, error:'คูปองนี้ใช้กับเกมที่เลือกไม่ได้' };
  if (c.usage_limit !== '' && c.usage_limit != null && Number(c.used_count || 0) >= Number(c.usage_limit)) return { valid:false, error:'คูปองถูกใช้ครบจำนวนแล้ว' };
  const discount = Math.min(amount, c.discount_type === 'percent' ? amount * Number(c.discount_value) / 100 : Number(c.discount_value));
  return { valid:true, code:c.code, coupon_id:c.id, discount:money_(discount), total:money_(amount-discount) };
}

/** payload: {game_id,package_id,player_id,server_id,coupon_code,request_key,slip:{name,mimeType,base64}} */
function createOrder(payload) {
  payload = payload || {};
  const key = String(payload.request_key || '').trim();
  if (key.length < 12 || key.length > 120) throw new Error('ต้องมี request_key ที่ไม่ซ้ำและยาวอย่างน้อย 12 ตัวอักษร');
  const prior = rows_('orders').find(o => String(o.request_key) === key);
  if (prior) return { ok:true, order:publicOrder_(prior), duplicate:true };
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const again = rows_('orders').find(o => String(o.request_key) === key);
    if (again) return { ok:true, order:publicOrder_(again), duplicate:true };
    const game = rows_('games').find(r => String(r.id) === String(payload.game_id) && truth_(r.active));
    const pack = rows_('packages').find(r => String(r.id) === String(payload.package_id) && truth_(r.active) && String(r.game_id) === String(payload.game_id));
    const playerId = String(payload.player_id || '').trim();
    const serverId = String(payload.server_id || '').trim();
    if (!game || !pack) throw new Error('ไม่พบเกมหรือแพ็กเกจที่เปิดขาย');
    if (!playerId || playerId.length > 100 || serverId.length > 100) throw new Error('UID/Server ID ไม่ถูกต้อง');
    const subtotal = money_(Number(pack.price));
    if (!Number.isFinite(subtotal) || subtotal < 0) throw new Error('ราคาแพ็กเกจไม่ถูกต้อง');
    let coupon = null, discount = 0;
    if (payload.coupon_code) {
      const checked = validateCoupon(payload.coupon_code, game.id, subtotal);
      if (!checked.valid) throw new Error(checked.error);
      coupon = rows_('coupons').find(c => String(c.id) === String(checked.coupon_id));
      discount = checked.discount;
      // Recheck usage while holding the write lock.
      if (coupon.usage_limit !== '' && coupon.usage_limit != null && Number(coupon.used_count || 0) >= Number(coupon.usage_limit)) throw new Error('คูปองถูกใช้ครบจำนวนแล้ว');
    }
    const slip = payload.slip;
    if (!slip || !slip.base64 || !/^image\/(png|jpeg|webp)$/.test(String(slip.mimeType || ''))) throw new Error('กรุณาแนบสลิป PNG/JPG/WebP');
    const bytes = Utilities.base64Decode(String(slip.base64).replace(/^data:[^,]+,/, ''));
    if (!bytes.length || bytes.length > NOBI.MAX_SLIP_BYTES) throw new Error('ไฟล์สลิปต้องมีขนาดไม่เกิน 5 MB');
    const ext = slip.mimeType === 'image/png' ? 'png' : slip.mimeType === 'image/webp' ? 'webp' : 'jpg';
    const orderId = 'NBI-' + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMddHHmmss') + '-' + Utilities.getUuid().slice(0,8).toUpperCase();
    const folder = DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty('NOBI_PRIVATE_DRIVE_FOLDER_ID'));
    const file = folder.createFile(Utilities.newBlob(bytes, slip.mimeType, orderId + '.' + ext));
    file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
    const now = new Date().toISOString();
    const order = {id:orderId,game_id:game.id,package_id:pack.id,game_name:game.name,package_name:pack.name,player_id:playerId,server_id:serverId,coupon_id:coupon?coupon.id:'',coupon_code:coupon?coupon.code:'',subtotal:subtotal,discount:discount,total:money_(subtotal-discount),slip_file_id:file.getId(),status:'Pending',created_at:now,updated_at:now,request_key:key};
    append_('orders', order);
    if (coupon) updateById_('coupons', coupon.id, {used_count:Number(coupon.used_count||0)+1});
    return {ok:true,order:publicOrder_(order),duplicate:false};
  } finally {
    lock.releaseLock();
  }
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

function adminDashboard(token) {
  requireAdmin_(token);
  const orders = rows_('orders');
  return {orders:orders.length,pending:orders.filter(o=>o.status==='Pending').length,completed:orders.filter(o=>o.status==='Completed').length,revenue:money_(orders.filter(o=>o.status==='Completed').reduce((s,o)=>s+Number(o.total||0),0))};
}

function adminOrders(token) {
  requireAdmin_(token);
  return rows_('orders').sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))).map(function(o) {
    const safe = publicOrder_(o);
    safe.slip_file_id = o.slip_file_id; // ID only; use adminSlipData for authorized retrieval.
    return safe;
  });
}

function adminSlipData(token, orderId) {
  requireAdmin_(token);
  const order = rows_('orders').find(o => String(o.id) === String(orderId));
  if (!order || !order.slip_file_id) throw new Error('ไม่พบสลิป');
  const file = DriveApp.getFileById(String(order.slip_file_id));
  const blob = file.getBlob();
  return {name:file.getName(),mimeType:blob.getContentType(),base64:Utilities.base64Encode(blob.getBytes())};
}

function adminSetOrderStatus(token, orderId, status) {
  requireAdmin_(token);
  if (!['Pending','Completed','Rejected'].includes(String(status))) throw new Error('สถานะไม่ถูกต้อง');
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const order = rows_('orders').find(o=>String(o.id)===String(orderId));
    if (!order) throw new Error('ไม่พบออเดอร์');
    updateById_('orders',order.id,{status:status,updated_at:new Date().toISOString()});
    return {ok:true};
  } finally { lock.releaseLock(); }
}

function adminList(token, tableName) {
  requireAdmin_(token);
  if (!['games','packages','coupons','promotions'].includes(String(tableName))) throw new Error('ไม่อนุญาตให้เข้าถึงตารางนี้');
  return rows_(tableName).map(clean_);
}

function adminUpsert(token, tableName, record) {
  requireAdmin_(token);
  if (!['games','packages','coupons','promotions'].includes(String(tableName))) throw new Error('ไม่อนุญาตให้แก้ไขตารางนี้');
  record = record || {};
  const headers = NOBI.SHEETS[tableName];
  const safe = {};
  headers.forEach(h => { if (h !== 'id' && h !== 'created_at' && Object.prototype.hasOwnProperty.call(record,h)) safe[h] = record[h]; });
  validateRecord_(tableName,safe);
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    if (record.id) {
      updateById_(tableName,record.id,safe);
      return {ok:true,id:record.id};
    }
    safe.id = Utilities.getUuid();
    safe.created_at = new Date().toISOString();
    append_(tableName,safe);
    return {ok:true,id:safe.id};
  } finally { lock.releaseLock(); }
}

function adminDelete(token, tableName, id) {
  requireAdmin_(token);
  if (!['games','packages','coupons','promotions'].includes(String(tableName))) throw new Error('ไม่อนุญาตให้ลบตารางนี้');
  const sh = sheet_(tableName), data = sh.getDataRange().getValues(), headers = data[0], idx = headers.indexOf('id');
  for (let i=1;i<data.length;i++) if (String(data[i][idx])===String(id)) { sh.deleteRow(i+1); return {ok:true}; }
  throw new Error('ไม่พบรายการ');
}

function requireAdmin_(token) {
  const hash = sha256_(String(token || ''));
  const s = rows_('sessions').find(r=>String(r.token_hash)===hash && !truth_(r.revoked) && Date.parse(r.expires_at)>Date.now());
  if (!s) throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
  const a = rows_('admins').find(r=>String(r.id)===String(s.admin_id) && truth_(r.active));
  if (!a || Number(a.auth_version)!==Number(s.auth_version)) throw new Error('เซสชันถูกเพิกถอน กรุณาเข้าสู่ระบบใหม่');
  return a;
}

function validateRecord_(tableName,r) {
  const required = {games:['name'],packages:['game_id','name','price'],coupons:['code','discount_type','discount_value'],promotions:['title']}[tableName] || [];
  required.forEach(k=>{if(r[k]===undefined || r[k]===null || String(r[k]).trim()==='') throw new Error('ต้องระบุ '+k);});
  if (tableName==='packages' && (!Number.isFinite(Number(r.price)) || Number(r.price)<0)) throw new Error('ราคาไม่ถูกต้อง');
  if (tableName==='coupons' && (!['fixed','percent'].includes(String(r.discount_type)) || Number(r.discount_value)<=0)) throw new Error('ข้อมูลส่วนลดไม่ถูกต้อง');
}
function publicOrder_(o) { const c=Object.assign({},o); delete c.slip_file_id; delete c.request_key; return c; }
function passwordHash_(password,salt) { return sha256_(String(salt)+'|'+String(password)); }
function sha256_(value) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(value),Utilities.Charset.UTF_8).map(b=>('0'+((b+256)%256).toString(16)).slice(-2)).join(''); }
function money_(n) { return Math.round((Number(n)+Number.EPSILON)*100)/100; }
function truth_(v) { return v===true || v===1 || String(v).toLowerCase()==='true'; }
function clean_(r) { const out={}; Object.keys(r).forEach(k=>{if (k !== 'password_hash' && k !== 'password_salt' && k !== 'token_hash') out[k]=r[k];}); return out; }
function sheet_(name) {
  const id=PropertiesService.getScriptProperties().getProperty('NOBI_SHEET_ID');
  if(!id) throw new Error('Run setupNobiDatabase first.');
  const sh=SpreadsheetApp.openById(id).getSheetByName(name);
  if(!sh) throw new Error('Missing sheet: '+name);
  return sh;
}
function rows_(name) {
  const sh=sheet_(name), values=sh.getDataRange().getValues();
  if(values.length<2) return [];
  const headers=values[0];
  return values.slice(1).filter(row=>row.some(v=>v!=='' && v!==null)).map(row=>{
    const o={}; headers.forEach((h,i)=>o[h]=row[i]); return o;
  });
}
function append_(name, record) {
  const sh=sheet_(name), headers=NOBI.SHEETS[name];
  sh.appendRow(headers.map(h=>record[h]===undefined ? '' : record[h]));
}
function updateById_(name,id,patch) {
  const sh=sheet_(name), values=sh.getDataRange().getValues(), headers=values[0], idIndex=headers.indexOf('id');
  for(let i=1;i<values.length;i++) if(String(values[i][idIndex])===String(id)) {
    Object.keys(patch).forEach(k=>{const col=headers.indexOf(k);if(col>=0)sh.getRange(i+1,col+1).setValue(patch[k]);});
    return true;
  }
  throw new Error('ไม่พบรายการที่ต้องการแก้ไข');
}
