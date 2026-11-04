'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const PAYMENT_WINDOW_MS = 15 * 60 * 1000;

function couponExpiryCutoff(expiresAt) {
  const m = String(expiresAt || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2])-1, Number(m[3])+1) - 7*60*60*1000) : null;
}
function safeUnlink(file) { if (file && file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path); }

function createOrderService({ db, validateCoupon }) {
  function releaseReservation(orderId, at) {
    const row=db.prepare("SELECT coupon_id FROM coupon_redemptions WHERE order_id=? AND state='Reserved'").get(orderId);
    if(!row) return false;
    const changed=db.prepare("UPDATE coupon_redemptions SET state='Released',released_at=? WHERE order_id=? AND state='Reserved'").run(at,orderId).changes;
    if(changed) db.prepare('UPDATE coupons SET used_count=MAX(0,used_count-1) WHERE id=?').run(row.coupon_id);
    return Boolean(changed);
  }
  function createPendingOrder({game,pack,playerId,serverId='',couponCode='',file=null,memberId=null,idempotencyKey,requestHash}) {
    const keyHash=crypto.createHash('sha256').update(String(idempotencyKey || '')).digest('hex');
    const id=`NBI-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
    const checkoutToken=crypto.randomBytes(32).toString('base64url');
    const checkoutTokenHash=crypto.createHash('sha256').update(checkoutToken).digest('hex');
    const createdAt=new Date();
    const tx=db.transaction(()=>{
      const prior=db.prepare('SELECT request_hash,order_id FROM idempotency_records WHERE key_hash=?').get(keyHash);
      if(prior){
        if(prior.request_hash!==requestHash) return {ok:false,reason:'idempotency_conflict',message:'คำขอนี้ใช้รหัสซ้ำกับข้อมูลออเดอร์อื่น กรุณาเริ่มรายการใหม่'};
        const existing=db.prepare('SELECT * FROM orders WHERE id=?').get(prior.order_id);
        if(!existing) return {ok:false,reason:'idempotency_conflict',message:'ไม่สามารถกู้คืนรายการเดิมได้ กรุณาติดต่อผู้ดูแล'};
        if(existing.status==='Pending' && !existing.slip_submitted_at && Date.parse(existing.payment_expires_at)>createdAt.getTime()){
          db.prepare('UPDATE orders SET checkout_token_hash=?,updated_at=? WHERE id=?').run(checkoutTokenHash,createdAt.toISOString(),existing.id);
          return {ok:true,replay:true,order:{id:existing.id,game:game.name,package:pack.name,subtotal:existing.subtotal,discount:existing.discount,total:existing.total,status:existing.status,payment_expires_at:existing.payment_expires_at,slip_submitted_at:existing.slip_submitted_at},checkoutToken};
        }
        if(existing.status==='Pending' && !existing.slip_submitted_at && (!existing.payment_expires_at || Date.parse(existing.payment_expires_at)<=createdAt.getTime())){
          db.prepare("UPDATE orders SET status='Expired',status_reason='PAYMENT_TIMEOUT',updated_at=? WHERE id=? AND status='Pending'").run(createdAt.toISOString(),existing.id);
          releaseReservation(existing.id,createdAt.toISOString());
          return {ok:false,reason:'expired',message:'ออเดอร์เดิมหมดเวลาชำระเงินแล้ว กรุณาเริ่มรายการใหม่'};
        }
        return {ok:true,replay:true,order:{id:existing.id,game:game.name,package:pack.name,subtotal:existing.subtotal,discount:existing.discount,total:existing.total,status:existing.status,payment_expires_at:existing.payment_expires_at,slip_submitted_at:existing.slip_submitted_at},checkoutToken:null};
      }
      let couponId=null,discount=0,coupon=null;
      if(String(couponCode).trim()){
        const validation=validateCoupon(couponCode,game.id,pack.price,playerId);
        if(!validation.ok) return {ok:false,message:validation.message};
        coupon=validation.coupon; couponId=coupon.id; discount=validation.discount;
      }
      const couponCutoff=coupon && coupon.expires_at ? couponExpiryCutoff(coupon.expires_at) : null;
      const deadline=couponCutoff || new Date(createdAt.getTime()+PAYMENT_WINDOW_MS);
      if(deadline.getTime()<=createdAt.getTime()) return {ok:false,message:'โค้ดนี้หมดอายุแล้ว'};
      const total=Math.max(0,Math.round((pack.price-discount)*100)/100);
      const slipSubmittedAt=file ? createdAt.toISOString() : null;
      db.prepare(`INSERT INTO orders(id,game_id,package_id,player_id,server_id,coupon_id,subtotal,discount,total,slip_path,status,status_reason,payment_expires_at,slip_submitted_at,checkout_token_hash,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,'Pending',NULL,?,?,?,?,?)`)
        .run(id,game.id,pack.id,playerId,String(serverId).trim(),couponId,pack.price,discount,total,file ? file.filename : null,deadline.toISOString(),slipSubmittedAt,checkoutTokenHash,createdAt.toISOString(),createdAt.toISOString());
      db.prepare('INSERT INTO idempotency_records(key_hash,request_hash,order_id,created_at) VALUES(?,?,?,?)').run(keyHash,requestHash,id,createdAt.toISOString());
      if(couponId){
        const reserved=db.prepare('UPDATE coupons SET used_count=used_count+1 WHERE id=? AND active=1 AND (usage_limit IS NULL OR used_count<usage_limit)').run(couponId);
        if(!reserved.changes) throw new Error('COUPON_CAPACITY_EXHAUSTED');
        db.prepare("INSERT INTO coupon_redemptions(coupon_id,order_id,state,reserved_at,reserved_until) VALUES(?,?,'Reserved',?,?)").run(couponId,id,createdAt.toISOString(),deadline.toISOString());
      }
      return {ok:true,order:{id,game:game.name,package:pack.name,subtotal:pack.price,discount,total,status:'Pending',payment_expires_at:deadline.toISOString(),slip_submitted_at:slipSubmittedAt},checkoutToken};
    });
    try { const result=tx.immediate(); if(!result.ok || result.replay) safeUnlink(file); return result; }
    catch(error){ safeUnlink(file); if(error.message==='COUPON_CAPACITY_EXHAUSTED') return {ok:false,message:'โค้ดนี้ถูกจองครบจำนวนแล้ว กรุณาเลือกโค้ดอื่น'}; throw error; }
  }
  function submitSlip({orderId,checkoutToken,file,now=new Date()}) {
    const hash=crypto.createHash('sha256').update(String(checkoutToken||'')).digest('hex');
    const tx=db.transaction(()=>{
      const order=db.prepare('SELECT * FROM orders WHERE id=?').get(String(orderId));
      if(!order||!order.checkout_token_hash||!crypto.timingSafeEqual(Buffer.from(order.checkout_token_hash),Buffer.from(hash))) return {ok:false,reason:'not_found'};
      if(order.status!=='Pending'||order.slip_submitted_at) return {ok:false,reason:'already_submitted'};
      if(!order.payment_expires_at||now.getTime()>=Date.parse(order.payment_expires_at)){
        db.prepare("UPDATE orders SET status='Expired',status_reason='PAYMENT_TIMEOUT',updated_at=? WHERE id=? AND status='Pending'").run(now.toISOString(),order.id);
        releaseReservation(order.id,now.toISOString()); return {ok:false,reason:'expired'};
      }
      db.prepare("UPDATE orders SET slip_path=?,slip_submitted_at=?,updated_at=? WHERE id=? AND status='Pending' AND slip_submitted_at IS NULL").run(file.filename,now.toISOString(),now.toISOString(),order.id);
      return {ok:true,orderId:order.id,slipSubmittedAt:now.toISOString()};
    });
    const result=tx.immediate(); if(!result.ok) safeUnlink(file); return result;
  }
  function expirePendingOrders(now=new Date()) {
    const tx=db.transaction(()=>{
      const rows=db.prepare("SELECT id FROM orders WHERE status='Pending' AND slip_submitted_at IS NULL AND payment_expires_at IS NOT NULL AND payment_expires_at<=?").all(now.toISOString());
      for(const row of rows){
        db.prepare("UPDATE orders SET status='Expired',status_reason='PAYMENT_TIMEOUT',updated_at=? WHERE id=? AND status='Pending' AND slip_submitted_at IS NULL").run(now.toISOString(),row.id);
        releaseReservation(row.id,now.toISOString());
      }
      return rows.length;
    });
    return tx.immediate();
  }
  return {createPendingOrder,submitSlip,expirePendingOrders,releaseReservation};
}
module.exports=createOrderService;
