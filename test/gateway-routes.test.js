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
  let slipCalls = 0;
  const client = {
    async call(action, args = {}) {
      calls.push({action, args});
      if (action === 'catalog') return {games:[{id:'game-1',name:'RoV'}],packages:[]};
      if (action === 'promotions') return [];
      if (action === 'coupon') return {valid:true,code:'SAVE',discount:5,total:95};
      if (action === 'couponSuggestions') return {suggestion:null};
      if (action === 'publicMediaData') return {mimeType:'image/png',base64:Buffer.from('png-test').toString('base64')};
      if (action === 'createOrder') return {
        ok:true,duplicate:false,
        order:{id:'NBI-20261105-ABCDEF',order_id:'NBI-20261105-ABCDEF',payment_expires_at:new Date(Date.now()+15*60*1000).toISOString(),slip_submitted_at:null},
        checkout_token:'checkout-secret-token'
      };
      if (action === 'submitOrderSlip') {
        slipCalls++;
        return {ok:true,already_submitted:slipCalls>1,slip_submitted_at:'2026-11-05T04:00:00.000Z'};
      }
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
      if (action === 'adminDashboard') {
        assert.equal(args.token,'admin-secret-token');
        return {orders:3,pending:1,completed:2,revenue:50};
      }
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
    const memberMeCallsBeforeCoupon = calls.filter(item => item.action === 'memberMe').length;
    const memberCoupon = await fetch(base + '/api/public/coupons/validate', {
      method:'POST', headers:{...origin,Cookie:memberCookie,'Content-Type':'application/json'},
      body:JSON.stringify({code:'SAVE',gameId:'game-1',subtotal:100,playerId:'uid-1'})
    });
    assert.equal(memberCoupon.status,200);
    const couponCall = calls.filter(item => item.action === 'coupon').at(-1);
    assert.equal(couponCall.args.member_token,'member-secret-token');
    assert.equal(calls.filter(item => item.action === 'memberMe').length,memberMeCallsBeforeCoupon,
      'coupon validation must not issue a separate memberMe GAS request');

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
    assert.equal(calls.filter(item => item.action === 'adminDashboard').length,1);
    assert.equal(calls.filter(item => item.action === 'adminMemberLoginLogs').length,1);
    assert.equal(calls.filter(item => item.action === 'adminMe').length,0,
      'protected Admin actions must validate within their own GAS request, not a redundant preflight');
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, {recursive:true, force:true});
  }
});


