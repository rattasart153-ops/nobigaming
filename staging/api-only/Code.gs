// ===== SOURCE: google-apps-script/00_Config.gs =====
/** Nobi Topup Apps Script configuration and versioned Sheets schema. */
const NOBI = {
  SCHEMA_VERSION: 6,
  SCHEMA_VERSION_KEY: 'schema_version',
  SHEETS: {
    admins: ['admin_id','username_normalized','username_display','password_hash','password_salt','password_algorithm','status','auth_version','created_at','updated_at','last_login_at'],
    admin_sessions: ['session_id','admin_id','token_hash','auth_version','created_at','expires_at','last_seen_at','revoked_at','created_ip'],
    members: ['member_id','full_name','login_id_normalized','login_id_display','password_hash','password_salt','password_algorithm','status','auth_version','registered_ip','last_login_ip','created_at','updated_at','last_login_at'],
    member_sessions: ['session_id','member_id','token_hash','auth_version','created_at','expires_at','last_seen_at','revoked_at','created_ip'],
    member_login_logs: ['log_id','member_id','login_id_normalized','ip_address','is_new_ip','login_result','failure_reason_code','user_agent','created_at'],
    admin_audit_logs: ['audit_id','admin_id','action','target_type','target_id','request_id','ip_address','details_json','created_at'],
    games: ['game_id','name','category','description','active','sort_order','created_at','updated_at'],
    packages: ['package_id','game_id','name','amount','unit','price_satang','image_file_id','image_url','popular','active','sort_order','created_at','updated_at'],
    coupons: ['coupon_id','code_normalized','code_display','discount_type','discount_value','min_order_satang','game_id','access_type','member_spend_game_id','member_min_game_spend_satang','expires_at','usage_limit','active','allowed_player_ids_json','min_player_spend_satang','created_at','updated_at'],
    coupon_redemptions: ['redemption_id','coupon_id','order_id','member_id','player_id','game_id','discount_satang','state','reserved_at','reserved_until','finalized_at','released_at'],
    member_coupon_alerts: ['alert_id','member_coupon_key','member_id','coupon_id','last_stage','notified_at','created_at','updated_at'],
    promotions: ['promotion_id','title','subtitle','image_file_id','image_url','link_url','active','sort_order','starts_at','ends_at','created_at','updated_at'],
    banners: ['banner_id','title','subtitle','image_file_id','image_url','link_url','active','sort_order','starts_at','ends_at','created_at','updated_at'],
    wallets: ['member_id','paid_balance_satang','bonus_balance_satang','wallet_version','created_at','updated_at'],
    wallet_ledger: ['ledger_id','transaction_id','member_id','credit_type','entry_type','delta_satang','balance_after_satang','reference_type','reference_id','idempotency_key','actor_type','actor_id','reason','created_at'],
    wallet_topups: ['topup_id','member_id','amount_satang','status','payment_method','payment_reference','slip_file_id','slip_mime_type','slip_size_bytes','submitted_at','reviewed_by_admin_id','reviewed_at','rejection_reason','idempotency_key','payload_hash','created_at','updated_at'],
    wallet_holds: ['hold_id','order_id','member_id','status','total_satang','paid_reserved_satang','bonus_reserved_satang','created_at','expires_at','captured_at','released_at'],
    wallet_hold_allocations: ['allocation_id','hold_id','credit_type','bonus_grant_id','amount_satang','allocation_order','created_at'],
    wallet_bonus_grants: ['bonus_grant_id','member_id','granted_satang','remaining_satang','source_type','source_id','reason','starts_at','expires_at','status','created_by_admin_id','created_at','updated_at'],
    wallet_recovery_journal: ['journal_id','operation','transaction_id','idempotency_key','payload_hash','member_id','hold_id','topup_id','step_state','ledger_payload_json','wallet_patch_json','bonus_patch_json','order_patch_json','topup_patch_json','audit_patch_json','attempts','last_error_code','created_at','updated_at'],
    orders: ['order_id','order_number','request_key','member_id','game_id','package_id','player_id','server_id','coupon_id','subtotal_satang','discount_satang','total_satang','slip_file_id','slip_mime_type','slip_size_bytes','slip_submitted_at','checkout_token_hash','status','status_reason','payment_expires_at','created_at','updated_at','completed_at','rejected_at','payment_method','wallet_hold_id'],
    idempotency_records: ['idempotency_id','scope','request_key','payload_hash','resource_id','state','created_at','expires_at'],
    order_recovery_journal: ['journal_id','order_id','operation','order_record_json','idempotency_record_json','redemption_record_json','order_patch_json','redemption_id','redemption_patch_json','state','attempts','last_error_code','created_at','updated_at'],
    system_metadata: ['key','value','updated_at'],
    gateway_nonces: ['nonce_hash','created_at'],
    security_rate_limits: ['bucket_key_hash','window_start','attempt_count','blocked_until','updated_at']
  },
  SESSION_MAX_LIFETIME_MS: 8 * 60 * 60 * 1000,
  SESSION_IDLE_TIMEOUT_MS: 30 * 60 * 1000,
  LOG_RETENTION_DAYS: 90,
  MAX_SLIP_BYTES: 3 * 1024 * 1024
};

// ===== SOURCE: google-apps-script/01_HttpEntry.gs =====
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
    case 'banners': return publicBanners();
    case 'coupon': return validateCoupon(args.code, args.gameId, args.subtotal, args.playerId, gatewayOptionalMemberId_(args.member_token));
    case 'couponSuggestions': return couponSuggestions_(args.gameId, args.subtotal, args.playerId, gatewayOptionalMemberId_(args.member_token));
    case 'paymentInfo': return paymentInfo_(args.amount);
    case 'createOrder': return createOrder(args);
    case 'submitOrderSlip': return submitOrderSlip(args);
    case 'adminLogin': return adminLogin(args.username, args.password);
    case 'memberRegister': return memberRegister(args.fullName, args.loginId, args.password);
    case 'memberLogin': return memberLogin(args.loginId, args.password, args.userAgent);
    case 'memberDashboard': return memberDashboard(args.token);
    case 'memberCreateWalletTopup': return memberCreateWalletTopup(args.token,args);
    case 'memberSubmitWalletTopupProof': return memberSubmitWalletTopupProof(args.token,args);
    case 'memberWalletTopups': return memberWalletTopups(args.token,args.limit);
    case 'memberOrders': return memberOrders(args.token, args.limit);
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
    case 'adminChangePassword': return adminChangePassword(args.token, args.currentPassword, args.newPassword);
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
    case 'adminWalletTopups': return adminWalletTopups(args.token,args.status,args.limit);
    case 'adminWalletTopupProof': return adminWalletTopupProof(args.token,args.topupId);
    case 'adminApproveWalletTopup': return adminApproveWalletTopup(args.token,args);
    case 'adminRejectWalletTopup': return adminRejectWalletTopup(args.token,args);
    case 'adminGrantPaidCredit': return adminGrantPaidCredit(args.token,args);
    case 'adminCreateBonusGrant': return adminCreateBonusGrant(args.token,args);
    case 'adminOrders': return adminOrders(args.token);
    case 'adminSlipData': return adminSlipData(args.token, args.orderId);
    case 'adminSetOrderStatus': return adminSetOrderStatus(args.token, args.orderId, args.status);
    case 'adminList': return adminList(args.token, args.tableName);
    case 'adminUpsert': return adminUpsert(args.token, args.tableName, args.record);
    case 'adminDelete': return adminDelete(args.token, args.tableName, args.id);
    case 'adminMemberLoginLogs': return adminMemberLoginLogs(args.token, args.memberId, args.limit);
    case 'adminMembers': return adminMembers(args.token, args.search, args.limit);
    case 'adminSetMemberStatus': return adminSetMemberStatus(args.token, args.memberId, args.status);
    case 'adminStoreMedia': return adminStoreMedia(args.token, args.media);
    case 'publicMediaData': return publicMediaData(args.fileId);
    default: throw new Error('Action is not allowed');
  }
}

// ===== SOURCE: google-apps-script/02_Database.gs =====
/** Nobi Topup versioned, non-destructive Google Sheets setup and data helpers. */

function setupNobiDatabase() {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const props = PropertiesService.getScriptProperties();
    const configuredId = String(props.getProperty('NOBI_SHEET_ID') || '').trim();
    const ss = configuredId
      ? SpreadsheetApp.openById(configuredId)
      : SpreadsheetApp.create('Nobi Topup Database');

    // Preflight every existing sheet before making any schema changes.
    const metadataSheet = ss.getSheetByName('system_metadata');
    let currentVersion = '';
    if (metadataSheet) {
      const metadataHeaders = databaseHeaders_(metadataSheet);
      if (metadataHeaders.length && !databaseHeadersMatch_(metadataHeaders, NOBI.SHEETS.system_metadata)) {
        throw new Error('SCHEMA_INCOMPATIBLE: system_metadata headers do not match the expected schema.');
      }
      const metadataValues = metadataSheet.getLastRow() > 1
        ? metadataSheet.getDataRange().getValues().slice(1)
        : [];
      const versionRow = metadataValues.find(row => String(row[0]) === NOBI.SCHEMA_VERSION_KEY);
      if (versionRow) currentVersion = String(versionRow[1] || '');
      else if (metadataValues.length) {
        throw new Error('SCHEMA_VERSION_MISSING: existing metadata has no schema version; manual review is required.');
      }
    }

    const supportedUpgrade = currentVersion === '5' && Number(NOBI.SCHEMA_VERSION) === 6;
    if (currentVersion && currentVersion !== String(NOBI.SCHEMA_VERSION) && !supportedUpgrade) {
      throw new Error('SCHEMA_VERSION_UNSUPPORTED: expected version ' + NOBI.SCHEMA_VERSION + ' but found ' + currentVersion + '.');
    }

    Object.keys(NOBI.SHEETS).forEach(function(name) {
      const sheet = ss.getSheetByName(name);
      if (!sheet) return;
      const headers = databaseHeaders_(sheet);
      const expectedHeaders = name === 'orders' && currentVersion === '5'
        ? NOBI.SHEETS.orders.slice(0, -2)
        : NOBI.SHEETS[name];
      const alreadyUpgradedOrders = name === 'orders' && currentVersion === '5' &&
        databaseHeadersMatch_(headers, NOBI.SHEETS.orders);
      if (headers.length && !databaseHeadersMatch_(headers, expectedHeaders) && !alreadyUpgradedOrders) {
        throw new Error('SCHEMA_INCOMPATIBLE: ' + name + ' headers do not match the expected schema. No data was changed.');
      }
      if (sheet.getLastRow() > 0 && !headers.length) {
        throw new Error('SCHEMA_INCOMPATIBLE: ' + name + ' contains rows without a header row. No data was changed.');
      }
      if (sheet.getLastRow() > 1 && !currentVersion) {
        throw new Error('SCHEMA_VERSION_MISSING: ' + name + ' contains rows but the database has no schema version. No data was changed.');
      }
    });

    // Only after the full preflight succeeds may missing/empty sheets be initialized.
    Object.keys(NOBI.SHEETS).forEach(function(name) {
      let sheet = ss.getSheetByName(name);
      if (!sheet) sheet = ss.insertSheet(name);
      if (sheet.getLastRow() === 0) {
        sheet.getRange(1, 1, 1, NOBI.SHEETS[name].length).setValues([NOBI.SHEETS[name]]);
      } else if (name === 'orders' && currentVersion === '5' &&
          databaseHeadersMatch_(databaseHeaders_(sheet), NOBI.SHEETS.orders.slice(0, -2))) {
        // Additive v5 -> v6 migration: preserve every existing order row and append two blank columns.
        sheet.getRange(1, NOBI.SHEETS.orders.length - 1, 1, 2).setValues([['payment_method','wallet_hold_id']]);
      }
      sheet.setFrozenRows(1);
    });

    const metadata = ss.getSheetByName('system_metadata');
    const values = metadata.getDataRange().getValues();
    const versionIndex = values.findIndex(function(row, index) {
      return index > 0 && String(row[0]) === NOBI.SCHEMA_VERSION_KEY;
    });
    const now = new Date().toISOString();
    if (versionIndex === -1) {
      metadata.appendRow([NOBI.SCHEMA_VERSION_KEY, String(NOBI.SCHEMA_VERSION), now]);
    } else {
      metadata.getRange(versionIndex + 1, 2).setValue(String(NOBI.SCHEMA_VERSION));
      metadata.getRange(versionIndex + 1, 3).setValue(now);
    }

    // Persist the spreadsheet reference only after every schema check and write succeeds.
    props.setProperty('NOBI_SHEET_ID', ss.getId());
    return {
      ok: true,
      schemaVersion: NOBI.SCHEMA_VERSION,
      sheetCount: Object.keys(NOBI.SHEETS).length,
      message: 'Versioned database schema initialized. No catalog data or Admin account was seeded.'
    };
  } finally {
    lock.releaseLock();
  }
}

function databaseHeaders_(sheet) {
  const lastColumn = sheet.getLastColumn();
  if (sheet.getLastRow() === 0 || lastColumn === 0) return [];
  return sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(String);
}

function databaseHeadersMatch_(actual, expected) {
  return actual.length === expected.length && expected.every(function(header, index) {
    return actual[index] === header;
  });
}

function sheet_(name) {
  if (!NOBI.SHEETS[name]) throw new Error('DATABASE_TABLE_NOT_ALLOWED: ' + name);
  const id = PropertiesService.getScriptProperties().getProperty('NOBI_SHEET_ID');
  if (!id) throw new Error('Run setupNobiDatabase first.');
  const sheet = SpreadsheetApp.openById(id).getSheetByName(name);
  if (!sheet) throw new Error('Missing sheet: ' + name);
  return sheet;
}

function rows_(name) {
  return repositoryRows_(name);
}

function databaseAssertSchema_(name) {
  const headers = NOBI.SHEETS[name];
  if (!headers) throw new Error('DATABASE_TABLE_NOT_ALLOWED: ' + name);
  const sh = sheet_(name);
  if (!databaseHeadersMatch_(databaseHeaders_(sh), headers)) {
    throw new Error('DATABASE_SCHEMA_MISMATCH: ' + name);
  }
  return { sheet: sh, headers: headers };
}

function databaseAssertRecordFields_(name, record, allowPrimaryKey) {
  const schema = NOBI.SHEETS[name];
  if (!schema || !record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error('DATABASE_INVALID_RECORD');
  }
  Object.keys(record).forEach(function(field) {
    if (schema.indexOf(field) === -1) {
      throw new Error('DATABASE_FIELD_NOT_ALLOWED: ' + name + '.' + field);
    }
    if (!allowPrimaryKey && field === schema[0]) {
      throw new Error('DATABASE_PRIMARY_KEY_IMMUTABLE: ' + name + '.' + field);
    }
  });
  return schema;
}

function append_(name, record) {
  return repositoryInsert_(name, record);
}

function deleteById_(name, id) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try { return repositoryDeleteLocked_(name, id); }
  finally { lock.releaseLock(); }
}

function updateById_(name, id, patch) {
  return repositoryUpdate_(name, id, patch);
}

// ===== SOURCE: google-apps-script/03_Catalog.gs =====
/** Nobi Topup Apps Script catalog queries backed by Schema v1. */

function publicCatalog() {
  const games = repositoryRows_('games').filter(function(row) {
    return truth_(row.active);
  }).sort(function(a, b) {
    return Number(a.sort_order || 0) - Number(b.sort_order || 0);
  });

  const packages = repositoryRows_('packages').filter(function(row) {
    return truth_(row.active) && games.some(function(game) {
      return String(game.game_id) === String(row.game_id);
    });
  }).sort(function(a, b) {
    return Number(a.sort_order || 0) - Number(b.sort_order || 0);
  });

  return {
    games: games.map(function(game) {
      return {
        id: game.game_id,
        name: game.name,
        category: game.category,
        description: game.description,
        active: truth_(game.active)
      };
    }),
    packages: packages.map(function(pack) {
      const game = games.find(function(item) {
        return String(item.game_id) === String(pack.game_id);
      });
      return {
        id: pack.package_id,
        game_id: pack.game_id,
        name: pack.name,
        amount: Number(pack.amount || 0),
        unit: pack.unit,
        price: Number(pack.price_satang || 0) / 100,
        image_url: catalogImageUrl_(pack.image_file_id, pack.image_url),
        popular: truth_(pack.popular),
        active: truth_(pack.active),
        game_name: game ? game.name : ''
      };
    })
  };
}

