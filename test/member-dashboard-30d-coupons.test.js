'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function makeContext() {
  const now = Date.parse('2026-11-12T03:00:00.000Z');
  const RealDate = Date;
  class FixedDate extends RealDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  FixedDate.parse = RealDate.parse;
  FixedDate.UTC = RealDate.UTC;
  const data = {
    orders:[], coupons:[], coupon_redemptions:[], member_coupon_alerts:[],
    games:[{game_id:'g1',name:'RoV'},{game_id:'g2',name:'Free Fire'}],
    members:[{member_id:'m1',full_name:'Member One',login_id_display:'member1',status:'Active'}]
  };
  let id = 0;
  const context = {
    Date:FixedDate, NOBI:{},
    NOBI_MEMBER_SPEND_WINDOW_MS:30*24*60*60*1000,
    LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
    Utilities:{getUuid:()=>String(++id)},
    requireMember_:()=>data.members[0],
    expirePendingOrders_:()=>{},
    repositoryRows_:name=>data[name]||[],
    repositoryFindByField_:(name,field,value)=>(data[name]||[]).filter(row=>String(row[field])===String(value)),
    repositoryGetById_:(name,key)=>(data[name]||[]).find(row=>String(row[{games:'game_id',members:'member_id'}[name]])===String(key))||null,
    repositoryInsertLocked_:(name,row)=>{data[name].push({...row});return row;},
    repositoryUpdateLocked_:(name,key,patch)=>{const row=(data[name]||[]).find(x=>x.alert_id===key);if(!row)throw Error('missing');Object.assign(row,patch);return row;},
    truth_:v=>v===true||v===1||String(v).toLowerCase()==='true',
    money_:v=>Number(v).toFixed(2),
    couponExpiryCutoff_:()=>NaN
  };
  vm.createContext(context);
  for(const file of ['04_Coupons.gs','15_MemberDashboard.gs']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname,'..','google-apps-script',file),'utf8'),context,{filename:file});
  }
  return {context,data,now};
}

test('member spend counts only own Completed orders within the rolling 30-day window',()=>{
  const {context,data,now}=makeContext();
  const inside=new Date(now-29*24*60*60*1000).toISOString();
  const outside=new Date(now-30*24*60*60*1000-1).toISOString();
  data.orders.push(
    {member_id:'m1',game_id:'g1',status:'Completed',completed_at:inside,total_satang:7500},
    {member_id:'m1',game_id:'g2',status:'Completed',completed_at:inside,total_satang:2500},
    {member_id:'m1',game_id:'g1',status:'Completed',completed_at:outside,total_satang:99000},
    {member_id:'m1',game_id:'g1',status:'Pending',completed_at:inside,total_satang:50000},
    {member_id:'guest',game_id:'g1',status:'Completed',completed_at:inside,total_satang:50000}
  );
  const result=context.memberSpendSummary_('m1',now);
  assert.equal(result.total_satang,10000);
  assert.equal(result.by_game.g1,7500);
  assert.equal(result.by_game.g2,2500);
});

test('member dashboard emits 75%, 80%, and 90% alerts once as progress crosses each stage',()=>{
  const {context,data,now}=makeContext();
  data.coupons.push({coupon_id:'c1',code_display:'ROV100',active:true,access_type:'member_game_spend',member_spend_game_id:'g1',member_min_game_spend_satang:10000});
  data.orders.push({member_id:'m1',game_id:'g1',status:'Completed',completed_at:new Date(now-1000).toISOString(),total_satang:7500});
  let result=context.memberDashboard('token');
  assert.deepEqual(Array.from(result.alerts,x=>x.stage),[75]);
  data.orders[0].total_satang=8000;
  result=context.memberDashboard('token');
  assert.deepEqual(Array.from(result.alerts,x=>x.stage),[80]);
  data.orders[0].total_satang=9000;
  result=context.memberDashboard('token');
  assert.deepEqual(Array.from(result.alerts,x=>x.stage),[90]);
  result=context.memberDashboard('token');
  assert.equal(result.alerts.length,0);
});

test('member total-spend coupon progress aggregates multiple games in the same 30-day window',()=>{
  const {context,data,now}=makeContext();
  data.coupons.push({coupon_id:'c2',code_display:'TOTAL200',active:true,access_type:'member_total_spend',member_min_game_spend_satang:20000});
  data.orders.push(
    {member_id:'m1',game_id:'g1',status:'Completed',completed_at:new Date(now-1000).toISOString(),total_satang:12000},
    {member_id:'m1',game_id:'g2',status:'Completed',completed_at:new Date(now-2000).toISOString(),total_satang:8000}
  );
  const result=context.memberDashboard('token');
  assert.equal(result.total_satang,20000);
  assert.equal(result.coupons[0].scope,'total');
  assert.equal(result.coupons[0].unlocked,true);
});

test('coupon eligibility enforces rolling 30-day member spend, not lifetime spend',()=>{
  const {context,data,now}=makeContext();
  const inside=new Date(now-5*24*60*60*1000).toISOString();
  const outside=new Date(now-31*24*60*60*1000).toISOString();
  data.orders.push(
    {member_id:'m1',game_id:'g1',status:'Completed',completed_at:inside,total_satang:5000},
    {member_id:'m1',game_id:'g1',status:'Completed',completed_at:outside,total_satang:50000}
  );
  const coupon={coupon_id:'c3',code_display:'ROV100',active:true,access_type:'member_game_spend',member_spend_game_id:'g1',member_min_game_spend_satang:10000,discount_type:'fixed',discount_value:1000,min_order_satang:0,usage_limit:'',expires_at:''};
  const result=context.couponEligibility_(coupon,'g1',5000,'uid','m1',now);
  assert.equal(result.valid,false);
  assert.match(result.error,/30 วัน/);
});

test('member page, RPC facade, coupon Admin fields, and alert ledger are wired',()=>{
  const root=path.join(__dirname,'..','google-apps-script');
  const code=fs.readFileSync(path.join(root,'Code.gs'),'utf8');
  const member=fs.readFileSync(path.join(root,'Member.html'),'utf8');
  const facade=fs.readFileSync(path.join(root,'BrowserFacade.gs'),'utf8');
  const gateway=fs.readFileSync(path.join(root,'01_HttpEntry.gs'),'utf8');
  const admin=fs.readFileSync(path.join(root,'Admin.html'),'utf8');
  const config=fs.readFileSync(path.join(root,'00_Config.gs'),'utf8');
  assert.match(code,/pathInfo === 'member'/);
  assert.match(member,/id="orderForm"/);
  assert.match(member,/id="ordersTable"/);
  assert.match(member,/nobiCreateOrder/);
  assert.match(member,/nobiSubmitOrderSlip/);
  assert.match(facade,/function nobiGetMemberDashboard/);
  assert.match(facade,/function nobiGetMemberOrders/);
  assert.match(gateway,/case 'memberDashboard'/);
  assert.match(gateway,/case 'memberOrders'/);
  assert.match(admin,/member_total_spend/);
  assert.match(admin,/ยอดซื้อสะสมย้อนหลัง 30 วัน/);
  assert.match(config,/member_coupon_alerts/);
  assert.match(config,/SCHEMA_VERSION: 4/);
});
