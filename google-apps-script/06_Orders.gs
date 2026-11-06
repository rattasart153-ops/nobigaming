/** Order lifecycle backed by the versioned Sheets schema, with idempotent checkout and coupon reservations. */

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
    recoverPendingOrderJournalsLocked_();
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
    if (existingKey) {
      const idempotencyExpiry = Date.parse(existingKey.expires_at || '');
      if (!Number.isFinite(idempotencyExpiry)) {
        throw new Error('IDEMPOTENCY_RECORD_INVALID: expiry timestamp is missing or invalid');
      }
      if (idempotencyExpiry <= Date.now()) {
        repositoryDeleteLocked_('idempotency_records', existingKey.idempotency_id);
        existingKey = null;
      }
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
        // Deterministic HMAC token recovery avoids invalidating a concurrent retry response.
        replayToken = checkoutTokenForOrder_(existingOrder.order_id, key);
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
    const checkoutToken = checkoutTokenForOrder_(orderId, key);
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

    const redemption = coupon ? {
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
    } : null;
    const idempotencyRecord = {
      idempotency_id:Utilities.getUuid(),
      scope:'create_order',
      request_key:key,
      payload_hash:payloadHash,
      resource_id:orderId,
      state:'Completed',
      created_at:now.toISOString(),
      expires_at:new Date(nowMs + 90 * 24 * 60 * 60 * 1000).toISOString()
    };
    const journal = createOrderRecoveryJournalLocked_({
      order_id:orderId,
      operation:'CREATE',
      order_record:order,
      idempotency_record:idempotencyRecord,
      redemption_record:redemption,
      created_at:now.toISOString()
    });
    applyOrderRecoveryJournalLocked_(journal);

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
    recoverPendingOrderJournalsLocked_();
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
    if (!folder || typeof folder.getSharingAccess !== 'function') {
      throw new Error('DRIVE_FOLDER_INVALID');
    }
    if (folder.getSharingAccess() !== DriveApp.Access.PRIVATE) {
      throw new Error('DRIVE_FOLDER_NOT_PRIVATE');
    }
    file = folder.createFile(
      Utilities.newBlob(bytes, slip.mimeType, String(order.order_number) + '.' + ext)
    );
    file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.VIEW);
    assertDriveFileInPrivateFolder_(file, folderId);
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
      let linkedToOrder = true;
      try {
        const persisted = repositoryGetById_('orders', orderId);
        linkedToOrder = Boolean(persisted &&
          String(persisted.slip_file_id || '') === String(file.getId()) &&
          persisted.slip_submitted_at);
      } catch (ignored) {}
      if (!linkedToOrder) {
        try { file.setTrashed(true); } catch (ignored) {}
      }
    }
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function expirePendingOrdersLocked_(nowMs) {
  recoverPendingOrderJournalsLocked_();
  const now = new Date(nowMs).toISOString();
  repositoryRows_('orders').filter(function(order) {
    const deadline = Date.parse(order.payment_expires_at || '');
    return order.status === 'Pending' && !order.slip_submitted_at &&
      (!Number.isFinite(deadline) || deadline <= nowMs);
  }).forEach(function(order) {
    expireOrderLocked_(order, now);
  });
}

function expireOrderLocked_(order, now) {
  const current = repositoryGetById_('orders', order.order_id);
  if (!current || current.status === 'Expired') return;
  if (current.status !== 'Pending') return;
  const redemption = repositoryFindByField_('coupon_redemptions', 'order_id', order.order_id)
    .find(function(item) { return item.state === 'Reserved'; });
  const journal = createOrderRecoveryJournalLocked_({
    order_id:order.order_id,
    operation:'TRANSITION',
    order_patch:{status:'Expired',status_reason:'PAYMENT_TIMEOUT',updated_at:now},
    redemption_id:redemption ? redemption.redemption_id : '',
    redemption_patch:redemption ? {state:'Released',released_at:now} : null,
    created_at:now
  });
  applyOrderRecoveryJournalLocked_(journal);
}

/** Journal intent is persisted before any order/coupon write. Caller holds ScriptLock. */
function createOrderRecoveryJournalLocked_(input) {
  const now = input.created_at || new Date().toISOString();
  const journal = {
    journal_id:Utilities.getUuid(),
    order_id:String(input.order_id),
    operation:String(input.operation),
    order_record_json:input.order_record ? JSON.stringify(input.order_record) : '',
    idempotency_record_json:input.idempotency_record ? JSON.stringify(input.idempotency_record) : '',
    redemption_record_json:input.redemption_record ? JSON.stringify(input.redemption_record) : '',
    order_patch_json:input.order_patch ? JSON.stringify(input.order_patch) : '',
    redemption_id:String(input.redemption_id || ''),
    redemption_patch_json:input.redemption_patch ? JSON.stringify(input.redemption_patch) : '',
    state:'Pending',
    attempts:0,
    last_error_code:'',
    created_at:now,
    updated_at:now
  };
  repositoryInsertLocked_('order_recovery_journal',journal);
  return journal;
}

