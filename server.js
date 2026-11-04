require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const generatePayload = require('promptpay-qr');
const QRCode = require('qrcode');

const app = express();
const PORT = Number(process.env.PORT || 3000);
// Keep path resolution centralized; preserve the existing locations and overrides.
const { PUBLIC, DATA_DIR, UPLOADS, IS_VERCEL } = require('./src/config/paths');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOADS, { recursive: true });
if (IS_VERCEL) console.warn('[Nobi Topup] Vercel is using ephemeral /tmp storage. Orders, sessions, SQLite data and uploads will not persist across instance replacement. Do not use for production transactions.');
// Initialize middleware only after its backing directories exist.
const sessionMiddleware = require('./src/middleware/session');
const upload = require('./src/middleware/uploads');
const errorHandler = require('./src/middleware/error-handler');
const { configureSecurity, createLoginLimiter } = require('./src/middleware/security');
configureSecurity(app, express, IS_VERCEL);
app.use(sessionMiddleware);
app.use('/uploads', express.static(UPLOADS, { maxAge: '1h', dotfiles: 'deny' }));
app.use(express.static(PUBLIC));

const db = require('./src/db/sqlite');

const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const requireAdmin = (req, res, next) => req.session && req.session.adminId ? next() : res.status(401).json({ error: 'กรุณาเข้าสู่ระบบแอดมินก่อน' });
const loginLimiter = createLoginLimiter();
const bool = v => v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0;
const validDate = v => !v || !Number.isNaN(Date.parse(v));
function getCatalog() {
  const games = db.prepare('SELECT * FROM games WHERE active=1 ORDER BY name').all();
  const packages = db.prepare(`SELECT p.*, g.name AS game_name FROM packages p JOIN games g ON g.id=p.game_id WHERE p.active=1 AND g.active=1 ORDER BY p.popular DESC, p.price ASC`).all();
  return { games, packages };
}
function validateCoupon(code, gameId, subtotal, playerId = '') {
  if (!code) return { ok: false, message: 'กรุณากรอกโค้ดส่วนลด' };
  const c = db.prepare(`SELECT c.*, g.name AS game_name FROM coupons c LEFT JOIN games g ON g.id=c.game_id WHERE upper(c.code)=upper(?)`).get(code.trim());
  if (!c || !c.active) return { ok: false, message: 'ไม่พบโค้ดนี้หรือโค้ดถูกปิดใช้งาน' };
  if (c.expires_at && Date.parse(c.expires_at) < Date.now()) return { ok: false, message: 'โค้ดนี้หมดอายุแล้ว' };
  if (c.usage_limit !== null && c.usage_limit !== undefined && c.used_count >= c.usage_limit) return { ok: false, message: 'โค้ดนี้ถูกใช้ครบจำนวนแล้ว' };
  if (subtotal < c.min_spend) return { ok: false, message: `ยอดซื้อขั้นต่ำของโค้ดนี้คือ ฿${Number(c.min_spend).toLocaleString('th-TH')}`, coupon: c };
  if (c.game_id && Number(c.game_id) !== Number(gameId)) return { ok: false, message: `โค้ดนี้ใช้ได้เฉพาะเกม ${c.game_name}`, coupon: c };
  const uid = String(playerId || '').trim();
  const allowedIds = String(c.allowed_player_ids || '').split(/[\n,;]+/).map(v => v.trim()).filter(Boolean);
  if (allowedIds.length && !allowedIds.includes(uid)) return { ok:false, message:'คูปองนี้จำกัดเฉพาะ UID ที่แอดมินกำหนด', coupon:c };
  const minPlayerSpend = Number(c.min_player_spend || 0);
  if (minPlayerSpend > 0) {
    if (!uid) return { ok:false, message:'กรุณากรอก UID ก่อนตรวจสอบสิทธิ์คูปอง', coupon:c };
    const spent = db.prepare("SELECT COALESCE(SUM(total),0) AS total FROM orders WHERE game_id=? AND player_id=? AND status='Completed'").get(Number(gameId), uid).total;
    if (Number(spent) < minPlayerSpend) return { ok:false, message:`ยอดเติมสะสมของ UID นี้ในเกมที่เลือกต้องครบ ฿${minPlayerSpend.toLocaleString('th-TH')} (ปัจจุบัน ฿${Number(spent).toLocaleString('th-TH')})`, coupon:c };
  }
  const discount = Math.min(subtotal, c.discount_type === 'percent' ? subtotal * c.discount_value / 100 : c.discount_value);
  return { ok: true, message: 'ใช้โค้ดส่วนลดได้', coupon: c, discount: Math.round(discount * 100) / 100 };
}

