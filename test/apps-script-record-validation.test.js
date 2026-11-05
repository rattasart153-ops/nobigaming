'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = vm.createContext({URL});
for (const file of ['04_Coupons.gs','09_Validation.gs']) {
  vm.runInContext(
    fs.readFileSync(path.join(__dirname,'..','google-apps-script',file),'utf8'),
    context,
    {filename:file}
  );
}

test('promotion editor default anchor and safe internal paths are accepted',()=>{
  assert.doesNotThrow(()=>context.validateRecord_('promotions',{title:'Sale',link_url:'#games'}));
  assert.doesNotThrow(()=>context.validateRecord_('promotions',{title:'Sale',link_url:'/promotions/summer'}));
  assert.doesNotThrow(()=>context.validateRecord_('promotions',{title:'Sale',link_url:'https://example.com/sale'}));
});

test('promotion links reject protocol-relative and unsafe schemes',()=>{
  assert.throws(()=>context.validateRecord_('promotions',{title:'Sale',link_url:'//evil.example/path'}),/ลิงก์โปรโมชันไม่ถูกต้อง/);
  assert.throws(()=>context.validateRecord_('promotions',{title:'Sale',link_url:'javascript:alert(1)'}),/ลิงก์โปรโมชันไม่ถูกต้อง/);
});

test('catalog images must use the private media proxy',()=>{
  assert.doesNotThrow(()=>context.validateRecord_('packages',{
    game_id:'g1',name:'Pack',amount:10,unit:'Coins',price_satang:1000,
    image_url:'/api/public/media/Abcdefghijk123456'
  }));
  assert.throws(()=>context.validateRecord_('packages',{
    game_id:'g1',name:'Pack',amount:10,unit:'Coins',price_satang:1000,
    image_url:'https://example.com/image.png'
  }),/รูปภาพต้องอัปโหลดผ่านระบบจัดเก็บส่วนตัว/);
});

test('coupon UID spend requires a game and valid expiry/usage limit values',()=>{
  assert.throws(()=>context.validateRecord_('coupons',{
    code_normalized:'SAVE',discount_type:'fixed',discount_value:1000,
    access_type:'public',min_player_spend_satang:1000
  }),/ต้องเลือกเกม/);
  assert.throws(()=>context.validateRecord_('coupons',{
    code_normalized:'SAVE',discount_type:'fixed',discount_value:1000,
    access_type:'public',expires_at:'2026-02-31'
  }),/วันหมดอายุคูปองไม่ถูกต้อง/);
  assert.throws(()=>context.validateRecord_('coupons',{
    code_normalized:'SAVE',discount_type:'fixed',discount_value:1000,
    access_type:'public',usage_limit:0
  }),/จำนวนสิทธิ์คูปอง/);
});


test('money thresholds use integer satang and promotion time ranges must be valid',()=>{
  assert.throws(()=>context.validateRecord_('packages',{
    game_id:'g1',name:'Pack',amount:10,unit:'Coins',price_satang:10.5
  }),/ข้อมูลแพ็กเกจไม่ถูกต้อง/);
  assert.throws(()=>context.validateRecord_('coupons',{
    code_normalized:'SAVE',discount_type:'fixed',discount_value:10.5,
    access_type:'public'
  }),/ข้อมูลส่วนลดไม่ถูกต้อง/);
  assert.throws(()=>context.validateRecord_('promotions',{
    title:'Sale',starts_at:'2026-11-06T00:00:00.000Z',ends_at:'2026-11-05T00:00:00.000Z'
  }),/ช่วงเวลาโปรโมชั่นไม่ถูกต้อง/);
});
