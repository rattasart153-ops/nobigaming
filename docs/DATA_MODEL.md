> **ACTIVE DATA MODEL BASELINE (2026-11-06):** Google Sheets Schema v3 is the approved data model for the zero-cost Apps Script architecture. This is a schema reference only; it does not authorize spreadsheet creation or initialization. See [ZERO_COST_MIGRATION_PLAN.md](./ZERO_COST_MIGRATION_PLAN.md).

# Nobi Topup — Google Sheets and Drive Data Model

Status: approved target schema baseline; version 3 headers are implemented in `google-apps-script/00_Config.gs` and initialized by `02_Database.gs`. Schema-aware business repositories are implemented; real Google Sheets/Drive runtime behavior remains unverified.

## Conventions
- Row 1 contains exact headers; the first column is the stable string key (UUID for entity records, natural key for metadata and nonce-ledger rows).
- Timestamps are ISO-8601 UTC.
- Money uses integer satang.
- Use explicit status enums; do not delete historical rows for ordinary CRUD.
- Never store raw passwords, raw session tokens or public Drive URLs.
- Setup is idempotent and versioned. Unexpected headers cause a clear failure; never silently clear or rewrite data.

## Sheets and columns

### admins
`admin_id, username_normalized, username_display, password_hash, password_salt, password_algorithm, status, auth_version, created_at, updated_at, last_login_at`

Unique logical key: `username_normalized`.

### admin_sessions
`session_id, admin_id, token_hash, auth_version, created_at, expires_at, last_seen_at, revoked_at, created_ip`

### members
`member_id, full_name, login_id_normalized, login_id_display, password_hash, password_salt, password_algorithm, status, auth_version, registered_ip, last_login_ip, created_at, updated_at, last_login_at`

Unique logical key: `login_id_normalized`. Login ID policy: ASCII English letters and digits only, 4–30 characters, case-insensitive.

### member_sessions
`session_id, member_id, token_hash, auth_version, created_at, expires_at, last_seen_at, revoked_at, created_ip`

Session policy (CONFIRMED): absolute lifetime is at most 8 hours from creation; idle timeout is 30 minutes based on `last_seen_at`. Revoke on logout or password change. Apply the same policy to Admin and Member sessions.

### member_login_logs
`log_id, member_id, login_id_normalized, ip_address, is_new_ip, login_result, failure_reason_code, user_agent, created_at`

Retention policy (CONFIRMED): retain login/IP history for 90 days, then delete or irreversibly anonymize it. IP history remains Admin-only. The scheduled cleanup removes rows at or beyond the 90-day boundary using bottom-up contiguous row batches.

### admin_audit_logs
`audit_id, admin_id, action, target_type, target_id, request_id, ip_address, details_json, created_at`

Retention policy (CONFIRMED): retain Admin audit logs for 90 days, then delete or irreversibly anonymize them. The scheduled cleanup removes rows at or beyond the 90-day boundary.

Audit sensitive actions: viewing member IP history, viewing private slips, changing order status, coupon changes and account/session administration. Never log secrets or slip bytes.

### games
`game_id, name, category, description, active, sort_order, created_at, updated_at`

### packages
`package_id, game_id, name, amount, unit, price_satang, image_file_id, image_url, popular, active, sort_order, created_at, updated_at`

### coupons
`coupon_id, code_normalized, code_display, discount_type, discount_value, min_order_satang, game_id, access_type, member_spend_game_id, member_min_game_spend_satang, expires_at, usage_limit, active, allowed_player_ids_json, min_player_spend_satang, created_at, updated_at`

`access_type` is everyone, member_only or member_game_spend. `game_id` limits redemption game; `member_spend_game_id` is the separate game used to calculate Member eligibility. UID allowlist and UID cumulative spend are separate constraints.

### coupon_redemptions
`redemption_id, coupon_id, order_id, member_id, player_id, game_id, discount_satang, state, reserved_at, reserved_until, finalized_at, released_at`

States: Reserved, Consumed, Released. This ledger is the source of truth for coupon capacity. Reserve immediately when a coupon order enters Pending; change to Consumed when Admin marks Completed only if the slip was submitted before its payment deadline; release on Rejected or payment expiry. Enforce every reserve/consume/release operation under a shared lock and make it idempotent. `reserved_until` records the effective payment deadline.

### promotions
`promotion_id, title, subtitle, image_file_id, image_url, link_url, active, sort_order, starts_at, ends_at, created_at, updated_at`

### orders
`order_id, order_number, request_key, member_id, game_id, package_id, player_id, server_id, coupon_id, subtotal_satang, discount_satang, total_satang, slip_file_id, slip_mime_type, slip_size_bytes, slip_submitted_at, checkout_token_hash, status, status_reason, payment_expires_at, created_at, updated_at, completed_at, rejected_at`

