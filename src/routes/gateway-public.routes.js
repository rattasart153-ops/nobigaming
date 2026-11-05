'use strict';

const express = require('express');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const validateImageFile = require('../middleware/validate-image-file');
const requireSameOrigin = require('../middleware/require-same-origin');
const asyncRoute = require('../utils/async-route');
const {readCookie, MEMBER_COOKIE} = require('../middleware/gateway-session');

function createGatewayPublicRouter({client, slipUpload, getPaymentInfo, loginLimiter, gatewaySession}) {
  const router = express.Router();
  router.use(requireSameOrigin);

  async function removeUpload(file) {
    if (file && file.path) await fs.unlink(file.path).catch(() => {});
  }

  async function memberIdFromRequest(req) {
    const token = readCookie(req, MEMBER_COOKIE);
    if (!token) return '';
    try {
      const result = await client.call('memberMe', {token});
      return result && result.authenticated && result.member ? String(result.member.member_id || '') : '';
    } catch (_) { return ''; }
  }

  router.get('/api/health', (req, res) => res.json({ok:true, service:'Nobi Topup API', storage:'google-apps-script'}));
  router.get('/api/public/catalog', asyncRoute(async (req, res) => {
    res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
    res.json(await client.call('catalog'));
  }));
  router.get('/api/public/promotions', asyncRoute(async (req, res) => {
    res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
    res.json(await client.call('promotions'));
  }));
  router.get('/api/public/coupons/suggestions', asyncRoute(async (req, res) => {
    const memberId = await memberIdFromRequest(req);
    const result = await client.call('couponSuggestions', {
      gameId:String(req.query.gameId || ''),
      subtotal:Number(req.query.subtotal || 0),
      playerId:String(req.query.playerId || ''),
      memberId
    });
    res.set('Cache-Control', 'no-store');
    res.json(result);
  }));
  router.post('/api/public/coupons/validate', asyncRoute(async (req, res) => {
    const {code, gameId, subtotal, playerId = ''} = req.body || {};
    if (!String(gameId || '') || !Number.isFinite(Number(subtotal)) || Number(subtotal) < 0) {
      return res.status(400).json({ok:false, message:'ข้อมูลยอดซื้อไม่ถูกต้อง'});
    }
    const memberId = await memberIdFromRequest(req);
    const result = await client.call('coupon', {
      code:String(code || ''), gameId:String(gameId),
      subtotal:Number(subtotal), playerId:String(playerId || ''), memberId
    });
    res.set('Cache-Control', 'no-store');
    return res.status(result.valid ? 200 : 422).json({
      ok:Boolean(result.valid),
      message:result.valid ? 'ใช้โค้ดส่วนลดได้' : result.error,
      discount:result.discount || 0,
      code:result.code || ''
    });
  }));
  router.get('/api/public/payment-info', asyncRoute(async (req, res) => {
    res.json(await getPaymentInfo(req.query.amount));
  }));

  router.post('/api/public/orders', slipUpload.single('slip'), validateImageFile, asyncRoute(async (req, res) => {
    const {gameId, packageId, playerId, serverId = '', couponCode = ''} = req.body || {};
    const idempotencyKey = String(req.get('Idempotency-Key') || '');
    if (!/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) {
      await removeUpload(req.file);
      return res.status(400).json({error:'ต้องระบุ Idempotency-Key ที่ถูกต้องเพื่อป้องกันออเดอร์ซ้ำ'});
    }
    if (!String(playerId || '').trim() || String(playerId).trim().length > 100) {
      await removeUpload(req.file);
      return res.status(400).json({error:'กรุณากรอก UID ให้ถูกต้อง'});
    }

    let fileBytes = null;
    try {
      if (req.file) fileBytes = await fs.readFile(req.file.path);
      const memberId = await memberIdFromRequest(req);
      const result = await client.call('createOrder', {
        request_key:idempotencyKey,
        game_id:String(gameId || ''),
        package_id:String(packageId || ''),
        player_id:String(playerId).trim(),
        server_id:String(serverId || '').trim(),
        coupon_code:String(couponCode || '').trim(),
        member_id:memberId
      });
      if (!result || !result.ok || !result.order) {
        return res.status(422).json({error:'ไม่สามารถสร้างออเดอร์ได้'});
      }

      const order = result.order;
      const token = result.checkout_token || '';
      if (token) {
        res.cookie('nobi_checkout_' + String(order.id).replace(/[^A-Za-z0-9_-]/g, ''), token, {
          httpOnly:true,
          secure:process.env.NODE_ENV === 'production' || Boolean(req.secure),
          sameSite:'strict',
          path:'/api/public/orders/' + encodeURIComponent(order.id) + '/slip',
          expires:new Date(order.payment_expires_at)
        });
      }

      let slipSubmittedAt = order.slip_submitted_at || null;
      if (req.file) {
        if (!token && !slipSubmittedAt) {
          return res.status(409).json({error:'ออเดอร์เดิมไม่มีสิทธิ์อัปโหลดสลิป กรุณาใช้รายการเดิมที่เปิดค้างไว้'});
        }
        if (token) {
          const submitted = await client.call('submitOrderSlip', {
            order_id:String(order.order_id || order.id),
            checkout_token:token,
            slip:{
              name:req.file.originalname,
              mimeType:req.file.mimetype,
              base64:fileBytes.toString('base64')
            }
          });
          slipSubmittedAt = submitted.slip_submitted_at || null;
        }
      }

      res.set('Cache-Control', 'no-store');
      return res.status(result.duplicate ? 200 : 201).json({
        message:slipSubmittedAt ? 'รับออเดอร์และสลิปแล้ว' : 'สร้างออเดอร์แล้ว กรุณาชำระเงินและอัปโหลดสลิปก่อนหมดเวลา',
        order:{...order, slip_submitted_at:slipSubmittedAt},
        replayed:Boolean(result.duplicate)
      });
    } finally {
      await removeUpload(req.file);
    }
  }));

  router.post('/api/public/orders/:id/slip', slipUpload.single('slip'), validateImageFile, asyncRoute(async (req, res) => {
    if (!req.file) return res.status(400).json({error:'กรุณาแนบสลิป PNG/JPG/WebP ไม่เกิน 5 MB'});
    const cookieName = 'nobi_checkout_' + String(req.params.id).replace(/[^A-Za-z0-9_-]/g, '');
    const checkoutToken = readCookie(req, cookieName);
    if (!checkoutToken) {
      await removeUpload(req.file);
      return res.status(404).json({error:'ไม่พบออเดอร์หรือสิทธิ์อัปโหลดไม่ถูกต้อง'});
    }
    try {
      const bytes = await fs.readFile(req.file.path);
      const result = await client.call('submitOrderSlip', {
        order_id:String(req.params.id),
        checkout_token:checkoutToken,
        slip:{name:req.file.originalname, mimeType:req.file.mimetype, base64:bytes.toString('base64')}
      });
      res.set('Cache-Control', 'no-store');
      return res.status(201).json({ok:true, slip_submitted_at:result.slip_submitted_at});
    } finally {
      await removeUpload(req.file);
    }
  }));

  router.get('/api/public/media/:id', asyncRoute(async (req, res) => {
    const result = await client.call('publicMediaData', {fileId:String(req.params.id)});
    const bytes = Buffer.from(String(result.base64 || ''), 'base64');
    if (!bytes.length) return res.status(404).json({error:'ไม่พบรูปภาพ'});
    res.set({
      'Content-Type':result.mimeType,
      'Content-Length':String(bytes.length),
      'Cache-Control':'public, max-age=300',
      'X-Content-Type-Options':'nosniff',
      'Content-Disposition':'inline'
    });
    return res.send(bytes);
  }));

  router.post('/api/member/register', loginLimiter, asyncRoute(async (req, res) => {
    const {fullName, loginId, password} = req.body || {};
    const result = await client.call('memberRegister', {
      fullName, loginId, password,
      ipAddress:String(req.ip || ''),
      userAgent:String(req.get('user-agent') || '')
    });
    return res.status(201).json(result);
  }));
  router.post('/api/member/login', loginLimiter, asyncRoute(async (req, res) => {
    const {loginId, password} = req.body || {};
    const result = await client.call('memberLogin', {
      loginId, password, ipAddress:String(req.ip || ''),
      userAgent:String(req.get('user-agent') || '')
    });
    gatewaySession.setMemberCookie(req, res, result.token, result.expires_at);
    return res.json({ok:true, member:result.member, expires_at:result.expires_at});
  }));
  router.post('/api/member/logout', asyncRoute(async (req, res) => {
    const token = readCookie(req, MEMBER_COOKIE);
    if (token) await client.call('memberLogout', {token});
    gatewaySession.clearMemberCookie(res);
    return res.json({ok:true});
  }));
  router.get('/api/member/me', asyncRoute(async (req, res) => {
    const token = readCookie(req, MEMBER_COOKIE);
    if (!token) return res.json({authenticated:false});
    try { return res.json(await client.call('memberMe', {token})); }
    catch (_) { return res.json({authenticated:false}); }
  }));
  router.post('/api/member/password', gatewaySession.requireMember, asyncRoute(async (req, res) => {
    const result = await client.call('memberChangePassword', {
      token:req.memberToken,
      currentPassword:String((req.body || {}).currentPassword || ''),
      newPassword:String((req.body || {}).newPassword || '')
    });
    gatewaySession.clearMemberCookie(res);
    return res.json(result);
  }));

  return router;
}

module.exports = createGatewayPublicRouter;
