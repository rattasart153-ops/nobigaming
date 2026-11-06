> **SUPERSEDED TRANSPORT CONTRACT (2026-11-05):** This document describes the former Vercel Express REST API and Vercel-to-Apps-Script signed gateway. Vercel is no longer part of the approved zero-cost target. Retain this only as a source/behavior reference while building the HtmlService + `google.script.run` compatibility facade. See [ZERO_COST_MIGRATION_PLAN.md](./ZERO_COST_MIGRATION_PLAN.md).

# Nobi Topup — Implemented API Contract

Status: browser-facing routes and the signed Vercel-to-Apps-Script contract are implemented in source on `vercel-drive-setup`. This is not production approval. Apps Script runtime, quota, concurrency and browser/device integration tests remain release gates.

## Browser-facing Vercel routes

Public:
- `GET /api/health`
- `GET /api/public/catalog`
- `GET /api/public/promotions`
- `GET /api/public/coupons/suggestions`
- `POST /api/public/coupons/validate`
- `GET /api/public/payment-info`
- `POST /api/public/orders` — creates a Pending order; a slip may be included in the same multipart request or uploaded later.
- `POST /api/public/orders/:orderId/slip` — requires the order-scoped HttpOnly checkout cookie.
- `GET /api/public/media/:fileId` — serves only active catalog/promotion images referenced in Sheets and stored in the configured private Drive media folder.

Member:
- `POST /api/member/register`
- `POST /api/member/login`
- `POST /api/member/logout`
- `GET /api/member/me`
- `POST /api/member/password`

Admin:
- `POST /api/admin/login`
- `POST /api/admin/logout`
- `GET /api/admin/me`
- `POST /api/admin/password`
- `GET /api/admin/dashboard`
- `GET /api/admin/orders`
- `PATCH /api/admin/orders/:orderId/status`
- `GET /api/admin/orders/:orderId/slip`
- `GET /api/admin/members`
- `PATCH /api/admin/members/:memberId/status`
- `GET /api/admin/member-login-logs`
- `GET|POST|PUT|DELETE /api/admin/games`
- `GET|POST|PUT|DELETE /api/admin/packages`
- `GET|POST|PUT|DELETE /api/admin/coupons`
- `GET|POST|PUT|DELETE /api/admin/promotions`
- `POST /api/admin/upload` — Admin-only private Drive image upload.

There are no Member order-history endpoints in the current API. Do not promise or call them until implemented and tested.

## Browser request and cookie rules

- Browser pages call same-origin Vercel routes only. Browser code must never call the Apps Script URL, `google.script.run`, Sheets or Drive directly.
- JSON uses `application/json`; uploads use `multipart/form-data`. Do not set the multipart boundary manually.
- Mutations pass same-origin checks. Cross-site Fetch Metadata and mismatched/missing Origin are rejected.
- Admin and Member use separate HttpOnly cookies, Secure in production, SameSite=Strict. Session tokens are never returned in JSON or stored in browser storage.
- Admin and Member sessions store only SHA-256 token hashes in Sheets; maximum lifetime is 8 hours and idle timeout is 30 minutes. Logout, password change, suspension and auth-version changes revoke existing sessions.
- Order checkout uses a separate HttpOnly, SameSite=Strict cookie scoped to that order's slip endpoint and expiring at the server-provided payment deadline.

## Order creation and slip lifecycle

- Every checkout request supplies an `Idempotency-Key` of 16–128 characters. The server fingerprints the canonical order payload and stores the request key, payload hash and resulting order ID in Sheets for 90 days.
- Repeating the same key with the same payload returns the same order. If the order is still Pending and has no slip, the server deterministically re-derives and reissues the same opaque checkout token in the scoped cookie, so concurrent retries cannot invalidate one another. Reusing the key with a different payload returns a conflict.
- The server derives package price, discount, totals, member identity and coupon eligibility from persisted records and the verified Member cookie. Client-supplied totals or member IDs are not authoritative.
- Orders without a coupon, and orders using a coupon without an expiry date, have a 15-minute payment deadline.
- Orders using an expiring coupon remain payable and eligible for slip submission through 23:59:59.999 Asia/Bangkok on the coupon expiry date. The stored deadline is the exclusive next-day 00:00 Asia/Bangkok cutoff. No additional 15-minute cap applies.
- The server enforces the deadline synchronously when creating an order, submitting a slip and approving an order. A slip must be accepted before the deadline; Admin may review and complete it later.
- Coupon capacity is Reserved when a Pending order is created, Consumed only when the order is Completed, and Released when the order is Rejected or expires. Sheets writes are serialized with ScriptLock; multi-row writes use compensating updates because Sheets has no SQL transaction.
- Slip upload is limited to PNG/JPEG/WebP, fully decoded/re-encoded in the Vercel staging layer, and capped at 3 MB to stay below Vercel function payload limits. Apps Script independently checks size and file signature.
- A repeated slip submission using the same valid checkout token returns the existing accepted submission and does not create a second Drive file. After the first accepted upload, Vercel retains the scoped token cookie for five minutes as a receipt/retry credential; a successful retry returns `already_submitted=true` and clears that cookie.
- Slips are stored in the configured private Drive slip folder. Admin retrieval requires a valid Admin session and checks the configured private folder and file privacy.

