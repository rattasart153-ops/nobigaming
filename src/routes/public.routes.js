'use strict';

const express = require('express');
const generatePayload = require('promptpay-qr');
const QRCode = require('qrcode');
const ENV = require('../config/env');

function createPublicRouter({ db, upload, asyncRoute, validateCoupon, getCatalog, createPendingOrder }) {
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
    const amount = Math.max(0, Number(req.query.amount || 0));
    const promptpayId = ENV.PROMPTPAY_ID;
    if (!promptpayId) return res.json({ configured: false, message: 'ผู้ดูแลระบบยังไม่ได้ตั้งค่า PromptPay ID' });
    const payload = generatePayload(promptpayId, { amount: amount || undefined });
    res.json({ configured: true, promptpayId, amount, qrDataUrl: await QRCode.toDataURL(payload, { margin: 1, width: 260 }) });
  }));
  router.post('/api/public/orders', upload.single('slip'), (req,res) => {
    const { gameId, packageId, playerId, serverId = '', couponCode = '' } = req.body;
    const game = db.prepare('SELECT * FROM games WHERE id=? AND active=1').get(Number(gameId));
    const pack = db.prepare('SELECT * FROM packages WHERE id=? AND game_id=? AND active=1').get(Number(packageId), Number(gameId));
    if (!game || !pack) return res.status(400).json({ error: 'ไม่พบเกมหรือแพ็กเกจที่เลือก' });
    if (!String(playerId || '').trim() || String(playerId).trim().length > 100) return res.status(400).json({ error: 'กรุณากรอก UID ให้ถูกต้อง' });
    if (!req.file) return res.status(400).json({ error: 'กรุณาแนบสลิปการโอนเงิน (PNG/JPG/WebP ไม่เกิน 5 MB)' });

    const result = createPendingOrder({
      game,
      pack,
      playerId: String(playerId).trim(),
      serverId,
      couponCode,
      file: req.file
    });
    if (!result.ok) return res.status(422).json({ error: result.message });
    res.status(201).json({ message: 'รับออเดอร์แล้ว รอแอดมินตรวจสอบสลิป', order: result.order });
  });

  return router;
}

module.exports = createPublicRouter;