/** Applies one journal repeatedly without duplicating rows or reversing a terminal state. Caller holds ScriptLock. */
function applyOrderRecoveryJournalLocked_(journal) {
  if (!journal || journal.state === 'Completed') return {ok:true,already_completed:true};
  const now = new Date().toISOString();
  try {
    if (journal.operation === 'CREATE') {
      const orderRecord = JSON.parse(String(journal.order_record_json || '{}'));
      const requiredOrderFields = NOBI.SHEETS.orders;
      if (!orderRecord.order_id || String(orderRecord.order_id) !== String(journal.order_id) ||
          requiredOrderFields.some(function(field) {
            return !Object.prototype.hasOwnProperty.call(orderRecord,field);
          }) || orderRecord.status !== 'Pending' || orderRecord.slip_submitted_at ||
          !/^[A-Za-z0-9._:-]{16,128}$/.test(String(orderRecord.request_key || '')) ||
          !/^[a-f0-9]{64}$/i.test(String(orderRecord.checkout_token_hash || '')) ||
          !Number.isFinite(Date.parse(orderRecord.created_at)) ||
          !Number.isFinite(Date.parse(orderRecord.payment_expires_at)) ||
          Date.parse(orderRecord.payment_expires_at) <= Date.parse(orderRecord.created_at) ||
          !Number.isSafeInteger(Number(orderRecord.subtotal_satang)) ||
          !Number.isSafeInteger(Number(orderRecord.discount_satang)) ||
          !Number.isSafeInteger(Number(orderRecord.total_satang)) ||
          Number(orderRecord.subtotal_satang) < 0 ||
          Number(orderRecord.discount_satang) < 0 ||
          Number(orderRecord.discount_satang) > Number(orderRecord.subtotal_satang) ||
          Number(orderRecord.total_satang) !== Number(orderRecord.subtotal_satang) - Number(orderRecord.discount_satang)) {
        throw new Error('RECOVERY_ORDER_PAYLOAD_INVALID');
      }

      const idem = JSON.parse(String(journal.idempotency_record_json || '{}'));
      const requiredIdemFields = NOBI.SHEETS.idempotency_records;
      if (!idem.idempotency_id || requiredIdemFields.some(function(field) {
            return !Object.prototype.hasOwnProperty.call(idem,field);
          }) || idem.scope !== 'create_order' ||
          String(idem.request_key) !== String(orderRecord.request_key) ||
          String(idem.resource_id) !== String(journal.order_id) || idem.state !== 'Completed' ||
          !/^[a-f0-9]{64}$/i.test(String(idem.payload_hash || '')) ||
          !Number.isFinite(Date.parse(idem.created_at)) ||
          String(idem.created_at) !== String(orderRecord.created_at) ||
          !Number.isFinite(Date.parse(idem.expires_at)) ||
          Date.parse(idem.expires_at) <= Date.parse(idem.created_at)) {
        throw new Error('RECOVERY_IDEMPOTENCY_PAYLOAD_INVALID');
      }

      const redemptionRecord = journal.redemption_record_json
        ? JSON.parse(String(journal.redemption_record_json)) : null;
      if (Boolean(orderRecord.coupon_id) !== Boolean(redemptionRecord)) {
        throw new Error('RECOVERY_REDEMPTION_PAYLOAD_INVALID');
      }
      if (redemptionRecord) {
        const requiredRedemptionFields = NOBI.SHEETS.coupon_redemptions;
        if (!redemptionRecord.redemption_id ||
            requiredRedemptionFields.some(function(field) {
              return !Object.prototype.hasOwnProperty.call(redemptionRecord,field);
            }) ||
            String(redemptionRecord.order_id) !== String(journal.order_id) ||
            String(redemptionRecord.coupon_id) !== String(orderRecord.coupon_id) ||
            String(redemptionRecord.member_id || '') !== String(orderRecord.member_id || '') ||
            String(redemptionRecord.player_id) !== String(orderRecord.player_id) ||
            String(redemptionRecord.game_id) !== String(orderRecord.game_id) ||
            Number(redemptionRecord.discount_satang) !== Number(orderRecord.discount_satang) ||
            String(redemptionRecord.reserved_at) !== String(orderRecord.created_at) ||
            String(redemptionRecord.reserved_until) !== String(orderRecord.payment_expires_at) ||
            redemptionRecord.state !== 'Reserved' ||
            !Number.isFinite(Date.parse(redemptionRecord.reserved_at)) ||
            !Number.isFinite(Date.parse(redemptionRecord.reserved_until))) {
          throw new Error('RECOVERY_REDEMPTION_PAYLOAD_INVALID');
        }
      }

      // Validate every pre-existing record before performing any missing write.
      const existingOrder = repositoryGetById_('orders',journal.order_id);
      if (existingOrder && requiredOrderFields.some(function(field) {
        return String(existingOrder[field] == null ? '' : existingOrder[field]) !==
          String(orderRecord[field] == null ? '' : orderRecord[field]);
      })) throw new Error('RECOVERY_ORDER_CONFLICT');

      const existingRedemptions = repositoryFindByField_('coupon_redemptions','order_id',journal.order_id);
      if (existingRedemptions.length > 1) throw new Error('RECOVERY_DUPLICATE_REDEMPTIONS');
      const existingRedemption = existingRedemptions[0] || null;
      if (existingRedemption && (!redemptionRecord ||
          NOBI.SHEETS.coupon_redemptions.some(function(field) {
            return String(existingRedemption[field] == null ? '' : existingRedemption[field]) !==
              String(redemptionRecord[field] == null ? '' : redemptionRecord[field]);
          }))) throw new Error('RECOVERY_REDEMPTION_CONFLICT');

      const existingIdemRows = repositoryFindByField_('idempotency_records','request_key',idem.request_key)
        .filter(function(item) { return item.scope === idem.scope; });
      if (existingIdemRows.length > 1) throw new Error('RECOVERY_DUPLICATE_IDEMPOTENCY');
      const existingIdem = existingIdemRows[0] || null;
      if (existingIdem && NOBI.SHEETS.idempotency_records.some(function(field) {
        return String(existingIdem[field] == null ? '' : existingIdem[field]) !==
          String(idem[field] == null ? '' : idem[field]);
      })) throw new Error('RECOVERY_IDEMPOTENCY_CONFLICT');

      if (!existingOrder) repositoryInsertLocked_('orders',orderRecord);
      if (redemptionRecord && !existingRedemption) {
        repositoryInsertLocked_('coupon_redemptions',redemptionRecord);
      }
      if (!existingIdem) repositoryInsertLocked_('idempotency_records',idem);
    } else if (journal.operation === 'TRANSITION') {
      const order = repositoryGetById_('orders',journal.order_id);
      if (!order) throw new Error('RECOVERY_ORDER_NOT_FOUND');
      const patch = JSON.parse(String(journal.order_patch_json || '{}'));
      const targetStatus = String(patch.status || '');
      const allowedPatchFields = {
        Completed:['status','completed_at','updated_at'],
        Rejected:['status','rejected_at','status_reason','updated_at'],
        Expired:['status','status_reason','updated_at']
      };
      const allowedFields = allowedPatchFields[targetStatus];
      if (!allowedFields || Object.keys(patch).some(function(field) {
        return allowedFields.indexOf(field) === -1;
      }) || !Number.isFinite(Date.parse(patch.updated_at)) ||
          (targetStatus === 'Completed' && (!Number.isFinite(Date.parse(patch.completed_at)) ||
            !order.slip_submitted_at || !Number.isFinite(Date.parse(order.slip_submitted_at)) ||
            !Number.isFinite(Date.parse(order.payment_expires_at)) ||
            Date.parse(order.slip_submitted_at) >= Date.parse(order.payment_expires_at))) ||
          (targetStatus === 'Rejected' && (!Number.isFinite(Date.parse(patch.rejected_at)) ||
            patch.status_reason !== 'ADMIN_REJECTED')) ||
          (targetStatus === 'Expired' && patch.status_reason !== 'PAYMENT_TIMEOUT')) {
        throw new Error('RECOVERY_TRANSITION_PAYLOAD_INVALID');
      }
      if (order.status !== 'Pending' && order.status !== targetStatus) {
        throw new Error('RECOVERY_TERMINAL_STATE_CONFLICT');
      }
      const orderRedemptions = repositoryFindByField_('coupon_redemptions','order_id',journal.order_id);
      if (orderRedemptions.length > 1) throw new Error('RECOVERY_DUPLICATE_REDEMPTIONS');
      if (Boolean(journal.redemption_id) !== Boolean(journal.redemption_patch_json) ||
          Boolean(order.coupon_id) !== Boolean(journal.redemption_id) ||
          Boolean(order.coupon_id) !== Boolean(orderRedemptions.length)) {
        throw new Error('RECOVERY_REDEMPTION_JOURNAL_MISSING');
      }
      if (journal.redemption_id && journal.redemption_patch_json) {
        const redemption = repositoryGetById_('coupon_redemptions',journal.redemption_id);
        if (!redemption) throw new Error('RECOVERY_REDEMPTION_NOT_FOUND');
        if (String(redemption.redemption_id) !== String(orderRedemptions[0].redemption_id) ||
            String(redemption.order_id) !== String(journal.order_id) ||
            String(redemption.coupon_id) !== String(order.coupon_id)) {
          throw new Error('RECOVERY_REDEMPTION_ORDER_MISMATCH');
        }
        const redemptionPatch = JSON.parse(journal.redemption_patch_json);
        const targetRedemptionState = String(redemptionPatch.state || '');
        const expectedRedemptionState = targetStatus === 'Completed' ? 'Consumed' :
          (['Rejected','Expired'].includes(targetStatus) ? 'Released' : '');
        const allowedRedemptionFields = targetStatus === 'Completed'
          ? ['state','finalized_at'] : ['state','released_at'];
        const redemptionTimestampField = targetStatus === 'Completed' ? 'finalized_at' : 'released_at';
        if (!expectedRedemptionState || targetRedemptionState !== expectedRedemptionState ||
            Object.keys(redemptionPatch).some(function(field) {
              return allowedRedemptionFields.indexOf(field) === -1;
            }) || !Number.isFinite(Date.parse(redemptionPatch[redemptionTimestampField]))) {
          throw new Error('RECOVERY_REDEMPTION_TRANSITION_INVALID');
        }
        if (redemption.state !== 'Reserved' && redemption.state !== targetRedemptionState) {
          throw new Error('RECOVERY_REDEMPTION_STATE_CONFLICT');
        }
        repositoryUpdateLocked_('coupon_redemptions',journal.redemption_id,redemptionPatch);
      }
      if (order.status !== targetStatus || Object.keys(patch).some(function(key) {
        return String(order[key] == null ? '' : order[key]) !== String(patch[key] == null ? '' : patch[key]);
      })) repositoryUpdateLocked_('orders',journal.order_id,patch);
    } else {
      throw new Error('RECOVERY_OPERATION_UNSUPPORTED');
    }
    // Completed journal rows retain only non-sensitive recovery metadata.
    // Clear duplicated order/member/UID payloads once both sides are consistent.
    repositoryUpdateLocked_('order_recovery_journal',journal.journal_id,{
      state:'Completed',
      order_record_json:'',
      idempotency_record_json:'',
      redemption_record_json:'',
      order_patch_json:'',
      redemption_patch_json:'',
      attempts:Number(journal.attempts || 0)+1,
      last_error_code:'',
      updated_at:now
    });
    return {ok:true};
  } catch (error) {
    try {
      // A Sheets write may have committed even if its response failed. Re-read
      // before marking Pending so a completed journal is never resurrected
      // after its recovery payload has already been cleared.
      const persistedJournal = repositoryGetById_('order_recovery_journal',journal.journal_id);
      if (persistedJournal && persistedJournal.state !== 'Completed') {
        repositoryUpdateLocked_('order_recovery_journal',journal.journal_id,{
          state:'Pending',
          attempts:Number(persistedJournal.attempts || 0)+1,
          last_error_code:/^[A-Z0-9_:-]{1,100}$/.test(String(error && error.message || ''))
            ? String(error.message) : 'RECOVERY_FAILED',
          updated_at:now
        });
      }
    } catch (journalError) {}
    throw error;
  }
}

function recoverPendingOrderJournalsLocked_() {
  repositoryRows_('order_recovery_journal').filter(function(item) {
    return item.state === 'Pending';
  }).forEach(function(item) {
    applyOrderRecoveryJournalLocked_(item);
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


/** Recoverable opaque checkout token; only its SHA-256 digest is stored in Sheets. */
function checkoutTokenForOrder_(orderId, requestKey) {
  const secret = String(PropertiesService.getScriptProperties().getProperty('NOBI_GATEWAY_SECRET') || '');
  if (secret.length < 32) throw new Error('GATEWAY_NOT_CONFIGURED');
  const signature = Utilities.computeHmacSha256Signature(
    'NOBI_CHECKOUT_V1:' + String(orderId) + ':' + String(requestKey),
    secret,
    Utilities.Charset.UTF_8
  );
  return signature.map(function(byte) {
    return ('0' + ((byte + 256) % 256).toString(16)).slice(-2);
  }).join('');
}
