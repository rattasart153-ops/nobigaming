'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const fs = require('node:fs');
const path = require('node:path');
const validateImageFile = require('../middleware/validate-image-file');
const requireSameOrigin = require('../middleware/require-same-origin');

function createAdminRouter({ db, requireAdmin, loginLimiter, upload, bool, validDate, privateSlipsDir, legacyUploadsDir }) {
  const router = express.Router();
  router.use(requireSameOrigin);

  router.post('/api/admin/login', loginLimiter, (req,res,next) => {
    const { username, password } = req.body || {};
    const admin = db.prepare('SELECT * FROM admins WHERE username=?').get(String(username || ''));
    if (!admin || !bcrypt.compareSync(String(password || ''), admin.password_hash)) return res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    req.session.regenerate(err => {
      if (err) return next(err);
      req.session.adminId = admin.id; req.session.username = admin.username;
      res.json({ ok: true, username: admin.username });
    });
  });
  router.post('/api/admin/logout', requireAdmin, (req,res) => req.session.destroy(() => res.json({ ok:true })));
  router.get('/api/admin/me', (req,res) => res.json({ authenticated: !!(req.session && req.session.adminId), username: req.session && req.session.username }));
  router.get('/api/admin/dashboard', requireAdmin, (req,res) => res.json({
    orders: db.prepare('SELECT COUNT(*) n FROM orders').get().n,
    pending: db.prepare("SELECT COUNT(*) n FROM orders WHERE status='Pending'").get().n,
    completed: db.prepare("SELECT COUNT(*) n FROM orders WHERE status='Completed'").get().n,
    revenue: db.prepare("SELECT COALESCE(SUM(total),0) n FROM orders WHERE status='Completed'").get().n,
    games: db.prepare('SELECT COUNT(*) n FROM games').get().n,
    packages: db.prepare('SELECT COUNT(*) n FROM packages').get().n,
    coupons: db.prepare('SELECT COUNT(*) n FROM coupons').get().n,
    promotions: db.prepare('SELECT COUNT(*) n FROM promotions').get().n
  }));
  router.get('/api/admin/games', requireAdmin, (req,res) => res.json(db.prepare('SELECT * FROM games ORDER BY id DESC').all()));
  router.post('/api/admin/games', requireAdmin, (req,res) => {
    const { name, category='other', description='', active=true } = req.body || {};
    if (!String(name||'').trim()) return res.status(400).json({ error:'กรุณาระบุชื่อเกม' });
    try { const r = db.prepare('INSERT INTO games(name,category,description,active) VALUES(?,?,?,?)').run(String(name).trim(),String(category),String(description),bool(active)); res.status(201).json(db.prepare('SELECT * FROM games WHERE id=?').get(r.lastInsertRowid)); }
    catch(e) { res.status(409).json({ error:'มีชื่อเกมนี้อยู่แล้ว' }); }
  });
  router.put('/api/admin/games/:id', requireAdmin, (req,res) => {
    const { name, category='other', description='', active=true } = req.body || {};
    if (!String(name||'').trim()) return res.status(400).json({error:'กรุณาระบุชื่อเกม'});
    try { const r=db.prepare('UPDATE games SET name=?,category=?,description=?,active=? WHERE id=?').run(String(name).trim(),String(category),String(description),bool(active),Number(req.params.id)); if(!r.changes)return res.status(404).json({error:'ไม่พบเกม'}); res.json(db.prepare('SELECT * FROM games WHERE id=?').get(Number(req.params.id))); }
    catch(e) { res.status(409).json({error:'มีชื่อเกมนี้อยู่แล้ว'}); }
  });
  router.delete('/api/admin/games/:id', requireAdmin, (req,res) => { try { const r=db.prepare('DELETE FROM games WHERE id=?').run(Number(req.params.id)); if(!r.changes)return res.status(404).json({error:'ไม่พบเกม'}); res.json({ok:true}); } catch(e) { res.status(409).json({error:'ลบเกมไม่ได้ เนื่องจากมีออเดอร์อ้างอิงอยู่'}); } });
  router.get('/api/admin/packages', requireAdmin, (req,res) => res.json(db.prepare('SELECT p.*,g.name game_name FROM packages p JOIN games g ON g.id=p.game_id ORDER BY p.popular DESC,p.id DESC').all()));
  router.post('/api/admin/packages', requireAdmin, (req,res) => {
    const {game_id, name, amount, unit, price, image_url='', popular=false, active=true} = req.body||{};
    if(!Number(game_id)||!String(name||'').trim()||!Number.isFinite(Number(amount))||Number(amount)<=0||!String(unit||'').trim()||!Number.isFinite(Number(price))||Number(price)<0) return res.status(400).json({error:'กรุณากรอกข้อมูลแพ็กเกจให้ครบและถูกต้อง'});
    const r=db.prepare('INSERT INTO packages(game_id,name,amount,unit,price,image_url,popular,active) VALUES(?,?,?,?,?,?,?,?)').run(Number(game_id),String(name).trim(),Number(amount),String(unit).trim(),Number(price),String(image_url),bool(popular),bool(active));
    res.status(201).json(db.prepare('SELECT p.*,g.name game_name FROM packages p JOIN games g ON g.id=p.game_id WHERE p.id=?').get(r.lastInsertRowid));
  });
  router.put('/api/admin/packages/:id', requireAdmin, (req,res) => {
    const {game_id, name, amount, unit, price, image_url='', popular=false, active=true} = req.body||{};
    if(!Number(game_id)||!String(name||'').trim()||!Number.isFinite(Number(amount))||Number(amount)<=0||!String(unit||'').trim()||!Number.isFinite(Number(price))||Number(price)<0) return res.status(400).json({error:'กรุณากรอกข้อมูลแพ็กเกจให้ครบและถูกต้อง'});
    const r=db.prepare('UPDATE packages SET game_id=?,name=?,amount=?,unit=?,price=?,image_url=?,popular=?,active=? WHERE id=?').run(Number(game_id),String(name).trim(),Number(amount),String(unit).trim(),Number(price),String(image_url),bool(popular),bool(active),Number(req.params.id));
    if(!r.changes)return res.status(404).json({error:'ไม่พบแพ็กเกจ'}); res.json(db.prepare('SELECT p.*,g.name game_name FROM packages p JOIN games g ON g.id=p.game_id WHERE p.id=?').get(Number(req.params.id)));
  });
  router.delete('/api/admin/packages/:id', requireAdmin, (req,res) => { try { const r=db.prepare('DELETE FROM packages WHERE id=?').run(Number(req.params.id)); if(!r.changes)return res.status(404).json({error:'ไม่พบแพ็กเกจ'}); res.json({ok:true}); } catch(e) { res.status(409).json({error:'ลบไม่ได้ เนื่องจากมีออเดอร์อ้างอิงอยู่'}); } });
  router.get('/api/admin/coupons', requireAdmin, (req,res) => res.json(db.prepare('SELECT c.*,g.name game_name FROM coupons c LEFT JOIN games g ON g.id=c.game_id ORDER BY c.id DESC').all()));
  router.post('/api/admin/coupons', requireAdmin, (req,res) => {
    const {code,discount_type='fixed',discount_value,min_spend=0,game_id=null,expires_at=null,usage_limit=null,allowed_player_ids='',min_player_spend=0,active=true}=req.body||{};
    if(!String(code||'').trim()||!['fixed','percent'].includes(discount_type)||!Number.isFinite(Number(discount_value))||Number(discount_value)<=0||Number(min_spend)<0||!Number.isFinite(Number(min_player_spend))||Number(min_player_spend)<0||(String(allowed_player_ids||'').trim()&&!game_id)||(discount_type==='percent'&&Number(discount_value)>100)||!validDate(expires_at)) return res.status(400).json({error:'ข้อมูลคูปองไม่ถูกต้อง'});
    try { const r=db.prepare('INSERT INTO coupons(code,discount_type,discount_value,min_spend,game_id,expires_at,usage_limit,active,allowed_player_ids,min_player_spend) VALUES(?,?,?,?,?,?,?,?,?,?)').run(String(code).trim().toUpperCase(),discount_type,Number(discount_value),Number(min_spend),game_id?Number(game_id):null,expires_at||null,usage_limit?Number(usage_limit):null,bool(active),String(allowed_player_ids||'').trim(),Number(min_player_spend)); res.status(201).json(db.prepare('SELECT * FROM coupons WHERE id=?').get(r.lastInsertRowid)); }
    catch(e) { res.status(409).json({error:'โค้ดนี้มีอยู่แล้ว หรือข้อมูลอ้างอิงไม่ถูกต้อง'}); }
  });
  router.put('/api/admin/coupons/:id', requireAdmin, (req,res) => {
    const {code,discount_type='fixed',discount_value,min_spend=0,game_id=null,expires_at=null,usage_limit=null,allowed_player_ids='',min_player_spend=0,active=true}=req.body||{};
    if(!String(code||'').trim()||!['fixed','percent'].includes(discount_type)||!Number.isFinite(Number(discount_value))||Number(discount_value)<=0||Number(min_spend)<0||!Number.isFinite(Number(min_player_spend))||Number(min_player_spend)<0||(String(allowed_player_ids||'').trim()&&!game_id)||(discount_type==='percent'&&Number(discount_value)>100)||!validDate(expires_at)) return res.status(400).json({error:'ข้อมูลคูปองไม่ถูกต้อง'});
    try { const r=db.prepare('UPDATE coupons SET code=?,discount_type=?,discount_value=?,min_spend=?,game_id=?,expires_at=?,usage_limit=?,active=?,allowed_player_ids=?,min_player_spend=? WHERE id=?').run(String(code).trim().toUpperCase(),discount_type,Number(discount_value),Number(min_spend),game_id?Number(game_id):null,expires_at||null,usage_limit?Number(usage_limit):null,bool(active),String(allowed_player_ids||'').trim(),Number(min_player_spend),Number(req.params.id)); if(!r.changes)return res.status(404).json({error:'ไม่พบคูปอง'}); res.json(db.prepare('SELECT * FROM coupons WHERE id=?').get(Number(req.params.id))); }
    catch(e) { res.status(409).json({error:'โค้ดนี้มีอยู่แล้ว หรือข้อมูลอ้างอิงไม่ถูกต้อง'}); }
  });
  router.delete('/api/admin/coupons/:id', requireAdmin, (req,res) => { const r=db.prepare('DELETE FROM coupons WHERE id=?').run(Number(req.params.id)); if(!r.changes)return res.status(404).json({error:'ไม่พบคูปอง'}); res.json({ok:true}); });
  router.get('/api/admin/promotions', requireAdmin, (req,res) => res.json(db.prepare('SELECT * FROM promotions ORDER BY sort_order,id DESC').all()));
  router.post('/api/admin/promotions', requireAdmin, (req,res) => {
    const {title,subtitle='',image_url='',link_url='#games',active=true,sort_order=0,starts_at=null,ends_at=null}=req.body||{};
    if(!String(title||'').trim()||!validDate(starts_at)||!validDate(ends_at))return res.status(400).json({error:'กรุณาระบุชื่อโปรโมชั่นและวันเวลาให้ถูกต้อง'});
    const r=db.prepare('INSERT INTO promotions(title,subtitle,image_url,link_url,active,sort_order,starts_at,ends_at) VALUES(?,?,?,?,?,?,?,?)').run(String(title).trim(),String(subtitle),String(image_url),String(link_url),bool(active),Number(sort_order)||0,starts_at||null,ends_at||null); res.status(201).json(db.prepare('SELECT * FROM promotions WHERE id=?').get(r.lastInsertRowid));
  });
  router.put('/api/admin/promotions/:id', requireAdmin, (req,res) => {
    const {title,subtitle='',image_url='',link_url='#games',active=true,sort_order=0,starts_at=null,ends_at=null}=req.body||{};
    if(!String(title||'').trim()||!validDate(starts_at)||!validDate(ends_at))return res.status(400).json({error:'กรุณาระบุชื่อโปรโมชั่นและวันเวลาให้ถูกต้อง'});
    const r=db.prepare('UPDATE promotions SET title=?,subtitle=?,image_url=?,link_url=?,active=?,sort_order=?,starts_at=?,ends_at=? WHERE id=?').run(String(title).trim(),String(subtitle),String(image_url),String(link_url),bool(active),Number(sort_order)||0,starts_at||null,ends_at||null,Number(req.params.id)); if(!r.changes)return res.status(404).json({error:'ไม่พบโปรโมชั่น'}); res.json(db.prepare('SELECT * FROM promotions WHERE id=?').get(Number(req.params.id)));
  });
  router.delete('/api/admin/promotions/:id', requireAdmin, (req,res) => { const r=db.prepare('DELETE FROM promotions WHERE id=?').run(Number(req.params.id)); if(!r.changes)return res.status(404).json({error:'ไม่พบโปรโมชั่น'}); res.json({ok:true}); });
  router.get('/api/admin/orders', requireAdmin, (req,res) => {
    const orders = db.prepare(`SELECT o.*,g.name game_name,p.name package_name,c.code coupon_code FROM orders o JOIN games g ON g.id=o.game_id JOIN packages p ON p.id=o.package_id LEFT JOIN coupons c ON c.id=o.coupon_id ORDER BY o.created_at DESC`).all();
    res.json(orders.map(({ slip_path, ...order }) => ({ ...order, has_slip: Boolean(slip_path) })));
  });
  router.get('/api/admin/orders/:id/slip', requireAdmin, (req,res,next) => {
    const order = db.prepare('SELECT slip_path FROM orders WHERE id=?').get(String(req.params.id));
    if (!order || !order.slip_path) return res.status(404).json({ error: 'ไม่พบสลิป' });

    const storedPath = String(order.slip_path);
    let filePath = null;
    if (/^[A-Za-z0-9._-]+$/.test(storedPath) && path.basename(storedPath) === storedPath) {
      filePath = path.join(privateSlipsDir, storedPath);
    } else {
      const legacy = storedPath.match(/^\\/uploads\\/([A-Za-z0-9._-]+)$/);
      if (legacy) filePath = path.join(legacyUploadsDir, legacy[1]);
    }

    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return res.status(404).json({ error: 'ไม่พบไฟล์สลิป' });
    }
    const extension = path.extname(filePath).toLowerCase();
    const mimeType = ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' })[extension];
    if (!mimeType) return res.status(415).json({ error: 'ชนิดไฟล์สลิปไม่รองรับ' });

    res.set({
      'Content-Type': mimeType,
      'Content-Disposition': `inline; filename="slip-${String(req.params.id).replace(/[^A-Za-z0-9_-]/g, '')}${extension}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    const stream = fs.createReadStream(filePath);
    stream.on('error', error => res.headersSent ? res.destroy(error) : next(error));
    stream.pipe(res);
  });
  router.patch('/api/admin/orders/:id/status', requireAdmin, (req,res) => {
    const status=String((req.body||{}).status||''); if(!['Pending','Completed','Rejected'].includes(status))return res.status(400).json({error:'สถานะไม่ถูกต้อง'});
    const r=db.prepare('UPDATE orders SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status,String(req.params.id)); if(!r.changes)return res.status(404).json({error:'ไม่พบออเดอร์'}); res.json({ok:true,status});
  });
  router.post('/api/admin/upload', requireAdmin, upload.single('image'), validateImageFile, (req,res) => { if(!req.file)return res.status(400).json({error:'กรุณาเลือกไฟล์ภาพ PNG/JPG/WebP ขนาดไม่เกิน 5 MB'}); res.status(201).json({url:`/uploads/${req.file.filename}`}); });

  return router;
}

module.exports = createAdminRouter;