function publicPromotions() {
  const now = Date.now();
  return repositoryRows_('promotions').filter(function(row) {
    const starts = row.starts_at ? Date.parse(row.starts_at) : NaN;
    const ends = row.ends_at ? Date.parse(row.ends_at) : NaN;
    return truth_(row.active) &&
      (!row.starts_at || (Number.isFinite(starts) && starts <= now)) &&
      (!row.ends_at || (Number.isFinite(ends) && ends >= now));
  }).sort(function(a, b) {
    return Number(a.sort_order || 0) - Number(b.sort_order || 0);
  }).map(function(row) {
    return {
      id: row.promotion_id,
      title: row.title,
      subtitle: row.subtitle,
      image_url: catalogImageUrl_(row.image_file_id, row.image_url),
      link_url: row.link_url || '',
      active: truth_(row.active),
      starts_at: row.starts_at,
      ends_at: row.ends_at
    };
  });
}


function publicBanners() {
  const now = Date.now();
  return repositoryRows_('banners').filter(function(row) {
    const starts = row.starts_at ? Date.parse(row.starts_at) : NaN;
    const ends = row.ends_at ? Date.parse(row.ends_at) : NaN;
    return truth_(row.active) &&
      (!row.starts_at || (Number.isFinite(starts) && starts <= now)) &&
      (!row.ends_at || (Number.isFinite(ends) && ends >= now)) &&
      (String(row.image_file_id || '').trim() || (/^https:\/\//i.test(String(row.image_url || '').trim()) && !/drive\.google\.com|googleusercontent\.com/i.test(String(row.image_url || ''))));
  }).sort(function(a, b) {
    return Number(a.sort_order || 0) - Number(b.sort_order || 0);
  }).map(function(row) {
    return {
      id: row.banner_id,
      title: row.title || '',
      subtitle: row.subtitle || '',
      image_url: catalogImageUrl_(row.image_file_id, row.image_url),
      link_url: row.link_url || '',
      sort_order: Number(row.sort_order || 0)
    };
  });
}

function catalogImageUrl_(fileId, fallbackUrl) {
  const id = String(fileId || '').trim();
  if (id) return '/api/public/media/' + encodeURIComponent(id);
  const fallback = String(fallbackUrl || '').trim();
  return /^https:\/\//i.test(fallback) || /^\/(?!\/)/.test(fallback) ? fallback : '';
}

// ===== SOURCE: google-apps-script/04_Coupons.gs =====
/** Coupon eligibility against Schema v1; all persisted money values are satang. */

function couponExpiryCutoff_(expiresAt) {
  const expiryText = String(expiresAt || '').trim();
  const match = expiryText.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);
  if (!match || (expiryText.length > 10 && !Number.isFinite(Date.parse(expiryText)))) return NaN;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (calendarDate.getUTCFullYear() !== year || calendarDate.getUTCMonth() !== month - 1 ||
      calendarDate.getUTCDate() !== day) return NaN;
  // Date-only expiry is inclusive through 23:59:59.999 Asia/Bangkok (UTC+7).
  return Date.UTC(year, month - 1, day + 1) - 7 * 60 * 60 * 1000;
}

function couponEligibility_(coupon, gameId, subtotalSatang, playerId, memberId, nowMs) {
  if (!coupon || !truth_(coupon.active)) return {valid:false, error:'คูปองปิดใช้งาน'};
  if (!Number.isSafeInteger(Number(subtotalSatang)) || Number(subtotalSatang) < 0) {
    return {valid:false, error:'ยอดซื้อไม่ถูกต้อง'};
  }
  const discountType = String(coupon.discount_type || '');
  const discountValue = Number(coupon.discount_value);
  if (!['fixed','percent'].includes(discountType) || !Number.isFinite(discountValue) ||
      discountValue <= 0 || (discountType === 'fixed' && !Number.isSafeInteger(discountValue)) ||
      (discountType === 'percent' && discountValue > 100)) {
    return {valid:false, error:'ข้อมูลส่วนลดของคูปองไม่ถูกต้อง'};
  }
  const minimumOrder = Number(coupon.min_order_satang || 0);
  const playerMinimum = Number(coupon.min_player_spend_satang || 0);
  if (!Number.isSafeInteger(minimumOrder) || minimumOrder < 0 ||
      !Number.isSafeInteger(playerMinimum) || playerMinimum < 0) {
    return {valid:false, error:'เงื่อนไขยอดใช้จ่ายของคูปองไม่ถูกต้อง'};
  }
  if (coupon.usage_limit !== '' && coupon.usage_limit !== null && coupon.usage_limit !== undefined &&
      (!Number.isSafeInteger(Number(coupon.usage_limit)) || Number(coupon.usage_limit) < 1)) {
    return {valid:false, error:'จำนวนสิทธิ์คูปองไม่ถูกต้อง'};
  }
  if (playerMinimum > 0 && !coupon.game_id) {
    return {valid:false, error:'คูปองยอดสะสม UID ต้องกำหนดเกม'};
  }
  if (coupon.expires_at) {
    const cutoff = couponExpiryCutoff_(coupon.expires_at);
    if (!Number.isFinite(cutoff) || nowMs >= cutoff) return {valid:false, error:'คูปองหมดอายุแล้ว'};
  }
  if (Number(subtotalSatang) < minimumOrder) return {valid:false, error:'ยอดซื้อไม่ถึงขั้นต่ำ'};
  if (coupon.game_id && String(coupon.game_id) !== String(gameId)) return {valid:false, error:'คูปองนี้ใช้กับเกมที่เลือกไม่ได้'};

  const uid = String(playerId || '').trim();
  let allowedIds = [];
  if (coupon.allowed_player_ids_json) {
    try {
      allowedIds = JSON.parse(String(coupon.allowed_player_ids_json));
      if (!Array.isArray(allowedIds)) throw new Error('invalid allowlist');
    } catch (ignored) {
      return {valid:false, error:'ข้อมูลเงื่อนไขคูปองไม่ถูกต้อง'};
    }
  }
  if (allowedIds.length && !allowedIds.map(String).includes(uid)) {
    return {valid:false, error:'คูปองนี้จำกัดเฉพาะ UID ที่แอดมินกำหนด'};
  }

  if (coupon.access_type === 'member_only' || coupon.access_type === 'member_game_spend' || coupon.access_type === 'member_total_spend') {
    if (!memberId) return {valid:false, error:'คูปองนี้สำหรับสมาชิกเท่านั้น กรุณาเข้าสู่ระบบ'};
    const member = repositoryGetById_('members', memberId);
    if (!member || member.status !== 'Active') return {valid:false, error:'ไม่พบสมาชิกหรือบัญชีสมาชิกถูกระงับ'};
  } else if (coupon.access_type !== 'public') {
    return {valid:false, error:'รูปแบบสิทธิ์คูปองไม่ถูกต้อง'};
  }

  if (coupon.access_type === 'member_game_spend' || coupon.access_type === 'member_total_spend') {
    const qualifyingGame = String(coupon.member_spend_game_id || '');
    const minimum = Number(coupon.member_min_game_spend_satang);
    if (!Number.isSafeInteger(minimum) || minimum <= 0 ||
        (coupon.access_type === 'member_game_spend' && !qualifyingGame)) {
      return {valid:false, error:'ข้อมูลเงื่อนไขสมาชิกของคูปองไม่ครบ'};
    }
    const cutoff = nowMs - 30 * 24 * 60 * 60 * 1000;
    const spent = repositoryRows_('orders').filter(function(order) {
      const completedAt = Date.parse(String(order.completed_at || ''));
      return String(order.member_id) === String(memberId) &&
        order.status === 'Completed' && Number.isFinite(completedAt) &&
        completedAt >= cutoff && completedAt <= nowMs &&
        (coupon.access_type !== 'member_game_spend' || String(order.game_id) === qualifyingGame);
    }).reduce(function(sum, order) {
      const amount = Number(order.total_satang);
      return Number.isSafeInteger(sum) && Number.isSafeInteger(amount) && amount >= 0 &&
        Number.isSafeInteger(sum + amount) ? sum + amount : NaN;
    }, 0);
    if (!Number.isSafeInteger(spent) || spent < minimum) {
      const scope = coupon.access_type === 'member_game_spend' ? 'ในเกมที่กำหนด' : 'รวมทุกเกม';
      return {valid:false, error:'ยอดซื้อสะสมย้อนหลัง 30 วัน' + scope + 'ยังไม่ถึง ฿' + (minimum / 100).toLocaleString('th-TH')};
    }
  }

  if (playerMinimum > 0) {
    const playerSpent = repositoryRows_('orders').filter(function(order) {
      return String(order.player_id) === uid &&
        String(order.game_id) === String(gameId) && order.status === 'Completed';
    }).reduce(function(sum, order) {
      const amount = Number(order.total_satang);
      return Number.isSafeInteger(sum) && Number.isSafeInteger(amount) && amount >= 0 &&
        Number.isSafeInteger(sum + amount) ? sum + amount : NaN;
    }, 0);
    if (!Number.isSafeInteger(playerSpent) || playerSpent < playerMinimum) {
      return {valid:false, error:'UID นี้มียอดเติมสะสมในเกมที่เลือกยังไม่ถึง ฿' + (playerMinimum / 100).toLocaleString('th-TH')};
    }
  }

  const redemptions = repositoryRows_('coupon_redemptions').filter(function(item) {
    return String(item.coupon_id) === String(coupon.coupon_id) &&
      (item.state === 'Reserved' || item.state === 'Consumed');
  }).length;
  if (coupon.usage_limit !== '' && coupon.usage_limit !== null &&
      coupon.usage_limit !== undefined && redemptions >= Number(coupon.usage_limit)) {
    return {valid:false, error:'คูปองถูกใช้ครบจำนวนแล้ว'};
  }

  const discountSatang = discountType === 'percent'
    ? Math.floor(Number(subtotalSatang) * discountValue / 100)
    : Math.round(discountValue);
  const finalDiscount = Math.min(subtotalSatang, Math.max(0, discountSatang));
  return {
    valid:true,
    code:coupon.code_display,
    coupon_id:coupon.coupon_id,
    discount:finalDiscount / 100,
    discount_satang:finalDiscount,
    total:(subtotalSatang - finalDiscount) / 100,
    total_satang:subtotalSatang - finalDiscount,
    expires_at:coupon.expires_at || ''
  };
}

function validateCoupon(code, gameId, subtotal, playerId, memberId, skipExpirySweep) {
  if (!skipExpirySweep) expirePendingOrders_();
  const normalized = String(code || '').trim().toUpperCase();
  const amount = Number(subtotal);
  if (!normalized || !Number.isFinite(amount) || amount < 0) {
    return {valid:false, error:'ข้อมูลคูปองไม่ถูกต้อง'};
  }
  const coupon = repositoryRows_('coupons').find(function(item) {
    return String(item.code_normalized).toUpperCase() === normalized;
  });
  if (!coupon) return {valid:false, error:'ไม่พบคูปองหรือคูปองปิดใช้งาน'};
  return couponEligibility_(coupon, gameId, Math.round(amount * 100), playerId, memberId, Date.now());
}

function couponSuggestions_(gameId, subtotal, playerId, memberId) {
  expirePendingOrders_();
  const amount = Number(subtotal);
  if (!Number.isFinite(amount) || amount < 0) return {suggestion:null};
  const candidates = repositoryRows_('coupons').map(function(coupon) {
    return couponEligibility_(coupon, gameId, Math.round(amount * 100), playerId, memberId, Date.now());
  }).filter(function(result) { return result.valid; });
  candidates.sort(function(a, b) { return b.discount_satang - a.discount_satang; });
  return {
    suggestion: candidates.length ? {
      code:candidates[0].code,
      discount:candidates[0].discount,
      message:'ประหยัด ' + money_(candidates[0].discount) + ' บาท'
    } : null
  };
}

// ===== SOURCE: google-apps-script/05_Payments.gs =====
/** Nobi Topup Apps Script 05_Payments module. */

function promptPayField_(id, value) {
  const text = String(value);
  if (text.length > 99) throw new Error('PROMPTPAY_FIELD_TOO_LONG');
  return id + ('0' + text.length).slice(-2) + text;
}

function promptPayCrc16_(value) {
  let crc = 0xffff;
  const text = String(value);
  for (let i = 0; i < text.length; i++) {
    crc ^= text.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xffff;
    }
  }
  return ('0000' + crc.toString(16).toUpperCase()).slice(-4);
}

function promptPayPayload_(promptpayId, amount) {
  const raw = String(promptpayId || '').trim();
  if (!raw || !/^[0-9().+ -]+$/.test(raw)) throw new Error('PROMPTPAY_ID_INVALID');
  const digits = raw.replace(/[().+ -]/g, '');
  let type;
  let target;
  if (/^0[0-9]{9}$/.test(digits)) {
    type = '01';
    target = '0066' + digits.slice(1);
  } else if (/^66[0-9]{9}$/.test(digits)) {
    type = '01';
    target = '00' + digits;
  } else if (/^[0-9]{13}$/.test(digits)) {
    type = '02';
    target = digits;
  } else if (/^[0-9]{15}$/.test(digits)) {
    type = '03';
    target = digits;
  } else {
    throw new Error('PROMPTPAY_ID_INVALID');
  }

  const input = Number(amount == null || amount === '' ? 0 : amount);
  if (!Number.isFinite(input) || input < 0) throw new Error('PROMPTPAY_AMOUNT_INVALID');
  const rounded = Math.round((input + Number.EPSILON) * 100) / 100;
  if (input > 0 && rounded === 0) throw new Error('PROMPTPAY_AMOUNT_INVALID');
  const parts = [
    promptPayField_('00', '01'),
    promptPayField_('01', rounded > 0 ? '12' : '11'),
    promptPayField_('29', promptPayField_('00', 'A000000677010111') + promptPayField_(type, target)),
    promptPayField_('58', 'TH'),
    promptPayField_('53', '764')
  ];
  if (rounded > 0) parts.push(promptPayField_('54', rounded.toFixed(2)));
  const body = parts.join('') + '6304';
  return body + promptPayCrc16_(body);
}

function paymentInfo_(amount) {
  const props = PropertiesService.getScriptProperties();
  const promptpayId = String(props.getProperty('NOBI_PROMPTPAY_ID') || '').trim();
  if (!promptpayId) return {configured:false,message:'ร้านยังไม่ได้ตั้งค่า PromptPay'};
  const value = Number(amount == null || amount === '' ? 0 : amount);
  if (!Number.isFinite(value) || value < 0) throw new Error('PROMPTPAY_AMOUNT_INVALID');
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  if (value > 0 && rounded <= 0) throw new Error('PROMPTPAY_AMOUNT_INVALID');
  return {
    configured:true,
    promptpayId:promptpayId,
    amount:rounded,
    payload:promptPayPayload_(promptpayId, rounded)
  };
}

// ===== SOURCE: google-apps-script/06_Orders.gs =====
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

function imageUint32BE_(bytes, offset) {
  return (((bytes[offset] << 24) >>> 0) +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3]) >>> 0;
}

