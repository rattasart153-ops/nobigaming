/** Admin operations backed exclusively by the current versioned Sheets schema. */

function adminDashboard(token) {
  requireAdmin_(token);
  expirePendingOrders_();
  const orders = repositoryRows_('orders');
  const completed = orders.filter(function(order) { return order.status === 'Completed'; });
  return {
    orders: orders.length,
    pending: orders.filter(function(order) { return order.status === 'Pending'; }).length,
    completed: completed.length,
    revenue: money_(completed.reduce(function(sum, order) {
      return sum + Number(order.total_satang || 0) / 100;
    }, 0)),
    games: repositoryRows_('games').length,
    packages: repositoryRows_('packages').length,
    coupons: repositoryRows_('coupons').length,
    promotions: repositoryRows_('promotions').length
  };
}

function adminOrders(token) {
  requireAdmin_(token);
  expirePendingOrders_();
  return repositoryRows_('orders').sort(function(a, b) {
    return String(b.created_at).localeCompare(String(a.created_at));
  }).map(function(order) {
    const safe = clean_(order);
    const game = repositoryGetById_('games', order.game_id);
    const pack = repositoryGetById_('packages', order.package_id);
    const coupon = order.coupon_id ? repositoryGetById_('coupons', order.coupon_id) : null;
    safe.id = order.order_id;
    safe.game_name = game ? game.name : '';
    safe.package_name = pack ? pack.name : '';
    safe.coupon_code = coupon ? coupon.code_display : '';
    safe.has_slip = Boolean(order.slip_file_id);
    safe.subtotal = Number(order.subtotal_satang || 0) / 100;
    safe.discount = Number(order.discount_satang || 0) / 100;
    safe.total = Number(order.total_satang || 0) / 100;
    delete safe.slip_file_id;
    delete safe.checkout_token_hash;
    delete safe.request_key;
    return safe;
  });
}

function adminSlipData(token, orderId) {
  // Fail before touching Drive for unauthenticated callers.
  requireAdmin_(token);
  const order = repositoryGetById_('orders', orderId);
  if (!order || !order.slip_file_id) throw new Error('ไม่พบสลิป');
  const slipFolderId = String(PropertiesService.getScriptProperties().getProperty('NOBI_PRIVATE_DRIVE_FOLDER_ID') || '').trim();
  if (!slipFolderId) throw new Error('ยังไม่ได้ตั้งค่าโฟลเดอร์สลิปส่วนตัว');
  const file = DriveApp.getFileById(String(order.slip_file_id));
  assertDriveFileInPrivateFolder_(file, slipFolderId);
  const blob = file.getBlob();
  const name = file.getName();
  const mimeType = blob.getContentType();
  const base64 = Utilities.base64Encode(blob.getBytes());

  // Revalidate at the response boundary. A logout, suspension, or password change
  // during the Drive read must win; the slip bytes are never returned for a revoked session.
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const admin = requireAdminLocked_(token, Date.now());
    appendAdminAuditLogLocked_({
      audit_id:Utilities.getUuid(), admin_id:admin.admin_id,
      action:'VIEW_ORDER_SLIP', target_type:'order', target_id:order.order_id,
      request_id:'', ip_address:'',
      details_json:'{}', created_at:new Date().toISOString()
    });
    return {name:name,mimeType:mimeType,base64:base64};
  } finally { lock.releaseLock(); }
}