test('slip upload keeps a short receipt cookie for safe retry and clears it after replay', async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'nobi-slip-retry-'));
  let slipCalls=0;
  const client={
    async call(action,args={}){
      if(action==='createOrder')return {
        ok:true,duplicate:false,
        order:{id:'NBI-20261105-ABCDEF',order_id:'NBI-20261105-ABCDEF',payment_expires_at:new Date(Date.now()+15*60*1000).toISOString(),slip_submitted_at:null},
        checkout_token:'checkout-secret-token'
      };
      if(action==='submitOrderSlip'){
        slipCalls++;
        return {ok:true,already_submitted:slipCalls>1,slip_submitted_at:'2026-11-05T04:00:00.000Z'};
      }
      if(action==='memberMe')return {authenticated:false};
      throw new Error('Unexpected action: '+action);
    }
  };
  const app=express();
  app.use(express.json({limit:'1mb'}));
  const gatewaySession=createGatewaySession(client);
  const upload=createUpload(root);
  app.use(createGatewayPublicRouter({
    client,slipUpload:upload,getPaymentInfo:async()=>({configured:false}),
    loginLimiter:(req,res,next)=>next(),gatewaySession
  }));
  app.use((error,req,res,next)=>res.status(500).json({error:error.message}));
  const server=await new Promise(resolve=>{
    const instance=app.listen(0,'127.0.0.1',()=>resolve(instance));
  });
  const base='http://127.0.0.1:'+server.address().port;
  const origin={Origin:base};
  try{
    const created=await fetch(base+'/api/public/orders',{
      method:'POST',headers:{...origin,'Idempotency-Key':'slip-retry-key-123456'},
      body:(()=>{const form=new FormData();form.append('gameId','game-1');form.append('packageId','pack-1');form.append('playerId','uid-1');return form;})()
    });
    assert.equal(created.status,201);
    const order=await created.json();
    const orderCookie=cookieFrom(created);
    assert.match(orderCookie,/^nobi_checkout_NBI-20261105-ABCDEF=/);

    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/7b8AAAAASUVORK5CYII=','base64');
    const uploadForm=()=>{const form=new FormData();form.append('slip',new Blob([png],{type:'image/png'}),'slip.png');return form;};
    const first=await fetch(base+'/api/public/orders/'+encodeURIComponent(order.order.id)+'/slip',{
      method:'POST',headers:{...origin,Cookie:orderCookie},body:uploadForm()
    });
    assert.equal(first.status,201);
    const receiptCookie=cookieFrom(first);
    assert.match(receiptCookie,/^nobi_checkout_NBI-20261105-ABCDEF=/);
    assert.match(first.headers.get('set-cookie')||'',/Expires=/);

    const retry=await fetch(base+'/api/public/orders/'+encodeURIComponent(order.order.id)+'/slip',{
      method:'POST',headers:{...origin,Cookie:receiptCookie},body:uploadForm()
    });
    assert.equal(retry.status,200);
    assert.equal((await retry.json()).already_submitted,true);
    assert.match(retry.headers.get('set-cookie')||'',/Expires=Thu, 01 Jan 1970/);
    assert.equal(slipCalls,2);
  }finally{
    await new Promise(resolve=>server.close(resolve));
    fs.rmSync(root,{recursive:true,force:true});
  }
});


test('Admin CRUD updates forward the server-derived request IP for audit logging', async () => {
  const calls = [];
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'nobi-admin-ip-'));
  const client = {
    async call(action, args = {}) {
      calls.push({action, args});
      if (action === 'adminLogin') return {
        token:'admin-secret-token',
        expires_at:new Date(Date.now()+3600000).toISOString(),
        username:'Admin'
      };
      if (action === 'adminUpsert') return {ok:true,id:args.record.game_id};
      throw new Error('Unexpected action: '+action);
    }
  };
  const app = express();
  app.use(express.json({limit:'1mb'}));
  const gatewaySession = createGatewaySession(client);
  const upload = createUpload(root);
  app.use(createGatewayAdminRouter({
    client, requireAdmin:gatewaySession.requireAdmin,
    loginLimiter:(req,res,next)=>next(), upload, gatewaySession
  }));
  app.use((error,req,res,next)=>res.status(500).json({error:error.message}));
  const server = await new Promise(resolve => {
    const instance = app.listen(0,'127.0.0.1',()=>resolve(instance));
  });
  const base = 'http://127.0.0.1:'+server.address().port;
  try {
    const login = await fetch(base+'/api/admin/login',{
      method:'POST',
      headers:{Origin:base,'Content-Type':'application/json'},
      body:JSON.stringify({username:'Admin',password:'admin-password'})
    });
    assert.equal(login.status,200);
    const cookie = cookieFrom(login);
    const response = await fetch(base+'/api/admin/games/game-1',{
      method:'PUT',
      headers:{Origin:base,Cookie:cookie,'Content-Type':'application/json'},
      body:JSON.stringify({name:'RoV Updated',category:'moba',description:'',active:true,sort_order:1})
    });
    assert.equal(response.status,200);
    assert.deepEqual(await response.json(),{ok:true,id:'game-1'});
    const upsert = calls.find(item=>item.action==='adminUpsert');
    assert.ok(upsert);
    assert.equal(upsert.args.token,'admin-secret-token');
    assert.equal(upsert.args.tableName,'games');
    assert.equal(upsert.args.record.game_id,'game-1');
    assert.match(upsert.args.ipAddress,/^(?:127\\.0\\.0\\.1|::ffff:127\\.0\\.0\\.1)$/);
  } finally {
    await new Promise(resolve=>server.close(resolve));
    fs.rmSync(root,{recursive:true,force:true});
  }
});