function imageCrc32_(bytes, start, end) {
  let crc = 0xffffffff;
  for (let i = start; i < end; i++) {
    crc = (crc ^ bytes[i]) >>> 0;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 1) ? ((crc >>> 1) ^ 0xedb88320) >>> 0 : (crc >>> 1);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function validPngStructure_(bytes) {
  const signature = [137,80,78,71,13,10,26,10];
  if (bytes.length < 45 || signature.some(function(value, index) { return bytes[index] !== value; })) return false;
  let offset = 8, hasHeader = false, hasData = false, hasEnd = false;
  while (offset + 12 <= bytes.length) {
    const length = imageUint32BE_(bytes, offset);
    const typeStart = offset + 4;
    const dataStart = offset + 8;
    const crcOffset = dataStart + length;
    const nextOffset = crcOffset + 4;
    if (nextOffset > bytes.length) return false;
    const type = String.fromCharCode.apply(null, bytes.slice(typeStart, typeStart + 4));
    if (!hasHeader && (type !== 'IHDR' || length !== 13)) return false;
    if (type === 'IHDR') {
      if (hasHeader || length !== 13 ||
          imageUint32BE_(bytes, dataStart) === 0 ||
          imageUint32BE_(bytes, dataStart + 4) === 0) return false;
      hasHeader = true;
    } else if (type === 'IDAT') {
      if (!hasHeader || hasEnd) return false;
      hasData = true;
    } else if (type === 'IEND') {
      if (!hasData || length !== 0 || hasEnd) return false;
      hasEnd = true;
      if (nextOffset !== bytes.length) return false;
    } else if (hasEnd) {
      return false;
    }
    if (imageCrc32_(bytes, typeStart, crcOffset) !== imageUint32BE_(bytes, crcOffset)) return false;
    offset = nextOffset;
    if (hasEnd) return true;
  }
  return false;
}

function validJpegStructure_(bytes) {
  if (bytes.length < 12 || bytes[0] !== 255 || bytes[1] !== 216 ||
      bytes[bytes.length - 2] !== 255 || bytes[bytes.length - 1] !== 217) return false;
  let offset = 2, hasFrame = false;
  while (offset < bytes.length - 2) {
    if (bytes[offset] !== 255) return false;
    while (offset < bytes.length && bytes[offset] === 255) offset++;
    if (offset >= bytes.length) return false;
    const marker = bytes[offset++];
    if (marker === 0xd9) return hasFrame && offset === bytes.length;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return false;
    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return false;
    if ((marker >= 0xc0 && marker <= 0xcf) &&
        ![0xc4,0xc8,0xcc].includes(marker)) hasFrame = true;
    if (marker === 0xda) return hasFrame && offset + segmentLength <= bytes.length - 2;
    offset += segmentLength;
  }
  return false;
}

function validWebpStructure_(bytes) {
  if (bytes.length < 20 ||
      String.fromCharCode.apply(null, bytes.slice(0, 4)) !== 'RIFF' ||
      String.fromCharCode.apply(null, bytes.slice(8, 12)) !== 'WEBP' ||
      imageUint32BE_([bytes[7],bytes[6],bytes[5],bytes[4]], 0) !== bytes.length - 8) return false;
  let offset = 12, hasImageChunk = false;
  while (offset + 8 <= bytes.length) {
    const type = String.fromCharCode.apply(null, bytes.slice(offset, offset + 4));
    const length = imageUint32BE_([bytes[offset + 7],bytes[offset + 6],bytes[offset + 5],bytes[offset + 4]], 0);
    const end = offset + 8 + length;
    if (end > bytes.length) return false;
    if (type === 'VP8 ' || type === 'VP8L' || type === 'VP8X') hasImageChunk = length > 0;
    offset = end + (length % 2);
  }
  return hasImageChunk && offset === bytes.length;
}

function validImageSignature_(bytes, mime) {
  const b = bytes.map(function(value) { return (value + 256) % 256; });
  if (mime === 'image/png') return validPngStructure_(b);
  if (mime === 'image/jpeg') return validJpegStructure_(b);
  if (mime === 'image/webp') return validWebpStructure_(b);
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

// ===== SOURCE: google-apps-script/07_Auth.gs =====
/** Admin authentication with Schema v1 sessions and bounded lifetime/idle expiry. */

function initializeAdmin() {
  const props = PropertiesService.getScriptProperties();
  const username = String(props.getProperty('NOBI_ADMIN_USERNAME') || '').trim();
  const password = String(props.getProperty('NOBI_ADMIN_PASSWORD') || '');
  if (!/^[A-Za-z0-9._-]{4,40}$/.test(username) || password.length < 14) {
    throw new Error('กำหนด NOBI_ADMIN_USERNAME และ NOBI_ADMIN_PASSWORD ที่มีความยาวอย่างน้อย 14 ตัวอักษรก่อน');
  }
  if (repositoryRows_('admins').length) throw new Error('มีบัญชี Admin อยู่แล้ว ไม่ได้เปลี่ยนแปลงข้อมูล');

  const now = new Date().toISOString();
  const salt = Utilities.getUuid() + Utilities.getUuid();
  const admin = {
    admin_id:Utilities.getUuid(),
    username_normalized:username.toLowerCase(),
    username_display:username,
    password_hash:passwordHash_(password, salt),
    password_salt:salt,
    password_algorithm:'PBKDF2-SHA256-120000',
    status:'Active',
    auth_version:1,
    created_at:now,
    updated_at:now,
    last_login_at:''
  };
  repositoryInsert_('admins', admin);
  props.deleteProperty('NOBI_ADMIN_PASSWORD');
  return {ok:true, message:'สร้างบัญชี Admin แล้ว และลบค่า bootstrap password ออกจาก Script Properties แล้ว'};
}

function adminLogin(username, password) {
  const user = String(username || '').trim();
  const normalized = user.toLowerCase();
  const pass = String(password || '');
  if (!user || !pass) throw new Error('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  consumeLoginAttempt_('ADMIN_LOGIN_ATTEMPT', normalized, 10);
  assertAccountNotBlocked_('ADMIN_ACCOUNT', normalized);

  // Password KDF is intentionally outside ScriptLock so a slow login cannot
  // block order creation, coupon reservations, or other users' sessions.
  const admin = repositoryRows_('admins').find(function(item) {
    return String(item.username_normalized) === normalized && item.status === 'Active';
  });
  const valid = Boolean(admin && passwordVerify_(pass, admin.password_salt, admin.password_hash, admin.password_algorithm));
  if (!valid) {
    const lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try { incrementAccountFailureLocked_('ADMIN_ACCOUNT', normalized, Date.now()); }
    finally { lock.releaseLock(); }
    throw new Error('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    pruneExpiredSessionsLocked_(Date.now());
    assertRateLimitBucketNotBlockedLocked_('ADMIN_ACCOUNT', normalized, Date.now());
    const currentAdmin = repositoryGetById_('admins', admin.admin_id);
    if (!currentAdmin || currentAdmin.status !== 'Active' ||
        String(currentAdmin.password_hash) !== String(admin.password_hash) ||
        Number(currentAdmin.auth_version) !== Number(admin.auth_version)) {
      throw new Error('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    }

    resetAccountFailureLocked_('ADMIN_ACCOUNT', normalized);
    const rawToken = Utilities.getUuid() + '.' + Utilities.getUuid() + '.' + Utilities.getUuid();
    const now = new Date();
    const createdAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + NOBI.SESSION_MAX_LIFETIME_MS).toISOString();
    repositoryInsertLocked_('admin_sessions', {
      session_id:Utilities.getUuid(),
      admin_id:currentAdmin.admin_id,
      token_hash:sha256_(rawToken),
      auth_version:Number(currentAdmin.auth_version || 1),
      created_at:createdAt,
      expires_at:expiresAt,
      last_seen_at:createdAt,
      revoked_at:'',
      created_ip:''
    });
    repositoryUpdateLocked_('admins', currentAdmin.admin_id, {
      last_login_at:createdAt,
      updated_at:createdAt
    });
    appendAdminAuditLogLocked_({
      audit_id:Utilities.getUuid(),
      admin_id:currentAdmin.admin_id,
      action:'ADMIN_LOGIN',
      target_type:'admin',
      target_id:currentAdmin.admin_id,
      request_id:'',
      ip_address:'',
      details_json:'{}',
      created_at:createdAt
    });
    return {ok:true, token:rawToken, expires_at:expiresAt, username:currentAdmin.username_display};
  } finally {
    lock.releaseLock();
  }
}
function adminLogout(token) {
  const tokenHash = sha256_(String(token || ''));
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const session = repositoryFindByField_('admin_sessions', 'token_hash', tokenHash)
      .find(function(item) { return !item.revoked_at; });
    if (session) repositoryUpdateLocked_('admin_sessions', session.session_id, {
      revoked_at:new Date().toISOString()
    });
    return {ok:true};
  } finally {
    lock.releaseLock();
  }
}

function requireAdmin_(token) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { return requireAdminLocked_(token, Date.now()); }
  finally { lock.releaseLock(); }
}

/** Caller must already hold ScriptLock. Used to make privileged multi-step reads atomic with revocation. */
function requireAdminLocked_(token, nowMs) {
  const tokenValue = String(token || '');
  if (!tokenValue) throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
  const tokenHash = sha256_(tokenValue);
  // Re-read and validate under the same lock used by revocation/password changes.
  const session = repositoryFindByField_('admin_sessions', 'token_hash', tokenHash)[0];
  const now = Number(nowMs) || Date.now();
  if (!session || session.revoked_at || !Number.isFinite(Date.parse(session.expires_at)) ||
      Date.parse(session.expires_at) <= now) {
    throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
  }
  const lastSeen = Date.parse(session.last_seen_at || session.created_at);
  if (!Number.isFinite(lastSeen) || now - lastSeen >= NOBI.SESSION_IDLE_TIMEOUT_MS) {
    repositoryUpdateLocked_('admin_sessions', session.session_id, {revoked_at:new Date(now).toISOString()});
    throw new Error('เซสชันไม่มีการใช้งานเกินกำหนด กรุณาเข้าสู่ระบบใหม่');
  }
  const admin = repositoryGetById_('admins', session.admin_id);
  if (!admin || admin.status !== 'Active' ||
      Number(admin.auth_version) !== Number(session.auth_version)) {
    throw new Error('เซสชันถูกเพิกถอน กรุณาเข้าสู่ระบบใหม่');
  }
  repositoryUpdateLocked_('admin_sessions', session.session_id, {
    last_seen_at:new Date(now).toISOString()
  });
  return admin;
}
function memberRegister(fullName, loginId, password) {
  const name = String(fullName || '').trim();
  const login = String(loginId || '').trim();
  const normalized = login.toLowerCase();
  const pass = String(password || '');
  if (!name || name.length > 100 || !/^[A-Za-z0-9]{4,30}$/.test(login) || !/^[A-Za-z0-9]{8,200}$/.test(pass)) {
    throw new Error('กรุณากรอกชื่อ Login ID (ภาษาอังกฤษ/ตัวเลข 4-30 ตัว) และรหัสผ่านภาษาอังกฤษ/ตัวเลข 8-200 ตัว');
  }
  consumeRegistrationAttempt_(normalized);

  // Compute the password KDF before acquiring the global write lock.
  const salt = Utilities.getUuid() + Utilities.getUuid();
  const passwordHash = passwordHash_(pass, salt);
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    if (repositoryFindByField_('members', 'login_id_normalized', normalized).length) {
      throw new Error('Login ID นี้ถูกใช้งานแล้ว');
    }
    const now = new Date().toISOString();
    const member = {
      member_id:Utilities.getUuid(),
      full_name:name,
      login_id_normalized:normalized,
      login_id_display:login,
      password_hash:passwordHash,
      password_salt:salt,
      password_algorithm:'PBKDF2-SHA256-120000',
      status:'Active',
      auth_version:1,
      registered_ip:'',
      last_login_ip:'',
      created_at:now,
      updated_at:now,
      last_login_at:''
    };
    repositoryInsertLocked_('members', member);
    return {ok:true, member_id:member.member_id};
  } finally {
    lock.releaseLock();
  }
}

function memberLogin(loginId, password, userAgent) {
  const login = String(loginId || '').trim();
  const normalized = login.toLowerCase();
  const pass = String(password || '');
  const agent = String(userAgent || '').slice(0, 300);
  if (!login || !pass) throw new Error('Login ID หรือรหัสผ่านไม่ถูกต้อง');
  consumeLoginAttempt_('MEMBER_LOGIN_ATTEMPT', normalized, 10);
  try {
    assertAccountNotBlocked_('MEMBER_ACCOUNT', normalized);
  } catch (error) {
    const lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      appendMemberLoginLogLocked_('', normalized, 'Failure', 'RATE_LIMITED', agent, new Date().toISOString());
    } finally { lock.releaseLock(); }
    throw error;
  }

  // PBKDF2 verification stays outside ScriptLock to avoid blocking checkout writes.
  const member = repositoryFindByField_('members', 'login_id_normalized', normalized)[0];
  const valid = Boolean(member && member.status === 'Active' &&
    passwordVerify_(pass, member.password_salt, member.password_hash, member.password_algorithm));
  if (!valid) {
    const lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      incrementAccountFailureLocked_('MEMBER_ACCOUNT', normalized, Date.now());
      appendMemberLoginLogLocked_(member ? member.member_id : '', normalized, 'Failure', 'INVALID_CREDENTIALS', agent, new Date().toISOString());
    } finally { lock.releaseLock(); }
    throw new Error('Login ID หรือรหัสผ่านไม่ถูกต้อง');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    pruneExpiredSessionsLocked_(Date.now());
    assertRateLimitBucketNotBlockedLocked_('MEMBER_ACCOUNT', normalized, Date.now());
    const currentMember = repositoryGetById_('members', member.member_id);
    if (!currentMember || currentMember.status !== 'Active' ||
        String(currentMember.password_hash) !== String(member.password_hash) ||
        Number(currentMember.auth_version) !== Number(member.auth_version)) {
      appendMemberLoginLogLocked_(member.member_id, normalized, 'Failure', 'CREDENTIALS_CHANGED', agent, new Date().toISOString());
      throw new Error('Login ID หรือรหัสผ่านไม่ถูกต้อง');
    }

    resetAccountFailureLocked_('MEMBER_ACCOUNT', normalized);
    const now = new Date();
    const nowIso = now.toISOString();
    const rawToken = Utilities.getUuid() + '.' + Utilities.getUuid() + '.' + Utilities.getUuid();
    const expiresAt = new Date(now.getTime() + NOBI.SESSION_MAX_LIFETIME_MS).toISOString();
    repositoryInsertLocked_('member_sessions', {
      session_id:Utilities.getUuid(),
      member_id:currentMember.member_id,
      token_hash:sha256_(rawToken),
      auth_version:Number(currentMember.auth_version || 1),
      created_at:nowIso,
      expires_at:expiresAt,
      last_seen_at:nowIso,
      revoked_at:'',
      created_ip:''
    });
    repositoryUpdateLocked_('members', currentMember.member_id, {
      last_login_ip:'',
      last_login_at:nowIso,
      updated_at:nowIso
    });
    appendMemberLoginLogLocked_(currentMember.member_id, normalized, 'Success', '', agent, nowIso);
    return {
      ok:true,
      token:rawToken,
      expires_at:expiresAt,
      member:{member_id:currentMember.member_id, full_name:currentMember.full_name, login_id:currentMember.login_id_display}
    };
  } finally {
    lock.releaseLock();
  }
}
function memberLogout(token) {
  const hash = sha256_(String(token || ''));
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const session = repositoryFindByField_('member_sessions', 'token_hash', hash)
      .find(function(item) { return !item.revoked_at; });
    if (session) repositoryUpdateLocked_('member_sessions', session.session_id, {
      revoked_at:new Date().toISOString()
    });
    return {ok:true};
  } finally {
    lock.releaseLock();
  }
}

function requireMember_(token) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { return requireMemberLocked_(token, Date.now()); }
  finally { lock.releaseLock(); }
}

/** Caller must already hold ScriptLock. */
function requireMemberLocked_(token, nowMs) {
  const tokenValue = String(token || '');
  if (!tokenValue) throw new Error('กรุณาเข้าสู่ระบบสมาชิก');
  const session = repositoryFindByField_('member_sessions', 'token_hash', sha256_(tokenValue))[0];
  const now = Number(nowMs) || Date.now();
  if (!session || session.revoked_at || !Number.isFinite(Date.parse(session.expires_at)) ||
      Date.parse(session.expires_at) <= now) {
    throw new Error('เซสชันสมาชิกหมดอายุ กรุณาเข้าสู่ระบบใหม่');
  }
  const lastSeen = Date.parse(session.last_seen_at || session.created_at);
  if (!Number.isFinite(lastSeen) || now - lastSeen >= NOBI.SESSION_IDLE_TIMEOUT_MS) {
    repositoryUpdateLocked_('member_sessions', session.session_id, {revoked_at:new Date(now).toISOString()});
    throw new Error('เซสชันสมาชิกไม่มีการใช้งานเกินกำหนด กรุณาเข้าสู่ระบบใหม่');
  }
  const member = repositoryGetById_('members', session.member_id);
  if (!member || member.status !== 'Active' ||
      Number(member.auth_version) !== Number(session.auth_version)) {
    throw new Error('บัญชีสมาชิกถูกระงับหรือเซสชันถูกเพิกถอน');
  }
  repositoryUpdateLocked_('member_sessions', session.session_id, {
    last_seen_at:new Date(now).toISOString()
  });
  return member;
}
function memberMe(token) {
  const member = requireMember_(token);
  return {
    authenticated:true,
    member:{member_id:member.member_id, full_name:member.full_name, login_id:member.login_id_display}
  };
}

function appendMemberLoginLogLocked_(memberId, loginId, result, reason, userAgent, createdAt) {
  repositoryInsertLocked_('member_login_logs', {
    log_id:Utilities.getUuid(),
    member_id:memberId,
    login_id_normalized:loginId,
    ip_address:'',
    is_new_ip:false,
    login_result:result,
    failure_reason_code:reason,
    user_agent:userAgent,
    created_at:createdAt
  });
  pruneMemberLoginLogsLocked_(Date.parse(createdAt));
}

