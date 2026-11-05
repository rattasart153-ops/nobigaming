'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function makeOrderHarness() {
  const fixedNow = Date.parse('2026-11-05T04:00:00.000Z');
  const RealDate = Date;
  class FixedDate extends RealDate {
    constructor(...args) { super(...(args.length ? args : [fixedNow])); }
    static now() { return fixedNow; }
  }
  FixedDate.parse = RealDate.parse;
  FixedDate.UTC = RealDate.UTC;

  const data = {
    games:[{game_id:'game-1',name:'RoV',active:true}],
    packages:[{package_id:'pack-1',game_id:'game-1',name:'100 Diamonds',amount:100,unit:'Diamonds',price_satang:10000,active:true}],
    coupons:[],
    members:[],
    orders:[],
    coupon_redemptions:[],
    idempotency_records:[]
  };
  let uuid = 0;
  const files = [];
  let folderAccess = 'PRIVATE';
  const context = {
    Date:FixedDate,
    NOBI:{MAX_SLIP_BYTES:3*1024*1024},
    LockService:{getScriptLock:()=>({waitLock:()=>{},releaseLock:()=>{}})},
    PropertiesService:{getScriptProperties:()=>({getProperty:key=>key==='NOBI_PRIVATE_DRIVE_FOLDER_ID'?'private-folder-id':''})},
    Utilities:{
      getUuid:()=>'uuid-' + (++uuid),
      formatDate:()=> '20261105110000',
      base64Decode:value=>Array.from(Buffer.from(String(value),'base64')).map(x=>x>127?x-256:x),
      newBlob:(bytes,mimeType,name)=>({bytes,mimeType,name})
    },
    DriveApp:{
      Access:{PRIVATE:'PRIVATE'}, Permission:{VIEW:'VIEW'},
      getFolderById:()=>({createFile:blob=>{
        const file={id:'drive-file-'+(files.length+1),blob,trashed:false,
          getId(){return this.id;},getSharingAccess(){return 'PRIVATE';},setSharing(){},setTrashed(value){this.trashed=value;}};
        files.push(file); return file;
      },getSharingAccess:()=> folderAccess})
    },
    checkoutTokenForOrder_:(orderId,requestKey)=>'derived-checkout-token.'+orderId+'.'+requestKey,
    requireMemberLocked_:token=>{
      if(token!=='valid-member-token') throw new Error('เซสชันสมาชิกหมดอายุ');
      const member=data.members.find(row=>row.member_id==='member-1'&&row.status==='Active');
      if(!member) throw new Error('บัญชีสมาชิกถูกระงับ');
      return member;
    },
    repositoryRows_:table=>data[table] || [],
    repositoryFindByField_:(table,field,value)=>(data[table]||[]).filter(row=>String(row[field])===String(value)),
    repositoryGetById_:(table,id)=>{
      const keys={games:'game_id',packages:'package_id',coupons:'coupon_id',members:'member_id',orders:'order_id',coupon_redemptions:'redemption_id',idempotency_records:'idempotency_id'};
      return (data[table]||[]).find(row=>String(row[keys[table]])===String(id)) || null;
    },
    repositoryInsertLocked_:(table,record)=>{
      const keys={orders:'order_id',coupon_redemptions:'redemption_id',idempotency_records:'idempotency_id'};
      const key=keys[table];
      if(key && (data[table]||[]).some(row=>String(row[key])===String(record[key]))) throw new Error('duplicate');
      data[table].push({...record}); return record;
    },
    repositoryUpdateLocked_:(table,id,patch)=>{
      const row=context.repositoryGetById_(table,id);
      if(!row) throw new Error('missing');
      Object.assign(row,patch); return row;
    },
    repositoryDeleteLocked_:(table,id)=>{
      const keys={idempotency_records:'idempotency_id'};
      const index=(data[table]||[]).findIndex(row=>String(row[keys[table]])===String(id));
      if(index>=0) data[table].splice(index,1);
      return index>=0;
    },
    sha256_:value=>crypto.createHash('sha256').update(String(value)).digest('hex'),
    constantTimeHexEqual_:(a,b)=>a.length===b.length && crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b)),
    truth_:value=>value===true||value===1||String(value).toLowerCase()==='true',
    money_:value=>Math.round(Number(value)*100)/100
  };
  vm.createContext(context);
  for (const file of ['04_Coupons.gs','06_Orders.gs']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname,'..','google-apps-script',file),'utf8'),context,{filename:file});
  }
  context.checkoutTokenForOrder_=(orderId,requestKey)=>'derived-checkout-token.'+orderId+'.'+requestKey;
  return {context,data,files,fixedNow,setFolderAccess:value=>{folderAccess=value;}};
}