function adminSetOrderStatus(token, orderId, status) {
  const admin = requireAdmin_(token);
  const nextStatus = String(status || '');
  if (!['Completed', 'Rejected'].includes(nextStatus)) throw new Error('สถานะไม่ถูกต้อง');
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    recoverPendingOrderJournalsLocked_();
    const order = repositoryGetById_('orders', orderId);
    if (!order) throw new Error('ไม่พบออเดอร์');
    if (order.status === nextStatus) return {ok:true, unchanged:true};
    if (order.status !== 'Pending') throw new Error('ออเดอร์ที่ตรวจสอบแล้วไม่สามารถเปลี่ยนสถานะซ้ำได้');

    const now = new Date().toISOString();
    const redemption = repositoryFindByField_('coupon_redemptions', 'order_id', order.order_id)
      .find(function(item) { return item.state === 'Reserved'; });
    let targetStatus = nextStatus;
    let orderPatch;
    let redemptionPatch = null;
    if (nextStatus === 'Completed') {
      if (!order.slip_submitted_at) throw new Error('ต้องมีสลิปก่อนอนุมัติออเดอร์');
      const submitted = Date.parse(order.slip_submitted_at);
      const deadline = Date.parse(order.payment_expires_at);
      if (!Number.isFinite(submitted) || !Number.isFinite(deadline) || submitted >= deadline) {
        targetStatus = 'Expired';
        orderPatch = {status:'Expired',status_reason:'PAYMENT_TIMEOUT',updated_at:now};
        if (redemption) redemptionPatch = {state:'Released',released_at:now};
      } else {
        orderPatch = {status:'Completed',completed_at:now,updated_at:now};
        if (redemption) redemptionPatch = {state:'Consumed',finalized_at:now};
      }
    } else {
      orderPatch = {status:'Rejected',rejected_at:now,status_reason:'ADMIN_REJECTED',updated_at:now};
      if (redemption) redemptionPatch = {state:'Released',released_at:now};
    }
    const journal = createOrderRecoveryJournalLocked_({
      order_id:order.order_id,
      operation:'TRANSITION',
      order_patch:orderPatch,
      redemption_id:redemption ? redemption.redemption_id : '',
      redemption_patch:redemptionPatch,
      created_at:now
    });
    applyOrderRecoveryJournalLocked_(journal);

    const expired = targetStatus === 'Expired';
    appendAdminAuditLogLocked_({
      audit_id:Utilities.getUuid(), admin_id:admin.admin_id,
      action:expired ? 'ORDER_STATUS_EXPIRED' : 'ORDER_STATUS_' + nextStatus.toUpperCase(),
      target_type:'order', target_id:order.order_id, request_id:'',
      ip_address:'',
      details_json:JSON.stringify(expired ? {reason:'PAYMENT_TIMEOUT'} : {previous_status:'Pending',status:nextStatus}),
      created_at:now
    });
    return expired ? {ok:false,reason:'expired'} : {ok:true,status:nextStatus};
  } finally {
    lock.releaseLock();
  }
}

function adminList(token, tableName) {
  requireAdmin_(token);
  if (String(tableName) === 'coupons') expirePendingOrders_();
  if (!['games', 'packages', 'coupons', 'promotions'].includes(String(tableName))) {
    throw new Error('ไม่อนุญาตให้เข้าถึงตารางนี้');
  }
  const records = repositoryRows_(tableName);
  if (tableName === 'coupons') {
    const redemptions = repositoryRows_('coupon_redemptions');
    return records.map(function(coupon) {
      const safe = clean_(coupon);
      safe.used_count = redemptions.filter(function(item) {
        return String(item.coupon_id) === String(coupon.coupon_id) &&
          (item.state === 'Reserved' || item.state === 'Consumed');
      }).length;
      return safe;
    });
  }
  return records.map(clean_);
}