function pruneMemberLoginLogsLocked_(nowMs) {
  const cutoff = nowMs - NOBI.LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  repositoryRows_('member_login_logs').filter(function(log) {
    const created = Date.parse(String(log.created_at || ''));
    return Number.isFinite(created) && created < cutoff;
  }).forEach(function(log) {
    repositoryDeleteLocked_('member_login_logs', log.log_id);
  });
}


function memberChangePassword(token, currentPassword, newPassword) {
  const authenticated = requireMember_(token);
  const nextPassword = String(newPassword || '');
  if (!/^[A-Za-z0-9]{8,200}$/.test(nextPassword)) throw new Error('รหัสผ่านใหม่ต้องเป็นภาษาอังกฤษ/ตัวเลข 8-200 ตัว');

  // Run the expensive KDF outside ScriptLock; re-check the credential snapshot before commit.
  if (!passwordVerify_(String(currentPassword || ''), authenticated.password_salt,
      authenticated.password_hash, authenticated.password_algorithm)) {
    throw new Error('รหัสผ่านปัจจุบันไม่ถูกต้อง');
  }
  const salt = Utilities.getUuid() + Utilities.getUuid();
  const nextHash = passwordHash_(nextPassword, salt);
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    // Revalidate the live session under the same lock used by logout and revocation.
    const member = requireMemberLocked_(token, Date.now());
    if (String(member.member_id) !== String(authenticated.member_id) ||
        String(member.password_hash) !== String(authenticated.password_hash) ||
        Number(member.auth_version) !== Number(authenticated.auth_version)) {
      throw new Error('ข้อมูลบัญชีเปลี่ยนแปลง กรุณาเข้าสู่ระบบใหม่');
    }
    const now = new Date().toISOString();
    repositoryUpdateLocked_('members', member.member_id, {
      password_hash:nextHash,
      password_salt:salt,
      password_algorithm:'PBKDF2-SHA256-120000',
      auth_version:Number(member.auth_version || 1) + 1,
      updated_at:now
    });
    repositoryRows_('member_sessions').filter(function(session) {
      return String(session.member_id) === String(member.member_id) && !session.revoked_at;
    }).forEach(function(session) {
      repositoryUpdateLocked_('member_sessions', session.session_id, {revoked_at:now});
    });
    return {ok:true, message:'เปลี่ยนรหัสผ่านแล้ว กรุณาเข้าสู่ระบบใหม่'};
  } finally {
    lock.releaseLock();
  }
}

function adminChangePassword(token, currentPassword, newPassword) {
  const authenticated = requireAdmin_(token);
  const nextPassword = String(newPassword || '');
  if (nextPassword.length < 14 || nextPassword.length > 200) throw new Error('รหัสผ่านใหม่ต้องมีความยาว 14-200 ตัวอักษร');

  // Run the expensive KDF outside ScriptLock; re-check the credential snapshot before commit.
  if (!passwordVerify_(String(currentPassword || ''), authenticated.password_salt,
      authenticated.password_hash, authenticated.password_algorithm)) {
    throw new Error('รหัสผ่านปัจจุบันไม่ถูกต้อง');
  }
  const salt = Utilities.getUuid() + Utilities.getUuid();
  const nextHash = passwordHash_(nextPassword, salt);
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    // Revalidate the live session under the same lock used by logout and revocation.
    const admin = requireAdminLocked_(token, Date.now());
    if (String(admin.admin_id) !== String(authenticated.admin_id) ||
        String(admin.password_hash) !== String(authenticated.password_hash) ||
        Number(admin.auth_version) !== Number(authenticated.auth_version)) {
      throw new Error('ข้อมูลบัญชีเปลี่ยนแปลง กรุณาเข้าสู่ระบบใหม่');
    }
    const now = new Date().toISOString();
    repositoryUpdateLocked_('admins', admin.admin_id, {
      password_hash:nextHash,
      password_salt:salt,
      password_algorithm:'PBKDF2-SHA256-120000',
      auth_version:Number(admin.auth_version || 1) + 1,
      updated_at:now
    });
    repositoryRows_('admin_sessions').filter(function(session) {
      return String(session.admin_id) === String(admin.admin_id) && !session.revoked_at;
    }).forEach(function(session) {
      repositoryUpdateLocked_('admin_sessions', session.session_id, {revoked_at:now});
    });
    appendAdminAuditLogLocked_({
      audit_id:Utilities.getUuid(), admin_id:admin.admin_id,
      action:'ADMIN_PASSWORD_CHANGED', target_type:'admin',
      target_id:admin.admin_id, request_id:'', ip_address:'',
      details_json:'{}', created_at:now
    });
    return {ok:true, message:'เปลี่ยนรหัสผ่านแล้ว กรุณาเข้าสู่ระบบใหม่'};
  } finally {
    lock.releaseLock();
  }
}

// ===== SOURCE: google-apps-script/08_Admin.gs =====
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
  assertDriveFolderPrivate_(folder);
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

function assertDriveFolderPrivate_(folder) {
  if (!folder || typeof folder.getSharingAccess !== 'function') {
    throw new Error('DRIVE_FOLDER_INVALID');
  }
  if (typeof folder.getEditors !== 'function' || typeof folder.getViewers !== 'function') {
    throw new Error('DRIVE_ACL_UNVERIFIABLE');
  }
  if (folder.getSharingAccess() !== DriveApp.Access.PRIVATE) {
    throw new Error('DRIVE_FOLDER_NOT_PRIVATE');
  }
  const editors = folder.getEditors();
  const viewers = folder.getViewers();
  if (!Array.isArray(editors) || !Array.isArray(viewers)) {
    throw new Error('DRIVE_ACL_UNVERIFIABLE');
  }
  if (editors.length || viewers.length) {
    throw new Error('DRIVE_RESOURCE_HAS_EXPLICIT_SHARES');
  }
  return true;
}

function assertDriveFileInPrivateFolder_(file, folderId) {
  const expected = String(folderId || '').trim();
  if (!expected || !file || typeof file.getParents !== 'function' ||
      typeof file.getSharingAccess !== 'function') {
    throw new Error('DRIVE_FOLDER_INVALID');
  }
  if (typeof file.getEditors !== 'function' || typeof file.getViewers !== 'function') {
    throw new Error('DRIVE_ACL_UNVERIFIABLE');
  }
  const folder = DriveApp.getFolderById(expected);
  assertDriveFolderPrivate_(folder);
  if (file.getSharingAccess() !== DriveApp.Access.PRIVATE) {
    throw new Error('DRIVE_FILE_NOT_PRIVATE');
  }
  const editors = file.getEditors();
  const viewers = file.getViewers();
  if (!Array.isArray(editors) || !Array.isArray(viewers)) {
    throw new Error('DRIVE_ACL_UNVERIFIABLE');
  }
  if (editors.length || viewers.length) {
    throw new Error('DRIVE_RESOURCE_HAS_EXPLICIT_SHARES');
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
  }) || repositoryRows_('banners').some(function(item) {
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
  const bytes = blob.getBytes();
  if (!bytes.length || bytes.length > NOBI.MAX_SLIP_BYTES) throw new Error('รูปภาพต้องมีขนาดไม่เกิน 3 MB');
  return {
    name:file.getName(),
    mimeType:mimeType,
    base64:Utilities.base64Encode(bytes)
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

// ===== SOURCE: google-apps-script/09_Validation.gs =====
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
    if (!Number.isSafeInteger(Number(record.amount)) || Number(record.amount) <= 0 ||
        !Number.isSafeInteger(Number(record.price_satang)) || Number(record.price_satang) < 0) {
      throw new Error('ข้อมูลแพ็กเกจไม่ถูกต้อง');
    }
  }

  if (tableName === 'coupons') {
    if (!['fixed', 'percent'].includes(String(record.discount_type)) ||
        !Number.isFinite(Number(record.discount_value)) || Number(record.discount_value) <= 0 ||
        (record.discount_type === 'fixed' && !Number.isSafeInteger(Number(record.discount_value))) ||
        (record.discount_type === 'percent' && Number(record.discount_value) > 100)) {
      throw new Error('ข้อมูลส่วนลดไม่ถูกต้อง');
    }
    if (!['public', 'member_only', 'member_game_spend', 'member_total_spend'].includes(String(record.access_type))) {
      throw new Error('รูปแบบสิทธิ์คูปองไม่ถูกต้อง');
    }
    ['min_order_satang', 'member_min_game_spend_satang', 'min_player_spend_satang'].forEach(function(field) {
      if (record[field] !== undefined &&
          (!Number.isSafeInteger(Number(record[field])) || Number(record[field]) < 0)) {
        throw new Error('เงื่อนไขยอดใช้จ่ายไม่ถูกต้อง');
      }
    });
    if (record.access_type === 'member_game_spend' &&
        (!record.member_spend_game_id || Number(record.member_min_game_spend_satang || 0) <= 0)) {
      throw new Error('ต้องกำหนดเกมและยอดเติมสะสมขั้นต่ำสำหรับคูปองสมาชิก');
    }
    if (record.access_type === 'member_total_spend' && Number(record.member_min_game_spend_satang || 0) <= 0) {
      throw new Error('ต้องกำหนดยอดซื้อรวมทุกเกมย้อนหลัง 30 วันขั้นต่ำสำหรับคูปองสมาชิก');
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

  if (tableName === 'promotions') {
    const starts = record.starts_at ? Date.parse(record.starts_at) : NaN;
    const ends = record.ends_at ? Date.parse(record.ends_at) : NaN;
    if ((record.starts_at && !Number.isFinite(starts)) || (record.ends_at && !Number.isFinite(ends)) ||
        (Number.isFinite(starts) && Number.isFinite(ends) && ends < starts)) {
      throw new Error('ช่วงเวลาโปรโมชั่นไม่ถูกต้อง');
    }
  }

  if (tableName === 'promotions' && record.link_url) {
    const link = String(record.link_url).trim();
    const safeRelative = link.charAt(0) === '#' ||
      (link.charAt(0) === '/' && link.charAt(1) !== '/');
    let parsed;
    if (!safeRelative) {
      try { parsed = new URL(link); } catch (ignored) {}
    }
    if (!safeRelative && (!parsed || !['https:', 'http:'].includes(parsed.protocol))) {
      throw new Error('ลิงก์โปรโมชันไม่ถูกต้อง');
    }
  }
}

// ===== SOURCE: google-apps-script/10_Utilities.gs =====
/** Shared security, encoding and money helpers. */

const NOBI_PASSWORD_ITERATIONS = 120000;

function passwordHash_(password, salt) {
  const saltBytes = Utilities.newBlob(String(salt), 'text/plain').getBytes();
  const passwordBytes = Utilities.newBlob(String(password), 'text/plain').getBytes();
  const block = saltBytes.concat([0, 0, 0, 1]);
  let u = Utilities.computeHmacSha256Signature(block, passwordBytes);
  const derived = u.slice();
  for (let i = 1; i < NOBI_PASSWORD_ITERATIONS; i++) {
    u = Utilities.computeHmacSha256Signature(u, passwordBytes);
    for (let j = 0; j < derived.length; j++) derived[j] = derived[j] ^ u[j];
  }
  return Utilities.base64EncodeWebSafe(derived).replace(/=+$/g, '');
}

function passwordVerify_(password, salt, expectedHash, algorithm) {
  if (String(algorithm) !== 'PBKDF2-SHA256-120000') return false;
  const actual = passwordHash_(password, salt);
  const expected = String(expectedHash || '');
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function sha256_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value), Utilities.Charset.UTF_8)
    .map(function(byte) { return ('0' + ((byte + 256) % 256).toString(16)).slice(-2); }).join('');
}

function money_(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function truth_(value) {
  return value === true || value === 1 || String(value).toLowerCase() === 'true';
}

function clean_(record) {
  const output = {};
  Object.keys(record).forEach(function(key) {
    if (key !== 'password_hash' && key !== 'password_salt' && key !== 'token_hash' &&
        key !== 'checkout_token_hash') {
      const value = record[key];
      output[key] = value instanceof Date ? value.toISOString() : value;
    }
  });
  return output;
}


/** Insert Admin audit records and enforce the approved 90-day retention. Caller holds ScriptLock. */
function appendAdminAuditLogLocked_(record) {
  repositoryInsertLocked_('admin_audit_logs', record);
  const cutoff = Date.now() - NOBI.LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  repositoryRows_('admin_audit_logs').filter(function(log) {
    const created = Date.parse(String(log.created_at || ''));
    return Number.isFinite(created) && created < cutoff;
  }).forEach(function(log) {
    repositoryDeleteLocked_('admin_audit_logs', log.audit_id);
  });
}


/** Prune revoked/expired opaque session hashes after the approved 90-day retention. Caller holds ScriptLock. */
function pruneExpiredSessionsLocked_(nowMs) {
  const cutoff = (Number(nowMs) || Date.now()) - NOBI.LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  ['admin_sessions','member_sessions'].forEach(function(tableName) {
    repositoryRows_(tableName).filter(function(session) {
      const terminalAt = session.revoked_at ? Date.parse(session.revoked_at) : Date.parse(session.expires_at);
      return Number.isFinite(terminalAt) && terminalAt < cutoff;
    }).forEach(function(session) {
      repositoryDeleteLocked_(tableName, session.session_id);
    });
  });
}


/** HMAC-hash bucket identities; never persist raw IP addresses or login identifiers. */
function rateLimitBucketHash_(scope, identity) {
  const secret = String(PropertiesService.getScriptProperties().getProperty('NOBI_GATEWAY_SECRET') || '');
  if (secret.length < 32) throw new Error('GATEWAY_NOT_CONFIGURED');
  const signature = Utilities.computeHmacSha256Signature(
    String(scope) + ':' + String(identity),
    secret,
    Utilities.Charset.UTF_8
  );
  return signature.map(function(byte) {
    return ('0' + ((byte + 256) % 256).toString(16)).slice(-2);
  }).join('');
}

/** Caller must hold ScriptLock. Uses a fixed 15-minute window in the shared Sheets ledger. */
function consumeRateLimitBucketLocked_(scope, identity, limit, nowMs) {
  const now = Number(nowMs) || Date.now();
  const nowIso = new Date(now).toISOString();
  const bucketHash = rateLimitBucketHash_(scope, identity);
  const existing = repositoryGetById_('security_rate_limits', bucketHash);
  const windowMs = 15 * 60 * 1000;
  let record;

  if (!existing) {
    record = {
      bucket_key_hash:bucketHash,
      window_start:nowIso,
      attempt_count:1,
      blocked_until:Number(limit) <= 1 ? new Date(now + windowMs).toISOString() : '',
      updated_at:nowIso
    };
    repositoryInsertLocked_('security_rate_limits', record);
  } else {
    const blockedUntil = Date.parse(existing.blocked_until || '');
    if (Number.isFinite(blockedUntil) && blockedUntil > now) throw new Error('RATE_LIMITED');
    const windowStart = Date.parse(existing.window_start || '');
    if (!Number.isFinite(windowStart) || now - windowStart >= windowMs) {
      record = {window_start:nowIso,attempt_count:1,blocked_until:'',updated_at:nowIso};
    } else {
      const count = Number(existing.attempt_count || 0);
      if (count >= Number(limit)) {
        repositoryUpdateLocked_('security_rate_limits', bucketHash, {
          blocked_until:new Date(now + windowMs).toISOString(),
          updated_at:nowIso
        });
        throw new Error('RATE_LIMITED');
      }
      record = {
        attempt_count:count + 1,
        blocked_until:count + 1 >= Number(limit) ? new Date(now + windowMs).toISOString() : existing.blocked_until,
        updated_at:nowIso
      };
    }
    repositoryUpdateLocked_('security_rate_limits', bucketHash, record);
  }

  const sheet = repositorySheet_('security_rate_limits');
  let rowCount = Math.max(0, sheet.getLastRow() - 1);
  if (rowCount > 1000) {
    const cutoff = now - 24 * 60 * 60 * 1000;
    repositoryRows_('security_rate_limits').filter(function(row) {
      return Date.parse(row.updated_at || '') < cutoff;
    }).slice(0, 250).forEach(function(row) {
      repositoryDeleteLocked_('security_rate_limits', row.bucket_key_hash);
    });
    rowCount = Math.max(0, repositorySheet_('security_rate_limits').getLastRow() - 1);
  }
  if (rowCount > 5000) throw new Error('RATE_LIMIT_STORE_FULL');
}

/** Caller must hold ScriptLock. */
function assertRateLimitBucketNotBlockedLocked_(scope, identity, nowMs) {
  const hash = rateLimitBucketHash_(scope, identity);
  const record = repositoryGetById_('security_rate_limits', hash);
  const blockedUntil = record ? Date.parse(record.blocked_until || '') : NaN;
  if (Number.isFinite(blockedUntil) && blockedUntil > (Number(nowMs) || Date.now())) {
    throw new Error('RATE_LIMITED');
  }
}

/** Caller must hold ScriptLock. */
function incrementAccountFailureLocked_(scope, identity, nowMs) {
  consumeRateLimitBucketLocked_(scope, identity, 5, nowMs);
}

/** Caller must hold ScriptLock. */
function resetAccountFailureLocked_(scope, identity) {
  const hash = rateLimitBucketHash_(scope, identity);
  repositoryDeleteLocked_('security_rate_limits', hash);
}

function consumeLoginAttempt_(scope, identity, limit) {
  const value = String(identity || '').trim().toLowerCase();
  if (!value) throw new Error('LOGIN_ID_REQUIRED');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { consumeRateLimitBucketLocked_(scope, value, Number(limit) || 10, Date.now()); }
  finally { lock.releaseLock(); }
}

function consumeRegistrationAttempt_(loginId) {
  const value = String(loginId || '').trim().toLowerCase();
  if (!value) throw new Error('LOGIN_ID_REQUIRED');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { consumeRateLimitBucketLocked_('MEMBER_REGISTER_ACCOUNT', value, 5, Date.now()); }
  finally { lock.releaseLock(); }
}

function assertAccountNotBlocked_(scope, identity) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { assertRateLimitBucketNotBlockedLocked_(scope, identity, Date.now()); }
  finally { lock.releaseLock(); }
}

// ===== SOURCE: google-apps-script/11_Repositories.gs =====
/** Nobi Topup schema-aware Sheets repositories.
 * Call the Locked variants only while holding the Apps Script ScriptLock.
 */

const NOBI_REPOSITORY_UNIQUE_FIELDS = {
  admins: ['username_normalized'],
  games: ['name'],
  admin_sessions: ['token_hash'],
  members: ['login_id_normalized'],
  member_sessions: ['token_hash'],
  coupons: ['code_normalized'],
  coupon_redemptions: ['order_id'],
  orders: ['request_key'],
  idempotency_records: [['scope', 'request_key']],
  system_metadata: ['key'],
  gateway_nonces: ['nonce_hash'],
  wallets: ['member_id'],
  wallet_ledger: ['transaction_id','idempotency_key'],
  wallet_topups: ['idempotency_key'],
  wallet_holds: ['order_id'],
  wallet_recovery_journal: ['transaction_id','idempotency_key'],
  member_coupon_alerts: ['member_coupon_key']
};

function repositorySheet_(tableName) {
  const headers = NOBI.SHEETS[tableName];
  if (!headers) throw new Error('REPOSITORY_TABLE_NOT_ALLOWED');
  const sheet = sheet_(tableName);
  if (!databaseHeadersMatch_(databaseHeaders_(sheet), headers)) {
    throw new Error('REPOSITORY_SCHEMA_MISMATCH: ' + tableName);
  }
  return sheet;
}

function repositoryRowObject_(headers, row) {
  const record = {};
  headers.forEach(function(header, index) {
    const value = row[index];
    record[header] = value instanceof Date ? value.toISOString() : value;
  });
  return record;
}

function repositoryRecordsFromValues_(values) {
  if (!Array.isArray(values) || values.length < 2) return [];
  const headers = values[0].map(String);
  return values.slice(1)
    .filter(function(row) { return row.some(function(value) { return value !== '' && value !== null; }); })
    .map(function(row) { return repositoryRowObject_(headers, row); });
}

function repositoryRows_(tableName) {
  const sheet = repositorySheet_(tableName);
  return repositoryRecordsFromValues_(sheet.getDataRange().getValues());
}

function repositoryGetById_(tableName, id) {
  const headers = NOBI.SHEETS[tableName];
  if (!headers) throw new Error('REPOSITORY_TABLE_NOT_ALLOWED');
  const normalizedId = String(id || '').trim();
  if (!normalizedId) return null;
  const key = headers[0];
  return repositoryRows_(tableName).find(function(record) {
    return String(record[key]) === normalizedId;
  }) || null;
}

function repositoryFindByField_(tableName, field, value) {
  const headers = NOBI.SHEETS[tableName];
  if (!headers || headers.indexOf(field) === -1) throw new Error('REPOSITORY_FIELD_NOT_ALLOWED');
  const expected = String(value == null ? '' : value);
  return repositoryRows_(tableName).filter(function(record) {
    return String(record[field] == null ? '' : record[field]) === expected;
  });
}

function repositoryAssertUniqueLocked_(tableName, record, exceptId, existingRecords) {
  const uniqueConstraints = NOBI_REPOSITORY_UNIQUE_FIELDS[tableName] || [];
  if (!uniqueConstraints.length) return;
  const headers = NOBI.SHEETS[tableName];
  const primaryKey = headers[0];
  const existing = Array.isArray(existingRecords) ? existingRecords : repositoryRows_(tableName);
  uniqueConstraints.forEach(function(constraint) {
    const fields = Array.isArray(constraint) ? constraint : [constraint];
    const values = fields.map(function(field) {
      return String(record[field] == null ? '' : record[field]).trim();
    });
    if (values.every(function(value) { return !value; })) return;
    if (values.some(function(value) { return !value; })) {
      throw new Error('REPOSITORY_UNIQUE_KEY_INCOMPLETE: ' + tableName + '.' + fields.join('+'));
    }
    const duplicate = existing.some(function(candidate) {
      if (exceptId && String(candidate[primaryKey]) === String(exceptId)) return false;
      return fields.every(function(field, index) {
        return String(candidate[field] == null ? '' : candidate[field]).trim() === values[index];
      });
    });
    if (duplicate) throw new Error('REPOSITORY_DUPLICATE: ' + tableName + '.' + fields.join('+'));
  });
}

function repositoryNormalizeRecord_(tableName, record, allowPrimaryKey) {
  const headers = NOBI.SHEETS[tableName];
  if (!headers || !record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error('REPOSITORY_INVALID_RECORD');
  }
  Object.keys(record).forEach(function(field) {
    if (headers.indexOf(field) === -1) throw new Error('REPOSITORY_FIELD_NOT_ALLOWED: ' + field);
    if (!allowPrimaryKey && field === headers[0]) throw new Error('REPOSITORY_PRIMARY_KEY_IMMUTABLE');
  });
  return headers.reduce(function(result, field) {
    if (Object.prototype.hasOwnProperty.call(record, field)) result[field] = record[field];
    return result;
  }, {});
}

function repositoryInsertLocked_(tableName, record) {
  const sheet = repositorySheet_(tableName);
  const headers = NOBI.SHEETS[tableName];
  const safe = repositoryNormalizeRecord_(tableName, record, true);
  const primaryKey = String(safe[headers[0]] || '').trim();
  if (!primaryKey) throw new Error('REPOSITORY_PRIMARY_KEY_REQUIRED');
  // Reuse one snapshot for primary-key and unique-key checks. Each getDataRange()
  // is a remote Sheets read, so avoid separate full-sheet reads while holding the lock.
  const values = sheet.getDataRange().getValues();
  const existingRecords = repositoryRecordsFromValues_(values);
  const idIndex = headers.indexOf(headers[0]);
  if (values.slice(1).some(function(row) { return String(row[idIndex] || '') === primaryKey; })) {
    throw new Error('REPOSITORY_DUPLICATE: ' + tableName + '.' + headers[0]);
  }
  repositoryAssertUniqueLocked_(tableName, safe, null, existingRecords);
  sheet.appendRow(headers.map(function(field) {
    return safe[field] === undefined || safe[field] === null ? '' : safe[field];
  }));
  return safe;
}

function repositoryUpdateLocked_(tableName, id, patch) {
  const sheet = repositorySheet_(tableName);
  const headers = NOBI.SHEETS[tableName];
  const primaryKey = headers[0];
  const normalizedId = String(id || '').trim();
  if (!normalizedId) throw new Error('REPOSITORY_PRIMARY_KEY_REQUIRED');
  const safePatch = repositoryNormalizeRecord_(tableName, patch, false);
  const values = sheet.getDataRange().getValues();
  const idIndex = headers.indexOf(primaryKey);
  for (let rowIndex = 1; rowIndex < values.length; rowIndex++) {
    if (String(values[rowIndex][idIndex]) !== normalizedId) continue;
    const current = repositoryRowObject_(headers, values[rowIndex]);
    const next = Object.assign({}, current, safePatch);
    repositoryAssertUniqueLocked_(tableName, next, normalizedId, repositoryRecordsFromValues_(values));
    sheet.getRange(rowIndex + 1, 1, 1, headers.length).setValues([headers.map(function(field) {
      return next[field] === undefined || next[field] === null ? '' : next[field];
    })]);
    return next;
  }
  throw new Error('REPOSITORY_NOT_FOUND');
}

function repositoryInsert_(tableName, record) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try { return repositoryInsertLocked_(tableName, record); }
  finally { lock.releaseLock(); }
}

