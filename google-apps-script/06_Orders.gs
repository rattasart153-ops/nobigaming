/** Order lifecycle backed by Schema v1, with idempotent checkout and coupon reservations. */

const NOBI_PAYMENT_WINDOW_MS = 15 * 60 * 1000;

function createOrder(payload) {
  payload = payload || {};
  const key = String(payload.request_key || '').trim();
  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(key)) {
    throw new Error('ต้องมี request_key ที่ถูกต้องเพื่อป้องกันออเดอร์ซ้ำ');
  }

  const gameId = String(payload.game_id || '');
  const packageId = String(payload.package_id || '');
  const playerId = String(payload.player_id || '').trim();
  const serverId = String(payload.server_id || '').trim();
  const memberToken = String(payload.member_token || '');
  const suppliedMemberId = String(payload.member_id || '').trim();
  const couponCode = String(payload.coupon_code || '').trim().toUpperCase();
  if (!gameId || !packageId || !playerId || playerId.length > 100 || serverId.length > 100) {
    throw new Error('ข้อมูลเกม แพ็กเกจ หรือ UID ไม่ถูกต้อง');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const member = memberToken ? requireMemberLocked_(memberToken, Date.now()) : null;
    if (!member && suppliedMemberId) throw new Error('ไม่อนุญาตให้กำหนดรหัสสมาชิกจากคำขอโดยตรง');
    const memberId = member ? String(member.member_id) : '';
    const payloadHash = sha256_(JSON.stringify({
      game_id:gameId, package_id:packageId, player_id:playerId,
      server_id:serverId, member_id:memberId, coupon_code:couponCode
    }));
    expirePendingOrdersLocked_(Date.now());
    pruneExpiredIdempotencyLocked_(Date.now());
    let existingKey = repositoryFindByField_('idempotency_records', 'request_key', key)
      .find(function(item) { return item.scope === 'create_order'; });
    if (existingKey && Date.parse(existingKey.expires_at) <= Date.now()) {
      repositoryDeleteLocked_('idempotency_records', existingKey.idempotency_id);
      existingKey = null;
    }
    if (existingKey) {
      if (String(existingKey.payload_hash) !== payloadHash) {
        throw new Error('IDEMPOTENCY_CONFLICT: request_key นี้ถูกใช้กับข้อมูลอื่นแล้ว');
      }
      const existingOrder = repositoryGetById_('orders', existingKey.resource_id);
      if (!existingOrder) throw new Error('ไม่สามารถกู้คืนออเดอร์เดิมได้');
      let replayToken = null;
      if (existingOrder.status === 'Pending' && !existingOrder.slip_submitted_at &&
          Date.parse(existingOrder.payment_expires_at) > Date.now()) {
        // The original response may have been lost. Rotate the one-time token
        // only for an identical idempotent request and invalidate the old token.
        replayToken = Utilities.getUuid() + '.' + Utilities.getUuid() + '.' + Utilities.getUuid();
        repositoryUpdateLocked_('orders', existingOrder.order_id, {
          checkout_token_hash:sha256_(replayToken),
          updated_at:new Date().toISOString()
        });
        existingOrder.checkout_token_hash = sha256_(replayToken);
      }
      return {ok:true, order:publicOrder_(existingOrder), duplicate:true, checkout_token:replayToken};
    }

    const game = repositoryGetById_('games', gameId);
    const pack = repositoryGetById_('packages', packageId);
    if (!game || !truth_(game.active) || !pack || !truth_(pack.active) ||
        String(pack.game_id) !== gameId) {
      throw new Error('ไม่พบเกมหรือแพ็กเกจที่เปิดขาย');
    }

    const subtotalSatang = Number(pack.price_satang);
    if (!Number.isSafeInteger(subtotalSatang) || subtotalSatang < 0) {
      throw new Error('ราคาแพ็กเกจไม่ถูกต้อง');
    }

    let coupon = null;
    let discountSatang = 0;
    if (couponCode) {
      const checked = validateCoupon(couponCode, gameId, subtotalSatang / 100, playerId, memberId, true);
      if (!checked.valid) throw new Error(checked.error);
      coupon = repositoryGetById_('coupons', checked.coupon_id);
      if (!coupon) throw new Error('ไม่พบคูปอง');
      discountSatang = checked.discount_satang;
    }

    const now = new Date();
    const nowMs = now.getTime();
    const couponCutoff = coupon && coupon.expires_at ? couponExpiryCutoff_(coupon.expires_at) : NaN;
    const deadlineMs = Number.isFinite(couponCutoff) ? couponCutoff : nowMs + NOBI_PAYMENT_WINDOW_MS;
    if (deadlineMs <= nowMs) throw new Error('คูปองหมดอายุแล้ว');
    const deadline = new Date(deadlineMs).toISOString();
    const orderNumber = 'NBI-' + Utilities.formatDate(now, 'Asia/Bangkok', 'yyyyMMddHHmmss') +
      '-' + Utilities.getUuid().slice(0, 6).toUpperCase();
    const orderId = orderNumber;
    const checkoutToken = Utilities.getUuid() + '.' + Utilities.getUuid() + '.' + Utilities.getUuid();
    const totalSatang = Math.max(0, subtotalSatang - discountSatang);

    const order = {
      order_id:orderId,
      order_number:orderNumber,
      request_key:key,
      member_id:memberId,
      game_id:gameId,
      package_id:packageId,
      player_id:playerId,
      server_id:serverId,
      coupon_id:coupon ? coupon.coupon_id : '',
      subtotal_satang:subtotalSatang,
      discount_satang:discountSatang,
      total_satang:totalSatang,
      slip_file_id:'',
      slip_mime_type:'',
      slip_size_bytes:0,
      slip_submitted_at:'',
      checkout_token_hash:sha256_(checkoutToken),
      status:'Pending',
      status_reason:'',
      payment_expires_at:deadline,
      created_at:now.toISOString(),
      updated_at:now.toISOString(),
      completed_at:'',
      rejected_at:''
    };

    repositoryInsertLocked_('orders', order);
    try {
      if (coupon) {
        const redemption = {
          redemption_id:Utilities.getUuid(),
          coupon_id:coupon.coupon_id,
          order_id:orderId,
          member_id:memberId,
          player_id:playerId,
          game_id:gameId,
          discount_satang:discountSatang,
          state:'Reserved',
          reserved_at:now.toISOString(),
          reserved_until:deadline,
          finalized_at:'',
          released_at:''
        };
        repositoryInsertLocked_('coupon_redemptions', redemption);
      }
      repositoryInsertLocked_('idempotency_records', {
        idempotency_id:Utilities.getUuid(),
        scope:'create_order',
        request_key:key,
        payload_hash:payloadHash,
        resource_id:orderId,
        state:'Completed',
        created_at:now.toISOString(),
        expires_at:new Date(nowMs + 90 * 24 * 60 * 60 * 1000).toISOString()
      });
    } catch (error) {
      // Sheets has no multi-row transaction. Release any reservation already
      // written, then make the partially-created order permanently unpayable.
      repositoryFindByField_('coupon_redemptions', 'order_id', orderId)
        .filter(function(item) { return item.state === 'Reserved'; })
        .forEach(function(item) {
          repositoryUpdateLocked_('coupon_redemptions', item.redemption_id, {
            state:'Released', released_at:new Date().toISOString()
          });
        });
      repositoryUpdateLocked_('orders', orderId, {
        status:'Rejected', status_reason:'CHECKOUT_PERSISTENCE_FAILED', updated_at:new Date().toISOString()
      });
      throw error;
    }

    return {
      ok:true,
      order:publicOrder_(order),
      duplicate:false,
      checkout_token:checkoutToken
    };
  } finally {
    lock.releaseLock();
  }
}