Guest order has blank `member_id`. Status is Pending, Completed, Rejected or Expired. `payment_expires_at` is fixed at order creation. An order without a coupon, or using a coupon with no expiry date, expires 15 minutes after creation. An order using a coupon with an expiry date may be paid and have its slip submitted until the exclusive cutoff at 00:00 Asia/Bangkok on the day after the coupon expiry date; there is no additional 15-minute cap for this case. The coupon expiry date is inclusive through 23:59:59.999 Asia/Bangkok. Store timestamps canonically as ISO-8601 UTC. Checkout creates a Pending order before payment and immediately reserves coupon capacity. The checkout token is returned once and only its hash is stored; it authorizes the customer to submit one slip. `slip_submitted_at` is the server-recorded submission time. If no slip is submitted before `payment_expires_at`, set `status=Expired` with `status_reason=PAYMENT_TIMEOUT` and release any Reserved coupon capacity exactly once. If a slip was submitted before the deadline, the order remains Pending for Admin review even after the deadline or coupon expiry date; Admin may later set Completed (consume the reservation) or Rejected (release it). A slip submitted at or after the exclusive deadline is rejected and the order expires. The expiry worker must be idempotent, and order creation/slip submission must enforce deadlines synchronously so correctness does not depend on scheduler punctuality. `request_key` is unique within the create-order idempotency scope.

### idempotency_records
`idempotency_id, scope, request_key, payload_hash, resource_id, state, created_at, expires_at`

Reusing a key with a different payload must return conflict.

### order_recovery_journal
`journal_id, order_id, operation, order_record_json, idempotency_record_json, redemption_record_json, order_patch_json, redemption_id, redemption_patch_json, state, attempts, last_error_code, created_at, updated_at`

Durable write-ahead intent for the non-transactional Sheets order/coupon workflow. A CREATE journal stores the order, idempotency and optional redemption records before any of those records are written. A TRANSITION journal stores the desired order and optional redemption patches before either is applied. Recovery replays Pending entries under ScriptLock and is safe to retry. Recovery validates order/redemption linkage and refuses conflicting or cross-order records. Once all writes are consistent, the journal is marked Completed and its duplicated JSON payload fields are cleared; the remaining row is operational metadata. Never manually delete Pending entries.

### system_metadata
`key, value, updated_at`

Stores schema version and non-secret setup metadata. Secrets belong in Apps Script Script Properties.

### gateway_nonces
`nonce_hash, created_at`

Stores SHA-256 hashes of recently accepted server-to-server request nonces. The gateway checks and appends under ScriptLock to reject replayed signed requests. Retain only a bounded recent window; this is transport replay protection and does not replace business idempotency records.

### security_rate_limits
`bucket_key_hash, window_start, attempt_count, blocked_until, updated_at`

Stores keyed hashes for shared IP/account throttling. Do not store raw IPs in rate-limit bucket keys.

## Private Drive layout
One private root folder referenced only through Script Properties:
- Nobi Topup Private
  - slips
  - catalog-images
  - promotion-images

No file or folder is shared as Anyone. Store Drive file IDs only. Slips and other uploaded images remain private in Drive. When an image is intended for storefront display, the application may proxy its bytes without changing the Drive file's sharing permissions; never return a public Drive URL.

## Setup behavior
- `setupNobiDatabase()` initializes schema version 3 after preflighting all existing sheets. It supports non-destructive upgrades from schema v1 or v2 to v3, creates missing sheets, writes exact headers and stores `schema_version` in `system_metadata`.
- A v1 database receives the missing recovery-journal sheet as part of the cumulative upgrade. A v2 database already containing the journal is advanced to v3 after preflight. Existing business rows are preserved.
- If an existing sheet has unexpected headers, an unknown schema version, or populated data without a version marker, stop before changing any sheet; never append columns, clear rows, or rewrite existing content.
- Do not seed catalog data during schema initialization; catalog seeding is a separate reviewed operation.
- Do not create an Admin with a hard-coded password.
- First Admin is created from a one-time Script Property bootstrap secret, then that secret is deleted.

## Retention implementation and activation
- Source function `runNobiRetentionCleanup()` clears `members.registered_ip` based on member creation time, clears `members.last_login_ip` based on last login time, clears `created_ip` from Member/Admin sessions, and deletes Member login and Admin audit log rows at or beyond 90 days.
- Invalid or missing timestamps are treated as expired for IP cleanup so IP data is not retained indefinitely without a defensible timestamp. Cleanup writes each IP-bearing column in one batch rather than issuing one Sheets write per affected record.
- `ensureNobiRetentionTrigger()` creates one daily trigger for approximately 03:00 Asia/Bangkok and removes duplicate triggers. It is deliberately not called by database setup. An authorized project owner must run it manually once after deployment; no real Google trigger has been installed by this source change.
- Actual Apps Script trigger execution, real Sheets retention behavior and runtime quotas remain unverified.

## Decisions status
1. Login ID policy: CONFIRMED — ASCII English letters/digits only, 4–30 characters, case-insensitive.
2. Coupon lifecycle and payment window: CONFIRMED; see the `orders` and `coupon_redemptions` rules above.
3. Image privacy: CONFIRMED — uploaded images, including marketing/catalog images and slips, remain private in Drive; storefront display must use an application proxy rather than public Drive sharing.
4. Login/IP-history and Admin audit-log retention: CONFIRMED — 90 days, then delete or irreversibly anonymize.
5. Admin and Member sessions: CONFIRMED — 8-hour maximum lifetime, 30-minute idle timeout, revoke on logout or password change.
