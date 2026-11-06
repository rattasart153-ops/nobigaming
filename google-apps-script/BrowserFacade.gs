/**
 * Browser-callable typed facade.
 *
 * Only the named functions below are callable by the HTML client.
 * The generic dispatcher and validation helpers end in "_" and are private
 * to the Apps Script runtime. Never add a browser-supplied IP field here.
 */

var NOBI_BROWSER_FACADE_ACTIONS_ = [
  'catalog','promotions','coupon','couponSuggestions','paymentInfo',
  'createOrder','submitOrderSlip','adminLogin','memberRegister','memberLogin',
  'memberMe','memberLogout','memberChangePassword','adminChangePassword',
  'adminMe','adminLogout','adminDashboard','adminOrders','adminSlipData',
  'adminSetOrderStatus','adminList','adminUpsert','adminDelete',
  'adminMemberLoginLogs','adminMembers','adminSetMemberStatus',
  'adminStoreMedia','publicMediaData'
];

function nobiFacadePayload_(value, allowedKeys, requiredKeys) {
  if (value == null) value = {};
  if (typeof value !== 'object' || Array.isArray(value) ||
      Object.prototype.toString.call(value) !== '[object Object]') {
    throw new Error('ข้อมูลคำขอไม่ถูกต้อง');
  }
  var keys = Object.keys(value);
  if (keys.length > allowedKeys.length) throw new Error('ข้อมูลคำขอมีฟิลด์ที่ไม่อนุญาต');
  keys.forEach(function(key) {
    if (allowedKeys.indexOf(key) === -1) throw new Error('ฟิลด์ที่ไม่อนุญาต: ' + key);
  });
  (requiredKeys || []).forEach(function(key) {
    if (!Object.prototype.hasOwnProperty.call(value, key) || value[key] == null || value[key] === '') {
      throw new Error('กรุณาระบุข้อมูล ' + key);
    }
  });
  return value;
}

function nobiFacadeToken_(token) {
  if (token == null) return '';
  if (typeof token !== 'string' || token.length > 512) throw new Error('โทเคนไม่ถูกต้อง');
  return token;
}

function nobiFacadeCall_(action, args) {
  if (NOBI_BROWSER_FACADE_ACTIONS_.indexOf(action) === -1) {
    throw new Error('ไม่อนุญาตให้เรียกการทำงานนี้');
  }
  return dispatchGatewayAction_(action, args || {});
}

function nobiGetCatalog() {
  return nobiFacadeCall_('catalog', {});
}

function nobiGetPromotions() {
  return nobiFacadeCall_('promotions', {});
}

function nobiValidateCoupon(input) {
  var p = nobiFacadePayload_(input, ['code','gameId','subtotal','playerId','memberToken'], ['gameId','subtotal']);
  return nobiFacadeCall_('coupon', {
    code:String(p.code || ''), gameId:String(p.gameId || ''),
    subtotal:Number(p.subtotal), playerId:String(p.playerId || ''),
    member_token:nobiFacadeToken_(p.memberToken)
  });
}

function nobiGetCouponSuggestions(input) {
  var p = nobiFacadePayload_(input, ['gameId','subtotal','playerId','memberToken'], ['gameId','subtotal']);
  return nobiFacadeCall_('couponSuggestions', {
    gameId:String(p.gameId || ''), subtotal:Number(p.subtotal),
    playerId:String(p.playerId || ''), member_token:nobiFacadeToken_(p.memberToken)
  });
}

function nobiGetPaymentInfo(input) {
  var p = nobiFacadePayload_(input, ['amount'], []);
  return nobiFacadeCall_('paymentInfo', {amount:p.amount});
}

function nobiCreateOrder(input) {
  var p = nobiFacadePayload_(input,
    ['requestKey','gameId','packageId','playerId','serverId','couponCode','memberToken'],
    ['requestKey','gameId','packageId','playerId']);
  return nobiFacadeCall_('createOrder', {
    request_key:String(p.requestKey), game_id:String(p.gameId),
    package_id:String(p.packageId), player_id:String(p.playerId),
    server_id:String(p.serverId || ''), coupon_code:String(p.couponCode || ''),
    member_token:nobiFacadeToken_(p.memberToken)
  });
}

function nobiSubmitOrderSlip(input) {
  var p = nobiFacadePayload_(input, ['orderId','checkoutToken','slip'], ['orderId','checkoutToken','slip']);
  var slip = nobiFacadePayload_(p.slip, ['name','mimeType','base64'], ['mimeType','base64']);
  if (typeof slip.base64 !== 'string' || slip.base64.length > 4194304) {
    throw new Error('ไฟล์สลิปมีขนาดเกินกำหนด');
  }
  return nobiFacadeCall_('submitOrderSlip', {
    order_id:String(p.orderId), checkout_token:String(p.checkoutToken),
    slip:{name:String(slip.name || 'slip'),mimeType:String(slip.mimeType),base64:slip.base64}
  });
}

function nobiRegisterMember(input) {
  var p = nobiFacadePayload_(input, ['fullName','loginId','password'], ['fullName','loginId','password']);
  return nobiFacadeCall_('memberRegister', {
    fullName:String(p.fullName), loginId:String(p.loginId), password:String(p.password)
  });
}

function nobiLoginMember(input) {
  var p = nobiFacadePayload_(input, ['loginId','password','userAgent'], ['loginId','password']);
  return nobiFacadeCall_('memberLogin', {
    loginId:String(p.loginId), password:String(p.password),
    userAgent:String(p.userAgent || '').slice(0,300)
  });
}

