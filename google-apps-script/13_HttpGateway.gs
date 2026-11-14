/**
 * Nobi Topup signed server-to-server HTTP gateway.
 *
 * Configure NOBI_GATEWAY_SECRET in Apps Script Script Properties.
 * The secret must match APPS_SCRIPT_SHARED_SECRET in the Vercel environment.
 * Never deploy the Web App until the gateway and all persistence actions are tested.
 */

const NOBI_GATEWAY = {
  VERSION: 1,
  MAX_CLOCK_SKEW_MS: 5 * 60 * 1000,
  MAX_BODY_CHARS: 7 * 1024 * 1024,
  NONCE_RETENTION_MS: 10 * 60 * 1000,
  ALLOWED_ACTIONS: [
    'catalog',
    'promotions',
    'coupon',
    'couponSuggestions',
    'paymentInfo',
    'createOrder',
    'submitOrderSlip',
    'adminLogin',
    'memberRegister',
    'memberLogin',
    'memberDashboard',
    'memberOrders',
    'memberMe',
    'memberLogout',
    'memberChangePassword',
    'adminChangePassword',
    'adminMe',
    'adminLogout',
    'adminDashboard',
    'adminOrders',
    'adminSlipData',
    'adminSetOrderStatus',
    'adminList',
    'adminUpsert',
    'adminDelete',
    'adminMemberLoginLogs',
    'adminMembers',
    'adminSetMemberStatus',
    'adminStoreMedia',
    'publicMediaData'
  ]
};

/**
 * Apps Script Web App entry point.
 * Apps Script ContentService does not expose arbitrary HTTP status codes;
 * callers must inspect the signed JSON envelope's "ok" field.
 */
function doPost(e) {
  try {
    const raw = e && e.postData && e.postData.contents ? String(e.postData.contents) : '';
    if (!raw || raw.length > NOBI_GATEWAY.MAX_BODY_CHARS) {
      return gatewayJson_({ok:false, version:NOBI_GATEWAY.VERSION, error:{code:'INVALID_BODY',message:'Invalid request body'}});
    }

    let envelope;
    try { envelope = JSON.parse(raw); }
    catch (ignored) {
      return gatewayJson_({ok:false, version:NOBI_GATEWAY.VERSION, error:{code:'INVALID_JSON',message:'Invalid JSON'}});
    }

    const verified = verifyGatewayEnvelope_(envelope);
    if (!verified.ok) {
      return gatewayJson_({ok:false, version:NOBI_GATEWAY.VERSION, error:verified.error});
    }

    const result = dispatchGatewayAction_(envelope.action, envelope.args || {});
    return gatewayJson_({ok:true, version:NOBI_GATEWAY.VERSION, result:result});
  } catch (error) {
    // Do not return stack traces, properties, or internal identifiers.
    return gatewayJson_({
      ok:false,
      version:NOBI_GATEWAY.VERSION,
      error:{code:gatewayErrorCode_(error),message:safeGatewayMessage_(error)}
    });
  }
}

function gatewayJson_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function verifyGatewayEnvelope_(envelope) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    return {ok:false,error:{code:'INVALID_ENVELOPE',message:'Invalid request envelope'}};
  }
  if (Number(envelope.version) !== NOBI_GATEWAY.VERSION) {
    return {ok:false,error:{code:'UNSUPPORTED_VERSION',message:'Unsupported gateway version'}};
  }
  const timestamp = Number(envelope.timestamp);
  const now = Date.now();
  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > NOBI_GATEWAY.MAX_CLOCK_SKEW_MS) {
    return {ok:false,error:{code:'STALE_REQUEST',message:'Request timestamp is outside the allowed window'}};
  }
  const nonce = String(envelope.nonce || '');
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(nonce)) {
    return {ok:false,error:{code:'INVALID_NONCE',message:'Invalid request nonce'}};
  }
  const action = String(envelope.action || '');
  if (NOBI_GATEWAY.ALLOWED_ACTIONS.indexOf(action) === -1) {
    return {ok:false,error:{code:'ACTION_NOT_ALLOWED',message:'Action is not allowed'}};
  }
  if (!envelope.args || typeof envelope.args !== 'object' || Array.isArray(envelope.args)) {
    return {ok:false,error:{code:'INVALID_ARGUMENTS',message:'Invalid action arguments'}};
  }

  const secret = String(PropertiesService.getScriptProperties().getProperty('NOBI_GATEWAY_SECRET') || '');
  if (secret.length < 32) {
    return {ok:false,error:{code:'GATEWAY_NOT_CONFIGURED',message:'Gateway authentication is not configured'}};
  }

  const canonical = gatewayCanonical_(envelope);
  const expected = bytesToHex_(Utilities.computeHmacSha256Signature(canonical, secret));
  const supplied = String(envelope.signature || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(supplied) || !constantTimeHexEqual_(expected, supplied)) {
    return {ok:false,error:{code:'INVALID_SIGNATURE',message:'Request authentication failed'}};
  }

  if (!claimGatewayNonce_(nonce, timestamp)) {
    return {ok:false,error:{code:'REPLAYED_REQUEST',message:'Request nonce has already been used'}};
  }
  return {ok:true};
}

