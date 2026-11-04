/** Nobi Topup Apps Script 04_Coupons module. */

function couponSuggestions_(gameId, subtotal, playerId) {
  const amount = Number(subtotal);
  if (!Number.isFinite(amount) || amount < 0) return {suggestion:null};
  const candidates = rows_('coupons').filter(c => truth_(c.active)).map(c => validateCoupon(c.code, gameId, amount, playerId)).filter(c => c.valid);
  candidates.sort((a,b) => Number(b.discount)-Number(a.discount));
  return {suggestion:candidates.length ? {code:candidates[0].code, discount:candidates[0].discount, message:'ประหยัด '+money_(candidates[0].discount)+' บาท'} : null};
}

function validateCoupon(code, gameId, subtotal, playerId) {
  const normalized = String(code || '').trim().toUpperCase();
  const amount = Number(subtotal);
  if (!normalized || !Number.isFinite(amount) || amount < 0) return { valid:false, error:'ข้อมูลคูปองไม่ถูกต้อง' };
  const c = rows_('coupons').find(r => String(r.code).toUpperCase() === normalized && truth_(r.active));
  if (!c) return { valid:false, error:'ไม่พบคูปองหรือคูปองปิดใช้งาน' };
  if (c.expires_at && Date.parse(c.expires_at) < Date.now()) return { valid:false, error:'คูปองหมดอายุแล้ว' };
  if (amount < Number(c.min_spend || 0)) return { valid:false, error:'ยอดซื้อไม่ถึงขั้นต่ำ' };
  if (c.game_id && String(c.game_id) !== String(gameId)) return { valid:false, error:'คูปองนี้ใช้กับเกมที่เลือกไม่ได้' };
  const uid = String(playerId || '').trim();
  const allowedIds = String(c.allowed_player_ids || '').split(/[\n,;]+/).map(v => v.trim()).filter(Boolean);
  if (allowedIds.length && !allowedIds.includes(uid)) return { valid:false, error:'คูปองนี้จำกัดเฉพาะ UID ที่แอดมินกำหนด' };
  const minPlayerSpend = Number(c.min_player_spend || 0);
  if (minPlayerSpend > 0) {
    if (!uid) return { valid:false, error:'กรุณากรอก UID ก่อนตรวจสอบสิทธิ์คูปอง' };
    const spent = rows_('orders').filter(o => String(o.game_id) === String(gameId) && String(o.player_id).trim() === uid && String(o.status) === 'Completed').reduce((sum,o)=>sum+Number(o.total||0),0);
    if (spent < minPlayerSpend) return { valid:false, error:'ยอดเติมสะสมของ UID นี้ในเกมที่เลือกยังไม่ถึง ฿'+minPlayerSpend.toLocaleString('th-TH')+' (ปัจจุบัน ฿'+spent.toLocaleString('th-TH')+')' };
  }
  if (c.usage_limit !== '' && c.usage_limit != null && Number(c.used_count || 0) >= Number(c.usage_limit)) return { valid:false, error:'คูปองถูกใช้ครบจำนวนแล้ว' };
  const discount = Math.min(amount, c.discount_type === 'percent' ? amount * Number(c.discount_value) / 100 : Number(c.discount_value));
  return { valid:true, code:c.code, coupon_id:c.id, discount:money_(discount), total:money_(amount-discount) };
}
