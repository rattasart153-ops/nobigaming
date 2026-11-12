/** Member dashboard, rolling 30-day spend and coupon progress. All spend is server-derived. */
const NOBI_MEMBER_SPEND_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const NOBI_MEMBER_ALERT_STAGES = [75, 80, 90];

function memberSpendSummary_(memberId, nowMs) {
  const cutoff = Number(nowMs) - NOBI_MEMBER_SPEND_WINDOW_MS;
  const totals = {total_satang:0, by_game:{}};
  repositoryRows_('orders').forEach(function(order) {
    if (String(order.member_id || '') !== String(memberId) || order.status !== 'Completed') return;
    const completedAt = Date.parse(String(order.completed_at || ''));
    if (!Number.isFinite(completedAt) || completedAt < cutoff || completedAt > nowMs) return;
    const amount = Number(order.total_satang);
    if (!Number.isSafeInteger(amount) || amount < 0) return;
    totals.total_satang += amount;
    const gameId = String(order.game_id || '');
    totals.by_game[gameId] = (totals.by_game[gameId] || 0) + amount;
  });
  return totals;
}

function memberCouponProgress_(coupon, spend, memberId, nowMs, redemptions, games) {
  if (!truth_(coupon.active)) return null;
  const access = String(coupon.access_type || '');
  if (!['member_only','member_game_spend','member_total_spend'].includes(access)) return null;
  if (coupon.expires_at) {
    const expiry = couponExpiryCutoff_(coupon.expires_at);
    if (!Number.isFinite(expiry) || nowMs >= expiry) return null;
  }
  const target = access === 'member_game_spend'
    ? Number(coupon.member_min_game_spend_satang)
    : access === 'member_total_spend' ? Number(coupon.member_min_game_spend_satang) : 0;
  if (!Number.isSafeInteger(target) || target < 0 || (access !== 'member_only' && target <= 0)) return null;
  const gameId = access === 'member_game_spend' ? String(coupon.member_spend_game_id || '') : '';
  if (access === 'member_game_spend' && !gameId) return null;
  const current = access === 'member_game_spend'
    ? Number(spend.by_game[gameId] || 0) : access === 'member_total_spend' ? spend.total_satang : target;
  const ratio = target > 0 ? current / target : 1;
  const percent = Math.min(100, Math.floor(ratio * 100));
  const used = (Array.isArray(redemptions) ? redemptions : repositoryRows_('coupon_redemptions')).filter(function(item) {
    return String(item.coupon_id) === String(coupon.coupon_id) &&
      (item.state === 'Reserved' || item.state === 'Consumed');
  }).length;
  const capacityAvailable = coupon.usage_limit === '' || coupon.usage_limit == null ||
    used < Number(coupon.usage_limit);
  return {
    coupon_id:String(coupon.coupon_id), code:String(coupon.code_display || ''),
    access_type:access, scope:access === 'member_game_spend' ? 'game' : access === 'member_total_spend' ? 'total' : 'member',
    game_id:gameId, game_name:gameId && Array.isArray(games) && games.find(function(game) { return String(game.game_id) === gameId; }) ? games.find(function(game) { return String(game.game_id) === gameId; }).name : '',
    current_satang:current, target_satang:target, percent:percent,
    remaining_satang:Math.max(0,target-current), unlocked:percent >= 100 && capacityAvailable,
    capacity_available:capacityAvailable, expires_at:String(coupon.expires_at || ''),
    discount_type:String(coupon.discount_type || ''),
    discount_value:Number(coupon.discount_value || 0),
    min_order_satang:Number(coupon.min_order_satang || 0)
  };
}

