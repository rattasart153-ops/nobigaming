/** Nobi Topup Apps Script configuration and versioned Sheets schema. */
const NOBI = {
  SCHEMA_VERSION: 1,
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
    promotions: ['promotion_id','title','subtitle','image_file_id','image_url','link_url','active','sort_order','starts_at','ends_at','created_at','updated_at'],
    orders: ['order_id','order_number','request_key','member_id','game_id','package_id','player_id','server_id','coupon_id','subtotal_satang','discount_satang','total_satang','slip_file_id','slip_mime_type','slip_size_bytes','slip_submitted_at','checkout_token_hash','status','status_reason','payment_expires_at','created_at','updated_at','completed_at','rejected_at'],
    idempotency_records: ['idempotency_id','scope','request_key','payload_hash','resource_id','state','created_at','expires_at'],
    system_metadata: ['key','value','updated_at'],
    gateway_nonces: ['nonce_hash','created_at'],
    security_rate_limits: ['bucket_key_hash','window_start','attempt_count','blocked_until','updated_at']
  },
  SESSION_MAX_LIFETIME_MS: 8 * 60 * 60 * 1000,
  SESSION_IDLE_TIMEOUT_MS: 30 * 60 * 1000,
  LOG_RETENTION_DAYS: 90,
  MAX_SLIP_BYTES: 5 * 1024 * 1024
};