## Coupon eligibility

- `public`: Guest and Member, subject to other restrictions.
- `member_only`: authenticated Active Member only.
- `member_game_spend`: authenticated Active Member whose Completed, post-discount spend in the configured qualifying game reaches the threshold.
- Optional UID allowlist and UID cumulative Completed spend in the selected checkout game are additional independent restrictions.
- Pending, Rejected, Expired and Guest orders do not count toward Member or UID cumulative spend.
- Usage limits count Reserved and Consumed redemptions. Eligibility is rechecked under the checkout ScriptLock before reservation.

## Vercel-to-Apps-Script request envelope

Implemented in `google-apps-script/13_HttpGateway.gs` and `src/clients/apps-script.client.js`.

Signed JSON fields:
- `version`: integer, currently 1
- `timestamp`: Unix epoch milliseconds
- `nonce`: cryptographically random base64url value, unique per transport attempt
- `action`: fixed allowlisted action name
- `args`: action-specific object
- `signature`: lowercase hexadecimal HMAC-SHA256

The signature covers canonical JSON property order `version,timestamp,nonce,action,args`. The shared secret exists only in Vercel environment variable `APPS_SCRIPT_SHARED_SECRET` and Apps Script Script Property `NOBI_GATEWAY_SECRET`. GAS validates the secret, ±5-minute timestamp freshness, signature, nonce replay and fixed action allowlist before dispatch.

The gateway returns a signed-protocol JSON envelope:
- Success: `ok=true, version=1, result`
- Failure: `ok=false, version=1, error.code, error.message`

ContentService does not provide arbitrary HTTP status mapping; the Node client must inspect the JSON envelope. It follows only the expected Google-owned ContentService 302/303 redirect and never forwards the signed POST body to the redirect destination.

## Shared abuse controls

- Express has a process-local first-layer limiter; it is not treated as global protection across Vercel instances.
- Apps Script enforces shared HMAC-keyed Sheets buckets: 10 Admin login attempts per normalized Admin username per 15 minutes; 10 Member login attempts per normalized Login ID per 15 minutes; 5 registrations per normalized Login ID per 15 minutes; and 5 failed password attempts per account per 15 minutes.
- The approved HtmlService + Apps Script-only target has no trusted visitor-IP source. Caller-supplied IP arguments are ignored for Member and Admin security records; no browser-provided IP is stored or presented as verified.
- Member registration/login, Member sessions and Member login/security history do not collect IP addresses. Legacy schema columns remain blank for compatibility. Admin member APIs omit IP fields. Member login/security events retain time, outcome, failure reason and user-agent metadata for 90 days.
- Retention cleanup immediately clears legacy Member IP fields, Member session IP fields, Member login-log IP fields, and untrusted Admin session/audit IP fields. It continues to delete login/audit event rows after 90 days.

## Error mapping

The Node client maps known gateway errors to 401, 409, 410, 422, 429 or 503 as appropriate. Transport failures, invalid JSON, unsafe redirects and unknown gateway errors fail closed as 502. Apps Script stack traces, spreadsheet IDs, Drive IDs, hashes, tokens and secrets are not returned.

## Timeout and retry rules

- Every Apps Script call has a bounded timeout (configured through `APPS_SCRIPT_TIMEOUT_MS`; default 30 seconds in the current Vercel environment config).
- The client does not automatically retry mutations.
- An ambiguous order-creation result must be retried only with the original Idempotency-Key and identical payload.
- Each transport retry gets a fresh nonce, timestamp and signature; the order idempotency key remains stable.
- Do not accept live orders until Apps Script runtime, quota, concurrent-write and browser/device tests pass.

## Release gates

- Import the complete `google-apps-script/` source into one Apps Script project and verify syntax/runtime compatibility.
- Test signature failure, stale timestamp, replay, invalid action, missing schema and concurrent nonce claims.
- Test concurrent coupon reservations, idempotent order retries, payment deadlines, slip upload retries and order status transitions.
- Benchmark PBKDF2-SHA256 at 120,000 iterations and verify Apps Script execution time/quotas.
- Verify private Drive folder/file permissions and media reference checks using synthetic files.
- Run browser/device end-to-end tests against a synthetic Apps Script deployment.
- Verify Vercel function duration and payload constraints before any live launch.
- Do not initialize production Sheets, publish the Web App or deploy Vercel without separate explicit approval.