function repositoryUpdate_(tableName, id, patch) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try { return repositoryUpdateLocked_(tableName, id, patch); }
  finally { lock.releaseLock(); }
}


/** Delete a single schema-keyed row. Caller must already hold ScriptLock. */
function repositoryDeleteLocked_(tableName, id) {
  const sheet = repositorySheet_(tableName);
  const headers = NOBI.SHEETS[tableName];
  const normalizedId = String(id || '').trim();
  if (!normalizedId) throw new Error('REPOSITORY_PRIMARY_KEY_REQUIRED');
  const values = sheet.getDataRange().getValues();
  for (let row = 1; row < values.length; row++) {
    if (String(values[row][0]) !== normalizedId) continue;
    sheet.deleteRow(row + 1);
    return true;
  }
  return false;
}

// ===== SOURCE: google-apps-script/12_Seed.gs =====
/** Idempotent initial catalog seed, preserving any existing custom package catalog. */

const NOBI_DEFAULT_GAMES = [
  ['RoV','moba','Arena of Valor'],
  ['Free Fire','br','เพชร Free Fire'],
  ['Genshin Impact','rpg','Genesis Crystal'],
  ['PUBG Mobile','br','UC'],
  ['Mobile Legends','moba','Diamonds'],
  ['Valorant','fps','VP'],
  ['Honkai: Star Rail','rpg','Oneiric Shard'],
  ['Call of Duty: Mobile','fps','CP'],
  ['Roblox','sandbox','Robux']
];

const NOBI_DEFAULT_PACKAGES = {
  'RoV':['คูปอง',[[90,15],[250,39],[500,75],[1100,159],[2200,299],[5500,699]]],
  'Free Fire':['เพชร',[[110,19],[341,59],[572,99],[1060,139],[2200,279],[5600,699]]],
  'Genshin Impact':['Genesis Crystal',[[60,35],[330,169],[1090,559],[2240,1190],[3880,1890],[8080,3590]]],
  'PUBG Mobile':['UC',[[60,25],[325,129],[660,259],[1800,679],[3850,1390],[8100,2790]]],
  'Mobile Legends':['Diamonds',[[86,20],[172,39],[257,59],[706,159],[2195,479],[4390,949]]],
  'Valorant':['VP',[[125,45],[420,149],[700,249],[1375,479],[2400,829],[4000,1350]]],
  'Honkai: Star Rail':['Oneiric Shard',[[60,39],[330,179],[1090,579],[2240,1250],[3880,1990],[8080,3790]]],
  'Call of Duty: Mobile':['CP',[[80,25],[420,129],[880,259],[2400,679],[5000,1390],[10000,2690]]],
  'Roblox':['Robux',[[80,29],[400,139],[800,269],[1700,559],[4500,1390],[10000,2990]]]
};

/**
 * Run manually after setupNobiDatabase() in a fresh/test spreadsheet.
 * Existing games are preserved; package seeds are added only when the package
 * table was empty at the first invocation. An IN_PROGRESS marker permits safe
 * resumption if Apps Script stops partway through the 54 package inserts.
 */
function seedDefaultCatalog() {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const now = new Date().toISOString();
    let gamesAdded = 0;
    const gameIds = {};

    NOBI_DEFAULT_GAMES.forEach(function(seed, index) {
      let game = repositoryFindByField_('games', 'name', seed[0])[0];
      if (!game) {
        game = repositoryInsertLocked_('games', {
          game_id:Utilities.getUuid(),
          name:seed[0],
          category:seed[1],
          description:seed[2],
          active:true,
          sort_order:index + 1,
          created_at:now,
          updated_at:now
        });
        gamesAdded++;
      }
      gameIds[seed[0]] = game.game_id;
    });

    let marker = repositoryFindByField_('system_metadata', 'key', 'default_catalog_seed_v1')[0];
    if (marker && marker.value !== 'IN_PROGRESS') {
      return {ok:true, alreadySeeded:true, gamesAdded:gamesAdded, packagesAdded:0, status:marker.value};
    }

    if (!marker) {
      if (repositoryRows_('packages').length) {
        repositoryInsertLocked_('system_metadata', {
          key:'default_catalog_seed_v1',
          value:'SKIPPED_EXISTING_PACKAGES',
          updated_at:now
        });
        return {ok:true, alreadySeeded:false, gamesAdded:gamesAdded, packagesAdded:0, status:'SKIPPED_EXISTING_PACKAGES'};
      }
      marker = repositoryInsertLocked_('system_metadata', {
        key:'default_catalog_seed_v1',
        value:'IN_PROGRESS',
        updated_at:now
      });
    }

    let packagesAdded = 0;
    Object.keys(NOBI_DEFAULT_PACKAGES).forEach(function(gameName) {
      const gameId = gameIds[gameName];
      if (!gameId) throw new Error('DEFAULT_GAME_MISSING: ' + gameName);
      const definition = NOBI_DEFAULT_PACKAGES[gameName];
      const unit = definition[0];
      const packages = definition[1];
      packages.forEach(function(item, index) {
        const amount = item[0];
        const priceBaht = item[1];
        const name = amount.toLocaleString('en-US') + ' ' + unit;
        const exists = repositoryFindByField_('packages', 'game_id', gameId)
          .some(function(pack) { return String(pack.name) === name; });
        if (exists) return;
        repositoryInsertLocked_('packages', {
          package_id:Utilities.getUuid(),
          game_id:gameId,
          name:name,
          amount:amount,
          unit:unit,
          price_satang:priceBaht * 100,
          image_file_id:'',
          image_url:'',
          popular:index === packages.length - 2,
          active:true,
          sort_order:index + 1,
          created_at:now,
          updated_at:now
        });
        packagesAdded++;
      });
    });

    repositoryUpdateLocked_('system_metadata', marker.key, {
      value:'COMPLETE',
      updated_at:new Date().toISOString()
    });
    return {ok:true, alreadySeeded:false, gamesAdded:gamesAdded, packagesAdded:packagesAdded, status:'COMPLETE'};
  } finally {
    lock.releaseLock();
  }
}

// ===== SOURCE: google-apps-script/13_HttpGateway.gs =====
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
    'publicMediaData',
    'memberCreateWalletTopup',
    'memberSubmitWalletTopupProof',
    'memberWalletTopups',
    'adminWalletTopups',
    'adminWalletTopupProof',
    'adminApproveWalletTopup',
    'adminRejectWalletTopup',
    'adminGrantPaidCredit',
    'adminCreateBonusGrant',
    'banners'
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

// ===== SOURCE: google-apps-script/14_Retention.gs =====
/** Enforce the approved 90-day retention policy for IP-bearing records.
 * The cleanup is intentionally not invoked by database setup. Install the daily
 * trigger separately with ensureNobiRetentionTrigger() after reviewing deployment.
 */

function runNobiRetentionCleanup() {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return runNobiRetentionCleanupLocked_(Date.now());
  } finally {
    lock.releaseLock();
  }
}

/** Caller must already hold ScriptLock. */
function runNobiRetentionCleanupLocked_(nowMs) {
  const cutoffMs = Number(nowMs) - NOBI.LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  if (!Number.isFinite(cutoffMs)) throw new Error('RETENTION_INVALID_CLOCK');

  const result = {
    ok:true,
    cutoff_at:new Date(cutoffMs).toISOString(),
    member_fields_cleared:clearTableField_('members', 'registered_ip') + clearTableField_('members', 'last_login_ip'),
    member_session_fields_cleared:clearTableField_('member_sessions', 'created_ip'),
    member_login_ip_fields_cleared:clearTableField_('member_login_logs', 'ip_address') + clearTableField_('member_login_logs', 'is_new_ip'),
    admin_session_ip_fields_cleared:clearTableField_('admin_sessions', 'created_ip'),
    admin_audit_ip_fields_cleared:clearTableField_('admin_audit_logs', 'ip_address'),
    member_login_logs_deleted:deleteExpiredRetentionRows_('member_login_logs', cutoffMs),
    admin_audit_logs_deleted:deleteExpiredRetentionRows_('admin_audit_logs', cutoffMs)
  };
  return result;
}

