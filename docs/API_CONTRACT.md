# Nobi Topup — API Contract

Status: proposed contract. Verify exact legacy payloads and response shapes before replacing existing frontend calls.

## Browser-facing Vercel routes

Public:
- GET /api/health
- GET /api/public/catalog
- GET /api/public/promotions
- GET /api/public/coupons/suggestions
- POST /api/public/coupons/validate
- GET /api/public/payment-info
- POST /api/public/orders (creates Pending checkout; slip upload is optional at creation)
- POST /api/public/orders/:orderId/slip (multipart upload; order-scoped HttpOnly checkout cookie required)

Authentication:
- POST /api/admin/login
- POST /api/admin/logout
- GET /api/admin/me
- POST /api/member/register
- POST /api/member/login
- POST /api/member/logout
- GET /api/member/me

Member:
- GET /api/member/orders
- GET /api/member/orders/:orderId

Admin:
- GET /api/admin/dashboard
- GET /api/admin/orders
- PATCH /api/admin/orders/:orderId/status
- GET /api/admin/orders/:orderId/slip
- GET /api/admin/members
- GET /api/admin/members/:memberId/ip-history
- CRUD routes for games, packages, coupons and promotions under /api/admin/*

Member identity is derived from the verified session, never from a browser-supplied member ID. IP history and private slip routes require Admin authorization and audit logging.

## Browser request rules
- JSON uses application/json.
- Upload uses multipart/form-data; browser must not set the multipart boundary manually.
- Mutations require CSRF/origin protection appropriate to same-site cookie authentication.
- Auth cookies are HttpOnly and never returned in JSON.
- Admin and Member cookies are separate.
- Order creation requires an `Idempotency-Key` generated once per checkout attempt and reused only for retries of the same payload. The server stores a SHA-256 key digest, a canonical request fingerprint and the resulting order ID in the same immediate SQLite transaction as order creation. Concurrent requests using the same key serialize through that transaction and must return one shared order ID, never create duplicate coupon reservations. Reuse with the same fingerprint returns the original order and rotates the scoped checkout cookie; reuse with a different fingerprint returns 409. Expired original attempts return 410. The browser may persist the non-secret key and order ID in sessionStorage, but never the checkout token.
- Server derives identity, price, discount, totals and coupon eligibility.
- Orders without a coupon, and orders using a coupon without an expiry date, have a 15-minute payment deadline. An order using a coupon with an expiry date may be paid and have its slip submitted until the exclusive cutoff at 00:00 Asia/Bangkok on the day after the coupon expiry date; do not impose an additional 15-minute cap. The coupon expiry date is inclusive. The server stores this immutable deadline as `payment_expires_at`. Order creation generates a one-time checkout token; store only its SHA-256 hash. Return the raw token only in an HttpOnly, SameSite=Strict cookie scoped to that order's slip-upload path, expiring at payment_expires_at. Never return the token in JSON or store it in browser storage. Slip submission uses the scoped cookie. After acceptance, shorten its expiry to five minutes so a client that missed the response can safely retry and receive an `already_submitted` result; the token cannot submit a second slip.

## Vercel-to-Apps-Script request envelope

The repository gateway currently implements protocol version 1 in `google-apps-script/13_HttpGateway.gs` and `src/clients/apps-script.client.js`.

Signed JSON body fields:
- `version`: integer, currently 1
- `timestamp`: Unix epoch milliseconds
- `nonce`: cryptographically random base64url value, unique per transport attempt
- `action`: fixed allowlisted action name
- `args`: action-specific object
- `signature`: lowercase hexadecimal HMAC-SHA256

The signature covers the exact canonical JSON representation of `version,timestamp,nonce,action,args` in that order. The shared secret exists only in Vercel environment variable `APPS_SCRIPT_SHARED_SECRET` and Apps Script Script Property `NOBI_GATEWAY_SECRET`; it is never sent to the browser or committed. The GAS endpoint validates the secret, timestamp freshness (±5 minutes), signature, nonce replay and action allowlist before dispatch.

The nonce ledger is the private `gateway_nonces` sheet created by `setupNobiDatabase()`. A ScriptLock serializes replay checks and inserts. This is an initial bounded-replay control, not a claim of unlimited throughput; monitor sheet growth and Apps Script quotas.

Apps Script Web App ContentService does not provide arbitrary HTTP status mapping. The gateway therefore returns a JSON envelope and the Vercel client must inspect `ok`, `version` and `error.code`; a transport-level HTTP 200 is not proof of application success.

## Response envelope
Success fields: `ok=true, version=1, result`.
Failure fields: `ok=false, version=1, error.code, error.message`.

Never expose stack traces, spreadsheet IDs, Drive IDs, password hashes, tokens or secret configuration.

## Current gateway action allowlist

The initial gateway currently forwards only these legacy RPC action names through the existing `rpc()` switch:
- `catalog`, `promotions`, `coupon`, `couponSuggestions`, `paymentInfo`, `createOrder`
- `adminLogin`, `adminMe`, `adminLogout`, `adminDashboard`, `adminOrders`, `adminSlipData`, `adminSetOrderStatus`, `adminList`, `adminUpsert`, `adminDelete`

This is a transport foundation, not the final business-action contract. Some legacy RPC handlers still use the older Sheets schema and do not implement the approved Member, reservation, payment-deadline, or private-media proxy behavior. Do not expose the Web App or connect production routes until each action has a reviewed adapter, authorization boundary and contract test. The target action names above remain design intent, not an assertion that those handlers already exist.

## HTTP status mapping
- 200 successful read/update; 201 created.
- 400 malformed or invalid request.
- 401 missing, invalid or expired session.
- 403 authenticated but insufficient permission.
- 404 resource not found, without leaking protected resource existence.
- 409 idempotency conflict, duplicate key or invalid status transition.
- 410 checkout payment window expired; late slip submissions are rejected.
- 413 upload too large; 415 unsupported or forged media.
- 429 rate limit.
- 502/503 Apps Script unavailable or dependency failure.
- 500 unexpected internal error with request ID.

## Timeout and retry rules
- Bound every Apps Script call timeout.
- Retry only transient reads or mutations protected by a stable idempotency key.
- Never retry order creation with a new key after an ambiguous timeout.
- A Pending order with a slip submitted strictly before `payment_expires_at` may be marked Completed by Admin even after the payment deadline. If no slip was submitted before the deadline, set `status=Expired` with `status_reason=PAYMENT_TIMEOUT` and release its coupon reservation exactly once. Rejected orders also release Reserved coupon capacity. Consumed reservations remain counted. An idempotent expiry sweep processes abandoned Pending orders; order creation, slip submission and Admin status changes enforce the rules synchronously.
- On ambiguous create-order result, query with the original key before allowing another checkout.
- Preserve request_id across retry; generate a fresh nonce and signature timestamp for each transport attempt.
- Redirects, HTML error pages and malformed JSON are not success.

## Compatibility gate
Before migrating a frontend call: inventory exact payload/response; map it to this contract; adapt deliberately; test success, validation, unauthorized, timeout and malformed response; remove the old browser GAS bridge only after all callers pass.