function adminUpsert(token, tableName, record) {
  const admin = requireAdmin_(token);
  if (!['games', 'packages', 'coupons', 'promotions'].includes(String(tableName))) {
    throw new Error('ไม่อนุญาตให้แก้ไขตารางนี้');
  }
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('ข้อมูลไม่ถูกต้อง');

  const primaryKeys = {games:'game_id', packages:'package_id', coupons:'coupon_id', promotions:'promotion_id'};
  const primaryKey = primaryKeys[tableName];
  const safe = {};
  Object.keys(record).forEach(function(field) {
    if (field === primaryKey || field === 'created_at' || field === 'updated_at') return;
    if (NOBI.SHEETS[tableName].indexOf(field) === -1) throw new Error('ฟิลด์ไม่ถูกต้อง: ' + field);
    safe[field] = record[field];
  });
  if ((tableName === 'packages' || tableName === 'promotions') &&
      Object.prototype.hasOwnProperty.call(record, 'image_file_id')) {
    throw new Error('ห้ามกำหนด image_file_id โดยตรง กรุณาใช้ URL รูปภาพที่อัปโหลดผ่านระบบ');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    let id = record[primaryKey] ? String(record[primaryKey]) : '';
    const current = id ? repositoryGetById_(tableName, id) : null;
    if (id && !current) throw new Error('ไม่พบรายการ');
    const candidate = Object.assign({}, current || {}, safe);

    if ((tableName === 'packages' || tableName === 'promotions') &&
        Object.prototype.hasOwnProperty.call(record, 'image_url')) {
      const imageUrl = String(safe.image_url || '').trim();
      const mediaMatch = imageUrl.match(/^\/api\/public\/media\/([A-Za-z0-9_-]{10,100})$/);
      candidate.image_file_id = mediaMatch ? mediaMatch[1] : '';
      safe.image_file_id = candidate.image_file_id;
    }
    if ((tableName === 'packages' || tableName === 'promotions') &&
        /drive\.google\.com|googleusercontent\.com/i.test(String(candidate.image_url || ''))) {
      throw new Error('ห้ามใช้ลิงก์ Google Drive โดยตรง ต้องใช้ URL ผ่านระบบสื่อส่วนตัว');
    }

    // Validate the complete post-update record so partial edits preserve required fields.
    validateRecord_(tableName, candidate);
    if (tableName === 'packages' && !repositoryGetById_('games', candidate.game_id)) {
      throw new Error('ไม่พบเกมที่เลือกสำหรับแพ็กเกจ');
    }
    if (tableName === 'coupons') {
      if (candidate.game_id && !repositoryGetById_('games', candidate.game_id)) {
        throw new Error('ไม่พบเกมที่เลือกสำหรับคูปอง');
      }
      if (candidate.member_spend_game_id && !repositoryGetById_('games', candidate.member_spend_game_id)) {
        throw new Error('ไม่พบเกมที่ใช้คำนวณยอดเติมสะสมสมาชิก');
      }
    }
    if ((tableName === 'packages' || tableName === 'promotions') && candidate.image_file_id) {
      const mediaFolderId = String(PropertiesService.getScriptProperties().getProperty('NOBI_PRIVATE_MEDIA_FOLDER_ID') || '').trim();
      if (!mediaFolderId) throw new Error('ยังไม่ได้ตั้งค่าโฟลเดอร์รูปภาพส่วนตัว');
      const mediaFile = DriveApp.getFileById(String(candidate.image_file_id));
      assertDriveFileInPrivateFolder_(mediaFile, mediaFolderId);
    }
    const now = new Date().toISOString();
    if (id) {
      safe.updated_at = now;
      repositoryUpdateLocked_(tableName, id, safe);
    } else {
      id = Utilities.getUuid();
      safe[primaryKey] = id;
      safe.created_at = now;
      safe.updated_at = now;
      repositoryInsertLocked_(tableName, safe);
    }
    appendAdminAuditLogLocked_({
      audit_id: Utilities.getUuid(), admin_id: admin.admin_id,
      action: 'UPSERT_' + tableName.toUpperCase(), target_type: tableName,
      target_id: id, request_id: '', ip_address: '',
      details_json: '{}', created_at: now
    });
    return {ok:true, id:id};
  } finally {
    lock.releaseLock();
  }
}

function adminDelete(token, tableName, id) {
  const admin = requireAdmin_(token);
  if (!['games', 'packages', 'coupons', 'promotions'].includes(String(tableName))) {
    throw new Error('ไม่อนุญาตให้ลบตารางนี้');
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const primaryKey = NOBI.SHEETS[tableName][0];
    const target = repositoryGetById_(tableName, id);
    if (!target) throw new Error('ไม่พบรายการ');
    if (tableName === 'games' && (
      repositoryFindByField_('packages', 'game_id', id).length ||
      repositoryFindByField_('orders', 'game_id', id).length
    )) throw new Error('ลบเกมไม่ได้ เนื่องจากมีแพ็กเกจหรือออเดอร์อ้างอิงอยู่');
    if (tableName === 'packages' && repositoryFindByField_('orders', 'package_id', id).length) {
      throw new Error('ลบแพ็กเกจไม่ได้ เนื่องจากมีออเดอร์อ้างอิงอยู่');
    }
    if (tableName === 'coupons' && repositoryFindByField_('coupon_redemptions', 'coupon_id', id).length) {
      throw new Error('ลบคูปองไม่ได้ เนื่องจากมีประวัติการใช้คูปอง');
    }

    if (!repositoryDeleteLocked_(tableName, id)) throw new Error('ไม่พบรายการ');
    const now = new Date().toISOString();
    appendAdminAuditLogLocked_({
      audit_id: Utilities.getUuid(), admin_id: admin.admin_id,
      action: 'DELETE_' + tableName.toUpperCase(), target_type: tableName,
      target_id: String(id), request_id: '', ip_address: '',
      details_json: '{}', created_at: now
    });
    return {ok:true};
  } finally {
    lock.releaseLock();
  }
}


