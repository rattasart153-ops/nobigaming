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
    idempotency_records:[],
    order_recovery_journal:[]
  };
  let uuid = 0;
  const files = [];
  let folderAccess = 'PRIVATE';
  let fileAccess = 'PRIVATE';
  let fileParentId = 'private-folder-id';
  let fileMetadataAvailable = true;
  const context = {
    Date:FixedDate,
    NOBI:{MAX_SLIP_BYTES:3*1024*1024,SHEETS:{orders:['order_id','order_number','request_key','member_id','game_id','package_id','player_id','server_id','coupon_id','subtotal_satang','discount_satang','total_satang','slip_file_id','slip_mime_type','slip_size_bytes','slip_submitted_at','checkout_token_hash','status','status_reason','payment_expires_at','created_at','updated_at','completed_at','rejected_at'],coupon_redemptions:['redemption_id','coupon_id','order_id','member_id','player_id','game_id','discount_satang','state','reserved_at','reserved_until','finalized_at','released_at'],idempotency_records:['idempotency_id','scope','request_key','payload_hash','resource_id','state','created_at','expires_at']}},
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
          getId(){return this.id;},setSharing(){},setTrashed(value){this.trashed=value;},
          getEditors:()=>[],getViewers:()=>[],
          getParents(){
            let consumed=false;
            return {hasNext:()=>!consumed,next:()=>{consumed=true;return {getId:()=>fileParentId};}};
          }};
        if(fileMetadataAvailable) file.getSharingAccess=()=>fileAccess;
        files.push(file); return file;
      },getSharingAccess:()=> folderAccess,getEditors:()=>[],getViewers:()=>[]})
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
      const keys={games:'game_id',packages:'package_id',coupons:'coupon_id',members:'member_id',orders:'order_id',coupon_redemptions:'redemption_id',idempotency_records:'idempotency_id',order_recovery_journal:'journal_id'};
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
  for (const file of ['04_Coupons.gs','06_Orders.gs','08_Admin.gs']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname,'..','google-apps-script',file),'utf8'),context,{filename:file});
  }
  context.checkoutTokenForOrder_=(orderId,requestKey)=>'derived-checkout-token.'+orderId+'.'+requestKey;
  return {
    context,data,files,fixedNow,
    setFolderAccess:value=>{folderAccess=value;},
    setFileAccess:value=>{fileAccess=value;},
    setFileParent:value=>{fileParentId=value;},
    setFileMetadataAvailable:value=>{fileMetadataAvailable=value;}
  };
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
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==','base64');
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


test('slip upload preserves the Drive file when the order write committed but its response was lost',()=>{
  const {context,data,files}=makeOrderHarness();
  const created=context.createOrder({
    request_key:'request-key-slip-commit-loss-0001',game_id:'game-1',package_id:'pack-1',
    player_id:'uid-slip-commit-loss',server_id:'',coupon_code:''
  });
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==','base64');
  const payload={
    order_id:created.order.order_id,
    checkout_token:created.checkout_token,
    slip:{mimeType:'image/png',base64:png.toString('base64')}
  };
  const originalUpdate=context.repositoryUpdateLocked_;
  let loseResponse=true;
  context.repositoryUpdateLocked_=(table,id,patch)=>{
    const result=originalUpdate(table,id,patch);
    if(table==='orders'&&patch.slip_submitted_at&&loseResponse){
      loseResponse=false;
      throw new Error('SIMULATED_SLIP_COMMIT_RESPONSE_LOST');
    }
    return result;
  };
  assert.throws(()=>context.submitOrderSlip(payload),/SIMULATED_SLIP_COMMIT_RESPONSE_LOST/);
  assert.equal(data.orders[0].slip_file_id,'drive-file-1');
  assert.equal(data.orders[0].slip_submitted_at!=='',true);
  assert.equal(files.length,1);
  assert.equal(files[0].trashed,false,'a file referenced by a committed order must never be trashed');

  const retry=context.submitOrderSlip(payload);
  assert.equal(retry.already_submitted,true);
  assert.equal(retry.slip_submitted_at,data.orders[0].slip_submitted_at);
  assert.equal(files.length,1,'retry must not create a second Drive file');
  assert.equal(files[0].trashed,false);
});