app.get('/api/health', (req,res) => res.json({ ok: true, service: 'Nobi Topup API' }));
app.get('/api/public/catalog', (req,res) => res.json(getCatalog()));
app.get('/api/public/promotions', (req,res) => { const now=Date.now(); const items=db.prepare('SELECT * FROM promotions WHERE active=1 ORDER BY sort_order,id DESC').all().filter(p => (!p.starts_at || Date.parse(p.starts_at)<=now) && (!p.ends_at || Date.parse(p.ends_at)>=now)); res.json(items); });
app.get('/api/public/coupons/suggestions', (req,res) => {
  const gameId = Number(req.query.gameId || 0), subtotal = Number(req.query.subtotal || 0);
  const candidates = db.prepare('SELECT * FROM coupons WHERE active=1 ORDER BY id DESC').all();
  const valid = candidates.map(c => validateCoupon(c.code, gameId, subtotal, req.query.playerId || '')).filter(x => x.ok).sort((a,b) => b.discount-a.discount);
  res.json(valid.length ? { suggestion: { code: valid[0].coupon.code, discount: valid[0].discount, message: `ประหยัด ฿${valid[0].discount.toLocaleString('th-TH')}` } } : { suggestion: null });
});
app.post('/api/public/coupons/validate', (req,res) => {
  const { code, gameId, subtotal, playerId = '' } = req.body || {};
  if (!Number.isFinite(Number(gameId)) || !Number.isFinite(Number(subtotal)) || Number(subtotal) < 0) return res.status(400).json({ ok:false, message:'ข้อมูลยอดซื้อไม่ถูกต้อง' });
  const result = validateCoupon(String(code || ''), Number(gameId), Number(subtotal), String(playerId || ''));
  res.status(result.ok ? 200 : 422).json({ ok: result.ok, message: result.message, discount: result.discount || 0, code: result.coupon && result.coupon.code });
});
app.get('/api/public/payment-info', asyncRoute(async (req,res) => {
  const amount = Math.max(0, Number(req.query.amount || 0));
  const promptpayId = process.env.PROMPTPAY_ID;
  if (!promptpayId) return res.json({ configured: false, message: 'ผู้ดูแลระบบยังไม่ได้ตั้งค่า PromptPay ID' });
  const payload = generatePayload(promptpayId, { amount: amount || undefined });
  res.json({ configured: true, promptpayId, amount, qrDataUrl: await QRCode.toDataURL(payload, { margin: 1, width: 260 }) });
}));
app.post('/api/public/orders', upload.single('slip'), (req,res) => {
  const { gameId, packageId, playerId, serverId = '', couponCode = '' } = req.body;
  const game = db.prepare('SELECT * FROM games WHERE id=? AND active=1').get(Number(gameId));
  const pack = db.prepare('SELECT * FROM packages WHERE id=? AND game_id=? AND active=1').get(Number(packageId), Number(gameId));
  if (!game || !pack) return res.status(400).json({ error: 'ไม่พบเกมหรือแพ็กเกจที่เลือก' });
  if (!String(playerId || '').trim() || String(playerId).trim().length > 100) return res.status(400).json({ error: 'กรุณากรอก UID ให้ถูกต้อง' });
  if (!req.file) return res.status(400).json({ error: 'กรุณาแนบสลิปการโอนเงิน (PNG/JPG/WebP ไม่เกิน 5 MB)' });
  let couponId = null, discount = 0;
  if (String(couponCode).trim()) {
    const validation = validateCoupon(couponCode, game.id, pack.price, String(playerId).trim());
    if (!validation.ok) { fs.unlinkSync(req.file.path); return res.status(422).json({ error: validation.message }); }
    couponId = validation.coupon.id; discount = validation.discount;
  }
  const id = `NBI-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const total = Math.max(0, Math.round((pack.price - discount) * 100) / 100);
  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO orders(id,game_id,package_id,player_id,server_id,coupon_id,subtotal,discount,total,slip_path,status) VALUES(?,?,?,?,?,?,?,?,?,?, 'Pending')`)
      .run(id, game.id, pack.id, String(playerId).trim(), String(serverId).trim(), couponId, pack.price, discount, total, `/uploads/${req.file.filename}`);
    if (couponId) db.prepare('UPDATE coupons SET used_count=used_count+1 WHERE id=?').run(couponId);
  });
  try { tx(); } catch (e) { fs.unlinkSync(req.file.path); throw e; }
  res.status(201).json({ message: 'รับออเดอร์แล้ว รอแอดมินตรวจสอบสลิป', order: { id, game: game.name, package: pack.name, subtotal: pack.price, discount, total, status: 'Pending' } });
});