function nobiGetMemberSession(token) {
  return nobiFacadeCall_('memberMe', {token:nobiFacadeToken_(token)});
}

function nobiLogoutMember(token) {
  return nobiFacadeCall_('memberLogout', {token:nobiFacadeToken_(token)});
}

function nobiChangeMemberPassword(input) {
  var p = nobiFacadePayload_(input, ['token','currentPassword','newPassword'], ['token','currentPassword','newPassword']);
  return nobiFacadeCall_('memberChangePassword', {
    token:nobiFacadeToken_(p.token), currentPassword:String(p.currentPassword),
    newPassword:String(p.newPassword)
  });
}

function nobiLoginAdmin(input) {
  var p = nobiFacadePayload_(input, ['username','password'], ['username','password']);
  return nobiFacadeCall_('adminLogin', {username:String(p.username),password:String(p.password)});
}

function nobiGetAdminSession(token) {
  return nobiFacadeCall_('adminMe', {token:nobiFacadeToken_(token)});
}

function nobiLogoutAdmin(token) {
  return nobiFacadeCall_('adminLogout', {token:nobiFacadeToken_(token)});
}

function nobiChangeAdminPassword(input) {
  var p = nobiFacadePayload_(input, ['token','currentPassword','newPassword'], ['token','currentPassword','newPassword']);
  return nobiFacadeCall_('adminChangePassword', {
    token:nobiFacadeToken_(p.token), currentPassword:String(p.currentPassword),
    newPassword:String(p.newPassword)
  });
}

function nobiGetAdminDashboard(token) {
  return nobiFacadeCall_('adminDashboard', {token:nobiFacadeToken_(token)});
}

function nobiGetAdminOrders(token) {
  return nobiFacadeCall_('adminOrders', {token:nobiFacadeToken_(token)});
}

function nobiGetAdminSlip(input) {
  var p = nobiFacadePayload_(input, ['token','orderId'], ['token','orderId']);
  return nobiFacadeCall_('adminSlipData', {token:nobiFacadeToken_(p.token),orderId:String(p.orderId)});
}

function nobiSetAdminOrderStatus(input) {
  var p = nobiFacadePayload_(input, ['token','orderId','status'], ['token','orderId','status']);
  return nobiFacadeCall_('adminSetOrderStatus', {
    token:nobiFacadeToken_(p.token),orderId:String(p.orderId),status:String(p.status)
  });
}

function nobiListAdminRecords(input) {
  var p = nobiFacadePayload_(input, ['token','tableName'], ['token','tableName']);
  return nobiFacadeCall_('adminList', {token:nobiFacadeToken_(p.token),tableName:String(p.tableName)});
}

function nobiUpsertAdminRecord(input) {
  var p = nobiFacadePayload_(input, ['token','tableName','record'], ['token','tableName','record']);
  if (!p.record || typeof p.record !== 'object' || Array.isArray(p.record)) throw new Error('ข้อมูลรายการไม่ถูกต้อง');
  return nobiFacadeCall_('adminUpsert', {
    token:nobiFacadeToken_(p.token),tableName:String(p.tableName),record:p.record
  });
}

function nobiDeleteAdminRecord(input) {
  var p = nobiFacadePayload_(input, ['token','tableName','id'], ['token','tableName','id']);
  return nobiFacadeCall_('adminDelete', {
    token:nobiFacadeToken_(p.token),tableName:String(p.tableName),id:String(p.id)
  });
}

function nobiGetAdminMemberLoginLogs(input) {
  var p = nobiFacadePayload_(input, ['token','memberId','limit'], ['token']);
  return nobiFacadeCall_('adminMemberLoginLogs', {
    token:nobiFacadeToken_(p.token),memberId:String(p.memberId || ''),
    limit:p.limit == null ? 100 : Number(p.limit)
  });
}

function nobiGetAdminMembers(input) {
  var p = nobiFacadePayload_(input, ['token','search','limit'], ['token']);
  return nobiFacadeCall_('adminMembers', {
    token:nobiFacadeToken_(p.token),search:String(p.search || ''),
    limit:p.limit == null ? 200 : Number(p.limit)
  });
}

function nobiSetAdminMemberStatus(input) {
  var p = nobiFacadePayload_(input, ['token','memberId','status'], ['token','memberId','status']);
  return nobiFacadeCall_('adminSetMemberStatus', {
    token:nobiFacadeToken_(p.token),memberId:String(p.memberId),status:String(p.status)
  });
}

function nobiUploadAdminMedia(input) {
  var p = nobiFacadePayload_(input, ['token','media'], ['token','media']);
  var media = nobiFacadePayload_(p.media, ['name','mimeType','base64'], ['mimeType','base64']);
  if (typeof media.base64 !== 'string' || media.base64.length > 4194304) {
    throw new Error('ไฟล์ภาพมีขนาดเกินกำหนด');
  }
  return nobiFacadeCall_('adminStoreMedia', {
    token:nobiFacadeToken_(p.token),
    media:{name:String(media.name || 'media'),mimeType:String(media.mimeType),base64:media.base64}
  });
}

function nobiGetPublicMedia(fileId) {
  if (typeof fileId !== 'string' || fileId.length > 200) throw new Error('รหัสรูปภาพไม่ถูกต้อง');
  return nobiFacadeCall_('publicMediaData', {fileId:fileId});
}