/** Clear a legacy IP-related field immediately while preserving non-IP security events. */
function clearTableField_(tableName, fieldName) {
  const sheet = repositorySheet_(tableName);
  const values = sheet.getDataRange().getValues();
  const headers = NOBI.SHEETS[tableName];
  const fieldIndex = headers.indexOf(fieldName);
  if (fieldIndex < 0) throw new Error('RETENTION_SCHEMA_INVALID: ' + tableName + '.' + fieldName);
  let cleared = 0;
  const output = values.slice(1).map(function(row) {
    const value = row[fieldIndex];
    const replacement = fieldName === 'is_new_ip' ? false : '';
    if (value !== '' && value !== false && value !== null && value !== undefined) cleared++;
    return [replacement];
  });
  if (cleared) sheet.getRange(2, fieldIndex + 1, output.length, 1).setValues(output);
  return cleared;
}

function clearMemberIpFieldByDate_(ipField, timestampField, cutoffMs) {
  const sheet = repositorySheet_('members');
  const values = sheet.getDataRange().getValues();
  const headers = NOBI.SHEETS.members;
  const ipIndex = headers.indexOf(ipField);
  const timestampIndex = headers.indexOf(timestampField);
  if (ipIndex < 0 || timestampIndex < 0) throw new Error('RETENTION_SCHEMA_INVALID: members');
  if (values.length <= 1) return 0;
  const output = values.slice(1).map(function(row) { return [row[ipIndex] || '']; });
  let cleared = 0;
  for (let row = 1; row < values.length; row++) {
    const ip = String(values[row][ipIndex] || '');
    if (!ip) continue;
    const timestamp = Date.parse(String(values[row][timestampIndex] || ''));
    if (!Number.isFinite(timestamp) || timestamp <= cutoffMs) {
      output[row - 1][0] = '';
      cleared++;
    }
  }
  // One Sheets write per column avoids one remote service call per member/session.
  if (cleared) sheet.getRange(2, ipIndex + 1, output.length, 1).setValues(output);
  return cleared;
}

function clearSessionIpFieldByDate_(tableName, cutoffMs) {
  const sheet = repositorySheet_(tableName);
  const values = sheet.getDataRange().getValues();
  const headers = NOBI.SHEETS[tableName];
  const ipIndex = headers.indexOf('created_ip');
  const timestampIndex = headers.indexOf('created_at');
  if (ipIndex < 0 || timestampIndex < 0) throw new Error('RETENTION_SCHEMA_INVALID: ' + tableName);
  if (values.length <= 1) return 0;
  const output = values.slice(1).map(function(row) { return [row[ipIndex] || '']; });
  let cleared = 0;
  for (let row = 1; row < values.length; row++) {
    const ip = String(values[row][ipIndex] || '');
    if (!ip) continue;
    const timestamp = Date.parse(String(values[row][timestampIndex] || ''));
    if (!Number.isFinite(timestamp) || timestamp <= cutoffMs) {
      output[row - 1][0] = '';
      cleared++;
    }
  }
  if (cleared) sheet.getRange(2, ipIndex + 1, output.length, 1).setValues(output);
  return cleared;
}

function deleteExpiredRetentionRows_(tableName, cutoffMs) {
  const sheet = repositorySheet_(tableName);
  const values = sheet.getDataRange().getValues();
  const headers = NOBI.SHEETS[tableName];
  const timestampIndex = headers.indexOf('created_at');
  if (timestampIndex < 0) throw new Error('RETENTION_SCHEMA_INVALID: ' + tableName);
  const rowsToDelete = [];
  for (let row = values.length - 1; row >= 1; row--) {
    const timestamp = Date.parse(String(values[row][timestampIndex] || ''));
    // Invalid timestamps cannot justify retaining IP-bearing history indefinitely.
    if (!Number.isFinite(timestamp) || timestamp <= cutoffMs) rowsToDelete.push(row + 1);
  }

  // Delete contiguous blocks bottom-up to reduce Sheets service calls and
  // avoid shifting the remaining row indexes during cleanup.
  let deleted = 0;
  let blockStart = 0;
  let blockEnd = 0;
  rowsToDelete.forEach(function(rowNumber, index) {
    if (!blockStart) {
      blockStart = rowNumber;
      blockEnd = rowNumber;
    } else if (rowNumber === blockStart - 1) {
      blockStart = rowNumber;
    } else {
      sheet.deleteRows(blockStart, blockEnd - blockStart + 1);
      deleted += blockEnd - blockStart + 1;
      blockStart = rowNumber;
      blockEnd = rowNumber;
    }
    if (index === rowsToDelete.length - 1) {
      sheet.deleteRows(blockStart, blockEnd - blockStart + 1);
      deleted += blockEnd - blockStart + 1;
    }
  });
  return deleted;
}

/** Create one daily 03:00 Asia/Bangkok trigger; repeated calls are safe.
 * This function must be run manually by an authorized project owner.
 */
function ensureNobiRetentionTrigger() {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const handler = 'runNobiRetentionCleanup';
    const existing = ScriptApp.getProjectTriggers().filter(function(trigger) {
      return trigger.getHandlerFunction() === handler;
    });
    if (existing.length === 1) {
      return {ok:true, created:false, duplicates_removed:0, message:'Retention trigger already exists.'};
    }
    if (existing.length > 1) {
      existing.slice(1).forEach(function(trigger) { ScriptApp.deleteTrigger(trigger); });
      return {ok:true, created:false, duplicates_removed:existing.length - 1, message:'Duplicate retention triggers removed.'};
    }
    ScriptApp.newTrigger(handler)
      .timeBased()
      .everyDays(1)
      .atHour(3)
      .inTimezone('Asia/Bangkok')
      .create();
    return {ok:true, created:true, duplicates_removed:0, message:'Daily retention trigger created for approximately 03:00 Asia/Bangkok.'};
  } finally {
    lock.releaseLock();
  }
}

// ===== SOURCE: google-apps-script/15_MemberDashboard.gs =====
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

// ===== SOURCE: google-apps-script/BrowserFacade.gs =====
/**
 * Browser-callable typed facade.
 *
 * Only the named functions below are callable by the HTML client.
 * The generic dispatcher and validation helpers end in "_" and are private
 * to the Apps Script runtime. Never add a browser-supplied IP field here.
 */

var NOBI_BROWSER_FACADE_ACTIONS_ = [
  'catalog','promotions','banners','coupon','couponSuggestions','paymentInfo',
  'createOrder','submitOrderSlip','adminLogin','memberRegister','memberLogin',
  'memberMe','memberDashboard','memberOrders','memberLogout','memberChangePassword','adminChangePassword',
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

function nobiGetBanners() {
  return nobiFacadeCall_('banners', {});
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

function nobiGetMemberDashboard(token) {
  return nobiFacadeCall_('memberDashboard', {token:nobiFacadeToken_(token)});
}

function nobiGetMemberOrders(input) {
  var p = nobiFacadePayload_(input, ['token','limit'], ['token']);
  return nobiFacadeCall_('memberOrders', {token:nobiFacadeToken_(p.token),limit:p.limit == null ? 50 : Number(p.limit)});
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


// ===== E-BUDGET P1.1: guarded Wallet ledger primitives =====
/**
 * P1.1 establishes fail-closed Wallet mutation primitives only.
 * No public Wallet action is enabled in this increment.
 * Mutations require an explicit operational cutover gate; never set these
 * properties until the legacy financial writer is demonstrably disabled.
 */
function walletAssertWriteGateLocked_() {
  const props = PropertiesService.getScriptProperties();
  if (String(props.getProperty('NOBI_WALLET_WRITES_ENABLED') || '') !== 'true' ||
      String(props.getProperty('NOBI_FINANCIAL_WRITER_MODE') || '') !== 'API_ONLY' ||
      String(props.getProperty('NOBI_LEGACY_WRITER_DISABLED') || '') !== 'true') {
    throw new Error('WALLET_WRITES_BLOCKED: single-writer cutover gate is not satisfied');
  }
}

function walletAssertSatang_(value, allowZero) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) ||
      value < (allowZero ? 0 : 1)) {
    throw new Error('WALLET_INVALID_AMOUNT');
  }
  return value;
}

function walletFindOrCreateLocked_(memberId, nowIso) {
  const id = String(memberId || '').trim();
  if (!id || !repositoryGetById_('members', id)) throw new Error('WALLET_MEMBER_NOT_FOUND');
  const existing = repositoryGetById_('wallets', id);
  if (existing) {
    const paid = Number(existing.paid_balance_satang);
    const bonus = Number(existing.bonus_balance_satang);
    const version = Number(existing.wallet_version);
    if (!Number.isSafeInteger(paid) || paid < 0 ||
        !Number.isSafeInteger(bonus) || bonus < 0 ||
        !Number.isSafeInteger(version) || version < 0) {
      throw new Error('WALLET_CACHE_INVALID');
    }
    return existing;
  }
  const now = nowIso || new Date().toISOString();
  return repositoryInsertLocked_('wallets', {
    member_id:id,paid_balance_satang:0,bonus_balance_satang:0,
    wallet_version:0,created_at:now,updated_at:now
  });
}

/** Recompute posted balances from immutable ledger entries; holds are reported separately. */
function walletLedgerBalancesLocked_(memberId) {
  const id = String(memberId || '');
  const totals = {PAID:0,BONUS:0};
  repositoryRows_('wallet_ledger').filter(function(row) {
    return String(row.member_id) === id;
  }).forEach(function(row) {
    const type = String(row.credit_type || '');
    const delta = Number(row.delta_satang);
    if (!Object.prototype.hasOwnProperty.call(totals,type) ||
        !Number.isSafeInteger(delta) || delta === 0) {
      throw new Error('WALLET_LEDGER_INVALID');
    }
    const next = totals[type] + delta;
    if (!Number.isSafeInteger(next) || next < 0) throw new Error('WALLET_LEDGER_NEGATIVE_BALANCE');
    totals[type] = next;
  });
  return {paid_balance_satang:totals.PAID,bonus_balance_satang:totals.BONUS};
}

function walletAssertCacheMatchesLedgerLocked_(memberId) {
  const wallet = repositoryGetById_('wallets', String(memberId || ''));
  const ledger = walletLedgerBalancesLocked_(memberId);
  if (!wallet ||
      Number(wallet.paid_balance_satang) !== ledger.paid_balance_satang ||
      Number(wallet.bonus_balance_satang) !== ledger.bonus_balance_satang) {
    throw new Error('WALLET_RECONCILIATION_REQUIRED');
  }
  return {ok:true,paid_balance_satang:ledger.paid_balance_satang,
    bonus_balance_satang:ledger.bonus_balance_satang};
}

/**
 * Apply a prepared credit journal idempotently. The journal contains exact target
 * balances, so retries after any completed Sheet write never add a second delta.
 * Caller must hold ScriptLock and pass a journal already persisted as PREPARED.
 */
function walletApplyCreditJournalLocked_(journal) {
  walletAssertWriteGateLocked_();
  if (!journal || !journal.journal_id || !journal.transaction_id ||
      journal.step_state === 'COMPLETED') return {ok:true,already_completed:true};
  const now = new Date().toISOString();
  try {
    const ledger = JSON.parse(String(journal.ledger_payload_json || '{}'));
    const walletPatch = JSON.parse(String(journal.wallet_patch_json || '{}'));
    const bonusPatch = journal.bonus_patch_json ? JSON.parse(String(journal.bonus_patch_json)) : null;
    const requiredLedger = NOBI.SHEETS.wallet_ledger;
    if (!ledger.ledger_id || requiredLedger.some(function(field) {
      return !Object.prototype.hasOwnProperty.call(ledger,field);
    }) || String(ledger.transaction_id) !== String(journal.transaction_id) ||
        String(ledger.member_id) !== String(journal.member_id) ||
        !['PAID','BONUS'].includes(String(ledger.credit_type)) ||
        !Number.isSafeInteger(Number(ledger.delta_satang)) || Number(ledger.delta_satang) <= 0 ||
        !Number.isSafeInteger(Number(ledger.balance_after_satang)) ||
        Number(ledger.balance_after_satang) <= 0 ||
        !ledger.idempotency_key || !/^[A-Za-z0-9._:-]{16,128}$/.test(String(ledger.idempotency_key))) {
      throw new Error('WALLET_JOURNAL_LEDGER_INVALID');
    }
    const requiredWallet = NOBI.SHEETS.wallets;
    if (requiredWallet.some(function(field) {
      return !Object.prototype.hasOwnProperty.call(walletPatch,field);
    }) || String(walletPatch.member_id) !== String(journal.member_id) ||
        !Number.isSafeInteger(Number(walletPatch.paid_balance_satang)) ||
        !Number.isSafeInteger(Number(walletPatch.bonus_balance_satang)) ||
        Number(walletPatch.paid_balance_satang) < 0 ||
        Number(walletPatch.bonus_balance_satang) < 0 ||
        !Number.isSafeInteger(Number(walletPatch.wallet_version)) ||
        Number(walletPatch.wallet_version) < 1) {
      throw new Error('WALLET_JOURNAL_CACHE_INVALID');
    }

    const idemLedger = repositoryFindByField_('wallet_ledger','idempotency_key',ledger.idempotency_key);
    if(idemLedger.some(function(row){return String(row.transaction_id)!==String(ledger.transaction_id);})) throw new Error('WALLET_IDEMPOTENCY_CONFLICT');
    const existingLedger = repositoryFindByField_('wallet_ledger','transaction_id',ledger.transaction_id);
    if (existingLedger.length > 1) throw new Error('WALLET_DUPLICATE_TRANSACTION');
    if (existingLedger.length) {
      const saved = existingLedger[0];
      if (NOBI.SHEETS.wallet_ledger.some(function(field) {
        return String(saved[field] == null ? '' : saved[field]) !==
          String(ledger[field] == null ? '' : ledger[field]);
      })) throw new Error('WALLET_TRANSACTION_CONFLICT');
    } else {
      repositoryInsertLocked_('wallet_ledger',ledger);
    }

    const wallet = repositoryGetById_('wallets',String(journal.member_id));
    if (!wallet) {
      repositoryInsertLocked_('wallets',walletPatch);
    } else {
      const patch = {};
      ['paid_balance_satang','bonus_balance_satang','wallet_version','updated_at'].forEach(function(field) {
        patch[field] = walletPatch[field];
      });
      if (Number(wallet.wallet_version) > Number(walletPatch.wallet_version)) {
        throw new Error('WALLET_VERSION_CONFLICT');
      }
      if (Number(wallet.wallet_version) < Number(walletPatch.wallet_version) ||
          Number(wallet.paid_balance_satang) !== Number(walletPatch.paid_balance_satang) ||
          Number(wallet.bonus_balance_satang) !== Number(walletPatch.bonus_balance_satang)) {
        repositoryUpdateLocked_('wallets',String(journal.member_id),patch);
      }
    }

    if (bonusPatch) {
      if (bonusPatch.operation !== 'INSERT' || !bonusPatch.record ||
          !bonusPatch.record.bonus_grant_id ||
          String(bonusPatch.record.member_id) !== String(journal.member_id)) {
        throw new Error('WALLET_JOURNAL_BONUS_INVALID');
      }
      const existingGrant = repositoryGetById_('wallet_bonus_grants',bonusPatch.record.bonus_grant_id);
      if (!existingGrant) repositoryInsertLocked_('wallet_bonus_grants',bonusPatch.record);
      else if (NOBI.SHEETS.wallet_bonus_grants.some(function(field) {
        return String(existingGrant[field] == null ? '' : existingGrant[field]) !==
          String(bonusPatch.record[field] == null ? '' : bonusPatch.record[field]);
      })) throw new Error('WALLET_BONUS_GRANT_CONFLICT');
    }

    const topupPatch = journal.topup_patch_json ? JSON.parse(String(journal.topup_patch_json)) : null;
    if (topupPatch) {
      if (!topupPatch.topup_id || !topupPatch.expected_status || !topupPatch.patch ||
          String(topupPatch.topup_id) !== String(journal.topup_id)) throw new Error('WALLET_JOURNAL_TOPUP_INVALID');
      const topup = repositoryGetById_('wallet_topups',topupPatch.topup_id);
      if (!topup) throw new Error('WALLET_TOPUP_NOT_FOUND');
      if (String(topup.status) === String(topupPatch.expected_status)) {
        repositoryUpdateLocked_('wallet_topups',topupPatch.topup_id,topupPatch.patch);
      } else if (String(topup.status) !== String(topupPatch.patch.status)) {
        throw new Error('WALLET_TOPUP_STATE_CONFLICT');
      }
    }

    const auditPatch = journal.audit_patch_json ? JSON.parse(String(journal.audit_patch_json)) : null;
    if (auditPatch) {
      if (!auditPatch.audit_id || !auditPatch.admin_id || !auditPatch.action) throw new Error('WALLET_JOURNAL_AUDIT_INVALID');
      const existingAudit = repositoryGetById_('admin_audit_logs',auditPatch.audit_id);
      if (!existingAudit) repositoryInsertLocked_('admin_audit_logs',auditPatch);
      else if (NOBI.SHEETS.admin_audit_logs.some(function(field) {
        return String(existingAudit[field] == null ? '' : existingAudit[field]) !==
          String(auditPatch[field] == null ? '' : auditPatch[field]);
      })) throw new Error('WALLET_AUDIT_CONFLICT');
    }

    walletAssertCacheMatchesLedgerLocked_(journal.member_id);
    repositoryUpdateLocked_('wallet_recovery_journal',journal.journal_id,{
      step_state:'COMPLETED',attempts:Number(journal.attempts || 0)+1,
      last_error_code:'',updated_at:now
    });
    return {ok:true,transaction_id:journal.transaction_id};
  } catch (error) {
    try {
      const savedJournal = repositoryGetById_('wallet_recovery_journal',journal.journal_id);
      if (savedJournal && savedJournal.step_state !== 'COMPLETED') {
        repositoryUpdateLocked_('wallet_recovery_journal',journal.journal_id,{
          step_state:'RECOVERY_REQUIRED',
          attempts:Number(savedJournal.attempts || 0)+1,
          last_error_code:/^[A-Z0-9_:-]{1,100}$/.test(String(error && error.message || ''))
            ? String(error.message) : 'WALLET_RECOVERY_FAILED',
          updated_at:now
        });
      }
    } catch (ignored) {}
    throw error;
  }
}