app.post('/api/admin/login', loginLimiter, (req,res,next) => {
  const { username, password } = req.body || {};
  const admin = db.prepare('SELECT * FROM admins WHERE username=?').get(String(username || ''));
  if (!admin || !bcrypt.compareSync(String(password || ''), admin.password_hash)) return res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
  req.session.regenerate(err => {
    if (err) return next(err);
    req.session.adminId = admin.id; req.session.username = admin.username;
    res.json({ ok: true, username: admin.username });
  });
});
app.post('/api/admin/logout', requireAdmin, (req,res) => req.session.destroy(() => res.json({ ok:true })));
app.get('/api/admin/me', (req,res) => res.json({ authenticated: !!(req.session && req.session.adminId), username: req.session && req.session.username }));
app.get('/api/admin/dashboard', requireAdmin, (req,res) => res.json({
  orders: db.prepare('SELECT COUNT(*) n FROM orders').get().n,
  pending: db.prepare("SELECT COUNT(*) n FROM orders WHERE status='Pending'").get().n,
  completed: db.prepare("SELECT COUNT(*) n FROM orders WHERE status='Completed'").get().n,
  revenue: db.prepare("SELECT COALESCE(SUM(total),0) n FROM orders WHERE status='Completed'").get().n,
  games: db.prepare('SELECT COUNT(*) n FROM games').get().n,
  packages: db.prepare('SELECT COUNT(*) n FROM packages').get().n,
  coupons: db.prepare('SELECT COUNT(*) n FROM coupons').get().n,
  promotions: db.prepare('SELECT COUNT(*) n FROM promotions').get().n
}));
app.get('/api/admin/games', requireAdmin, (req,res) => res.json(db.prepare('SELECT * FROM games ORDER BY id DESC').all()));
app.post('/api/admin/games', requireAdmin, (req,res) => {
  const { name, category='other', description='', active=true } = req.body || {};
  if (!String(name||'').trim()) return res.status(400).json({ error:'กรุณาระบุชื่อเกม' });
  try { const r = db.prepare('INSERT INTO games(name,category,description,active) VALUES(?,?,?,?)').run(String(name).trim(),String(category),String(description),bool(active)); res.status(201).json(db.prepare('SELECT * FROM games WHERE id=?').get(r.lastInsertRowid)); }
  catch(e) { res.status(409).json({ error:'มีชื่อเกมนี้อยู่แล้ว' }); }
});
app.put('/api/admin/games/:id', requireAdmin, (req,res) => {
  const { name, category='other', description='', active=true } = req.body || {};
  if (!String(name||'').trim()) return res.status(400).json({error:'กรุณาระบุชื่อเกม'});
  try { const r=db.prepare('UPDATE games SET name=?,category=?,description=?,active=? WHERE id=?').run(String(name).trim(),String(category),String(description),bool(active),Number(req.params.id)); if(!r.changes)return res.status(404).json({error:'ไม่พบเกม'}); res.json(db.prepare('SELECT * FROM games WHERE id=?').get(Number(req.params.id))); }
  catch(e) { res.status(409).json({error:'มีชื่อเกมนี้อยู่แล้ว'}); }
});
app.delete('/api/admin/games/:id', requireAdmin, (req,res) => { try { const r=db.prepare('DELETE FROM games WHERE id=?').run(Number(req.params.id)); if(!r.changes)return res.status(404).json({error:'ไม่พบเกม'}); res.json({ok:true}); } catch(e) { res.status(409).json({error:'ลบเกมไม่ได้ เนื่องจากมีออเดอร์อ้างอิงอยู่'}); } });
app.get('/api/admin/packages', requireAdmin, (req,res) => res.json(db.prepare('SELECT p.*,g.name game_name FROM packages p JOIN games g ON g.id=p.game_id ORDER BY p.popular DESC,p.id DESC').all()));
app.post('/api/admin/packages', requireAdmin, (req,res) => {
  const {game_id, name, amount, unit, price, image_url='', popular=false, active=true} = req.body||{};
  if(!Number(game_id)||!String(name||'').trim()||!Number.isFinite(Number(amount))||Number(amount)<=0||!String(unit||'').trim()||!Number.isFinite(Number(price))||Number(price)<0) return res.status(400).json({error:'กรุณากรอกข้อมูลแพ็กเกจให้ครบและถูกต้อง'});
  const r=db.prepare('INSERT INTO packages(game_id,name,amount,unit,price,image_url,popular,active) VALUES(?,?,?,?,?,?,?,?)').run(Number(game_id),String(name).trim(),Number(amount),String(unit).trim(),Number(price),String(image_url),bool(popular),bool(active));
  res.status(201).json(db.prepare('SELECT p.*,g.name game_name FROM packages p JOIN games g ON g.id=p.game_id WHERE p.id=?').get(r.lastInsertRowid));
});
app.put('/api/admin/packages/:id', requireAdmin, (req,res) => {
  const {game_id, name, amount, unit, price, image_url='', popular=false, active=true} = req.body||{};
  if(!Number(game_id)||!String(name||'').trim()||!Number.isFinite(Number(amount))||Number(amount)<=0||!String(unit||'').trim()||!Number.isFinite(Number(price))||Number(price)<0) return res.status(400).json({error:'กรุณากรอกข้อมูลแพ็กเกจให้ครบและถูกต้อง'});
  const r=db.prepare('UPDATE packages SET game_id=?,name=?,amount=?,unit=?,price=?,image_url=?,popular=?,active=? WHERE id=?').run(Number(game_id),String(name).trim(),Number(amount),String(unit).trim(),Number(price),String(image_url),bool(popular),bool(active),Number(req.params.id));
  if(!r.changes)return res.status(404).json({error:'ไม่พบแพ็กเกจ'}); res.json(db.prepare('SELECT p.*,g.name game_name FROM packages p JOIN games g ON g.id=p.game_id WHERE p.id=?').get(Number(req.params.id)));
});
app.delete('/api/admin/packages/:id', requireAdmin, (req,res) => { try { const r=db.prepare('DELETE FROM packages WHERE id=?').run(Number(req.params.id)); if(!r.changes)return res.status(404).json({error:'ไม่พบแพ็กเกจ'}); res.json({ok:true}); } catch(e) { res.status(409).json({error:'ลบไม่ได้ เนื่องจากมีออเดอร์อ้างอิงอยู่'}); } });
app.get('/api/admin/coupons', requireAdmin, (req,res) => res.json(db.prepare('SELECT c.*,g.name game_name FROM coupons c LEFT JOIN games g ON g.id=c.game_id ORDER BY c.id DESC').all()));
app.post('/api/admin/coupons', requireAdmin, (req,res) => {
  const {code,discount_type='fixed',discount_value,min_spend=0,game_id=null,expires_at=null,usage_limit=null,allowed_player_ids='',min_player_spend=0,active=true}=req.body||{};
  if(!String(code||'').trim()||!['fixed','percent'].includes(discount_type)||!Number.isFinite(Number(discount_value))||Number(discount_value)<=0||Number(min_spend)<0||!Number.isFinite(Number(min_player_spend))||Number(min_player_spend)<0||(String(allowed_player_ids||'').trim()&&!game_id)||(discount_type==='percent'&&Number(discount_value)>100)||!validDate(expires_at)) return res.status(400).json({error:'ข้อมูลคูปองไม่ถูกต้อง'});
  try { const r=db.prepare('INSERT INTO coupons(code,discount_type,discount_value,min_spend,game_id,expires_at,usage_limit,active,allowed_player_ids,min_player_spend) VALUES(?,?,?,?,?,?,?,?,?,?)').run(String(code).trim().toUpperCase(),discount_type,Number(discount_value),Number(min_spend),game_id?Number(game_id):null,expires_at||null,usage_limit?Number(usage_limit):null,bool(active),String(allowed_player_ids||'').trim(),Number(min_player_spend)); res.status(201).json(db.prepare('SELECT * FROM coupons WHERE id=?').get(r.lastInsertRowid)); }
  catch(e) { res.status(409).json({error:'โค้ดนี้มีอยู่แล้ว หรือข้อมูลอ้างอิงไม่ถูกต้อง'}); }
});
app.put('/api/admin/coupons/:id', requireAdmin, (req,res) => {
  const {code,discount_type='fixed',discount_value,min_spend=0,game_id=null,expires_at=null,usage_limit=null,allowed_player_ids='',min_player_spend=0,active=true}=req.body||{};
  if(!String(code||'').trim()||!['fixed','percent'].includes(discount_type)||!Number.isFinite(Number(discount_value))||Number(discount_value)<=0||Number(min_spend)<0||!Number.isFinite(Number(min_player_spend))||Number(min_player_spend)<0||(String(allowed_player_ids||'').trim()&&!game_id)||(discount_type==='percent'&&Number(discount_value)>100)||!validDate(expires_at)) return res.status(400).json({error:'ข้อมูลคูปองไม่ถูกต้อง'});
  try { const r=db.prepare('UPDATE coupons SET code=?,discount_type=?,discount_value=?,min_spend=?,game_id=?,expires_at=?,usage_limit=?,active=?,allowed_player_ids=?,min_player_spend=? WHERE id=?').run(String(code).trim().toUpperCase(),discount_type,Number(discount_value),Number(min_spend),game_id?Number(game_id):null,expires_at||null,usage_limit?Number(usage_limit):null,bool(active),String(allowed_player_ids||'').trim(),Number(min_player_spend),Number(req.params.id)); if(!r.changes)return res.status(404).json({error:'ไม่พบคูปอง'}); res.json(db.prepare('SELECT * FROM coupons WHERE id=?').get(Number(req.params.id))); }
  catch(e) { res.status(409).json({error:'โค้ดนี้มีอยู่แล้ว หรือข้อมูลอ้างอิงไม่ถูกต้อง'}); }
});
app.delete('/api/admin/coupons/:id', requireAdmin, (req,res) => { const r=db.prepare('DELETE FROM coupons WHERE id=?').run(Number(req.params.id)); if(!r.changes)return res.status(404).json({error:'ไม่พบคูปอง'}); res.json({ok:true}); });
app.get('/api/admin/promotions', requireAdmin, (req,res) => res.json(db.prepare('SELECT * FROM promotions ORDER BY sort_order,id DESC').all()));
app.post('/api/admin/promotions', requireAdmin, (req,res) => {
  const {title,subtitle='',image_url='',link_url='#games',active=true,sort_order=0,starts_at=null,ends_at=null}=req.body||{};
  if(!String(title||'').trim()||!validDate(starts_at)||!validDate(ends_at))return res.status(400).json({error:'กรุณาระบุชื่อโปรโมชั่นและวันเวลาให้ถูกต้อง'});
  const r=db.prepare('INSERT INTO promotions(title,subtitle,image_url,link_url,active,sort_order,starts_at,ends_at) VALUES(?,?,?,?,?,?,?,?)').run(String(title).trim(),String(subtitle),String(image_url),String(link_url),bool(active),Number(sort_order)||0,starts_at||null,ends_at||null); res.status(201).json(db.prepare('SELECT * FROM promotions WHERE id=?').get(r.lastInsertRowid));
});
app.put('/api/admin/promotions/:id', requireAdmin, (req,res) => {
  const {title,subtitle='',image_url='',link_url='#games',active=true,sort_order=0,starts_at=null,ends_at=null}=req.body||{};
  if(!String(title||'').trim()||!validDate(starts_at)||!validDate(ends_at))return res.status(400).json({error:'กรุณาระบุชื่อโปรโมชั่นและวันเวลาให้ถูกต้อง'});
  const r=db.prepare('UPDATE promotions SET title=?,subtitle=?,image_url=?,link_url=?,active=?,sort_order=?,starts_at=?,ends_at=? WHERE id=?').run(String(title).trim(),String(subtitle),String(image_url),String(link_url),bool(active),Number(sort_order)||0,starts_at||null,ends_at||null,Number(req.params.id)); if(!r.changes)return res.status(404).json({error:'ไม่พบโปรโมชั่น'}); res.json(db.prepare('SELECT * FROM promotions WHERE id=?').get(Number(req.params.id)));
});
app.delete('/api/admin/promotions/:id', requireAdmin, (req,res) => { const r=db.prepare('DELETE FROM promotions WHERE id=?').run(Number(req.params.id)); if(!r.changes)return res.status(404).json({error:'ไม่พบโปรโมชั่น'}); res.json({ok:true}); });
app.get('/api/admin/orders', requireAdmin, (req,res) => res.json(db.prepare(`SELECT o.*,g.name game_name,p.name package_name,c.code coupon_code FROM orders o JOIN games g ON g.id=o.game_id JOIN packages p ON p.id=o.package_id LEFT JOIN coupons c ON c.id=o.coupon_id ORDER BY o.created_at DESC`).all()));
app.patch('/api/admin/orders/:id/status', requireAdmin, (req,res) => {
  const status=String((req.body||{}).status||''); if(!['Pending','Completed','Rejected'].includes(status))return res.status(400).json({error:'สถานะไม่ถูกต้อง'});
  const r=db.prepare('UPDATE orders SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status,String(req.params.id)); if(!r.changes)return res.status(404).json({error:'ไม่พบออเดอร์'}); res.json({ok:true,status});
});
app.post('/api/admin/upload', requireAdmin, upload.single('image'), (req,res) => { if(!req.file)return res.status(400).json({error:'กรุณาเลือกไฟล์ภาพ PNG/JPG/WebP ขนาดไม่เกิน 5 MB'}); res.status(201).json({url:`/uploads/${req.file.filename}`}); });

app.get('/admin', (req,res) => res.sendFile(path.join(PUBLIC,'admin.html')));
app.get('/', (req,res) => res.sendFile(path.join(PUBLIC,'nobitopup.html')));
app.use(errorHandler);
// Vercel invokes the exported handler; local development starts its own HTTP listener.
if (require.main === module) {
  app.listen(PORT, () => console.log(`Nobi Topup running at http://localhost:${PORT}`));
}

module.exports = app;