function adminMemberLoginLogs(token, memberId, requestedLimit) {
  requireAdmin_(token);
  const limit = Math.min(500, Math.max(1, Number(requestedLimit) || 100));
  return repositoryRows_('member_login_logs').filter(function(log) {
    return !memberId || String(log.member_id) === String(memberId);
  }).sort(function(a, b) {
    return String(b.created_at).localeCompare(String(a.created_at));
  }).slice(0, limit).map(function(log) {
    return {log_id:log.log_id,member_id:log.member_id,login_id_normalized:log.login_id_normalized,
      login_result:log.login_result,failure_reason_code:log.failure_reason_code,user_agent:log.user_agent,created_at:log.created_at};
  });
}


function adminStoreMedia(token, media) {
  const admin = requireAdmin_(token);
  media = media || {};
  const mimeType = String(media.mimeType || '');
  if (!media.base64 || !/^image\/(png|jpeg|webp)$/.test(mimeType)) {
    throw new Error('กรุณาแนบไฟล์ PNG/JPG/WebP');
  }
  const bytes = Utilities.base64Decode(String(media.base64).replace(/^data:[^,]+,/, ''));
  if (!bytes.length || bytes.length > NOBI.MAX_SLIP_BYTES || !validImageSignature_(bytes, mimeType)) {
    throw new Error('ไฟล์ภาพไม่ถูกต้องหรือมีขนาดเกิน 3 MB');
  }
  const folderId = String(PropertiesService.getScriptProperties().getProperty('NOBI_PRIVATE_MEDIA_FOLDER_ID') || '').trim();
  if (!folderId) throw new Error('ยังไม่ได้ตั้งค่าโฟลเดอร์ Drive ส่วนตัวสำหรับรูปภาพ');
  const folder = DriveApp.getFolderById(folderId);
  if (!folder || typeof folder.getSharingAccess !== 'function') {
    throw new Error('DRIVE_FOLDER_INVALID');
  }
  if (folder.getSharingAccess() !== DriveApp.Access.PRIVATE) {
    throw new Error('DRIVE_FOLDER_NOT_PRIVATE');
  }
  const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  let file = null;
  try {
    file = folder.createFile(
      Utilities.newBlob(bytes, mimeType, 'nobi-media-' + Utilities.getUuid() + '.' + ext)
    );
    file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.VIEW);
    assertDriveFileInPrivateFolder_(file, folderId);
    const now = new Date().toISOString();
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      appendAdminAuditLogLocked_({
        audit_id:Utilities.getUuid(), admin_id:admin.admin_id,
        action:'UPLOAD_PRIVATE_MEDIA', target_type:'drive_media', target_id:file.getId(),
        request_id:'', ip_address:'',
        details_json:JSON.stringify({mime_type:mimeType, size_bytes:bytes.length}),
        created_at:now
      });
    } finally { lock.releaseLock(); }
    return {ok:true, file_id:file.getId(), url:'/api/public/media/' + file.getId()};
  } catch (error) {
    if (file) {
      try { file.setTrashed(true); } catch (ignored) {}
    }
    throw error;
  }
}