function submitOrderSlip(payload) {
  payload = payload || {};
  const orderId = String(payload.order_id || '').trim();
  const checkoutToken = String(payload.checkout_token || '');
  const slip = payload.slip || {};
  if (!orderId || !checkoutToken || !slip.base64 ||
      !/^image\/(png|jpeg|webp)$/.test(String(slip.mimeType || ''))) {
    throw new Error('กรุณาแนบสลิป PNG/JPG/WebP และยืนยันสิทธิ์อัปโหลด');
  }

  const bytes = Utilities.base64Decode(String(slip.base64).replace(/^data:[^,]+,/, ''));
  if (!bytes.length || bytes.length > NOBI.MAX_SLIP_BYTES ||
      !validImageSignature_(bytes, slip.mimeType)) {
    throw new Error('ไฟล์สลิปไม่ถูกต้องหรือมีขนาดเกิน 3 MB');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let file = null;
  try {
    const order = repositoryGetById_('orders', orderId);
    if (!order || !order.checkout_token_hash ||
        !constantTimeHexEqual_(String(order.checkout_token_hash), sha256_(checkoutToken))) {
      throw new Error('ไม่พบออเดอร์หรือสิทธิ์อัปโหลดไม่ถูกต้อง');
    }
    if (order.slip_submitted_at) {
      return {ok:true, already_submitted:true, slip_submitted_at:order.slip_submitted_at};
    }
    if (order.status !== 'Pending') {
      throw new Error('ออเดอร์นี้ไม่สามารถส่งสลิปได้แล้ว');
    }
    const deadline = Date.parse(order.payment_expires_at);
    if (!Number.isFinite(deadline) || Date.now() >= deadline) {
      expireOrderLocked_(order, new Date().toISOString());
      throw new Error('หมดเวลาชำระเงินและอัปโหลดสลิปแล้ว');
    }

    const folderId = String(PropertiesService.getScriptProperties().getProperty('NOBI_PRIVATE_DRIVE_FOLDER_ID') || '').trim();
    if (!folderId) throw new Error('ยังไม่ได้ตั้งค่าโฟลเดอร์ Drive ส่วนตัว');
    const ext = slip.mimeType === 'image/png' ? 'png' : slip.mimeType === 'image/webp' ? 'webp' : 'jpg';
    const folder = DriveApp.getFolderById(folderId);
    if (folder.getSharingAccess && folder.getSharingAccess() !== DriveApp.Access.PRIVATE) {
      throw new Error('DRIVE_FOLDER_NOT_PRIVATE');
    }
    file = folder.createFile(
      Utilities.newBlob(bytes, slip.mimeType, String(order.order_number) + '.' + ext)
    );
    file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.VIEW);
    if (file.getSharingAccess && file.getSharingAccess() !== DriveApp.Access.PRIVATE) {
      file.setTrashed(true);
      throw new Error('DRIVE_FILE_NOT_PRIVATE');
    }
    const now = new Date().toISOString();
    repositoryUpdateLocked_('orders', orderId, {
      slip_file_id:file.getId(),
      slip_mime_type:slip.mimeType,
      slip_size_bytes:bytes.length,
      slip_submitted_at:now,
      updated_at:now
    });
    return {ok:true, slip_submitted_at:now};
  } catch (error) {
    if (file) {
      try { file.setTrashed(true); } catch (ignored) {}
    }
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function expirePendingOrdersLocked_(nowMs) {
  const now = new Date(nowMs).toISOString();
  repositoryRows_('orders').filter(function(order) {
    return order.status === 'Pending' && !order.slip_submitted_at &&
      Date.parse(order.payment_expires_at) <= nowMs;
  }).forEach(function(order) {
    expireOrderLocked_(order, now);
  });
}

function expireOrderLocked_(order, now) {
  repositoryUpdateLocked_('orders', order.order_id, {
    status:'Expired', status_reason:'PAYMENT_TIMEOUT', updated_at:now
  });
  repositoryFindByField_('coupon_redemptions', 'order_id', order.order_id)
    .filter(function(item) { return item.state === 'Reserved'; })
    .forEach(function(item) {
      repositoryUpdateLocked_('coupon_redemptions', item.redemption_id, {
        state:'Released', released_at:now
      });
    });
}

function publicOrder_(order) {
  return {
    id:order.order_number,
    order_id:order.order_id,
    game_id:order.game_id,
    package_id:order.package_id,
    player_id:order.player_id,
    server_id:order.server_id,
    coupon_id:order.coupon_id,
    subtotal:Number(order.subtotal_satang || 0) / 100,
    discount:Number(order.discount_satang || 0) / 100,
    total:Number(order.total_satang || 0) / 100,
    status:order.status,
    payment_expires_at:order.payment_expires_at,
    slip_submitted_at:order.slip_submitted_at || null,
    created_at:order.created_at
  };
}

function validImageSignature_(bytes, mime) {
  const b = bytes.map(function(value) { return (value + 256) % 256; });
  if (mime === 'image/png') return b.length >= 8 && b.slice(0, 8).join(',') === '137,80,78,71,13,10,26,10';
  if (mime === 'image/jpeg') return b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255;
  if (mime === 'image/webp') {
    return b.length >= 12 &&
      String.fromCharCode.apply(null, b.slice(0, 4)) === 'RIFF' &&
      String.fromCharCode.apply(null, b.slice(8, 12)) === 'WEBP';
  }
  return false;
}


/** Public expiry sweep; caller must not already hold ScriptLock. */
function expirePendingOrders_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try { expirePendingOrdersLocked_(Date.now()); }
  finally { lock.releaseLock(); }
}


function pruneExpiredIdempotencyLocked_(nowMs) {
  repositoryRows_('idempotency_records').filter(function(record) {
    const expiry = Date.parse(record.expires_at || '');
    return Number.isFinite(expiry) && expiry <= nowMs;
  }).forEach(function(record) {
    repositoryDeleteLocked_('idempotency_records', record.idempotency_id);
  });
}
