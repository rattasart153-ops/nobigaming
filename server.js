require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const multer = require('multer');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const generatePayload = require('promptpay-qr');
const QRCode = require('qrcode');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const UPLOADS = path.join(ROOT, 'uploads');
fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
fs.mkdirSync(UPLOADS, { recursive: true });

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(session({
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: path.join(ROOT, 'data') }),
  secret: process.env.SESSION_SECRET || 'dev-only-change-this-session-secret-before-deploying',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 1000 * 60 * 60 * 8 }
}));
app.use('/uploads', express.static(UPLOADS, { maxAge: '1h', dotfiles: 'deny' }));
app.use(express.static(PUBLIC));

const db = new Database(path.join(ROOT, 'data', 'nobitopup.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS admins (id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS games (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, category TEXT DEFAULT 'other', description TEXT DEFAULT '', active INTEGER NOT NULL DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS packages (id INTEGER PRIMARY KEY AUTOINCREMENT, game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE, name TEXT NOT NULL, amount INTEGER NOT NULL, unit TEXT NOT NULL, price REAL NOT NULL CHECK(price >= 0), image_url TEXT DEFAULT '', popular INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS coupons (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, discount_type TEXT NOT NULL CHECK(discount_type IN ('fixed','percent')), discount_value REAL NOT NULL CHECK(discount_value > 0), min_spend REAL NOT NULL DEFAULT 0, game_id INTEGER REFERENCES games(id) ON DELETE SET NULL, expires_at TEXT, usage_limit INTEGER, used_count INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS promotions (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, subtitle TEXT DEFAULT '', image_url TEXT DEFAULT '', link_url TEXT DEFAULT '#games', active INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0, starts_at TEXT, ends_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, game_id INTEGER NOT NULL REFERENCES games(id), package_id INTEGER NOT NULL REFERENCES packages(id), player_id TEXT NOT NULL, server_id TEXT DEFAULT '', coupon_id INTEGER REFERENCES coupons(id), subtotal REAL NOT NULL, discount REAL NOT NULL DEFAULT 0, total REAL NOT NULL, slip_path TEXT, status TEXT NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending','Completed','Rejected')), created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
`);

const seedGames = [
  ['RoV','moba','Arena of Valor'], ['Free Fire','br','เพชร Free Fire'], ['Genshin Impact','rpg','Genesis Crystal'],
  ['PUBG Mobile','br','UC'], ['Mobile Legends','moba','Diamonds'], ['Valorant','fps','VP'],
  ['Honkai: Star Rail','rpg','Oneiric Shard'], ['Call of Duty: Mobile','fps','CP'], ['Roblox','sandbox','Robux']
];
const seedPacks = {
  'RoV': ['คูปอง', [[90,15],[250,39],[500,75],[1100,159],[2200,299],[5500,699]]],
  'Free Fire': ['เพชร', [[110,19],[341,59],[572,99],[1060,139],[2200,279],[5600,699]]],
  'Genshin Impact': ['Genesis Crystal', [[60,35],[330,169],[1090,559],[2240,1190],[3880,1890],[8080,3590]]],
  'PUBG Mobile': ['UC', [[60,25],[325,129],[660,259],[1800,679],[3850,1390],[8100,2790]]],
  'Mobile Legends': ['Diamonds', [[86,20],[172,39],[257,59],[706,159],[2195,479],[4390,949]]],
  'Valorant': ['VP', [[125,45],[420,149],[700,249],[1375,479],[2400,829],[4000,1350]]],
  'Honkai: Star Rail': ['Oneiric Shard', [[60,39],[330,179],[1090,579],[2240,1250],[3880,1990],[8080,3790]]],
  'Call of Duty: Mobile': ['CP', [[80,25],[420,129],[880,259],[2400,679],[5000,1390],[10000,2690]]],
  'Roblox': ['Robux', [[80,29],[400,139],[800,269],[1700,559],[4500,1390],[10000,2990]]]
};
const insertGame = db.prepare('INSERT OR IGNORE INTO games(name,category,description) VALUES(?,?,?)');
const insertPack = db.prepare('INSERT INTO packages(game_id,name,amount,unit,price,popular,active) VALUES(?,?,?,?,?,?,1)');
for (const [name, cat, desc] of seedGames) insertGame.run(name, cat, desc);
if (db.prepare('SELECT COUNT(*) AS n FROM packages').get().n === 0) {
  const tx = db.transaction(() => {
    for (const [game, [unit, packs]] of Object.entries(seedPacks)) {
      const g = db.prepare('SELECT id FROM games WHERE name=?').get(game);
      packs.forEach(([amount, price], i) => insertPack.run(g.id, `${amount.toLocaleString('en-US')} ${unit}`, amount, unit, price, i === packs.length - 2 ? 1 : 0));
    }
  }); tx();
}
const adminUser = process.env.ADMIN_USERNAME || 'NobiGaming';
const adminPass = process.env.ADMIN_PASSWORD || 'Nobi1534897';
if (!db.prepare('SELECT id FROM admins WHERE username=?').get(adminUser)) {
  db.prepare('INSERT INTO admins(username,password_hash) VALUES(?,?)').run(adminUser, bcrypt.hashSync(adminPass, 12));
}

const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const requireAdmin = (req, res, next) => req.session && req.session.adminId ? next() : res.status(401).json({ error: 'กรุณาเข้าสู่ระบบแอดมินก่อน' });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'พยายามเข้าสู่ระบบหลายครั้งเกินไป กรุณาลองใหม่ภายหลัง' } });
const upload = multer({
  storage: multer.diskStorage({ destination: UPLOADS, filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${path.extname(file.originalname).toLowerCase()}`) }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(png|jpeg|webp)$/.test(file.mimetype))
});
const bool = v => v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0;
const validDate = v => !v || !Number.isNaN(Date.parse(v));
function getCatalog() {
  const games = db.prepare('SELECT * FROM games WHERE active=1 ORDER BY name').all();
  const packages = db.prepare(`SELECT p.*, g.name AS game_name FROM packages p JOIN games g ON g.id=p.game_id WHERE p.active=1 AND g.active=1 ORDER BY p.popular DESC, p.price ASC`).all();
  return { games, packages };
}
function validateCoupon(code, gameId, subtotal) {
  if (!code) return { ok: false, message: 'กรุณากรอกโค้ดส่วนลด' };
  const c = db.prepare(`SELECT c.*, g.name AS game_name FROM coupons c LEFT JOIN games g ON g.id=c.game_id WHERE upper(c.code)=upper(?)`).get(code.trim());
  if (!c || !c.active) return { ok: false, message: 'ไม่พบโค้ดนี้หรือโค้ดถูกปิดใช้งาน' };
  if (c.expires_at && Date.parse(c.expires_at) < Date.now()) return { ok: false, message: 'โค้ดนี้หมดอายุแล้ว' };
  if (c.usage_limit !== null && c.usage_limit !== undefined && c.used_count >= c.usage_limit) return { ok: false, message: 'โค้ดนี้ถูกใช้ครบจำนวนแล้ว' };
  if (subtotal < c.min_spend) return { ok: false, message: `ยอดซื้อขั้นต่ำของโค้ดนี้คือ ฿${Number(c.min_spend).toLocaleString('th-TH')}`, coupon: c };
  if (c.game_id && Number(c.game_id) !== Number(gameId)) return { ok: false, message: `โค้ดนี้ใช้ได้เฉพาะเกม ${c.game_name}`, coupon: c };
  const discount = Math.min(subtotal, c.discount_type === 'percent' ? subtotal * c.discount_value / 100 : c.discount_value);
  return { ok: true, message: 'ใช้โค้ดส่วนลดได้', coupon: c, discount: Math.round(discount * 100) / 100 };
}

