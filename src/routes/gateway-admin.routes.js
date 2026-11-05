'use strict';

const express = require('express');
const fs = require('node:fs/promises');
const validateImageFile = require('../middleware/validate-image-file');
const requireSameOrigin = require('../middleware/require-same-origin');
const asyncRoute = require('../utils/async-route');
const {readCookie, ADMIN_COOKIE} = require('../middleware/gateway-session');

function createGatewayAdminRouter({client, requireAdmin, loginLimiter, upload, gatewaySession}) {
  const router = express.Router();
  router.use(requireSameOrigin);

  async function removeUpload(file) {
    if (file && file.path) await fs.unlink(file.path).catch(() => {});
  }

  function toSchemaRecord(table, input, id) {
    const value = input || {};
    if (table === 'games') return {
      ...(id ? {game_id:id} : {}),
      name:String(value.name || '').trim(),
      category:String(value.category || 'other'),
      description:String(value.description || ''),
      active:value.active !== false,
      sort_order:Number(value.sort_order || 0)
    };
    if (table === 'packages') return {
      ...(id ? {package_id:id} : {}),
      game_id:String(value.game_id || ''),
      name:String(value.name || '').trim(),
      amount:Number(value.amount),
      unit:String(value.unit || ''),
      price_satang:Math.round(Number(value.price || 0) * 100),
      image_url:String(value.image_url || ''),
      popular:Boolean(value.popular),
      active:value.active !== false,
      sort_order:Number(value.sort_order || 0)
    };
    if (table === 'coupons') {
      const allowed = String(value.allowed_player_ids || '').split(/[\n,;]+/).map(item => item.trim()).filter(Boolean);
      return {
        ...(id ? {coupon_id:id} : {}),
        code_normalized:String(value.code || value.code_normalized || '').trim().toUpperCase(),
        code_display:String(value.code || value.code_display || '').trim().toUpperCase(),
        discount_type:String(value.discount_type || 'fixed'),
        discount_value:String(value.discount_type || 'fixed') === 'percent'
          ? Number(value.discount_value) : Math.round(Number(value.discount_value || 0) * 100),
        min_order_satang:Math.round(Number(value.min_spend || value.min_order_satang / 100 || 0) * 100),
        game_id:value.game_id ? String(value.game_id) : '',
        access_type:String(value.access_type || 'public'),
        member_spend_game_id:String(value.member_spend_game_id || ''),
        member_min_game_spend_satang:Math.round(Number(value.member_min_game_spend || value.member_min_game_spend_satang / 100 || 0) * 100),
        expires_at:value.expires_at || '',
        usage_limit:value.usage_limit === '' || value.usage_limit == null ? '' : Number(value.usage_limit),
        active:value.active !== false,
        allowed_player_ids_json:JSON.stringify(allowed),
        min_player_spend_satang:Math.round(Number(value.min_player_spend || value.min_player_spend_satang / 100 || 0) * 100)
      };
    }
    if (table === 'promotions') return {
      ...(id ? {promotion_id:id} : {}),
      title:String(value.title || '').trim(),
      subtitle:String(value.subtitle || ''),
      image_url:String(value.image_url || ''),
      link_url:String(value.link_url || ''),
      active:value.active !== false,
      sort_order:Number(value.sort_order || 0),
      starts_at:value.starts_at || '',
      ends_at:value.ends_at || ''
    };
    throw new Error('ไม่อนุญาตให้แก้ไขตารางนี้');
  }

  function fromSchemaRecord(table, row) {
    const base = {...row};
    if (table === 'games') return {...base, id:row.game_id};
    if (table === 'packages') {
      delete base.image_file_id;
      delete base.price_satang;
      return {
        ...base, id:row.package_id, price:Number(row.price_satang || 0) / 100,
        image_url:row.image_file_id ? '/api/public/media/' + row.image_file_id : (row.image_url || '')
      };
    }
    if (table === 'coupons') {
      delete base.allowed_player_ids_json;
      delete base.min_order_satang;
      delete base.min_player_spend_satang;
      delete base.member_min_game_spend_satang;
      delete base.code_normalized;
      let allowed = [];
      try { allowed = JSON.parse(row.allowed_player_ids_json || '[]'); } catch (_) {}
      return {
        ...base, id:row.coupon_id, code:row.code_display,
        min_spend:Number(row.min_order_satang || 0) / 100,
        discount_value:row.discount_type === 'percent' ? Number(row.discount_value) : Number(row.discount_value) / 100,
        min_player_spend:Number(row.min_player_spend_satang || 0) / 100,
        member_min_game_spend:Number(row.member_min_game_spend_satang || 0) / 100,
        allowed_player_ids:Array.isArray(allowed) ? allowed.join('\n') : '',
        expires_at:row.expires_at || null
      };
    }
    if (table === 'promotions') {
      delete base.image_file_id;
      return {
        ...base, id:row.promotion_id,
        image_url:row.image_file_id ? '/api/public/media/' + row.image_file_id : (row.image_url || '')
      };
    }
    return base;
  }

  router.post('/api/admin/login', loginLimiter, asyncRoute(async (req, res) => {
    const {username, password} = req.body || {};
    const result = await client.call('adminLogin', {
      username, password, ipAddress:String(req.ip || '')
    });
    gatewaySession.setAdminCookie(req, res, result.token, result.expires_at);
    return res.json({ok:true, username:result.username});
  }));
  router.post('/api/admin/logout', gatewaySession.requireAdmin, asyncRoute(async (req, res) => {
    await client.call('adminLogout', {token:req.adminToken});
    gatewaySession.clearAdminCookie(res);
    return res.json({ok:true});
  }));
  router.get('/api/admin/me', asyncRoute(async (req, res) => {
    const token = readCookie(req, ADMIN_COOKIE);
    if (!token) return res.json({authenticated:false});
    try { return res.json(await client.call('adminMe', {token})); }
    catch (_) { return res.json({authenticated:false}); }
  }));
  router.post('/api/admin/password', gatewaySession.requireAdmin, asyncRoute(async (req, res) => {
    const result = await client.call('adminChangePassword', {
      token:req.adminToken,
      currentPassword:String((req.body || {}).currentPassword || ''),
      newPassword:String((req.body || {}).newPassword || '')
    });
    gatewaySession.clearAdminCookie(res);
    return res.json(result);
  }));

  router.get('/api/admin/dashboard', requireAdmin, asyncRoute(async (req, res) => {
    res.json(await client.call('adminDashboard', {token:req.adminToken}));
  }));
  router.get('/api/admin/orders', requireAdmin, asyncRoute(async (req, res) => {
    res.json(await client.call('adminOrders', {token:req.adminToken}));
  }));
  router.get('/api/admin/orders/:id/slip', requireAdmin, asyncRoute(async (req, res) => {
    const result = await client.call('adminSlipData', {token:req.adminToken, orderId:String(req.params.id), ipAddress:String(req.ip || '')});
    const bytes = Buffer.from(String(result.base64 || ''), 'base64');
    if (!bytes.length) return res.status(404).json({error:'ไม่พบสลิป'});
    res.set({
      'Content-Type':result.mimeType,
      'Content-Length':String(bytes.length),
      'Content-Disposition':'inline; filename="slip-' + String(req.params.id).replace(/[^A-Za-z0-9_-]/g, '') + '"',
      'Cache-Control':'private, no-store',
      'X-Content-Type-Options':'nosniff'
    });
    return res.send(bytes);
  }));
  router.patch('/api/admin/orders/:id/status', requireAdmin, asyncRoute(async (req, res) => {
    const status = String((req.body || {}).status || '');
    if (!['Completed','Rejected'].includes(status)) return res.status(400).json({error:'สถานะไม่ถูกต้อง'});
    const result = await client.call('adminSetOrderStatus', {
      token:req.adminToken, orderId:String(req.params.id), status, ipAddress:String(req.ip || '')
    });
    if (result && result.reason === 'expired') return res.status(409).json({error:'ออเดอร์หมดเวลาแล้วและคืนสิทธิ์คูปองแล้ว'});
    return res.json(result || {ok:true});
  }));

  for (const table of ['games','packages','coupons','promotions']) {
    router.get('/api/admin/' + table, requireAdmin, asyncRoute(async (req, res) => {
      const rows = await client.call('adminList', {token:req.adminToken, tableName:table});
      const converted = (rows || []).map(row => fromSchemaRecord(table, row));
      if (table === 'packages' || table === 'coupons') {
        const catalog = await client.call('catalog');
        const games = catalog.games || [];
        converted.forEach(row => {
          const game = games.find(item => String(item.id) === String(row.game_id));
          row.game_name = game ? game.name : '';
          if (table === 'coupons') {
            const qualifyingGame = games.find(item => String(item.id) === String(row.member_spend_game_id));
            row.member_spend_game_name = qualifyingGame ? qualifyingGame.name : '';
          }
        });
      }
      return res.json(converted);
    }));
    router.post('/api/admin/' + table, requireAdmin, asyncRoute(async (req, res) => {
      const record = toSchemaRecord(table, req.body || '');
      const result = await client.call('adminUpsert', {token:req.adminToken, tableName:table, record, ipAddress:String(req.ip || '')});
      return res.status(201).json(result);
    }));
    router.put('/api/admin/' + table + '/:id', requireAdmin, asyncRoute(async (req, res) => {
      const record = toSchemaRecord(table, req.body || {}, String(req.params.id));
      const result = await client.call('adminUpsert', {token:req.adminToken, tableName:table, record});
      return res.json(result);
    }));
    router.delete('/api/admin/' + table + '/:id', requireAdmin, asyncRoute(async (req, res) => {
      const id = String(req.params.id);
      const result = await client.call('adminDelete', {token:req.adminToken, tableName:table, id, ipAddress:String(req.ip || '')});
      return res.json(result || {ok:true});
    }));
  }

  router.get('/api/admin/member-login-logs', requireAdmin, asyncRoute(async (req, res) => {
    const result = await client.call('adminMemberLoginLogs', {
      token:req.adminToken,
      memberId:String(req.query.memberId || ''),
      limit:Number(req.query.limit || 100)
    });
    return res.json(result);
  }));

  router.post('/api/admin/upload', requireAdmin, upload.single('image'), validateImageFile, asyncRoute(async (req, res) => {
    if (!req.file) return res.status(400).json({error:'กรุณาเลือกไฟล์ภาพ PNG/JPG/WebP ขนาดไม่เกิน 5 MB'});
    try {
      const bytes = await fs.readFile(req.file.path);
      const result = await client.call('adminStoreMedia', {
        token:req.adminToken,
        media:{name:req.file.originalname, mimeType:req.file.mimetype, base64:bytes.toString('base64')},
        ipAddress:String(req.ip || '')
      });
      return res.status(201).json({url:result.url});
    } finally {
      await removeUpload(req.file);
    }
  }));

  return router;
}

module.exports = createGatewayAdminRouter;
