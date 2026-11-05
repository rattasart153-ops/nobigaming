/** Coupon eligibility against Schema v1; all persisted money values are satang. */

function couponExpiryCutoff_(expiresAt) {
  const match = String(expiresAt || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);
  if (!match) return NaN;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (calendarDate.getUTCFullYear() !== year || calendarDate.getUTCMonth() !== month - 1 ||
      calendarDate.getUTCDate() !== day) return NaN;
  // Date-only expiry is inclusive through 23:59:59.999 Asia/Bangkok (UTC+7).
  return Date.UTC(year, month - 1, day + 1) - 7 * 60 * 60 * 1000;
}

function couponEligibility_(coupon, gameId, subtotalSatang, playerId, memberId, nowMs) {
  if (!truth_(coupon.active)) return {valid:false, error:'คูปองปิดใช้งาน'};
  if (coupon.expires_at) {
    const cutoff = couponExpiryCutoff_(coupon.expires_at);
    if (!Number.isFinite(cutoff) || nowMs >= cutoff) return {valid:false, error:'คูปองหมดอายุแล้ว'};
  }
  if (subtotalSatang < Number(coupon.min_order_satang || 0)) return {valid:false, error:'ยอดซื้อไม่ถึงขั้นต่ำ'};
  if (coupon.game_id && String(coupon.game_id) !== String(gameId)) return {valid:false, error:'คูปองนี้ใช้กับเกมที่เลือกไม่ได้'};

  const uid = String(playerId || '').trim();
  let allowedIds = [];
  if (coupon.allowed_player_ids_json) {
    try {
      allowedIds = JSON.parse(String(coupon.allowed_player_ids_json));
      if (!Array.isArray(allowedIds)) throw new Error('invalid allowlist');
    } catch (ignored) {
      return {valid:false, error:'ข้อมูลเงื่อนไขคูปองไม่ถูกต้อง'};
    }
  }
  if (allowedIds.length && !allowedIds.map(String).includes(uid)) {
    return {valid:false, error:'คูปองนี้จำกัดเฉพาะ UID ที่แอดมินกำหนด'};
  }

  if (coupon.access_type === 'member_only' || coupon.access_type === 'member_game_spend') {
    if (!memberId) return {valid:false, error:'คูปองนี้สำหรับสมาชิกเท่านั้น กรุณาเข้าสู่ระบบ'};
    const member = repositoryGetById_('members', memberId);
    if (!member || member.status !== 'Active') return {valid:false, error:'ไม่พบสมาชิกหรือบัญชีสมาชิกถูกระงับ'};
  } else if (coupon.access_type !== 'public') {
    return {valid:false, error:'รูปแบบสิทธิ์คูปองไม่ถูกต้อง'};
  }

  if (coupon.access_type === 'member_game_spend') {
    const qualifyingGame = String(coupon.member_spend_game_id || '');
    const minimum = Number(coupon.member_min_game_spend_satang || 0);
    if (!qualifyingGame || minimum <= 0) return {valid:false, error:'ข้อมูลเงื่อนไขสมาชิกของคูปองไม่ครบ'};
    const spent = repositoryRows_('orders').filter(function(order) {
      return String(order.member_id) === String(memberId) &&
        String(order.game_id) === qualifyingGame && order.status === 'Completed';
    }).reduce(function(sum, order) {
      return sum + Number(order.total_satang || 0);
    }, 0);
    if (spent < minimum) {
      return {valid:false, error:'ยอดเติมสะสมของสมาชิกในเกมที่กำหนดยังไม่ถึง ฿' + (minimum / 100).toLocaleString('th-TH')};
    }
  }

  const playerMinimum = Number(coupon.min_player_spend_satang || 0);
  if (playerMinimum > 0) {
    const playerSpent = repositoryRows_('orders').filter(function(order) {
      return String(order.player_id) === uid &&
        String(order.game_id) === String(gameId) && order.status === 'Completed';
    }).reduce(function(sum, order) {
      return sum + Number(order.total_satang || 0);
    }, 0);
    if (playerSpent < playerMinimum) {
      return {valid:false, error:'UID นี้มียอดเติมสะสมในเกมที่เลือกยังไม่ถึง ฿' + (playerMinimum / 100).toLocaleString('th-TH')};
    }
  }

  const redemptions = repositoryRows_('coupon_redemptions').filter(function(item) {
    return String(item.coupon_id) === String(coupon.coupon_id) &&
      (item.state === 'Reserved' || item.state === 'Consumed');
  }).length;
  if (coupon.usage_limit !== '' && coupon.usage_limit !== null &&
      coupon.usage_limit !== undefined && redemptions >= Number(coupon.usage_limit)) {
    return {valid:false, error:'คูปองถูกใช้ครบจำนวนแล้ว'};
  }

  const discountSatang = coupon.discount_type === 'percent'
    ? Math.floor(subtotalSatang * Number(coupon.discount_value) / 100)
    : Math.round(Number(coupon.discount_value));
  const finalDiscount = Math.min(subtotalSatang, Math.max(0, discountSatang));
  return {
    valid:true,
    code:coupon.code_display,
    coupon_id:coupon.coupon_id,
    discount:finalDiscount / 100,
    discount_satang:finalDiscount,
    total:(subtotalSatang - finalDiscount) / 100,
    total_satang:subtotalSatang - finalDiscount,
    expires_at:coupon.expires_at || ''
  };
}

function validateCoupon(code, gameId, subtotal, playerId, memberId, skipExpirySweep) {
  if (!skipExpirySweep) expirePendingOrders_();
  const normalized = String(code || '').trim().toUpperCase();
  const amount = Number(subtotal);
  if (!normalized || !Number.isFinite(amount) || amount < 0) {
    return {valid:false, error:'ข้อมูลคูปองไม่ถูกต้อง'};
  }
  const coupon = repositoryRows_('coupons').find(function(item) {
    return String(item.code_normalized).toUpperCase() === normalized;
  });
  if (!coupon) return {valid:false, error:'ไม่พบคูปองหรือคูปองปิดใช้งาน'};
  return couponEligibility_(coupon, gameId, Math.round(amount * 100), playerId, memberId, Date.now());
}

function couponSuggestions_(gameId, subtotal, playerId, memberId) {
  expirePendingOrders_();
  const amount = Number(subtotal);
  if (!Number.isFinite(amount) || amount < 0) return {suggestion:null};
  const candidates = repositoryRows_('coupons').map(function(coupon) {
    return couponEligibility_(coupon, gameId, Math.round(amount * 100), playerId, memberId, Date.now());
  }).filter(function(result) { return result.valid; });
  candidates.sort(function(a, b) { return b.discount_satang - a.discount_satang; });
  return {
    suggestion: candidates.length ? {
      code:candidates[0].code,
      discount:candidates[0].discount,
      message:'ประหยัด ' + money_(candidates[0].discount) + ' บาท'
    } : null
  };
}
