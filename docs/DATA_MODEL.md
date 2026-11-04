# Nobi Topup — Google Sheets and Drive Data Model

Status: proposed schema baseline. Validate before implementation.

## Conventions
- Row 1 contains exact headers; first column is a stable UUID string.
- Timestamps are ISO-8601 UTC.
- Money uses integer satang.
- Use explicit status enums; do not delete historical rows for ordinary CRUD.
- Never store raw passwords, raw session tokens or public Drive URLs.
- Setup is idempotent and versioned. Unexpected headers cause a clear failure; never silently clear or rewrite data.

## Sheets and columns

### admins
admin_id, username_normalized, username_display, password_hash, password_salt, password_algorithm, status, auth_version, created_at, updated_at, last_login_at

Unique logical key: username_normalized.

### admin_sessions
session_id, admin_id, token_hash, auth_version, created_at, expires_at, last_seen_at, revoked_at, created_ip

### members
member_id, full_name, login_id_normalized, login_id_display, password_hash, password_salt, password_algorithm, status, auth_version, registered_ip, last_login_ip, created_at, updated_at, last_login_at

Unique logical key: login_id_normalized. Login ID is ASCII letters and digits, case-insensitive. Proposed length 4–30 must be checked against the approved member specification.

### member_sessions
session_id, member_id, token_hash, auth_version, created_at, expires_at, last_seen_at, revoked_at, created_ip

### member_login_logs
log_id, member_id, login_id_normalized, ip_address, is_new_ip, login_result, failure_reason_code, user_agent, created_at

Record login attempts. Only Admin can view IP history.

### admin_audit_logs
audit_id, admin_id, action, target_type, target_id, request_id, ip_address, details_json, created_at

Audit sensitive actions: viewing member IP history, viewing private slips, changing order status, coupon changes and account/session administration. Never log secrets or slip bytes.

### games
game_id, name, category, description, active, sort_order, created_at, updated_at

### packages
package_id, game_id, name, amount, unit, price_satang, image_file_id, image_url, popular, active, sort_order, created_at, updated_at

### coupons
coupon_id, code_normalized, code_display, discount_type, discount_value, min_order_satang, game_id, access_type, member_spend_game_id, member_min_game_spend_satang, expires_at, usage_limit, active, allowed_player_ids_json, min_player_spend_satang, created_at, updated_at

access_type is everyone, member_only or member_game_spend. game_id limits redemption game; member_spend_game_id is the separate game used to calculate Member eligibility.

### coupon_redemptions
redemption_id, coupon_id, order_id, member_id, player_id, game_id, discount_satang, state, reserved_at, reserved_until, finalized_at, released_at

States: Reserved, Consumed, Released. This ledger is the source of truth for coupon capacity. Reserve immediately when an order enters Pending; change to Consumed only when the order is Completed before its payment deadline; release on Rejected or payment expiry. Enforce every reserve/consume/release operation under a shared lock and make it idempotent. `reserved_until` records the effective payment deadline.

### promotions
promotion_id, title, subtitle, image_file_id, image_url, link_url, active, sort_order, starts_at, ends_at, created_at, updated_at

### orders
order_id, order_number, request_key, member_id, game_id, package_id, player_id, server_id, coupon_id, subtotal_satang, discount_satang, total_satang, slip_file_id, slip_mime_type, slip_size_bytes, status, status_reason, payment_expires_at, created_at, updated_at, completed_at, rejected_at

Guest order has blank member_id. Status is Pending, Completed or Rejected. `payment_expires_at` is fixed at order creation: for every order, 15 minutes after creation; for coupon orders, the earlier of that time and the coupon expiry-day cutoff. The coupon expiry date is the calendar date entered/displayed in Asia/Bangkok. The coupon remains valid through that entire date; its exclusive cutoff is 00:00 Asia/Bangkok at the start of the following day. Store timestamps canonically as ISO-8601 UTC. A Pending order must not be completed at or after `payment_expires_at`; expiry handling sets `status=Rejected` with `status_reason=PAYMENT_TIMEOUT` and releases any Reserved coupon capacity exactly once. The expiry worker must be idempotent; order creation, status changes and coupon validation must also enforce the deadline synchronously so correctness does not depend on scheduler punctuality. `request_key` is unique. Member history is always filtered by authenticated member_id.

### idempotency_records
idempotency_id, scope, request_key, payload_hash, resource_id, state, created_at, expires_at

Reusing a key with a different payload must return conflict.

### system_metadata
key, value, updated_at

Stores schema version and non-secret setup metadata. Secrets belong in Apps Script Script Properties.

## Private Drive layout
One private root folder referenced only through Script Properties:
- Nobi Topup Private
  - slips
  - catalog-images
  - promotion-images

No file or folder is shared as Anyone. Store Drive file IDs only. Slips and other uploaded images remain private in Drive. When an image is intended for storefront display, Vercel may proxy its bytes through an application route without changing the Drive file's sharing permissions; never return a public Drive URL.

## Setup behavior
- setupNobiDatabase() creates missing sheets and exact headers.
- If an existing sheet has unexpected headers or schema version, stop and report; do not overwrite.
- Seed catalog only when the relevant table is empty.
- Do not create an Admin with a hard-coded password.
- First Admin is created from a one-time Script Property bootstrap secret, then that secret is deleted.

## Decisions still required
1. Confirm whether login ID length 4–30 is final.
2. Coupon lifecycle and payment window are confirmed; see the `orders` and `coupon_redemptions` rules above.
3. Image privacy requirement is confirmed: uploaded images, including marketing/catalog images and slips, remain private in Drive; storefront display must use an application proxy rather than public Drive sharing.
4. Set retention periods for login and Admin audit logs.
5. Confirm Admin and Member session lifetime and idle timeout.
