/** Nobi Topup Apps Script 00_Config module. */

const NOBI = {
  SHEETS: {
    admins: ['id','username','password_salt','password_hash','auth_version','active','created_at'],
    games: ['id','name','category','description','active','created_at'],
    packages: ['id','game_id','name','amount','unit','price','image_url','popular','active','created_at'],
    coupons: ['id','code','discount_type','discount_value','min_spend','game_id','expires_at','usage_limit','used_count','active','created_at','allowed_player_ids','min_player_spend'],
    promotions: ['id','title','subtitle','image_url','link_url','active','sort_order','starts_at','ends_at','created_at'],
    orders: ['id','game_id','package_id','game_name','package_name','player_id','server_id','coupon_id','coupon_code','subtotal','discount','total','slip_file_id','status','created_at','updated_at','request_key'],
    sessions: ['id','admin_id','token_hash','auth_version','created_at','expires_at','revoked'],
    gateway_nonces: ['nonce_hash','created_at']
  },
  SESSION_MS: 8 * 60 * 60 * 1000,
  MAX_SLIP_BYTES: 5 * 1024 * 1024
}