test('checkout creates a Pending order with a 15-minute deadline and a one-time token', () => {
  const {context,data,fixedNow}=makeOrderHarness();
  const result=context.createOrder({
    request_key:'request-key-00000001',game_id:'game-1',package_id:'pack-1',
    player_id:'uid-123',server_id:'',coupon_code:''
  });
  assert.equal(result.ok,true);
  assert.equal(result.order.status,'Pending');
  assert.equal(result.order.total,100);
  assert.equal(result.order.payment_expires_at, new Date(fixedNow+15*60*1000).toISOString());
  assert.ok(result.checkout_token);
  assert.equal(data.orders.length,1);
});

test('expiring coupon grants until end of expiry day in Bangkok and reserves capacity', () => {
  const {context,data,fixedNow}=makeOrderHarness();
  data.coupons.push({
    coupon_id:'coupon-1',code_normalized:'SAVE',code_display:'SAVE',
    discount_type:'fixed',discount_value:1000,access_type:'public',active:true,
    expires_at:'2026-11-05',min_order_satang:0,usage_limit:1,game_id:''
  });
  const result=context.createOrder({
    request_key:'request-key-00000002',game_id:'game-1',package_id:'pack-1',
    player_id:'uid-123',server_id:'',coupon_code:'SAVE'
  });
  assert.equal(result.order.total,90);
  assert.equal(result.order.payment_expires_at,'2026-11-05T17:00:00.000Z');
  assert.ok(Date.parse(result.order.payment_expires_at)-fixedNow > 15*60*1000);
  assert.equal(data.coupon_redemptions[0].state,'Reserved');
  assert.equal(data.coupon_redemptions[0].order_id,result.order.order_id);
});

test('checkout idempotency returns the same order and rejects a changed payload', () => {
  const {context,data}=makeOrderHarness();
  const payload={request_key:'request-key-00000003',game_id:'game-1',package_id:'pack-1',player_id:'uid-123',server_id:'',coupon_code:''};
  const first=context.createOrder(payload);
  const replay=context.createOrder(payload);
  assert.equal(data.orders.length,1);
  assert.equal(replay.duplicate,true);
  assert.equal(replay.order.order_id,first.order.order_id);
  assert.ok(replay.checkout_token);
  assert.equal(replay.checkout_token,first.checkout_token);
  assert.throws(()=>context.createOrder({...payload,player_id:'uid-different'}),/IDEMPOTENCY_CONFLICT/);
});

test('coupon reservation is released when an unpaid Pending order expires', () => {
  const {context,data,fixedNow}=makeOrderHarness();
  data.coupons.push({
    coupon_id:'coupon-1',code_normalized:'SAVE',code_display:'SAVE',
    discount_type:'fixed',discount_value:1000,access_type:'public',active:true,
    expires_at:'',min_order_satang:0,usage_limit:1,game_id:''
  });
  const result=context.createOrder({
    request_key:'request-key-00000004',game_id:'game-1',package_id:'pack-1',
    player_id:'uid-123',server_id:'',coupon_code:'SAVE'
  });
  context.expirePendingOrdersLocked_(fixedNow+16*60*1000);
  assert.equal(data.orders[0].status,'Expired');
  assert.equal(data.coupon_redemptions[0].state,'Released');
});

test('slip upload checks the server deadline and prevents a second upload', () => {
  const {context,data,files}=makeOrderHarness();
  const order=context.createOrder({
    request_key:'request-key-00000005',game_id:'game-1',package_id:'pack-1',
    player_id:'uid-123',server_id:'',coupon_code:''
  });
  const png=Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]);
  const submitted=context.submitOrderSlip({
    order_id:order.order.order_id,
    checkout_token:order.checkout_token,
    slip:{mimeType:'image/png',base64:png.toString('base64')}
  });
  assert.ok(submitted.slip_submitted_at);
  assert.equal(data.orders[0].slip_file_id,'drive-file-1');
  assert.equal(files[0].trashed,false);
  const retry=context.submitOrderSlip({
    order_id:order.order.order_id,checkout_token:order.checkout_token,
    slip:{mimeType:'image/png',base64:png.toString('base64')}
  });
  assert.equal(retry.already_submitted,true);
  assert.equal(retry.slip_submitted_at,submitted.slip_submitted_at);
  assert.equal(files.length,1,'retry must not create another Drive file');
});