function memberDashboard(token) {
  expirePendingOrders_();
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const nowMs = Date.now();
    // Revalidate while holding the same lock used for session revocation.
    const member = requireMemberLocked_(token, nowMs);
    const spend = memberSpendSummary_(member.member_id, nowMs);
    const games = repositoryRows_('games');
    const redemptions = repositoryRows_('coupon_redemptions');
    const byGame = Object.keys(spend.by_game).map(function(gameId) {
      const game = games.find(function(item) { return String(item.game_id) === gameId; });
      return {game_id:gameId,game_name:game ? game.name : 'เกมที่ไม่พบ',total_satang:spend.by_game[gameId]};
    }).sort(function(a,b) { return b.total_satang-a.total_satang; });
    const alerts = [];
    const progress = repositoryRows_('coupons').map(function(coupon) {
      return memberCouponProgress_(coupon, spend, member.member_id, nowMs, redemptions, games);
    }).filter(Boolean);
    progress.forEach(function(item) {
      if (!item.target_satang || !item.capacity_available) return;
      const stage = item.unlocked ? 100 : (NOBI_MEMBER_ALERT_STAGES.filter(function(value) {
        return item.current_satang / item.target_satang >= value / 100;
      }).pop() || 0);
      const existing = repositoryFindByField_('member_coupon_alerts','member_coupon_key',
        String(member.member_id) + ':' + item.coupon_id)[0];
      const previous = existing ? Number(existing.last_stage || 0) : 0;
      if (stage < previous) {
        repositoryUpdateLocked_('member_coupon_alerts', existing.alert_id, {
          last_stage:stage, updated_at:new Date(nowMs).toISOString()
        });
      } else if (stage > previous) {
        NOBI_MEMBER_ALERT_STAGES.filter(function(value) { return value > previous && value <= Math.min(stage,90); })
          .forEach(function(value) {
            alerts.push({
              coupon_id:item.coupon_id,code:item.code,stage:value,
              message:'คูปอง ' + item.code + ' ใกล้ปลดล็อกแล้ว ' + value + '% — ขาดอีก ' + money_(Math.max(0,item.target_satang-item.current_satang)/100) + ' บาท'
            });
          });
        if (stage === 100 && previous < 100) alerts.push({coupon_id:item.coupon_id,code:item.code,stage:100,message:'ยินดีด้วย! คูปอง ' + item.code + ' ปลดล็อกแล้ว สามารถนำไปใช้สั่งซื้อได้'});
        const now = new Date(nowMs).toISOString();
        if (existing) repositoryUpdateLocked_('member_coupon_alerts', existing.alert_id, {
          last_stage:stage,notified_at:now,updated_at:now
        });
        else repositoryInsertLocked_('member_coupon_alerts', {
          alert_id:Utilities.getUuid(),
          member_coupon_key:String(member.member_id) + ':' + item.coupon_id,
          member_id:String(member.member_id),coupon_id:item.coupon_id,
          last_stage:stage,notified_at:now,created_at:now,updated_at:now
        });
      }
    });
    return {
      member:{member_id:member.member_id,full_name:member.full_name,login_id:member.login_id_display},
      window_days:30,window_started_at:new Date(nowMs-NOBI_MEMBER_SPEND_WINDOW_MS).toISOString(),
      total_satang:spend.total_satang,by_game:byGame,
      coupons:progress,alerts:alerts
    };
  } finally { lock.releaseLock(); }
}

function memberOrders(token, requestedLimit) {
  expirePendingOrders_();
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const member = requireMemberLocked_(token, Date.now());
    const limit = Math.min(100,Math.max(1,Number(requestedLimit)||50));
    return repositoryRows_('orders').filter(function(order) {
      return String(order.member_id || '') === String(member.member_id);
    }).sort(function(a,b) {
      return String(b.created_at || '').localeCompare(String(a.created_at || ''));
    }).slice(0,limit).map(function(order) {
      const game = repositoryGetById_('games',order.game_id);
      const pack = repositoryGetById_('packages',order.package_id);
      return {
        order_id:order.order_id,order_number:order.order_number,
        game_name:game ? game.name : '',package_name:pack ? pack.name : '',
        player_id:order.player_id,status:order.status,
        subtotal_satang:Number(order.subtotal_satang||0),
        discount_satang:Number(order.discount_satang||0),
        total_satang:Number(order.total_satang||0),
        created_at:order.created_at,completed_at:order.completed_at,
        payment_expires_at:order.payment_expires_at,
        slip_submitted_at:order.slip_submitted_at
      };
    });
  } finally { lock.releaseLock(); }
}
