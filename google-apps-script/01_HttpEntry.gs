/** Resolve an optional Member identity from a verified server-side session. */
function gatewayOptionalMemberId_(token) {
  if (!String(token || '')) return '';
  try {
    const member = requireMember_(token);
    return String(member.member_id || '');
  } catch (error) {
    const message = String(error && error.message || '');
    if (/セッション|ログイン|アカウント|เซสชันสมาชิก|กรุณาเข้าสู่ระบบสมาชิก|บัญชีสมาชิกถูกระงับ|ถูกระงับ|เพิกถอน|ไม่มีการใช้งาน/.test(message)) return '';
    throw error;
  }
}

/** HTTP-only action dispatcher. Browser clients use the Vercel REST API. */
function dispatchGatewayAction_(action, args) {
  args = args || {};
  switch (String(action || '')) {
    case 'catalog': return publicCatalog();
    case 'promotions': return publicPromotions();
    case 'coupon': return validateCoupon(args.code, args.gameId, args.subtotal, args.playerId, gatewayOptionalMemberId_(args.member_token));
    case 'couponSuggestions': return couponSuggestions_(args.gameId, args.subtotal, args.playerId, gatewayOptionalMemberId_(args.member_token));
    case 'paymentInfo': return paymentInfo_(args.amount);
    case 'createOrder': return createOrder(args);
    case 'submitOrderSlip': return submitOrderSlip(args);
    case 'adminLogin': return adminLogin(args.username, args.password, args.ipAddress);
    case 'memberRegister': return memberRegister(args.fullName, args.loginId, args.password, args.ipAddress);
    case 'memberLogin': return memberLogin(args.loginId, args.password, args.ipAddress, args.userAgent);
    case 'memberMe':
      try { return memberMe(args.token); }
      catch (error) {
        if (/เซสชัน|กรุณาเข้าสู่ระบบ|บัญชีสมาชิกถูกระงับ|เพิกถอน/.test(String(error && error.message || ''))) {
          return {authenticated:false};
        }
        throw error;
      }
    case 'memberLogout': return memberLogout(args.token);
    case 'memberChangePassword': return memberChangePassword(args.token, args.currentPassword, args.newPassword);
    case 'adminChangePassword': return adminChangePassword(args.token, args.currentPassword, args.newPassword, args.ipAddress);
    case 'adminMe':
      try { requireAdmin_(args.token); return {authenticated:true}; }
      catch (error) {
        if (/เซสชัน|กรุณาเข้าสู่ระบบ|ถูกเพิกถอน/.test(String(error && error.message || ''))) {
          return {authenticated:false};
        }
        throw error;
      }
    case 'adminLogout': return adminLogout(args.token);
    case 'adminDashboard': return adminDashboard(args.token);
    case 'adminOrders': return adminOrders(args.token);
    case 'adminSlipData': return adminSlipData(args.token, args.orderId, args.ipAddress);
    case 'adminSetOrderStatus': return adminSetOrderStatus(args.token, args.orderId, args.status, args.ipAddress);
    case 'adminList': return adminList(args.token, args.tableName);
    case 'adminUpsert': return adminUpsert(args.token, args.tableName, args.record, args.ipAddress);
    case 'adminDelete': return adminDelete(args.token, args.tableName, args.id, args.ipAddress);
    case 'adminMemberLoginLogs': return adminMemberLoginLogs(args.token, args.memberId, args.limit);
    case 'adminMembers': return adminMembers(args.token, args.search, args.limit);
    case 'adminSetMemberStatus': return adminSetMemberStatus(args.token, args.memberId, args.status, args.ipAddress);
    case 'adminStoreMedia': return adminStoreMedia(args.token, args.media, args.ipAddress);
    case 'publicMediaData': return publicMediaData(args.fileId);
    default: throw new Error('Action is not allowed');
  }
}
