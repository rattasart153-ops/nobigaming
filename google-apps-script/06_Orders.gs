/** Nobi Topup Apps Script 06_Orders module. */

function createOrder(payload) {
  payload = payload || {};
  const key = String(payload.request_key || '').trim();
  if (key.length < 12 || key.length > 120) throw new Error('ต้องมี request_key ที่ไม่ซ้ำและยาวอย่างน้อย 12 ตัวอักษร');
  const prior = rows_('orders').find(o => String(o.request_key) === key);
  if (prior) return { ok:true, order:publicOrder_(prior), duplicate:true };
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const again = rows_('orders').find(o => String(o.request_key) === key);
    if (again) return { ok:true, order:publicOrder_(again), duplicate:true };
    const game = rows_('games').find(r => String(r.id) === String(payload.game_id) && truth_(r.active));
    const pack = rows_('packages').find(r => String(r.id) === String(payload.package_id) && truth_(r.active) && String(r.game_id) === String(payload.game_id));
    const playerId = String(payload.player_id || '').trim();
    const serverId = String(payload.server_id || '').trim();
    if (!game || !pack) throw new Error('ไม่พบเกมหรือแพ็กเกจที่เปิดขาย');
    if (!playerId || playerId.length > 100 || serverId.length > 100) throw new Error('UID/Server ID ไม่ถูกต้อง');
    const subtotal = money_(Number(pack.price));
    if (!Number.isFinite(subtotal) || subtotal < 0) throw new Error('ราคาแพ็กเกจไม่ถูกต้อง');
    let coupon = null, discount = 0;
    if (payload.coupon_code) {
      const checked = validateCoupon(payload.coupon_code, game.id, subtotal, playerId);
      if (!checked.valid) throw new Error(checked.error);
      coupon = rows_('coupons').find(c => String(c.id) === String(checked.coupon_id));
      discount = checked.discount;
      // Recheck usage while holding the write lock.
      if (coupon.usage_limit !== '' && coupon.usage_limit != null && Number(coupon.used_count || 0) >= Number(coupon.usage_limit)) throw new Error('คูปองถูกใช้ครบจำนวนแล้ว');
    }
    const slip = payload.slip;
    if (!slip || !slip.base64 || !/^image\/(png|jpeg|webp)$/.test(String(slip.mimeType || ''))) throw new Error('กรุณาแนบสลิป PNG/JPG/WebP');
    const bytes = Utilities.base64Decode(String(slip.base64).replace(/^data:[^,]+,/, ''));
    if (!bytes.length || bytes.length > NOBI.MAX_SLIP_BYTES) throw new Error('ไฟล์สลิปต้องมีขนาดไม่เกิน 5 MB');
    if (!validImageSignature_(bytes, slip.mimeType)) throw new Error('ชนิดไฟล์ไม่ตรงกับเนื้อหาไฟล์ภาพ');
    const ext = slip.mimeType === 'image/png' ? 'png' : slip.mimeType === 'image/webp' ? 'webp' : 'jpg';
    const orderId = 'NBI-' + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMddHHmmss') + '-' + Utilities.getUuid().slice(0,8).toUpperCase();
    const folder = DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty('NOBI_PRIVATE_DRIVE_FOLDER_ID'));
    const file = folder.createFile(Utilities.newBlob(bytes, slip.mimeType, orderId + '.' + ext));
    file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
    const now = new Date().toISOString();
    const order = {id:orderId,game_id:game.id,package_id:pack.id,game_name:game.name,package_name:pack.name,player_id:playerId,server_id:serverId,coupon_id:coupon?coupon.id:'',coupon_code:coupon?coupon.code:'',subtotal:subtotal,discount:discount,total:money_(subtotal-discount),slip_file_id:file.getId(),status:'Pending',created_at:now,updated_at:now,request_key:key};
    let orderWritten = false;
    try {
      append_('orders', order);
      orderWritten = true;
      if (coupon) updateById_('coupons', coupon.id, {used_count:Number(coupon.used_count||0)+1});
      return {ok:true,order:publicOrder_(order),duplicate:false};
    } catch (writeError) {
      if (orderWritten) { try { deleteById_('orders', order.id); } catch (ignored) {} }
      try { file.setTrashed(true); } catch (ignored) {}
      throw writeError;
    }
  } finally {
    lock.releaseLock();
  }
}

function publicOrder_(o) { const c=Object.assign({},o); delete c.slip_file_id; delete c.request_key; return c; }

function validImageSignature_(bytes,mime) {
  const b=bytes.map(x=>(x+256)%256);
  if(mime==='image/png') return b.length>=8 && b.slice(0,8).join(',')==='137,80,78,71,13,10,26,10';
  if(mime==='image/jpeg') return b.length>=3 && b[0]===255 && b[1]===216 && b[2]===255;
  if(mime==='image/webp') return b.length>=12 && String.fromCharCode.apply(null,b.slice(0,4))==='RIFF' && String.fromCharCode.apply(null,b.slice(8,12))==='WEBP';
  return false;
}
