'use strict';

function createCouponService(db) {
  return function validateCoupon(code, gameId, subtotal, playerId = '') {
    if (!code) return { ok: false, message: 'กรุณากรอกโค้ดส่วนลด' };
    const c = db.prepare(`SELECT c.*, g.name AS game_name FROM coupons c LEFT JOIN games g ON g.id=c.game_id WHERE upper(c.code)=upper(?)`).get(code.trim());
    if (!c || !c.active) return { ok: false, message: 'ไม่พบโค้ดนี้หรือโค้ดถูกปิดใช้งาน' };
    if (c.expires_at) {
      const match = String(c.expires_at).match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (match) {
        // Coupon date is inclusive in Asia/Bangkok; cutoff is midnight at the next local day.
        const cutoff = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1) - 7 * 60 * 60 * 1000;
        if (Date.now() >= cutoff) return { ok: false, message: 'โค้ดนี้หมดอายุแล้ว' };
      } else if (Date.parse(c.expires_at) <= Date.now()) return { ok: false, message: 'โค้ดนี้หมดอายุแล้ว' };
    }
    if (c.usage_limit !== null && c.usage_limit !== undefined && c.used_count >= c.usage_limit) return { ok: false, message: 'โค้ดนี้ถูกใช้ครบจำนวนแล้ว' };
    if (subtotal < c.min_spend) return { ok: false, message: `ยอดซื้อขั้นต่ำของโค้ดนี้คือ ฿${Number(c.min_spend).toLocaleString('th-TH')}`, coupon: c };
    if (c.game_id && Number(c.game_id) !== Number(gameId)) return { ok: false, message: `โค้ดนี้ใช้ได้เฉพาะเกม ${c.game_name}`, coupon: c };
    const uid = String(playerId || '').trim();
    const allowedIds = String(c.allowed_player_ids || '').split(/[\n,;]+/).map(v => v.trim()).filter(Boolean);
    if (allowedIds.length && !allowedIds.includes(uid)) return { ok:false, message:'คูปองนี้จำกัดเฉพาะ UID ที่แอดมินกำหนด', coupon:c };
    const minPlayerSpend = Number(c.min_player_spend || 0);
    if (minPlayerSpend > 0) {
      if (!uid) return { ok:false, message:'กรุณากรอก UID ก่อนตรวจสอบสิทธิ์คูปอง', coupon:c };
      const spent = db.prepare("SELECT COALESCE(SUM(total),0) AS total FROM orders WHERE game_id=? AND player_id=? AND status='Completed'").get(Number(gameId), uid).total;
      if (Number(spent) < minPlayerSpend) return { ok:false, message:`ยอดเติมสะสมของ UID นี้ในเกมที่เลือกต้องครบ ฿${minPlayerSpend.toLocaleString('th-TH')} (ปัจจุบัน ฿${Number(spent).toLocaleString('th-TH')})`, coupon:c };
    }
    const discount = Math.min(subtotal, c.discount_type === 'percent' ? subtotal * c.discount_value / 100 : c.discount_value);
    return { ok: true, message: 'ใช้โค้ดส่วนลดได้', coupon: c, discount: Math.round(discount * 100) / 100 };
  };
}

module.exports = createCouponService;