/** Prepare a positive Paid/Bonus credit as a write-ahead journal. Caller holds ScriptLock. */
function walletPrepareCreditJournalLocked_(input) {
  walletAssertWriteGateLocked_();
  input = input || {};
  const memberId = String(input.member_id || '');
  const creditType = String(input.credit_type || '');
  const amount = walletAssertSatang_(input.amount_satang, false);
  const idempotencyKey = String(input.idempotency_key || '');
  const reason = String(input.reason || '').trim();
  if (!['PAID','BONUS'].includes(creditType) ||
      !/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey) ||
      !reason || reason.length > 500) throw new Error('WALLET_CREDIT_INPUT_INVALID');

  const payloadHash=String(input.payload_hash || '');
  if(!/^[a-f0-9]{64}$/.test(payloadHash)) throw new Error('WALLET_CREDIT_PAYLOAD_HASH_REQUIRED');
  const priorJournals=repositoryFindByField_('wallet_recovery_journal','idempotency_key',idempotencyKey);
  if(priorJournals.length>1) throw new Error('WALLET_DUPLICATE_RECOVERY_JOURNAL');
  if(priorJournals.length) {
    if(String(priorJournals[0].payload_hash)!==payloadHash) throw new Error('WALLET_IDEMPOTENCY_CONFLICT');
    return priorJournals[0];
  }
  const duplicate = repositoryFindByField_('wallet_ledger','idempotency_key',idempotencyKey);
  if (duplicate.length) throw new Error('WALLET_IDEMPOTENCY_CONFLICT');
  const now = new Date().toISOString();
  const wallet = walletFindOrCreateLocked_(memberId,now);
  walletAssertCacheMatchesLedgerLocked_(memberId);
  const currentBalance = creditType === 'PAID'
    ? Number(wallet.paid_balance_satang) : Number(wallet.bonus_balance_satang);
  const nextBalance = currentBalance + amount;
  if (!Number.isSafeInteger(nextBalance)) throw new Error('WALLET_BALANCE_OVERFLOW');

  const transactionId = Utilities.getUuid();
  const ledger = {
    ledger_id:Utilities.getUuid(),transaction_id:transactionId,member_id:memberId,
    credit_type:creditType,entry_type:String(input.entry_type || ''),
    delta_satang:amount,balance_after_satang:nextBalance,
    reference_type:String(input.reference_type || 'ADMIN'),
    reference_id:String(input.reference_id || ''),
    idempotency_key:idempotencyKey,actor_type:String(input.actor_type || 'ADMIN'),
    actor_id:String(input.actor_id || ''),reason:reason,created_at:now
  };
  if (!['TOPUP_APPROVAL','ADMIN_CREDIT','BONUS_GRANT'].includes(ledger.entry_type)) {
    throw new Error('WALLET_ENTRY_TYPE_INVALID');
  }
  const walletPatch = {
    member_id:memberId,
    paid_balance_satang:currentBalance + (creditType === 'PAID' ? amount : 0),
    bonus_balance_satang:Number(wallet.bonus_balance_satang) + (creditType === 'BONUS' ? amount : 0),
    wallet_version:Number(wallet.wallet_version) + 1,
    created_at:wallet.created_at,updated_at:now
  };
  const bonusPatch = input.bonus_grant
    ? {operation:'INSERT',record:input.bonus_grant} : null;
  const journal = {
    journal_id:Utilities.getUuid(),operation:'CREDIT',transaction_id:transactionId,
    idempotency_key:idempotencyKey,payload_hash:payloadHash,
    member_id:memberId,hold_id:'',topup_id:String(input.topup_id || ''),
    step_state:'PREPARED',ledger_payload_json:JSON.stringify(ledger),
    wallet_patch_json:JSON.stringify(walletPatch),
    bonus_patch_json:bonusPatch ? JSON.stringify(bonusPatch) : '',
    order_patch_json:'',topup_patch_json:input.topup_patch ? JSON.stringify(input.topup_patch) : '',
    audit_patch_json:input.audit_patch ? JSON.stringify(input.audit_patch) : '',
    attempts:0,last_error_code:'',
    created_at:now,updated_at:now
  };
  repositoryInsertLocked_('wallet_recovery_journal',journal);
  return journal;
}


// ===== E-BUDGET P1.2: member top-up and admin credit workflows =====
function walletRequestHash_(value) {
  return sha256_(JSON.stringify(value));
}

function walletRequestKey_(value) {
  const key=String(value || '').trim();
  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(key)) throw new Error('WALLET_REQUEST_KEY_INVALID');
  return key;
}

function walletConfiguredTopupMethod_(method) {
  const key=String(method || '').trim().toUpperCase();
  if (key === 'PROMPTPAY' &&
      String(PropertiesService.getScriptProperties().getProperty('NOBI_PROMPTPAY_ID') || '').trim()) {
    return 'PROMPTPAY';
  }
  throw new Error('WALLET_PAYMENT_METHOD_NOT_CONFIGURED');
}

function walletPublicTopup_(row) {
  return {
    topupId:String(row.topup_id),amountSatang:Number(row.amount_satang),
    status:String(row.status),paymentMethod:String(row.payment_method),
    paymentReference:String(row.payment_reference || ''),
    submittedAt:String(row.submitted_at || ''),
    reviewedAt:String(row.reviewed_at || ''),
    rejectionReason:String(row.rejection_reason || ''),
    createdAt:String(row.created_at)
  };
}

function memberCreateWalletTopup(token,args) {
  args=args || {};
  const key=walletRequestKey_(args.requestKey);
  const amount=walletAssertSatang_(args.amountSatang,false);
  if(amount<5000) throw new Error('WALLET_TOPUP_MINIMUM_50_THB');
  const method=walletConfiguredTopupMethod_(args.paymentMethod);
  const reference=String(args.paymentReference || '').trim().slice(0,100);
  const payloadHash=walletRequestHash_({amountSatang:amount,paymentMethod:method,paymentReference:reference});
  const lock=LockService.getScriptLock();lock.waitLock(15000);
  try {
    walletAssertWriteGateLocked_();
    const member=requireMemberLocked_(token,Date.now());
    const existing=repositoryFindByField_('wallet_topups','idempotency_key',key);
    if(existing.length){
      if(String(existing[0].member_id)!==String(member.member_id) ||
         String(existing[0].payload_hash)!==payloadHash) throw new Error('IDEMPOTENCY_CONFLICT');
      return {ok:true,topup:walletPublicTopup_(existing[0]),replayed:true};
    }
    if(reference && repositoryRows_('wallet_topups').some(function(t){
      return String(t.payment_reference || '').toLowerCase()===reference.toLowerCase() &&
        ['PENDING_REVIEW','APPROVED'].includes(String(t.status));
    })) throw new Error('WALLET_PAYMENT_REFERENCE_DUPLICATE');
    const now=new Date().toISOString();
    const row={
      topup_id:Utilities.getUuid(),member_id:member.member_id,amount_satang:amount,
      status:'AWAITING_PROOF',payment_method:method,payment_reference:reference,
      slip_file_id:'',slip_mime_type:'',slip_size_bytes:0,submitted_at:'',
      reviewed_by_admin_id:'',reviewed_at:'',rejection_reason:'',
      idempotency_key:key,payload_hash:payloadHash,created_at:now,updated_at:now
    };
    repositoryInsertLocked_('wallet_topups',row);
    return {ok:true,topup:walletPublicTopup_(row),replayed:false};
  } finally {lock.releaseLock();}
}

function memberSubmitWalletTopupProof(token,args) {
  args=args || {};
  const topupId=String(args.topupId || '').trim();
  const slip=args.slip || {};
  const mime=String(slip.mimeType || '');
  if(!topupId || !slip.base64 || !/^image\/(png|jpeg|webp)$/.test(mime)) throw new Error('WALLET_TOPUP_PROOF_INVALID');
  const bytes=Utilities.base64Decode(String(slip.base64).replace(/^data:[^,]+,/, ''));
  if(!bytes.length || bytes.length>NOBI.MAX_SLIP_BYTES || !validImageSignature_(bytes,mime)) throw new Error('WALLET_TOPUP_PROOF_INVALID');
  const lock=LockService.getScriptLock();lock.waitLock(20000);
  let file=null;
  try {
    walletAssertWriteGateLocked_();
    const member=requireMemberLocked_(token,Date.now());
    const topup=repositoryGetById_('wallet_topups',topupId);
    if(!topup || String(topup.member_id)!==String(member.member_id)) throw new Error('WALLET_TOPUP_NOT_FOUND');
    if(topup.status!=='AWAITING_PROOF') {
      if(topup.status==='PENDING_REVIEW' && topup.slip_file_id) return {ok:true,alreadySubmitted:true,status:topup.status};
      throw new Error('WALLET_TOPUP_NOT_ACCEPTING_PROOF');
    }
    const created=Date.parse(topup.created_at);
    if(!Number.isFinite(created) || Date.now()>=created+24*60*60*1000) {
      repositoryUpdateLocked_('wallet_topups',topupId,{status:'EXPIRED',updated_at:new Date().toISOString()});
      throw new Error('WALLET_TOPUP_EXPIRED');
    }
    const folderId=String(PropertiesService.getScriptProperties().getProperty('NOBI_PRIVATE_DRIVE_FOLDER_ID') || '').trim();
    if(!folderId) throw new Error('DRIVE_FOLDER_NOT_CONFIGURED');
    const folder=DriveApp.getFolderById(folderId);assertDriveFolderPrivate_(folder);
    const ext=mime==='image/png'?'png':mime==='image/webp'?'webp':'jpg';
    file=folder.createFile(Utilities.newBlob(bytes,mime,'wallet-topup-'+topupId+'.'+ext));
    file.setSharing(DriveApp.Access.PRIVATE,DriveApp.Permission.VIEW);
    assertDriveFileInPrivateFolder_(file,folderId);
    const now=new Date().toISOString();
    repositoryUpdateLocked_('wallet_topups',topupId,{
      status:'PENDING_REVIEW',slip_file_id:file.getId(),slip_mime_type:mime,
      slip_size_bytes:bytes.length,submitted_at:now,updated_at:now
    });
    return {ok:true,status:'PENDING_REVIEW',submittedAt:now};
  } catch(error) {
    if(file) {
      let linked=false;
      try {const row=repositoryGetById_('wallet_topups',topupId);linked=Boolean(row && String(row.slip_file_id)===String(file.getId()));}catch(ignored){}
      if(!linked) try{file.setTrashed(true);}catch(ignored){}
    }
    throw error;
  } finally {lock.releaseLock();}
}

function memberWalletTopups(token,limit) {
  const member=requireMember_(token);
  const max=Math.min(50,Math.max(1,Number.isSafeInteger(Number(limit))?Number(limit):20));
  return repositoryRows_('wallet_topups').filter(function(row){
    return String(row.member_id)===String(member.member_id);
  }).sort(function(a,b){return String(b.created_at).localeCompare(String(a.created_at));})
    .slice(0,max).map(walletPublicTopup_);
}

function adminWalletTopups(token,status,limit) {
  requireAdmin_(token);
  const allowed=['AWAITING_PROOF','PENDING_REVIEW','APPROVED','REJECTED','EXPIRED','CANCELLED'];
  const filter=String(status || 'PENDING_REVIEW');
  if(!allowed.includes(filter)) throw new Error('WALLET_TOPUP_STATUS_INVALID');
  const max=Math.min(100,Math.max(1,Number.isSafeInteger(Number(limit))?Number(limit):50));
  const members={};
  repositoryRows_('members').forEach(function(m){members[String(m.member_id)]=m;});
  return repositoryRows_('wallet_topups').filter(function(row){return String(row.status)===filter;})
    .sort(function(a,b){return String(b.created_at).localeCompare(String(a.created_at));})
    .slice(0,max).map(function(row){
      const member=members[String(row.member_id)] || {};
      return {topupId:String(row.topup_id),memberId:String(row.member_id),
        memberName:String(member.full_name || ''),loginId:String(member.login_id_display || ''),
        amountSatang:Number(row.amount_satang),status:String(row.status),
        paymentMethod:String(row.payment_method),paymentReference:String(row.payment_reference || ''),
        submittedAt:String(row.submitted_at || ''),proofAvailable:Boolean(row.slip_file_id),
        createdAt:String(row.created_at)};
    });
}

function adminApproveWalletTopup(token,args) {
  args=args || {};
  const requestKey=walletRequestKey_(args.requestKey);
  if(args.confirmation!==true) throw new Error('WALLET_APPROVAL_CONFIRMATION_REQUIRED');
  const reason=String(args.reason || 'Payment evidence verified').trim();
  if(!reason || reason.length>500) throw new Error('WALLET_REASON_REQUIRED');
  const lock=LockService.getScriptLock();lock.waitLock(20000);
  try {
    walletAssertWriteGateLocked_();
    const admin=requireAdminLocked_(token,Date.now());
    const topup=repositoryGetById_('wallet_topups',String(args.topupId || ''));
    if(!topup) throw new Error('WALLET_TOPUP_NOT_FOUND');
    if(topup.status==='APPROVED') {
      const linked=repositoryFindByField_('wallet_ledger','reference_id',topup.topup_id)
        .filter(function(l){return l.entry_type==='TOPUP_APPROVAL';});
      if(linked.length===1) return {ok:true,alreadyApproved:true,topupId:topup.topup_id};
      throw new Error('WALLET_TOPUP_RECONCILIATION_REQUIRED');
    }
    if(topup.status!=='PENDING_REVIEW' || !topup.slip_file_id) throw new Error('WALLET_TOPUP_NOT_PENDING_REVIEW');
    const journal=walletPrepareCreditJournalLocked_({
      member_id:topup.member_id,credit_type:'PAID',amount_satang:Number(topup.amount_satang),
      idempotency_key:'TOPUP:'+topup.topup_id,entry_type:'TOPUP_APPROVAL',
      reference_type:'TOPUP',reference_id:topup.topup_id,actor_type:'ADMIN',
      actor_id:admin.admin_id,reason:reason,topup_id:topup.topup_id,
      payload_hash:walletRequestHash_({topupId:topup.topup_id,amountSatang:Number(topup.amount_satang),reason:reason}),
      topup_patch:{topup_id:topup.topup_id,expected_status:'PENDING_REVIEW',
        patch:{status:'APPROVED',reviewed_by_admin_id:admin.admin_id,reviewed_at:new Date().toISOString(),updated_at:new Date().toISOString()}},
      audit_patch:{
        audit_id:Utilities.getUuid(),admin_id:admin.admin_id,action:'WALLET_TOPUP_APPROVED',
        target_type:'wallet_topup',target_id:topup.topup_id,request_id:requestKey,ip_address:'',
        details_json:JSON.stringify({amount_satang:Number(topup.amount_satang),reason:reason}),created_at:new Date().toISOString()
      }
    });
    const ready=repositoryGetById_('wallet_recovery_journal',journal.journal_id);
    walletApplyCreditJournalLocked_(ready);
    return {ok:true,topupId:topup.topup_id,status:'APPROVED',amountSatang:Number(topup.amount_satang)};
  } finally {lock.releaseLock();}
}