app.get('/api/health', (req,res) => res.json({ ok: true, service: 'Nobi Topup API' }));
app.get('/api/public/catalog', (req,res) => res.json(getCatalog()));
app.get('/api/public/promotions', (req,res) => { const now=Date.now(); const items=db.prepare('SELECT * FROM promotions WHERE active=1 ORDER BY sort_order,id DESC').all().filter(p => (!p.starts_at || Date.parse(p.starts_at)<=now) && (!p.ends_at || Date.parse(p.ends_at)>=now)); res.json(items); });
app.get('/api/public/coupons/suggestions', (req,res) => {
  const gameId = Number(req.query.gameId || 0), subtotal = Number(req.query.subtotal || 0);
  const candidates = db.prepare('SELECT * FROM coupons WHERE active=1 ORDER BY id DESC').all();
  const valid = candidates.map(c => validateCoupon(c.code, gameId, subtotal)).filter(x => x.ok).sort((a,b) => b.discount-a.discount);
  res.json(valid.length ? { suggestion: { code: valid[0].coupon.code, discount: valid[0].discount, message: `ประหยัด ฿${valid[0].discount.toLocaleString('th-TH')}` } } : { suggestion: null });
});
app.post('/api/public/coupons/validate', (req,res) => {
  const { code, gameId, subtotal } = req.body || {};
  if (!Number.isFinite(Number(gameId)) || !Number.isFinite(Number(subtotal)) || Number(subtotal) < 0) return res.status(400).json({ ok:false, message:'ข้อมูลยอดซื้อไม่ถูกต้อง' });
  const result = validateCoupon(String(code || ''), Number(gameId), Number(subtotal));
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
    const validation = validateCoupon(couponCode, game.id, pack.price);
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
  const {code,discount_type='fixed',discount_value,min_spend=0,game_id=null,expires_at=null,usage_limit=null,active=true}=req.body||{};
  if(!String(code||'').trim()||!['fixed','percent'].includes(discount_type)||!Number.isFinite(Number(discount_value))||Number(discount_value)<=0||Number(min_spend)<0||(discount_type==='percent'&&Number(discount_value)>100)||!validDate(expires_at)) return res.status(400).json({error:'ข้อมูลคูปองไม่ถูกต้อง'});
  try { const r=db.prepare('INSERT INTO coupons(code,discount_type,discount_value,min_spend,game_id,expires_at,usage_limit,active) VALUES(?,?,?,?,?,?,?,?)').run(String(code).trim().toUpperCase(),discount_type,Number(discount_value),Number(min_spend),game_id?Number(game_id):null,expires_at||null,usage_limit?Number(usage_limit):null,bool(active)); res.status(201).json(db.prepare('SELECT * FROM coupons WHERE id=?').get(r.lastInsertRowid)); }
  catch(e) { res.status(409).json({error:'โค้ดนี้มีอยู่แล้ว หรือข้อมูลอ้างอิงไม่ถูกต้อง'}); }
});
app.put('/api/admin/coupons/:id', requireAdmin, (req,res) => {
  const {code,discount_type='fixed',discount_value,min_spend=0,game_id=null,expires_at=null,usage_limit=null,active=true}=req.body||{};
  if(!String(code||'').trim()||!['fixed','percent'].includes(discount_type)||!Number.isFinite(Number(discount_value))||Number(discount_value)<=0||Number(min_spend)<0||(discount_type==='percent'&&Number(discount_value)>100)||!validDate(expires_at)) return res.status(400).json({error:'ข้อมูลคูปองไม่ถูกต้อง'});
  try { const r=db.prepare('UPDATE coupons SET code=?,discount_type=?,discount_value=?,min_spend=?,game_id=?,expires_at=?,usage_limit=?,active=? WHERE id=?').run(String(code).trim().toUpperCase(),discount_type,Number(discount_value),Number(min_spend),game_id?Number(game_id):null,expires_at||null,usage_limit?Number(usage_limit):null,bool(active),Number(req.params.id)); if(!r.changes)return res.status(404).json({error:'ไม่พบคูปอง'}); res.json(db.prepare('SELECT * FROM coupons WHERE id=?').get(Number(req.params.id))); }
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
app.use((err,req,res,next) => {
  console.error(err);
  if (err instanceof multer.MulterError) return res.status(400).json({error: err.code === 'LIMIT_FILE_SIZE' ? 'ไฟล์ใหญ่เกิน 5 MB' : 'อัปโหลดไฟล์ไม่สำเร็จ'});
  res.status(500).json({error:'เกิดข้อผิดพลาดภายในระบบ'});
});
app.listen(PORT, () => console.log(`Nobi Topup running at http://localhost:${PORT}`));
