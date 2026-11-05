/** Admin operations backed exclusively by the version 1 Sheets schema. */

function adminDashboard(token) {
  requireAdmin_(token);
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
  return repositoryRows_('orders').sort(function(a, b) {
    return String(b.created_at).localeCompare(String(a.created_at));
  }).map(function(order) {
    const safe = clean_(order);
    safe.id = order.order_id;
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
  requireAdmin_(token);
  const order = repositoryGetById_('orders', orderId);
  if (!order || !order.slip_file_id) throw new Error('ไม่พบสลิป');
  const file = DriveApp.getFileById(String(order.slip_file_id));
  const blob = file.getBlob();
  return {
    name: file.getName(),
    mimeType: blob.getContentType(),
    base64: Utilities.base64Encode(blob.getBytes())
  };
}

function adminSetOrderStatus(token, orderId, status) {
  const admin = requireAdmin_(token);
  const nextStatus = String(status || '');
  if (!['Completed', 'Rejected'].includes(nextStatus)) throw new Error('สถานะไม่ถูกต้อง');
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const order = repositoryGetById_('orders', orderId);
    if (!order) throw new Error('ไม่พบออเดอร์');
    if (order.status === nextStatus) return {ok:true, unchanged:true};
    if (order.status !== 'Pending') throw new Error('ออเดอร์ที่ตรวจสอบแล้วไม่สามารถเปลี่ยนสถานะซ้ำได้');

    const now = new Date().toISOString();
    const redemption = repositoryFindByField_('coupon_redemptions', 'order_id', order.order_id)
      .find(function(item) { return item.state === 'Reserved'; });

    if (nextStatus === 'Completed') {
      if (!order.slip_submitted_at) throw new Error('ต้องมีสลิปก่อนอนุมัติออเดอร์');
      const submitted = Date.parse(order.slip_submitted_at);
      const deadline = Date.parse(order.payment_expires_at);
      if (!Number.isFinite(submitted) || !Number.isFinite(deadline) || submitted >= deadline) {
        repositoryUpdateLocked_('orders', order.order_id, {
          status: 'Expired', status_reason: 'PAYMENT_TIMEOUT', updated_at: now
        });
        if (redemption) repositoryUpdateLocked_('coupon_redemptions', redemption.redemption_id, {
          state: 'Released', released_at: now
        });
        return {ok:false, reason:'expired'};
      }
      if (redemption) repositoryUpdateLocked_('coupon_redemptions', redemption.redemption_id, {
        state: 'Consumed', finalized_at: now
      });
      repositoryUpdateLocked_('orders', order.order_id, {
        status: 'Completed', completed_at: now, updated_at: now
      });
    } else {
      if (redemption) repositoryUpdateLocked_('coupon_redemptions', redemption.redemption_id, {
        state: 'Released', released_at: now
      });
      repositoryUpdateLocked_('orders', order.order_id, {
        status: 'Rejected', rejected_at: now, status_reason: 'ADMIN_REJECTED', updated_at: now
      });
    }

    appendAdminAuditLogLocked_({
      audit_id: Utilities.getUuid(),
      admin_id: admin.admin_id,
      action: 'ORDER_STATUS_' + nextStatus.toUpperCase(),
      target_type: 'order',
      target_id: order.order_id,
      request_id: '',
      ip_address: '',
      details_json: JSON.stringify({previous_status:'Pending', status:nextStatus}),
      created_at: now
    });
    return {ok:true, status:nextStatus};
  } finally {
    lock.releaseLock();
  }
}

function adminList(token, tableName) {
  requireAdmin_(token);
  if (!['games', 'packages', 'coupons', 'promotions'].includes(String(tableName))) {
    throw new Error('ไม่อนุญาตให้เข้าถึงตารางนี้');
  }
  return repositoryRows_(tableName).map(clean_);
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
  if (tableName === 'packages' || tableName === 'promotions') {
    const imageUrl = String(safe.image_url || '').trim();
    const mediaMatch = imageUrl.match(/^\/api\/public\/media\/([A-Za-z0-9_-]{10,100})$/);
    safe.image_file_id = mediaMatch ? mediaMatch[1] : '';
    if (/drive\.google\.com|googleusercontent\.com/i.test(imageUrl)) {
      throw new Error('ห้ามใช้ลิงก์ Google Drive โดยตรง ต้องใช้ URL ผ่านระบบสื่อส่วนตัว');
    }
  }
  validateRecord_(tableName, safe);

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const now = new Date().toISOString();
    let id;
    if (record[primaryKey]) {
      id = String(record[primaryKey]);
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

    const sheet = repositorySheet_(tableName);
    const values = sheet.getDataRange().getValues();
    const index = NOBI.SHEETS[tableName].indexOf(primaryKey);
    for (let row = 1; row < values.length; row++) {
      if (String(values[row][index]) !== String(id)) continue;
      sheet.deleteRow(row + 1);
      const now = new Date().toISOString();
      appendAdminAuditLogLocked_({
        audit_id: Utilities.getUuid(), admin_id: admin.admin_id,
        action: 'DELETE_' + tableName.toUpperCase(), target_type: tableName,
        target_id: String(id), request_id: '', ip_address: '',
        details_json: '{}', created_at: now
      });
      return {ok:true};
    }
    throw new Error('ไม่พบรายการ');
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
  }).slice(0, limit).map(clean_);
}


function adminStoreMedia(token, media) {
  requireAdmin_(token);
  media = media || {};
  const mimeType = String(media.mimeType || '');
  if (!media.base64 || !/^image\/(png|jpeg|webp)$/.test(mimeType)) {
    throw new Error('กรุณาแนบไฟล์ PNG/JPG/WebP');
  }
  const bytes = Utilities.base64Decode(String(media.base64).replace(/^data:[^,]+,/, ''));
  if (!bytes.length || bytes.length > NOBI.MAX_SLIP_BYTES || !validImageSignature_(bytes, mimeType)) {
    throw new Error('ไฟล์ภาพไม่ถูกต้องหรือมีขนาดเกิน 5 MB');
  }
  const folderId = String(PropertiesService.getScriptProperties().getProperty('NOBI_PRIVATE_MEDIA_FOLDER_ID') || '').trim();
  if (!folderId) throw new Error('ยังไม่ได้ตั้งค่าโฟลเดอร์ Drive ส่วนตัวสำหรับรูปภาพ');
  const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  const file = DriveApp.getFolderById(folderId).createFile(
    Utilities.newBlob(bytes, mimeType, 'nobi-media-' + Utilities.getUuid() + '.' + ext)
  );
  file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
  return {ok:true, file_id:file.getId(), url:'/api/public/media/' + file.getId()};
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
  const file = DriveApp.getFileById(id);
  const blob = file.getBlob();
  const mimeType = blob.getContentType();
  if (!/^image\/(png|jpeg|webp)$/.test(mimeType)) throw new Error('ชนิดไฟล์รูปภาพไม่รองรับ');
  return {
    name:file.getName(),
    mimeType:mimeType,
    base64:Utilities.base64Encode(blob.getBytes())
  };
}
