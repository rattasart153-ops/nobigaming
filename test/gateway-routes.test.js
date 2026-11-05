'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const createUpload = require('../src/middleware/uploads');
const {createGatewaySession} = require('../src/middleware/gateway-session');
const createGatewayPublicRouter = require('../src/routes/gateway-public.routes');
const createGatewayAdminRouter = require('../src/routes/gateway-admin.routes');

function cookieFrom(response) {
  const value = response.headers.get('set-cookie') || '';
  return value.split(';')[0];
}

test('Apps Script-backed public and Admin REST routes preserve the browser API contract', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nobi-gateway-routes-'));
  const calls = [];
  const client = {
    async call(action, args = {}) {
      calls.push({action, args});
      if (action === 'catalog') return {games:[{id:'game-1',name:'RoV'}],packages:[]};
      if (action === 'promotions') return [];
      if (action === 'coupon') return {valid:true,code:'SAVE',discount:5,total:95};
      if (action === 'couponSuggestions') return {suggestion:null};
      if (action === 'publicMediaData') return {mimeType:'image/png',base64:Buffer.from('png-test').toString('base64')};
      if (action === 'memberLogin') return {
        token:'member-secret-token',expires_at:new Date(Date.now()+3600000).toISOString(),
        member:{member_id:'member-1',full_name:'Member',login_id:'member123'}
      };
      if (action === 'memberMe') return {
        authenticated:true,member:{member_id:'member-1',full_name:'Member',login_id:'member123'}
      };
      if (action === 'adminLogin') return {
        token:'admin-secret-token',expires_at:new Date(Date.now()+3600000).toISOString(),username:'Admin'
      };
      if (action === 'adminMe') return {authenticated:true};
      if (action === 'adminDashboard') return {orders:3,pending:1,completed:2,revenue:50};
      if (action === 'adminMemberLoginLogs') return [{ip_address:'203.0.113.10',login_result:'Success'}];
      if (action === 'adminLogout' || action === 'memberLogout') return {ok:true};
      throw new Error('Unexpected action: ' + action);
    }
  };

  const app = express();
  app.use(express.json({limit:'1mb'}));
  app.use(express.urlencoded({extended:true}));
  const gatewaySession = createGatewaySession(client);
  const upload = createUpload(root);
  const loginLimiter = (req, res, next) => next();
  app.use(createGatewayPublicRouter({
    client, slipUpload:upload, getPaymentInfo:async amount => ({configured:false,amount}),
    loginLimiter, gatewaySession
  }));
  app.use(createGatewayAdminRouter({
    client, requireAdmin:gatewaySession.requireAdmin, loginLimiter,
    upload, gatewaySession
  }));
  app.use((error, req, res, next) => res.status(500).json({error:error.message}));

  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  const origin = {Origin:base};

  try {
    const catalog = await fetch(base + '/api/public/catalog');
    assert.equal(catalog.status, 200);
    assert.equal((await catalog.json()).games[0].id, 'game-1');

    const coupon = await fetch(base + '/api/public/coupons/validate', {
      method:'POST', headers:{...origin,'Content-Type':'application/json'},
      body:JSON.stringify({code:'SAVE',gameId:'game-1',subtotal:100,playerId:'uid-1'})
    });
    assert.equal(coupon.status, 200);
    assert.equal((await coupon.json()).ok, true);

    const media = await fetch(base + '/api/public/media/drive-file-id-123');
    assert.equal(media.status, 200);
    assert.equal(media.headers.get('content-type'), 'image/png');
    assert.equal(Buffer.from(await media.arrayBuffer()).toString(), 'png-test');

    const memberLogin = await fetch(base + '/api/member/login', {
      method:'POST', headers:{...origin,'Content-Type':'application/json'},
      body:JSON.stringify({loginId:'member123',password:'member-password'})
    });
    assert.equal(memberLogin.status, 200);
    const memberCookie = cookieFrom(memberLogin);
    assert.match(memberCookie, /^nobi_member_session=/);
    const memberMe = await fetch(base + '/api/member/me', {headers:{Cookie:memberCookie}});
    assert.equal((await memberMe.json()).authenticated, true);

    const adminLogin = await fetch(base + '/api/admin/login', {
      method:'POST', headers:{...origin,'Content-Type':'application/json'},
      body:JSON.stringify({username:'Admin',password:'admin-password'})
    });
    assert.equal(adminLogin.status, 200);
    const adminCookie = cookieFrom(adminLogin);
    assert.match(adminCookie, /^nobi_admin_session=/);

    const dashboard = await fetch(base + '/api/admin/dashboard', {headers:{Cookie:adminCookie}});
    assert.equal(dashboard.status, 200);
    assert.equal((await dashboard.json()).completed, 2);

    const logs = await fetch(base + '/api/admin/member-login-logs?limit=20', {headers:{Cookie:adminCookie}});
    assert.equal(logs.status, 200);
    assert.equal((await logs.json())[0].ip_address, '203.0.113.10');

    assert.ok(calls.some(item => item.action === 'coupon'));
    assert.ok(calls.some(item => item.action === 'adminMemberLoginLogs'));
    assert.ok(calls.some(item => item.action === 'memberMe'));
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, {recursive:true, force:true});
  }
});