function adminRejectWalletTopup(token,args) {
  args=args || {};
  const requestKey=walletRequestKey_(args.requestKey);
  const reason=String(args.reason || '').trim();
  if(!reason || reason.length>500) throw new Error('WALLET_REJECTION_REASON_REQUIRED');
  const lock=LockService.getScriptLock();lock.waitLock(15000);
  try {
    walletAssertWriteGateLocked_();
    const admin=requireAdminLocked_(token,Date.now());
    const topup=repositoryGetById_('wallet_topups',String(args.topupId || ''));
    if(!topup) throw new Error('WALLET_TOPUP_NOT_FOUND');
    const idem='TOPUP_REJECT:'+topup.topup_id;
    const payloadHash=walletRequestHash_({topupId:topup.topup_id,reason:reason});
    const prior=repositoryFindByField_('wallet_recovery_journal','idempotency_key',idem);
    if(prior.length) {
      if(String(prior[0].payload_hash)!==payloadHash) throw new Error('WALLET_IDEMPOTENCY_CONFLICT');
      walletApplyTopupDecisionJournalLocked_(prior[0]);
      return {ok:true,topupId:topup.topup_id,status:'REJECTED',replayed:true};
    }
    if(topup.status==='REJECTED') return {ok:true,unchanged:true,status:'REJECTED'};
    if(topup.status!=='PENDING_REVIEW') throw new Error('WALLET_TOPUP_NOT_PENDING_REVIEW');
    const now=new Date().toISOString();
    const journal=walletPrepareTopupDecisionJournalLocked_({
      topup_id:topup.topup_id,member_id:topup.member_id,idempotency_key:idem,
      payload_hash:payloadHash,expected_status:'PENDING_REVIEW',
      patch:{status:'REJECTED',reviewed_by_admin_id:admin.admin_id,reviewed_at:now,
        rejection_reason:reason,updated_at:now},
      audit_patch:{
        audit_id:Utilities.getUuid(),admin_id:admin.admin_id,action:'WALLET_TOPUP_REJECTED',
        target_type:'wallet_topup',target_id:topup.topup_id,request_id:requestKey,ip_address:'',
        details_json:JSON.stringify({reason:reason}),created_at:now
      }
    });
    walletApplyTopupDecisionJournalLocked_(journal);
    return {ok:true,topupId:topup.topup_id,status:'REJECTED'};
  } finally {lock.releaseLock();}
}

function adminGrantPaidCredit(token,args) {
  args=args || {};
  const key=walletRequestKey_(args.requestKey);
  const amount=walletAssertSatang_(args.amountSatang,false);
  const reason=String(args.reason || '').trim();
  if(!reason || reason.length>500) throw new Error('WALLET_REASON_REQUIRED');
  const lock=LockService.getScriptLock();lock.waitLock(20000);
  try {
    walletAssertWriteGateLocked_();
    const admin=requireAdminLocked_(token,Date.now());
    const memberId=String(args.memberId || '').trim();
    if(!repositoryGetById_('members',memberId)) throw new Error('WALLET_MEMBER_NOT_FOUND');
    const idem='ADMIN_CREDIT:'+key;
    const payloadHash=walletRequestHash_({memberId:memberId,amountSatang:amount,reason:reason});
    const prior=repositoryFindByField_('wallet_recovery_journal','idempotency_key',idem);
    if(prior.length) {
      if(String(prior[0].payload_hash)!==payloadHash) throw new Error('WALLET_IDEMPOTENCY_CONFLICT');
      walletApplyCreditJournalLocked_(prior[0]);
      return {ok:true,replayed:true,transactionId:prior[0].transaction_id};
    }
    const existing=repositoryFindByField_('wallet_ledger','idempotency_key',idem);
    if(existing.length) return {ok:true,replayed:true,transactionId:existing[0].transaction_id};
    const journal=walletPrepareCreditJournalLocked_({
      member_id:memberId,credit_type:'PAID',amount_satang:amount,idempotency_key:idem,
      entry_type:'ADMIN_CREDIT',reference_type:'ADMIN_CREDIT',reference_id:key,
      actor_type:'ADMIN',actor_id:admin.admin_id,reason:reason,
      payload_hash:payloadHash,
      audit_patch:{
        audit_id:Utilities.getUuid(),admin_id:admin.admin_id,action:'WALLET_PAID_CREDIT_GRANTED',
        target_type:'member',target_id:memberId,request_id:key,ip_address:'',
        details_json:JSON.stringify({amount_satang:amount,reason:reason}),created_at:new Date().toISOString()
      }
    });
    walletApplyCreditJournalLocked_(repositoryGetById_('wallet_recovery_journal',journal.journal_id));
    return {ok:true,memberId:memberId,amountSatang:amount};
  } finally {lock.releaseLock();}
}

function walletResolveBonusExpiry_(args,nowMs) {
  const now=Number(nowMs) || Date.now();
  const duration=args.durationDays;
  const explicit=String(args.expiresAt || '').trim();
  if(duration!==undefined && duration!==null && duration!=='' && explicit) throw new Error('WALLET_BONUS_EXPIRY_AMBIGUOUS');
  let expiry;
  if(duration!==undefined && duration!==null && duration!=='') {
    if(!Number.isSafeInteger(duration) || duration<1 || duration>3650) throw new Error('WALLET_BONUS_DURATION_INVALID');
    expiry=now+duration*24*60*60*1000;
  } else {
    if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\+07:00|Z)$/.test(explicit)) throw new Error('WALLET_BONUS_EXPIRY_OFFSET_REQUIRED');
    expiry=Date.parse(explicit);
  }
  if(!Number.isFinite(expiry) || expiry<=now) throw new Error('WALLET_BONUS_EXPIRY_INVALID');
  return new Date(expiry).toISOString();
}

function adminCreateBonusGrant(token,args) {
  args=args || {};
  const key=walletRequestKey_(args.requestKey);
  const amount=walletAssertSatang_(args.amountSatang,false);
  const reason=String(args.reason || '').trim();
  const sourceType=String(args.sourceType || '').trim().toUpperCase();
  const sourceId=String(args.sourceId || '').trim();
  if(!reason || reason.length>500 || !['PROMOTION','CAMPAIGN','ADMIN_COMPENSATION','OTHER'].includes(sourceType)) {
    throw new Error('WALLET_BONUS_INPUT_INVALID');
  }
  const lock=LockService.getScriptLock();lock.waitLock(20000);
  try {
    walletAssertWriteGateLocked_();
    const admin=requireAdminLocked_(token,Date.now());
    const memberId=String(args.memberId || '').trim();
    if(!repositoryGetById_('members',memberId)) throw new Error('WALLET_MEMBER_NOT_FOUND');
    const idem='BONUS_GRANT:'+key;
    const requestPayloadHash=walletRequestHash_({memberId:memberId,amountSatang:amount,reason:reason,
      sourceType:sourceType,sourceId:sourceId,startsAt:String(args.startsAt || ''),
      durationDays:args.durationDays===undefined?'':args.durationDays,expiresAt:String(args.expiresAt || '')});
    const prior=repositoryFindByField_('wallet_recovery_journal','idempotency_key',idem);
    if(prior.length) {
      if(String(prior[0].payload_hash)!==requestPayloadHash) throw new Error('WALLET_IDEMPOTENCY_CONFLICT');
      walletApplyCreditJournalLocked_(prior[0]);
      const savedGrant=prior[0].bonus_patch_json?JSON.parse(prior[0].bonus_patch_json).record:null;
      return {ok:true,replayed:true,memberId:memberId,amountSatang:amount,expiresAt:savedGrant?savedGrant.expires_at:''};
    }
    const existing=repositoryFindByField_('wallet_ledger','idempotency_key',idem);
    if(existing.length) return {ok:true,replayed:true,transactionId:existing[0].transaction_id};
    const now=new Date();
    const startsAt=String(args.startsAt || now.toISOString());
    const startsMs=Date.parse(startsAt);
    if(!Number.isFinite(startsMs) || startsMs>now.getTime()) throw new Error('WALLET_BONUS_START_INVALID');
    const expiresAt=walletResolveBonusExpiry_(args,now.getTime());
    const grant={
      bonus_grant_id:Utilities.getUuid(),member_id:memberId,granted_satang:amount,
      remaining_satang:amount,source_type:sourceType,source_id:sourceId,reason:reason,
      starts_at:new Date(startsMs).toISOString(),expires_at:expiresAt,status:'ACTIVE',
      created_by_admin_id:admin.admin_id,created_at:now.toISOString(),updated_at:now.toISOString()
    };
    const journal=walletPrepareCreditJournalLocked_({
      member_id:memberId,credit_type:'BONUS',amount_satang:amount,idempotency_key:idem,
      entry_type:'BONUS_GRANT',reference_type:'BONUS_GRANT',reference_id:grant.bonus_grant_id,
      actor_type:'ADMIN',actor_id:admin.admin_id,reason:reason,bonus_grant:grant,
      payload_hash:requestPayloadHash,
      audit_patch:{
        audit_id:Utilities.getUuid(),admin_id:admin.admin_id,action:'WALLET_BONUS_GRANTED',
        target_type:'member',target_id:memberId,request_id:key,ip_address:'',
        details_json:JSON.stringify({amount_satang:amount,source_type:sourceType,source_id:sourceId,
          starts_at:grant.starts_at,expires_at:grant.expires_at,reason:reason}),created_at:now.toISOString()
      }
    });
    walletApplyCreditJournalLocked_(repositoryGetById_('wallet_recovery_journal',journal.journal_id));
    return {ok:true,memberId:memberId,amountSatang:amount,expiresAt:grant.expires_at};
  } finally {lock.releaseLock();}
}


function adminWalletTopupProof(token,topupId) {
  const admin=requireAdmin_(token);
  const row=repositoryGetById_('wallet_topups',String(topupId || ''));
  if(!row || !row.slip_file_id) throw new Error('WALLET_TOPUP_PROOF_NOT_FOUND');
  const folderId=String(PropertiesService.getScriptProperties().getProperty('NOBI_PRIVATE_DRIVE_FOLDER_ID') || '').trim();
  if(!folderId) throw new Error('DRIVE_FOLDER_NOT_CONFIGURED');
  const file=DriveApp.getFileById(String(row.slip_file_id));
  assertDriveFileInPrivateFolder_(file,folderId);
  const blob=file.getBlob();
  const bytes=blob.getBytes();
  if(bytes.length>NOBI.MAX_SLIP_BYTES || !validImageSignature_(bytes,String(blob.getContentType()))) {
    throw new Error('WALLET_TOPUP_PROOF_INVALID');
  }
  const lock=LockService.getScriptLock();lock.waitLock(10000);
  try {
    const currentAdmin=requireAdminLocked_(token,Date.now());
    appendAdminAuditLogLocked_({
      audit_id:Utilities.getUuid(),admin_id:currentAdmin.admin_id,action:'VIEW_WALLET_TOPUP_PROOF',
      target_type:'wallet_topup',target_id:row.topup_id,request_id:'',ip_address:'',
      details_json:JSON.stringify({mime_type:blob.getContentType(),size_bytes:bytes.length}),
      created_at:new Date().toISOString()
    });
    return {name:file.getName(),mimeType:blob.getContentType(),base64:Utilities.base64Encode(bytes)};
  } finally {lock.releaseLock();}
}

/** Idempotent expiry worker; install a scheduled trigger only after release approval. */
function runWalletTopupExpiry() {
  const lock=LockService.getScriptLock();lock.waitLock(20000);
  try {
    walletAssertWriteGateLocked_();
    const now=Date.now(), nowIso=new Date(now).toISOString();
    let expired=0;
    repositoryRows_('wallet_topups').forEach(function(row) {
      if(row.status!=='AWAITING_PROOF') return;
      const created=Date.parse(row.created_at);
      if(Number.isFinite(created) && now>=created+24*60*60*1000) {
        repositoryUpdateLocked_('wallet_topups',row.topup_id,{status:'EXPIRED',updated_at:nowIso});
        expired++;
      }
    });
    return {ok:true,expired:expired,checkedAt:nowIso};
  } finally {lock.releaseLock();}
}


function walletPrepareTopupDecisionJournalLocked_(input) {
  walletAssertWriteGateLocked_();
  const key=String(input.idempotency_key || '');
  const hash=String(input.payload_hash || '');
  if(!/^[A-Za-z0-9._:-]{16,128}$/.test(key) || !/^[a-f0-9]{64}$/.test(hash)) {
    throw new Error('WALLET_TOPUP_DECISION_INVALID');
  }
  const prior=repositoryFindByField_('wallet_recovery_journal','idempotency_key',key);
  if(prior.length) {
    if(String(prior[0].payload_hash)!==hash) throw new Error('WALLET_IDEMPOTENCY_CONFLICT');
    return prior[0];
  }
  const now=new Date().toISOString();
  const row={
    journal_id:Utilities.getUuid(),operation:'TOPUP_DECISION',transaction_id:Utilities.getUuid(),
    idempotency_key:key,payload_hash:hash,member_id:String(input.member_id),
    hold_id:'',topup_id:String(input.topup_id),step_state:'PREPARED',
    ledger_payload_json:'',wallet_patch_json:'',bonus_patch_json:'',order_patch_json:'',
    topup_patch_json:JSON.stringify({topup_id:String(input.topup_id),
      expected_status:String(input.expected_status),patch:input.patch}),
    audit_patch_json:JSON.stringify(input.audit_patch),attempts:0,last_error_code:'',
    created_at:now,updated_at:now
  };
  repositoryInsertLocked_('wallet_recovery_journal',row);
  return row;
}

function walletApplyTopupDecisionJournalLocked_(journal) {
  walletAssertWriteGateLocked_();
  if(!journal || journal.operation!=='TOPUP_DECISION') throw new Error('WALLET_TOPUP_JOURNAL_INVALID');
  if(journal.step_state==='COMPLETED') return {ok:true,alreadyCompleted:true};
  const now=new Date().toISOString();
  try {
    const patch=JSON.parse(String(journal.topup_patch_json || '{}'));
    const topup=repositoryGetById_('wallet_topups',String(patch.topup_id || ''));
    if(!topup || String(topup.member_id)!==String(journal.member_id)) throw new Error('WALLET_TOPUP_NOT_FOUND');
    if(String(topup.status)===String(patch.expected_status)) {
      repositoryUpdateLocked_('wallet_topups',patch.topup_id,patch.patch);
    } else if(String(topup.status)!==String(patch.patch.status)) {
      throw new Error('WALLET_TOPUP_STATE_CONFLICT');
    }
    const audit=JSON.parse(String(journal.audit_patch_json || '{}'));
    const existing=repositoryGetById_('admin_audit_logs',audit.audit_id);
    if(!existing) repositoryInsertLocked_('admin_audit_logs',audit);
    else if(NOBI.SHEETS.admin_audit_logs.some(function(field){
      return String(existing[field] == null ? '' : existing[field])!==String(audit[field] == null ? '' : audit[field]);
    })) throw new Error('WALLET_AUDIT_CONFLICT');
    repositoryUpdateLocked_('wallet_recovery_journal',journal.journal_id,{
      step_state:'COMPLETED',attempts:Number(journal.attempts || 0)+1,last_error_code:'',updated_at:now
    });
    return {ok:true};
  } catch(error) {
    const saved=repositoryGetById_('wallet_recovery_journal',journal.journal_id);
    if(saved && saved.step_state!=='COMPLETED') repositoryUpdateLocked_('wallet_recovery_journal',journal.journal_id,{
      step_state:'RECOVERY_REQUIRED',attempts:Number(saved.attempts || 0)+1,
      last_error_code:/^[A-Z0-9_:-]{1,100}$/.test(String(error.message || ''))?String(error.message):'WALLET_RECOVERY_FAILED',
      updated_at:now
    });
    throw error;
  }
}
