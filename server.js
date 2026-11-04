const ENV = require('./src/config/env');
const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = Number(ENV.PORT || 3000);
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

const createPublicRouter = require('./src/routes/public.routes');
app.use(createPublicRouter({ db, upload, asyncRoute, validateCoupon, getCatalog }));

const createAdminRouter = require('./src/routes/admin.routes');
app.use(createAdminRouter({ db, requireAdmin, loginLimiter, upload, bool, validDate }));

app.get('/admin', (req,res) => res.sendFile(path.join(PUBLIC,'admin.html')));
app.get('/', (req,res) => res.sendFile(path.join(PUBLIC,'nobitopup.html')));
app.use(errorHandler);
// Vercel invokes the exported handler; local development starts its own HTTP listener.
if (require.main === module) {
  app.listen(PORT, () => console.log(`Nobi Topup running at http://localhost:${PORT}`));
}

module.exports = app;
