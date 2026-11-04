'use strict';

const express = require('express');
const fs = require('node:fs');
const crypto = require('node:crypto');
const validateImageFile = require('../middleware/validate-image-file');

function readCookie(req, name) {
  const header = String(req.headers.cookie || '');
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1).trim());
  }
  return '';
}
function checkoutCookieName(orderId) {
  return 'nobi_checkout_' + String(orderId).replace(/[^A-Za-z0-9_-]/g, '');
}

function createPublicRouter({ db, slipUpload, asyncRoute, validateCoupon, getCatalog, getPaymentInfo, createPendingOrder, submitSlip }) {
  const router = express.Router();

  router.get('/api/health', (req,res) => res.json({ ok: true, service: 'Nobi Topup API' }));
  router.get('/api/public/catalog', (req,res) => res.json(getCatalog()));
  router.get('/api/public/promotions', (req,res) => { const now=Date.now(); const items=db.prepare('SELECT * FROM promotions WHERE active=1 ORDER BY sort_order,id DESC').all().filter(p => (!p.starts_at || Date.parse(p.starts_at)<=now) && (!p.ends_at || Date.parse(p.ends_at)>=now)); res.json(items); });
  router.get('/api/public/coupons/suggestions', (req,res) => {
    const gameId = Number(req.query.gameId || 0), subtotal = Number(req.query.subtotal || 0);
    const candidates = db.prepare('SELECT * FROM coupons WHERE active=1 ORDER BY id DESC').all();
    const valid = candidates.map(c => validateCoupon(c.code, gameId, subtotal, req.query.playerId || '')).filter(x => x.ok).sort((a,b) => b.discount-a.discount);
    res.json(valid.length ? { suggestion: { code: valid[0].coupon.code, discount: valid[0].discount, message: `ประหยัด ฿${valid[0].discount.toLocaleString('th-TH')}` } } : { suggestion: null });
  });
  router.post('/api/public/coupons/validate', (req,res) => {
    const { code, gameId, subtotal, playerId = '' } = req.body || {};
    if (!Number.isFinite(Number(gameId)) || !Number.isFinite(Number(subtotal)) || Number(subtotal) < 0) return res.status(400).json({ ok:false, message:'ข้อมูลยอดซื้อไม่ถูกต้อง' });
    const result = validateCoupon(String(code || ''), Number(gameId), Number(subtotal), String(playerId || ''));
    res.status(result.ok ? 200 : 422).json({ ok: result.ok, message: result.message, discount: result.discount || 0, code: result.coupon && result.coupon.code });
  });
  router.get('/api/public/payment-info', asyncRoute(async (req,res) => {
    res.json(await getPaymentInfo(req.query.amount));
  }));
  router.post('/api/public/orders', slipUpload.single('slip'), validateImageFile, (req,res) => {
    const { gameId, packageId, playerId, serverId = '', couponCode = '' } = req.body;
    const game = db.prepare('SELECT * FROM games WHERE id=? AND active=1').get(Number(gameId));
    const pack = db.prepare('SELECT * FROM packages WHERE id=? AND game_id=? AND active=1').get(Number(packageId), Number(gameId));
    const discardUpload = () => {
      if (req.file && req.file.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    };
    const idempotencyKey = String(req.get('Idempotency-Key') || '');
    if (!/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) {
      discardUpload();
      return res.status(400).json({ error: 'ต้องระบุ Idempotency-Key ที่ถูกต้องเพื่อป้องกันออเดอร์ซ้ำ' });
    }
    if (!game || !pack) {
      discardUpload();
      return res.status(400).json({ error: 'ไม่พบเกมหรือแพ็กเกจที่เลือก' });
    }
    if (!String(playerId || '').trim() || String(playerId).trim().length > 100) {
      discardUpload();
      return res.status(400).json({ error: 'กรุณากรอก UID ให้ถูกต้อง' });
    }
    const normalizedPlayerId = String(playerId).trim();
    const normalizedServerId = String(serverId || '').trim();
    const normalizedCouponCode = String(couponCode || '').trim();
    const slipHash = req.file ? crypto.createHash('sha256').update(fs.readFileSync(req.file.path)).digest('hex') : null;
    const requestHash = crypto.createHash('sha256').update(JSON.stringify({
      gameId: game.id, packageId: pack.id, playerId: normalizedPlayerId,
      serverId: normalizedServerId, couponCode: normalizedCouponCode, slipHash
    })).digest('hex');
    const result = createPendingOrder({
      game, pack, playerId: normalizedPlayerId, serverId: normalizedServerId,
      couponCode: normalizedCouponCode, file: req.file || null, idempotencyKey, requestHash
    });
    if (!result.ok) {
      const status = result.reason === 'idempotency_conflict' ? 409 : result.reason === 'expired' ? 410 : 422;
      return res.status(status).json({ error: result.message, reason: result.reason });
    }
    res.set('Cache-Control', 'no-store');
    if (!result.order.slip_submitted_at && result.checkoutToken) {
      res.cookie(checkoutCookieName(result.order.id), result.checkoutToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production' || req.secure,
        sameSite: 'strict',
        path: '/api/public/orders/' + encodeURIComponent(result.order.id) + '/slip',
        expires: new Date(result.order.payment_expires_at)
      });
    }
    res.status(result.replay ? 200 : 201).json({ message: result.order.slip_submitted_at ? 'รับออเดอร์และสลิปแล้ว' : 'สร้างออเดอร์แล้ว กรุณาชำระเงินและอัปโหลดสลิปก่อนหมดเวลา', order: result.order, replayed: Boolean(result.replay) });
  });

  router.post('/api/public/orders/:id/slip', slipUpload.single('slip'), validateImageFile, (req,res) => {
    if (!req.file) return res.status(400).json({ error: 'กรุณาแนบสลิป PNG/JPG/WebP ไม่เกิน 5 MB' });
    const cookieName = checkoutCookieName(req.params.id);
    const checkoutToken = readCookie(req, cookieName);
    const result = submitSlip({ orderId: req.params.id, checkoutToken, file: req.file });
    if (!result.ok) {
      const status = result.reason === 'not_found' ? 404 : result.reason === 'expired' ? 410 : 409;
      const message = result.reason === 'expired' ? 'หมดเวลาชำระเงินและอัปโหลดสลิปแล้ว' : result.reason === 'already_submitted' ? 'ออเดอร์นี้มีการส่งสลิปแล้วหรือไม่สามารถแก้ไขได้' : 'ไม่พบออเดอร์หรือสิทธิ์อัปโหลดไม่ถูกต้อง';
      return res.status(status).json({ error: message, reason: result.reason });
    }
    res.cookie(cookieName, checkoutToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production' || req.secure,
      sameSite: 'strict',
      path: '/api/public/orders/' + encodeURIComponent(req.params.id) + '/slip',
      expires: new Date(Date.now() + 5 * 60 * 1000)
    });
    return res.status(201).json({ ok: true, slip_submitted_at: result.slipSubmittedAt });
  });

  return router;
}

module.exports = createPublicRouter;
