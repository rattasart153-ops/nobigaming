/** Schema v1 validation for Admin-managed catalog records. */

function validateRecord_(tableName, record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error('ข้อมูลไม่ถูกต้อง');
  }

  const required = {
    games: ['name', 'category'],
    packages: ['game_id', 'name', 'amount', 'unit', 'price_satang'],
    coupons: ['code_normalized', 'discount_type', 'discount_value', 'access_type'],
    promotions: ['title']
  }[tableName];

  if (!required) throw new Error('ไม่อนุญาตให้แก้ไขตารางนี้');
  required.forEach(function(field) {
    if (record[field] === undefined || record[field] === null || String(record[field]).trim() === '') {
      throw new Error('ต้องระบุ ' + field);
    }
  });

  if (tableName === 'packages') {
    if (!Number.isFinite(Number(record.amount)) || Number(record.amount) <= 0 ||
        !Number.isFinite(Number(record.price_satang)) || Number(record.price_satang) < 0) {
      throw new Error('ข้อมูลแพ็กเกจไม่ถูกต้อง');
    }
  }

  if (tableName === 'coupons') {
    if (!['fixed', 'percent'].includes(String(record.discount_type)) ||
        !Number.isFinite(Number(record.discount_value)) || Number(record.discount_value) <= 0 ||
        (record.discount_type === 'percent' && Number(record.discount_value) > 100)) {
      throw new Error('ข้อมูลส่วนลดไม่ถูกต้อง');
    }
    if (!['public', 'member_only', 'member_game_spend'].includes(String(record.access_type))) {
      throw new Error('รูปแบบสิทธิ์คูปองไม่ถูกต้อง');
    }
    ['min_order_satang', 'member_min_game_spend_satang', 'min_player_spend_satang'].forEach(function(field) {
      if (record[field] !== undefined && (!Number.isFinite(Number(record[field])) || Number(record[field]) < 0)) {
        throw new Error('เงื่อนไขยอดใช้จ่ายไม่ถูกต้อง');
      }
    });
    if (record.access_type === 'member_game_spend' &&
        (!record.member_spend_game_id || Number(record.member_min_game_spend_satang || 0) <= 0)) {
      throw new Error('ต้องกำหนดเกมและยอดเติมสะสมขั้นต่ำสำหรับคูปองสมาชิก');
    }
    if ((record.allowed_player_ids_json || Number(record.min_player_spend_satang || 0) > 0) && !record.game_id) {
      throw new Error('ต้องเลือกเกมเมื่อจำกัด UID หรือกำหนดยอดเติมสะสมของ UID');
    }
    if (record.expires_at && !Number.isFinite(couponExpiryCutoff_(record.expires_at))) {
      throw new Error('วันหมดอายุคูปองไม่ถูกต้อง');
    }
    if (record.usage_limit !== '' && record.usage_limit !== null && record.usage_limit !== undefined &&
        (!Number.isSafeInteger(Number(record.usage_limit)) || Number(record.usage_limit) < 1)) {
      throw new Error('จำนวนสิทธิ์คูปองต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป');
    }
  }

  if ((tableName === 'packages' || tableName === 'promotions') && record.image_url) {
    const imageUrl = String(record.image_url);
    if (!/^\/api\/public\/media\/[A-Za-z0-9_-]{10,100}$/.test(imageUrl)) {
      throw new Error('รูปภาพต้องอัปโหลดผ่านระบบจัดเก็บส่วนตัวของ Google Drive');
    }
  }

  if (tableName === 'promotions' && record.link_url) {
    let parsed;
    try { parsed = new URL(String(record.link_url)); } catch (ignored) {}
    if (!parsed || !['https:', 'http:'].includes(parsed.protocol)) {
      throw new Error('ลิงก์โปรโมชันไม่ถูกต้อง');
    }
  }
}