function assertDriveFileInPrivateFolder_(file, folderId) {
  const expected = String(folderId || '').trim();
  if (!expected || !file || typeof file.getParents !== 'function' ||
      typeof file.getSharingAccess !== 'function') {
    throw new Error('DRIVE_FOLDER_INVALID');
  }
  const folder = DriveApp.getFolderById(expected);
  if (!folder || typeof folder.getSharingAccess !== 'function') {
    throw new Error('DRIVE_FOLDER_INVALID');
  }
  if (folder.getSharingAccess() !== DriveApp.Access.PRIVATE) {
    throw new Error('DRIVE_FOLDER_NOT_PRIVATE');
  }
  if (file.getSharingAccess() !== DriveApp.Access.PRIVATE) {
    throw new Error('DRIVE_FILE_NOT_PRIVATE');
  }
  const parents = file.getParents();
  let found = false;
  while (parents.hasNext()) {
    const parent = parents.next();
    if (parent && String(parent.getId()) === expected) found = true;
  }
  if (!found) throw new Error('DRIVE_FILE_OUTSIDE_PRIVATE_FOLDER');
  return true;
}

function publicMediaData(fileId) {
  const id = String(fileId || '').trim();
  if (!id) throw new Error('ไม่พบรูปภาพ');
  const referenced = repositoryRows_('packages').some(function(item) {
    return truth_(item.active) && String(item.image_file_id) === id;
  }) || repositoryRows_('promotions').some(function(item) {
    return truth_(item.active) && String(item.image_file_id) === id;
  });
  if (!referenced) throw new Error('ไม่พบรูปภาพ');
  const mediaFolderId = String(PropertiesService.getScriptProperties().getProperty('NOBI_PRIVATE_MEDIA_FOLDER_ID') || '').trim();
  if (!mediaFolderId) throw new Error('ยังไม่ได้ตั้งค่าโฟลเดอร์รูปภาพส่วนตัว');
  const file = DriveApp.getFileById(id);
  assertDriveFileInPrivateFolder_(file, mediaFolderId);
  const blob = file.getBlob();
  const mimeType = blob.getContentType();
  if (!/^image\/(png|jpeg|webp)$/.test(mimeType)) throw new Error('ชนิดไฟล์รูปภาพไม่รองรับ');
  return {
    name:file.getName(),
    mimeType:mimeType,
    base64:Utilities.base64Encode(blob.getBytes())
  };
}


function adminMembers(token, searchTerm, requestedLimit) {
  requireAdmin_(token);
  const query = String(searchTerm || '').trim().toLowerCase();
  const limit = Math.min(500, Math.max(1, Number(requestedLimit) || 200));
  return repositoryRows_('members').filter(function(member) {
    return !query ||
      String(member.login_id_normalized).toLowerCase().includes(query) ||
      String(member.full_name).toLowerCase().includes(query) ||
      String(member.member_id).toLowerCase().includes(query);
  }).sort(function(a, b) {
    return String(b.created_at).localeCompare(String(a.created_at));
  }).slice(0, limit).map(function(member) {
    return {
      member_id:member.member_id,
      full_name:member.full_name,
      login_id:member.login_id_display,
      status:member.status,
      last_login_at:member.last_login_at,
      created_at:member.created_at
    };
  });
}

function adminSetMemberStatus(token, memberId, status) {
  const admin = requireAdmin_(token);
  const nextStatus = String(status || '');
  if (!['Active','Suspended'].includes(nextStatus)) throw new Error('สถานะสมาชิกไม่ถูกต้อง');
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const member = repositoryGetById_('members', memberId);
    if (!member) throw new Error('ไม่พบสมาชิก');
    if (member.status === nextStatus) return {ok:true, unchanged:true};
    const now = new Date().toISOString();
    repositoryUpdateLocked_('members', member.member_id, {
      status:nextStatus,
      auth_version:Number(member.auth_version || 1) + 1,
      updated_at:now
    });
    if (nextStatus === 'Suspended') {
      repositoryRows_('member_sessions').filter(function(session) {
        return String(session.member_id) === String(member.member_id) && !session.revoked_at;
      }).forEach(function(session) {
        repositoryUpdateLocked_('member_sessions', session.session_id, {revoked_at:now});
      });
    }
    appendAdminAuditLogLocked_({
      audit_id:Utilities.getUuid(), admin_id:admin.admin_id,
      action:'MEMBER_STATUS_' + nextStatus.toUpperCase(),
      target_type:'member', target_id:member.member_id,
      request_id:'', ip_address:'',
      details_json:JSON.stringify({previous_status:member.status,status:nextStatus}),
      created_at:now
    });
    return {ok:true,status:nextStatus};
  } finally {
    lock.releaseLock();
  }
}