test('member-game coupon requires an authenticated member with completed spend in the qualifying game', () => {
  const {context,data,fixedNow}=makeOrderHarness();
  data.members.push({member_id:'member-1',status:'Active'});
  data.orders.push({order_id:'old-order',member_id:'member-1',game_id:'game-1',status:'Completed',completed_at:new Date(fixedNow-24*60*60*1000).toISOString(),total_satang:50000});
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


test('coupon eligibility fails closed on malformed thresholds and Completed spend values',()=>{
  const {context,data,fixedNow}=makeOrderHarness();
  data.members.push({member_id:'member-1',status:'Active'});
  const memberCoupon={
    coupon_id:'member-coupon',code_normalized:'MEMBER',code_display:'MEMBER',
    discount_type:'fixed',discount_value:1000,access_type:'member_game_spend',
    member_spend_game_id:'game-1',member_min_game_spend_satang:'not-a-number',
    active:true,expires_at:'',min_order_satang:0,usage_limit:''
  };
  assert.equal(context.couponEligibility_(memberCoupon,'game-1',10000,'uid-123','member-1',fixedNow).valid,false);
  memberCoupon.member_min_game_spend_satang=1000;
  data.orders.push({order_id:'corrupt-member-spend',member_id:'member-1',game_id:'game-1',status:'Completed',total_satang:'corrupt'});
  assert.equal(context.couponEligibility_(memberCoupon,'game-1',10000,'uid-123','member-1',fixedNow).valid,false);

  const uidCoupon={
    coupon_id:'uid-coupon',code_normalized:'UID',code_display:'UID',
    discount_type:'fixed',discount_value:1000,access_type:'public',
    game_id:'game-1',min_player_spend_satang:1000,
    active:true,expires_at:'',min_order_satang:0,usage_limit:''
  };
  data.orders.push({order_id:'corrupt-uid-spend',member_id:'',player_id:'uid-123',game_id:'game-1',status:'Completed',total_satang:'bad'});
  assert.equal(context.couponEligibility_(uidCoupon,'game-1',10000,'uid-123','',fixedNow).valid,false);
  uidCoupon.discount_value=10.5;
  assert.equal(context.couponEligibility_(uidCoupon,'game-1',10000,'uid-123','',fixedNow).valid,false);
});


test('invalid Pending payment deadline expires the order and releases its coupon reservation',()=>{
  const {context,data,fixedNow}=makeOrderHarness();
  data.coupons.push({
    coupon_id:'coupon-invalid-deadline',code_normalized:'SAVE',code_display:'SAVE',
    discount_type:'fixed',discount_value:1000,access_type:'public',active:true,
    expires_at:'',min_order_satang:0,usage_limit:1,game_id:''
  });
  context.createOrder({
    request_key:'request-key-invalid-deadline',game_id:'game-1',package_id:'pack-1',
    player_id:'uid-123',server_id:'',coupon_code:'SAVE'
  });
  data.orders[0].payment_expires_at='not-a-date';
  context.expirePendingOrdersLocked_(fixedNow+16*60*1000);
  assert.equal(data.orders[0].status,'Expired');
  assert.equal(data.coupon_redemptions[0].state,'Released');
});


test('checkout rejects an existing idempotency record with an invalid expiry timestamp',()=>{
  const {context,data}=makeOrderHarness();
  const payload={request_key:'request-key-invalid-idem',game_id:'game-1',package_id:'pack-1',player_id:'uid-123',server_id:'',coupon_code:''};
  context.createOrder(payload);
  data.idempotency_records[0].expires_at='invalid';
  assert.throws(()=>context.createOrder(payload),/IDEMPOTENCY_RECORD_INVALID/);
});


test('UID cumulative spend coupon is enforced per game using Completed orders only',()=>{
  const {context,data,fixedNow}=makeOrderHarness();
  data.orders.push(
    {order_id:'uid-completed-1',member_id:'',player_id:'uid-123',game_id:'game-1',status:'Completed',total_satang:30000},
    {order_id:'uid-member-completed',member_id:'member-2',player_id:'uid-123',game_id:'game-1',status:'Completed',total_satang:10000},
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
  coupon.min_player_spend_satang=50000;
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
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==','base64');
  assert.throws(()=>context.submitOrderSlip({
    order_id:order.order.order_id,
    checkout_token:order.checkout_token,
    slip:{mimeType:'image/png',base64:png.toString('base64')}
  }),/DRIVE_FOLDER_NOT_PRIVATE/);
  assert.equal(files.length,0);
  assert.equal(data.orders[0].slip_submitted_at,'');
});



test('slip upload fails closed and trashes a file whose sharing access is not private',()=>{
  const {context,data,files,setFileAccess}=makeOrderHarness();
  const order=context.createOrder({
    request_key:'request-key-drive-shared-file-01',game_id:'game-1',package_id:'pack-1',
    player_id:'uid-123',server_id:'',coupon_code:''
  });
  setFileAccess('ANYONE');
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==','base64');
  assert.throws(()=>context.submitOrderSlip({
    order_id:order.order.order_id,
    checkout_token:order.checkout_token,
    slip:{mimeType:'image/png',base64:png.toString('base64')}
  }),/DRIVE_FILE_NOT_PRIVATE/);
  assert.equal(files.length,1);
  assert.equal(files[0].trashed,true);
  assert.equal(data.orders[0].slip_file_id,'');
  assert.equal(data.orders[0].slip_submitted_at,'');
});

test('slip upload fails closed when Drive cannot verify file sharing metadata',()=>{
  const {context,data,files,setFileMetadataAvailable}=makeOrderHarness();
  const order=context.createOrder({
    request_key:'request-key-drive-no-metadata-01',game_id:'game-1',package_id:'pack-1',
    player_id:'uid-123',server_id:'',coupon_code:''
  });
  setFileMetadataAvailable(false);
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==','base64');
  assert.throws(()=>context.submitOrderSlip({
    order_id:order.order.order_id,
    checkout_token:order.checkout_token,
    slip:{mimeType:'image/png',base64:png.toString('base64')}
  }),/DRIVE_FOLDER_INVALID/);
  assert.equal(files.length,1);
  assert.equal(files[0].trashed,true);
  assert.equal(data.orders[0].slip_file_id,'');
});

test('slip upload rejects a file stored outside the configured private folder',()=>{
  const {context,data,files,setFileParent}=makeOrderHarness();
  const order=context.createOrder({
    request_key:'request-key-drive-wrong-parent-01',game_id:'game-1',package_id:'pack-1',
    player_id:'uid-123',server_id:'',coupon_code:''
  });
  setFileParent('unexpected-folder');
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==','base64');
  assert.throws(()=>context.submitOrderSlip({
    order_id:order.order.order_id,
    checkout_token:order.checkout_token,
    slip:{mimeType:'image/png',base64:png.toString('base64')}
  }),/DRIVE_FILE_OUTSIDE_PRIVATE_FOLDER/);
  assert.equal(files.length,1);
  assert.equal(files[0].trashed,true);
  assert.equal(data.orders[0].slip_file_id,'');
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


test('recovery journal completes expiry after a transient coupon write failure', () => {
  const {context,data,fixedNow}=makeOrderHarness();
  data.coupons.push({
    coupon_id:'coupon-recovery',code_normalized:'RECOVER',code_display:'RECOVER',
    discount_type:'fixed',discount_value:1000,access_type:'public',active:true,
    expires_at:'',min_order_satang:0,usage_limit:1,game_id:''
  });
  const created=context.createOrder({
    request_key:'request-key-recovery-01',game_id:'game-1',package_id:'pack-1',
    player_id:'uid-recovery',server_id:'',coupon_code:'RECOVER'
  });
  const originalUpdate=context.repositoryUpdateLocked_;
  let failOnce=true;
  context.repositoryUpdateLocked_=(table,id,patch)=>{
    if(table==='coupon_redemptions'&&failOnce){failOnce=false;throw new Error('SIMULATED_SHEETS_WRITE_FAILURE');}
    return originalUpdate(table,id,patch);
  };
  assert.throws(()=>context.expirePendingOrdersLocked_(fixedNow+16*60*1000),/SIMULATED_SHEETS_WRITE_FAILURE/);
  assert.equal(data.orders[0].status,'Pending');
  assert.equal(data.coupon_redemptions[0].state,'Reserved');
  assert.equal(data.order_recovery_journal.find(x=>x.order_id===created.order.order_id&&x.operation==='TRANSITION').state,'Pending');
  context.expirePendingOrdersLocked_(fixedNow+16*60*1000);
  assert.equal(data.orders[0].status,'Expired');
  assert.equal(data.coupon_redemptions[0].state,'Released');
  assert.equal(data.order_recovery_journal.find(x=>x.order_id===created.order.order_id&&x.operation==='TRANSITION').state,'Completed');
});

test('recovery journal idempotently finalizes Completed and Rejected order/coupon pairs', () => {
  const {context,data}=makeOrderHarness();
  const now='2026-11-05T04:20:00.000Z';
  for(const status of ['Completed','Rejected']) {
    const id='order-'+status.toLowerCase();
    data.orders.push({
      order_id:id,coupon_id:'coupon-'+status.toLowerCase(),status:'Pending',slip_submitted_at:'2026-11-05T04:10:00.000Z',
      payment_expires_at:'2026-11-05T04:30:00.000Z',updated_at:now
    });
    data.coupon_redemptions.push({
      redemption_id:'redemption-'+status.toLowerCase(),order_id:id,coupon_id:'coupon-'+status.toLowerCase(),state:'Reserved'
    });
    const patch=status==='Completed'
      ? {status:'Completed',completed_at:now,updated_at:now}
      : {status:'Rejected',rejected_at:now,status_reason:'ADMIN_REJECTED',updated_at:now};
    const redemptionPatch=status==='Completed'
      ? {state:'Consumed',finalized_at:now}
      : {state:'Released',released_at:now};
    const journal=context.createOrderRecoveryJournalLocked_({
      order_id:id,operation:'TRANSITION',order_patch:patch,
      redemption_id:'redemption-'+status.toLowerCase(),
      redemption_patch:redemptionPatch,created_at:now
    });
    context.applyOrderRecoveryJournalLocked_(journal);
    context.applyOrderRecoveryJournalLocked_(journal);
    assert.equal(context.repositoryGetById_('orders',id).status,status);
    assert.equal(context.repositoryGetById_('coupon_redemptions','redemption-'+status.toLowerCase()).state,
      status==='Completed'?'Consumed':'Released');
    assert.equal(data.order_recovery_journal.filter(x=>x.order_id===id&&x.state==='Completed').length,1);
  }
});


test('checkout retry recovers a partially persisted order before returning the original idempotent order', () => {
  const {context,data}=makeOrderHarness();
  data.coupons.push({
    coupon_id:'coupon-create-recovery',code_normalized:'CREATEFIX',code_display:'CREATEFIX',
    discount_type:'fixed',discount_value:1000,access_type:'public',active:true,
    expires_at:'',min_order_satang:0,usage_limit:1,game_id:''
  });
  const payload={
    request_key:'request-key-create-recovery',game_id:'game-1',package_id:'pack-1',
    player_id:'uid-create-recovery',server_id:'',coupon_code:'CREATEFIX'
  };
  const originalInsert=context.repositoryInsertLocked_;
  let failOnce=true;
  context.repositoryInsertLocked_=(table,record)=>{
    if(table==='coupon_redemptions'&&failOnce){failOnce=false;throw new Error('SIMULATED_REDEMPTION_INSERT_FAILURE');}
    return originalInsert(table,record);
  };
  assert.throws(()=>context.createOrder(payload),/SIMULATED_REDEMPTION_INSERT_FAILURE/);
  assert.equal(data.orders.length,1);
  assert.equal(data.coupon_redemptions.length,0);
  const partiallyCreatedOrderId=data.orders[0].order_id;
  assert.equal(data.order_recovery_journal.find(x=>x.order_id===partiallyCreatedOrderId&&x.operation==='CREATE').state,'Pending');

  const retry=context.createOrder(payload);
  assert.equal(retry.duplicate,true);
  assert.equal(retry.order.order_id,data.orders[0].order_id);
  assert.equal(data.coupon_redemptions.length,1);
  assert.equal(data.idempotency_records.length,1);
  assert.equal(data.order_recovery_journal.find(x=>x.order_id===partiallyCreatedOrderId&&x.operation==='CREATE').state,'Completed');
});


test('CREATE recovery retries each primary write failure without duplicating order, redemption or idempotency rows', () => {
  for (const failedTable of ['orders','coupon_redemptions','idempotency_records']) {
    const {context,data}=makeOrderHarness();
    data.coupons.push({
      coupon_id:'coupon-'+failedTable,code_normalized:'SAVE'+failedTable,code_display:'SAVE',
      discount_type:'fixed',discount_value:1000,access_type:'public',active:true,
      expires_at:'',min_order_satang:0,usage_limit:1,game_id:''
    });
    const payload={
      request_key:'request-key-'+failedTable+'-0001',game_id:'game-1',package_id:'pack-1',
      player_id:'uid-'+failedTable,server_id:'',coupon_code:'SAVE'+failedTable
    };
    const originalInsert=context.repositoryInsertLocked_;
    let failOnce=true;
    context.repositoryInsertLocked_=(table,record)=>{
      if(table===failedTable&&failOnce){failOnce=false;throw new Error('SIMULATED_'+failedTable.toUpperCase()+'_WRITE');}
      return originalInsert(table,record);
    };
    assert.throws(()=>context.createOrder(payload),new RegExp('SIMULATED_'+failedTable.toUpperCase()+'_WRITE'));
    assert.equal(data.order_recovery_journal.length,1);
    assert.equal(data.order_recovery_journal[0].state,'Pending');
    context.repositoryInsertLocked_=originalInsert;
    context.recoverPendingOrderJournalsLocked_();
    context.recoverPendingOrderJournalsLocked_();
    assert.equal(data.orders.length,1,failedTable+' recovery must create one order');
    assert.equal(data.coupon_redemptions.length,1,failedTable+' recovery must create one redemption');
    assert.equal(data.idempotency_records.length,1,failedTable+' recovery must create one idempotency record');
    assert.equal(data.order_recovery_journal[0].state,'Completed');
  }
});

test('CREATE stops before business writes when the write-ahead journal cannot be persisted', () => {
  const {context,data}=makeOrderHarness();
  const originalInsert=context.repositoryInsertLocked_;
  context.repositoryInsertLocked_=(table,record)=>{
    if(table==='order_recovery_journal') throw new Error('SIMULATED_JOURNAL_INSERT_FAILURE');
    return originalInsert(table,record);
  };
  assert.throws(()=>context.createOrder({
    request_key:'request-key-journal-fail-0001',game_id:'game-1',package_id:'pack-1',
    player_id:'uid-journal-fail',server_id:'',coupon_code:''
  }),/SIMULATED_JOURNAL_INSERT_FAILURE/);
  assert.equal(data.orders.length,0);
  assert.equal(data.idempotency_records.length,0);
  assert.equal(data.coupon_redemptions.length,0);
  assert.equal(data.order_recovery_journal.length,0);
});

test('TRANSITION recovery retries redemption, order and journal-finalization write failures', () => {
  for (const failedPoint of ['coupon_redemptions','orders','journal_complete']) {
    const {context,data}=makeOrderHarness();
    const now='2026-11-05T04:20:00.000Z';
    const orderId='order-transition-'+failedPoint;
    data.orders.push({order_id:orderId,coupon_id:'coupon-'+failedPoint,status:'Pending',slip_submitted_at:'2026-11-05T04:10:00.000Z',payment_expires_at:'2026-11-05T04:30:00.000Z',updated_at:now});
    data.coupon_redemptions.push({
      redemption_id:'redemption-'+failedPoint,order_id:orderId,coupon_id:'coupon-'+failedPoint,state:'Reserved'
    });
    const journal=context.createOrderRecoveryJournalLocked_({
      order_id:orderId,operation:'TRANSITION',
      order_patch:{status:'Completed',completed_at:now,updated_at:now},
      redemption_id:'redemption-'+failedPoint,
      redemption_patch:{state:'Consumed',finalized_at:now},
      created_at:now
    });
    const originalUpdate=context.repositoryUpdateLocked_;
    let failOnce=true;
    context.repositoryUpdateLocked_=(table,id,patch)=>{
      const shouldFail=failedPoint==='journal_complete'
        ? table==='order_recovery_journal'&&patch.state==='Completed'
        : table===failedPoint;
      if(shouldFail&&failOnce){failOnce=false;throw new Error('SIMULATED_'+failedPoint.toUpperCase()+'_UPDATE');}
      return originalUpdate(table,id,patch);
    };
    assert.throws(()=>context.applyOrderRecoveryJournalLocked_(journal),/SIMULATED_/);
    context.repositoryUpdateLocked_=originalUpdate;
    assert.equal(journal.state,'Pending');
    context.applyOrderRecoveryJournalLocked_(data.order_recovery_journal[0]);
    context.applyOrderRecoveryJournalLocked_(data.order_recovery_journal[0]);
    assert.equal(context.repositoryGetById_('orders',orderId).status,'Completed');
    assert.equal(context.repositoryGetById_('coupon_redemptions','redemption-'+failedPoint).state,'Consumed');
    assert.equal(data.order_recovery_journal[0].state,'Completed');
  }
});

test('TRANSITION recovery remains pending and fail-closed when its referenced redemption is missing', () => {
  const {context,data}=makeOrderHarness();
  data.orders.push({order_id:'order-missing-redemption',coupon_id:'coupon-missing',status:'Pending'});
  data.coupon_redemptions.push({redemption_id:'redemption-other-id',order_id:'order-missing-redemption',coupon_id:'coupon-missing',state:'Reserved'});
  const journal=context.createOrderRecoveryJournalLocked_({
    order_id:'order-missing-redemption',operation:'TRANSITION',
    order_patch:{status:'Rejected',rejected_at:'2026-11-05T04:30:00.000Z',status_reason:'ADMIN_REJECTED',updated_at:'2026-11-05T04:30:00.000Z'},
    redemption_id:'redemption-does-not-exist',
    redemption_patch:{state:'Released'},
    created_at:'2026-11-05T04:30:00.000Z'
  });
  assert.throws(()=>context.applyOrderRecoveryJournalLocked_(journal),/RECOVERY_REDEMPTION_NOT_FOUND/);
  assert.equal(context.repositoryGetById_('orders','order-missing-redemption').status,'Pending');
  assert.equal(data.order_recovery_journal[0].state,'Pending');
});

test('CREATE recovery rejects an existing order whose immutable payload conflicts with the journal', () => {
  const {context,data}=makeOrderHarness();
  const order={
    order_id:'order-conflict',order_number:'NBI-CONFLICT',request_key:'request-key-conflict-0001',member_id:'',
    game_id:'game-1',package_id:'pack-1',player_id:'uid-expected',server_id:'',
    coupon_id:'',subtotal_satang:10000,discount_satang:0,total_satang:10000,
    slip_file_id:'',slip_mime_type:'',slip_size_bytes:0,slip_submitted_at:'',
    checkout_token_hash:'a'.repeat(64),status:'Pending',status_reason:'',
    payment_expires_at:'2026-11-05T04:15:00.000Z',created_at:'2026-11-05T04:00:00.000Z',
    updated_at:'2026-11-05T04:00:00.000Z',completed_at:'',rejected_at:''
  };
  data.orders.push({...order,player_id:'uid-attacker'});
  const journal=context.createOrderRecoveryJournalLocked_({
    order_id:order.order_id,operation:'CREATE',order_record:order,
    idempotency_record:{
      idempotency_id:'idem-conflict',scope:'create_order',request_key:order.request_key,
      payload_hash:'a'.repeat(64),resource_id:order.order_id,state:'Completed',
      created_at:'2026-11-05T04:00:00.000Z',expires_at:'2027-02-03T04:00:00.000Z'
    },
    created_at:'2026-11-05T04:00:00.000Z'
  });
  assert.throws(()=>context.applyOrderRecoveryJournalLocked_(journal),/RECOVERY_ORDER_CONFLICT/);
  assert.equal(data.idempotency_records.length,0);
  assert.equal(data.order_recovery_journal[0].state,'Pending');
});

test('replayed same-key checkout requests preserve one order in the single-thread harness', async () => {
  const {context,data}=makeOrderHarness();
  const payload={
    request_key:'request-key-replay-serialized-01',game_id:'game-1',package_id:'pack-1',
    player_id:'uid-replay',server_id:'',coupon_code:''
  };
  const results=await Promise.all([
    Promise.resolve().then(()=>context.createOrder(payload)),
    Promise.resolve().then(()=>context.createOrder(payload)),
    Promise.resolve().then(()=>context.createOrder(payload))
  ]);
  assert.equal(data.orders.length,1);
  assert.equal(data.idempotency_records.length,1);
  assert.equal(results.filter(result=>result.duplicate).length,2);
});


test('TRANSITION recovery refuses to mutate a coupon redemption belonging to another order',()=>{
  const {context,data}=makeOrderHarness();
  data.orders.push({order_id:'order-expected',coupon_id:'coupon-1',status:'Pending'});
  data.coupon_redemptions.push(
    {redemption_id:'redemption-expected',order_id:'order-expected',coupon_id:'coupon-1',state:'Reserved'},
    {redemption_id:'redemption-wrong-order',order_id:'order-other',coupon_id:'coupon-1',state:'Reserved'}
  );
  const journal=context.createOrderRecoveryJournalLocked_({
    order_id:'order-expected',operation:'TRANSITION',
    order_patch:{status:'Rejected',rejected_at:'2026-11-05T04:40:00.000Z',status_reason:'ADMIN_REJECTED',updated_at:'2026-11-05T04:40:00.000Z'},
    redemption_id:'redemption-wrong-order',
    redemption_patch:{state:'Released',released_at:'2026-11-05T04:40:00.000Z'},
    created_at:'2026-11-05T04:40:00.000Z'
  });
  assert.throws(()=>context.applyOrderRecoveryJournalLocked_(journal),/RECOVERY_REDEMPTION_ORDER_MISMATCH/);
  assert.equal(context.repositoryGetById_('orders','order-expected').status,'Pending');
  assert.equal(context.repositoryGetById_('coupon_redemptions','redemption-expected').state,'Reserved');
  assert.equal(context.repositoryGetById_('coupon_redemptions','redemption-wrong-order').state,'Reserved');
  assert.equal(data.order_recovery_journal[0].state,'Pending');
});


test('CREATE recovery rejects a missing idempotency payload before inserting the order',()=>{
  const {context,data}=makeOrderHarness();
  const order={
    order_id:'order-no-idem',order_number:'NBI-NO-IDEM',request_key:'request-key-no-idem-0001',
    member_id:'',game_id:'game-1',package_id:'pack-1',player_id:'uid-no-idem',server_id:'',
    coupon_id:'',subtotal_satang:10000,discount_satang:0,total_satang:10000,
    slip_file_id:'',slip_mime_type:'',slip_size_bytes:0,slip_submitted_at:'',
    checkout_token_hash:'b'.repeat(64),status:'Pending',status_reason:'',
    payment_expires_at:'2026-11-05T04:15:00.000Z',created_at:'2026-11-05T04:00:00.000Z',
    updated_at:'2026-11-05T04:00:00.000Z',completed_at:'',rejected_at:''
  };
  const journal=context.createOrderRecoveryJournalLocked_({
    order_id:order.order_id,operation:'CREATE',order_record:order,
    created_at:order.created_at
  });
  assert.throws(()=>context.applyOrderRecoveryJournalLocked_(journal),/RECOVERY_IDEMPOTENCY_PAYLOAD_INVALID/);
  assert.equal(data.orders.length,0);
  assert.equal(data.order_recovery_journal[0].state,'Pending');
});

test('TRANSITION recovery rejects unsupported status and unexpected patch fields',()=>{
  const {context,data}=makeOrderHarness();
  data.orders.push({order_id:'order-invalid-transition',coupon_id:'',status:'Pending'});
  const journal=context.createOrderRecoveryJournalLocked_({
    order_id:'order-invalid-transition',operation:'TRANSITION',
    order_patch:{status:'Cancelled',updated_at:'2026-11-05T04:40:00.000Z',admin_override:true},
    created_at:'2026-11-05T04:40:00.000Z'
  });
  assert.throws(()=>context.applyOrderRecoveryJournalLocked_(journal),/RECOVERY_TRANSITION_PAYLOAD_INVALID/);
  assert.equal(context.repositoryGetById_('orders','order-invalid-transition').status,'Pending');
  assert.equal(data.order_recovery_journal[0].state,'Pending');
});


test('TRANSITION recovery rejects attempts to mutate immutable redemption fields',()=>{
  const {context,data}=makeOrderHarness();
  data.orders.push({order_id:'order-redemption-patch',coupon_id:'coupon-locked',status:'Pending'});
  data.coupon_redemptions.push({
    redemption_id:'redemption-locked',order_id:'order-redemption-patch',
    coupon_id:'coupon-locked',state:'Reserved'
  });
  const journal=context.createOrderRecoveryJournalLocked_({
    order_id:'order-redemption-patch',operation:'TRANSITION',
    order_patch:{status:'Rejected',rejected_at:'2026-11-05T04:40:00.000Z',status_reason:'ADMIN_REJECTED',updated_at:'2026-11-05T04:40:00.000Z'},
    redemption_id:'redemption-locked',
    redemption_patch:{state:'Released',released_at:'2026-11-05T04:40:00.000Z',coupon_id:'attacker-coupon'},
    created_at:'2026-11-05T04:40:00.000Z'
  });
  assert.throws(()=>context.applyOrderRecoveryJournalLocked_(journal),/RECOVERY_REDEMPTION_TRANSITION_INVALID/);
  assert.equal(data.coupon_redemptions[0].coupon_id,'coupon-locked');
  assert.equal(data.coupon_redemptions[0].state,'Reserved');
  assert.equal(data.orders[0].status,'Pending');
});


test('recovery does not reopen a journal when finalization committed but the write response failed',()=>{
  const {context,data}=makeOrderHarness();
  data.orders.push({order_id:'order-uncertain-finalize',coupon_id:'',status:'Pending'});
  const journal=context.createOrderRecoveryJournalLocked_({
    order_id:'order-uncertain-finalize',operation:'TRANSITION',
    order_patch:{status:'Rejected',rejected_at:'2026-11-05T04:40:00.000Z',status_reason:'ADMIN_REJECTED',updated_at:'2026-11-05T04:40:00.000Z'},
    created_at:'2026-11-05T04:40:00.000Z'
  });
  const originalUpdate=context.repositoryUpdateLocked_;
  context.repositoryUpdateLocked_=(table,id,patch)=>{
    const result=originalUpdate(table,id,patch);
    if(table==='order_recovery_journal'&&patch.state==='Completed') {
      throw new Error('SIMULATED_RESPONSE_LOST_AFTER_COMMIT');
    }
    return result;
  };
  assert.throws(()=>context.applyOrderRecoveryJournalLocked_(journal),/SIMULATED_RESPONSE_LOST_AFTER_COMMIT/);
  assert.equal(data.orders[0].status,'Rejected');
  assert.equal(data.order_recovery_journal[0].state,'Completed');
  assert.equal(data.order_recovery_journal[0].order_patch_json,'');
});


test('checkout holds ScriptLock across recovery journal and all primary record writes',()=>{
  const {context}=makeOrderHarness();
  let held=false,acquired=0,released=0;
  context.LockService.getScriptLock=()=>({
    waitLock(){if(held) throw new Error('LOCK_REENTRY');held=true;acquired++;},
    releaseLock(){held=false;released++;}
  });
  const originalInsert=context.repositoryInsertLocked_;
  context.repositoryInsertLocked_=(table,record)=>{
    assert.equal(held,true,'all business writes must occur while ScriptLock is held');
    return originalInsert(table,record);
  };
  context.createOrder({
    request_key:'request-key-lock-assert-0001',game_id:'game-1',package_id:'pack-1',
    player_id:'uid-lock',server_id:'',coupon_code:''
  });
  assert.equal(acquired,1);
  assert.equal(released,1);
  assert.equal(held,false);
});
