/** Nobi Topup Apps Script 08_Admin module. */

function adminDashboard(token) {
  requireAdmin_(token);
  const orders = rows_('orders');
  return {orders:orders.length,pending:orders.filter(o=>o.status==='Pending').length,completed:orders.filter(o=>o.status==='Completed').length,revenue:money_(orders.filter(o=>o.status==='Completed').reduce((s,o)=>s+Number(o.total||0),0))};
}

function adminOrders(token) {
  requireAdmin_(token);
  return rows_('orders').sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))).map(function(o) {
    const safe = clean_(publicOrder_(o));
    safe.slip_file_id = o.slip_file_id; // ID only; use adminSlipData for authorized retrieval.
    return safe;
  });
}

function adminSlipData(token, orderId) {
  requireAdmin_(token);
  const order = rows_('orders').find(o => String(o.id) === String(orderId));
  if (!order || !order.slip_file_id) throw new Error('ไม่พบสลิป');
  const file = DriveApp.getFileById(String(order.slip_file_id));
  const blob = file.getBlob();
  return {name:file.getName(),mimeType:blob.getContentType(),base64:Utilities.base64Encode(blob.getBytes())};
}

function adminSetOrderStatus(token, orderId, status) {
  requireAdmin_(token);
  if (!['Pending','Completed','Rejected'].includes(String(status))) throw new Error('สถานะไม่ถูกต้อง');
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const order = rows_('orders').find(o=>String(o.id)===String(orderId));
    if (!order) throw new Error('ไม่พบออเดอร์');
    if (String(order.status) !== 'Pending' && String(order.status) !== String(status)) throw new Error('ออเดอร์ที่ตรวจสอบแล้วไม่สามารถเปลี่ยนสถานะซ้ำได้');
    updateById_('orders',order.id,{status:status,updated_at:new Date().toISOString()});
    return {ok:true};
  } finally { lock.releaseLock(); }
}

function adminList(token, tableName) {
  requireAdmin_(token);
  if (!['games','packages','coupons','promotions'].includes(String(tableName))) throw new Error('ไม่อนุญาตให้เข้าถึงตารางนี้');
  return rows_(tableName).map(clean_);
}

function adminUpsert(token, tableName, record) {
  requireAdmin_(token);
  if (!['games','packages','coupons','promotions'].includes(String(tableName))) throw new Error('ไม่อนุญาตให้แก้ไขตารางนี้');
  record = record || {};
  const headers = NOBI.SHEETS[tableName];
  const safe = {};
  headers.forEach(h => { if (h !== 'id' && h !== 'created_at' && Object.prototype.hasOwnProperty.call(record,h)) safe[h] = record[h]; });
  validateRecord_(tableName,safe);
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    if (record.id) {
      updateById_(tableName,record.id,safe);
      return {ok:true,id:record.id};
    }
    safe.id = Utilities.getUuid();
    safe.created_at = new Date().toISOString();
    append_(tableName,safe);
    return {ok:true,id:safe.id};
  } finally { lock.releaseLock(); }
}

function adminDelete(token, tableName, id) {
  requireAdmin_(token);
  if (!['games','packages','coupons','promotions'].includes(String(tableName))) throw new Error('ไม่อนุญาตให้ลบตารางนี้');
  const sh = sheet_(tableName), data = sh.getDataRange().getValues(), headers = data[0], idx = headers.indexOf('id');
  for (let i=1;i<data.length;i++) if (String(data[i][idx])===String(id)) { sh.deleteRow(i+1); return {ok:true}; }
  throw new Error('ไม่พบรายการ');
}