test('member-game coupon requires an authenticated member with completed spend in the qualifying game', () => {
  const {context,data,fixedNow}=makeOrderHarness();
  data.members.push({member_id:'member-1',status:'Active'});
  data.orders.push({order_id:'old-order',member_id:'member-1',game_id:'game-1',status:'Completed',total_satang:50000});
  const coupon={
    coupon_id:'member-coupon',code_normalized:'MEMBER',code_display:'MEMBER',
    discount_type:'percent',discount_value:10,access_type:'member_game_spend',
    member_spend_game_id:'game-1',member_min_game_spend_satang:40000,
    allowed_player_ids_json:'["uid-123"]',game_id:'game-1',
    active:true,expires_at:'',min_order_satang:0,usage_limit:''
  };
  const eligible=context.couponEligibility_(coupon,'game-1',10000,'uid-123','member-1',fixedNow);
  assert.equal(eligible.valid,true);
  assert.equal(eligible.discount_satang,1000);
  assert.equal(context.couponEligibility_(coupon,'game-1',10000,'uid-123','',fixedNow).valid,false);
  assert.equal(context.couponEligibility_(coupon,'game-1',10000,'uid-other','member-1',fixedNow).valid,false);
});


test('UID cumulative spend coupon is enforced per game using Completed orders only',()=>{
  const {context,data,fixedNow}=makeOrderHarness();
  data.orders.push(
    {order_id:'uid-completed-1',member_id:'',player_id:'uid-123',game_id:'game-1',status:'Completed',total_satang:30000},
    {order_id:'uid-pending',member_id:'',player_id:'uid-123',game_id:'game-1',status:'Pending',total_satang:50000},
    {order_id:'uid-other-game',member_id:'',player_id:'uid-123',game_id:'game-2',status:'Completed',total_satang:50000}
  );
  const coupon={
    coupon_id:'uid-spend',code_normalized:'UIDSAVE',code_display:'UIDSAVE',
    discount_type:'fixed',discount_value:1000,access_type:'public',
    game_id:'game-1',min_player_spend_satang:25000,
    active:true,expires_at:'',min_order_satang:0,usage_limit:''
  };
  const eligible=context.couponEligibility_(coupon,'game-1',10000,'uid-123','',fixedNow);
  assert.equal(eligible.valid,true);
  coupon.min_player_spend_satang=40000;
  const insufficient=context.couponEligibility_(coupon,'game-1',10000,'uid-123','',fixedNow);
  assert.equal(insufficient.valid,false);
  assert.match(insufficient.error,/ยอดเติมสะสม/);
});

test('coupon expiry rejects impossible calendar dates and remains inclusive through Bangkok day end',()=>{
  const {context}=makeOrderHarness();
  assert.ok(Number.isNaN(context.couponExpiryCutoff_('2026-02-31')));
  assert.equal(context.couponExpiryCutoff_('2026-11-05'),Date.parse('2026-11-05T17:00:00.000Z'));
});


test('slip upload fails closed when the configured Drive folder is shared',()=>{
  const {context,data,files,setFolderAccess}=makeOrderHarness();
  const order=context.createOrder({
    request_key:'request-key-00000006',game_id:'game-1',package_id:'pack-1',
    player_id:'uid-123',server_id:'',coupon_code:''
  });
  setFolderAccess('ANYONE');
  const png=Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]);
  assert.throws(()=>context.submitOrderSlip({
    order_id:order.order.order_id,
    checkout_token:order.checkout_token,
    slip:{mimeType:'image/png',base64:png.toString('base64')}
  }),/DRIVE_FOLDER_NOT_PRIVATE/);
  assert.equal(files.length,0);
  assert.equal(data.orders[0].slip_submitted_at,'');
});


test('checkout derives Member ID from the verified session and rejects caller-supplied identity',()=>{
  const {context,data}=makeOrderHarness();
  data.members.push({member_id:'member-1',status:'Active'});
  const result=context.createOrder({
    request_key:'request-key-00000007',game_id:'game-1',package_id:'pack-1',
    player_id:'uid-123',server_id:'',coupon_code:'',
    member_token:'valid-member-token',member_id:'attacker-controlled-id'
  });
  assert.equal(data.orders[0].member_id,'member-1');
  assert.equal(result.ok,true);
  assert.throws(()=>context.createOrder({
    request_key:'request-key-00000008',game_id:'game-1',package_id:'pack-1',
    player_id:'uid-123',server_id:'',coupon_code:'',
    member_id:'member-1'
  }),/ไม่อนุญาตให้กำหนดรหัสสมาชิก/);
});

test('checkout rejects an expired Member session instead of silently downgrading it to Guest',()=>{
  const {context,data}=makeOrderHarness();
  data.members.push({member_id:'member-1',status:'Active'});
  assert.throws(()=>context.createOrder({
    request_key:'request-key-00000009',game_id:'game-1',package_id:'pack-1',
    player_id:'uid-123',server_id:'',coupon_code:'',
    member_token:'expired-token'
  }),/เซสชันสมาชิกหมดอายุ/);
  assert.equal(data.orders.length,0);
});
