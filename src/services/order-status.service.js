'use strict';
function createOrderStatusService(db){
  function release(orderId,at){
    const r=db.prepare("SELECT coupon_id FROM coupon_redemptions WHERE order_id=? AND state='Reserved'").get(orderId);
    if(!r)return false;
    const changed=db.prepare("UPDATE coupon_redemptions SET state='Released',released_at=? WHERE order_id=? AND state='Reserved'").run(at,orderId).changes;
    if(changed)db.prepare('UPDATE coupons SET used_count=MAX(0,used_count-1) WHERE id=?').run(r.coupon_id);
    return Boolean(changed);
  }
  return function setOrderStatus(orderId,nextStatus,now=new Date()){
    const tx=db.transaction(()=>{
      const o=db.prepare('SELECT * FROM orders WHERE id=?').get(String(orderId));
      if(!o)return {ok:false,reason:'not_found'};
      if(o.status===nextStatus)return {ok:true,status:nextStatus,unchanged:true};
      if(o.status!=='Pending')return {ok:false,reason:'invalid_transition'};
      if(nextStatus==='Completed'){
        if(!o.slip_submitted_at)return {ok:false,reason:'missing_slip'};
        if(!o.payment_expires_at||Date.parse(o.slip_submitted_at)>=Date.parse(o.payment_expires_at)){
          db.prepare("UPDATE orders SET status='Expired',status_reason='PAYMENT_TIMEOUT',updated_at=? WHERE id=?").run(now.toISOString(),o.id);
          release(o.id,now.toISOString());return {ok:false,reason:'expired'};
        }
        db.prepare("UPDATE coupon_redemptions SET state='Consumed',finalized_at=? WHERE order_id=? AND state='Reserved'").run(now.toISOString(),o.id);
      }else if(nextStatus==='Rejected')release(o.id,now.toISOString());
      else return {ok:false,reason:'invalid_transition'};
      db.prepare('UPDATE orders SET status=?,updated_at=? WHERE id=?').run(nextStatus,now.toISOString(),String(orderId));
      return {ok:true,status:nextStatus,unchanged:false};
    });
    return tx.immediate();
  };
}
module.exports=createOrderStatusService;