/** Keep canonical property order identical to the Node.js client. */
function gatewayCanonical_(envelope) {
  return JSON.stringify({
    version:Number(envelope.version),
    timestamp:Number(envelope.timestamp),
    nonce:String(envelope.nonce),
    action:String(envelope.action),
    args:envelope.args || {}
  });
}

function claimGatewayNonce_(nonce, timestamp) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ssId = PropertiesService.getScriptProperties().getProperty('NOBI_SHEET_ID');
    if (!ssId) throw new Error('DATABASE_NOT_INITIALIZED');
    const checked = databaseAssertSchema_('gateway_nonces');
    const sheet = checked.sheet;
    let lastRow = sheet.getLastRow();
    const cutoff = Date.now() - NOBI_GATEWAY.NONCE_RETENTION_MS;

    // Rows are appended under this lock using server time, so timestamps remain ordered.
    // Binary-search the first unexpired row instead of scanning an ever-growing sheet.
    if (lastRow > 1) {
      let low = 2;
      let high = lastRow + 1;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        const created = Date.parse(String(sheet.getRange(middle, 2).getValue() || ''));
        if (!Number.isFinite(created)) throw new Error('GATEWAY_NONCE_LEDGER_CORRUPT');
        if (created >= cutoff) high = middle;
        else low = middle + 1;
      }
      if (low > 2) sheet.deleteRows(2, low - 2);
      lastRow = sheet.getLastRow();
    }

    const activeRows = Math.max(0, lastRow - 1);
    if (activeRows >= 5000) throw new Error('NONCE_STORE_FULL');
    const nonceHash = sha256_(nonce);
    if (activeRows) {
      const hashes = sheet.getRange(2, 1, activeRows, 1).getValues();
      for (let i = 0; i < hashes.length; i++) {
        if (String(hashes[i][0]) === nonceHash) return false;
      }
    }
    sheet.appendRow([nonceHash, new Date().toISOString()]);
    return true;
  } finally {
    lock.releaseLock();
  }
}

function constantTimeHexEqual_(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function bytesToHex_(bytes) {
  return bytes.map(function(value) {
    const byte = value < 0 ? value + 256 : value;
    return ('0' + byte.toString(16)).slice(-2);
  }).join('');
}

function safeGatewayMessage_(error) {
  const message = String(error && error.message || '');
  if (/^DATABASE_NOT_INITIALIZED$/.test(message)) return 'Database has not been initialized';
  if (/^GATEWAY_SCHEMA_MISSING$/.test(message)) return 'Gateway schema is missing';
  if (/คูปอง|UID|เกม|แพ็กเกจ|สลิป|ออเดอร์|หมดเวลา|ไม่พบ|ไม่ถูกต้อง/.test(message)) return message.slice(0, 240);
  return 'The request could not be completed';
}


function gatewayErrorCode_(error) {
  const message = String(error && error.message || '');
  if (/GATEWAY_NOT_CONFIGURED/.test(message)) return 'GATEWAY_NOT_CONFIGURED';
  if (/UNTRUSTED_SOURCE_IP/.test(message)) return 'UNTRUSTED_SOURCE_IP';
  if (/RATE_LIMITED|RATE_LIMIT_STORE_FULL|NONCE_STORE_FULL|ลองเข้าสู่ระบบใหม่ภายหลัง/.test(message)) return 'RATE_LIMITED';
  if (/เซสชัน|กรุณาเข้าสู่ระบบ|ชื่อผู้ใช้หรือรหัสผ่าน|Login ID หรือรหัสผ่าน|บัญชีสมาชิกถูกระงับ|สิทธิ์อัปโหลด/.test(message)) return 'UNAUTHENTICATED';
  if (/หมดเวลา|หมดอายุ/.test(message)) return 'RESOURCE_EXPIRED';
  if (/IDEMPOTENCY_CONFLICT|ถูกใช้ครบจำนวน|มีอยู่แล้ว|ไม่สามารถเปลี่ยนสถานะซ้ำ|อ้างอิงอยู่/.test(message)) return 'RESOURCE_CONFLICT';
  if (/ไม่พบ/.test(message)) return 'RESOURCE_NOT_FOUND';
  if (/ไม่ถูกต้อง|กรุณา|ต้องระบุ|ต้องมี|ต้องเลือก|ข้อมูล/.test(message)) return 'VALIDATION_FAILED';
  return 'GATEWAY_EXECUTION_FAILED';
}
