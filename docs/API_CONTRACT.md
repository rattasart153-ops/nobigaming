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
- POST /api/public/orders (multipart upload; idempotency key required)

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
- Order creation carries an idempotency key generated once per checkout attempt and reused only for retries of the same payload.
- Server derives identity, price, discount, totals and coupon eligibility.
- Every newly created order has a 15-minute payment deadline. For coupon orders, the effective deadline is the earlier of `created_at + 15 minutes` and the exclusive coupon expiry-day cutoff in `Asia/Bangkok` (00:00 at the start of the day after the coupon expiry date). The server stores this immutable deadline as `payment_expires_at`.

## Vercel-to-Apps-Script request envelope
Proposed JSON body fields:
- version: integer protocol version
- request_id: UUID
- timestamp: ISO-8601 UTC
- nonce: random one-time value
- action: fixed allowlisted action string
- payload: action-specific object
- auth: key_id and base64 HMAC-SHA256 signature

Signature covers a canonical representation of version, request_id, timestamp, nonce, action and payload. Shared secret exists only in Vercel environment variables and Apps Script Script Properties. It is never sent to browser or committed.

Apps Script validates request shape, protocol version, timestamp freshness, key ID, signature, replay policy, action allowlist, payload schema and operation authorization.

Do not assume arbitrary HTTP headers are exposed in Apps Script doPost event objects. Carry authentication in the signed body and test redirect/response behavior using a test deployment before production.

## Response envelope
Success fields: ok=true, version, request_id, data.
Failure fields: ok=false, version, request_id, error.code, error.message.

Never expose stack traces, spreadsheet IDs, Drive IDs, password hashes, tokens or secret configuration.

## Initial action allowlist
- system.health
- catalog.get
- promotions.get
- payment.info
- coupon.suggest
- coupon.validate
- order.create
- order.expire-pending (internal scheduled/maintenance action; not browser-callable)
- auth.admin.login, auth.admin.session.get, auth.admin.logout
- auth.member.register, auth.member.login, auth.member.session.get, auth.member.logout
- member.orders.list
- admin.dashboard.get
- admin.orders.list, admin.orders.status.set, admin.orders.slip.get
- admin.games.list/upsert/delete
- admin.packages.list/upsert/delete
- admin.coupons.list/upsert/delete
- admin.promotions.list/upsert/delete
- admin.members.list, admin.members.ip-history.get

Enable only actions required by an actual route. Public actions cannot invoke Admin repositories.

## HTTP status mapping
- 200 successful read/update; 201 created.
- 400 malformed or invalid request.
- 401 missing, invalid or expired session.
- 403 authenticated but insufficient permission.
- 404 resource not found, without leaking protected resource existence.
- 409 idempotency conflict, duplicate key or invalid status transition.
- 413 upload too large; 415 unsupported or forged media.
- 429 rate limit.
- 502/503 Apps Script unavailable or dependency failure.
- 500 unexpected internal error with request ID.

## Timeout and retry rules
- Bound every Apps Script call timeout.
- Retry only transient reads or mutations protected by a stable idempotency key.
- Never retry order creation with a new key after an ambiguous timeout.
- A Pending order may transition to Completed only if authoritative server time is strictly before `payment_expires_at`; otherwise set `status=Rejected` with `status_reason=PAYMENT_TIMEOUT` and release its coupon reservation exactly once. An idempotent expiry worker should process abandoned Pending orders, while every order/status endpoint enforces the deadline synchronously.
- On ambiguous create-order result, query with the original key before allowing another checkout.
- Preserve request_id across retry; generate a fresh nonce and signature timestamp for each transport attempt.
- Redirects, HTML error pages and malformed JSON are not success.

## Compatibility gate
Before migrating a frontend call: inventory exact payload/response; map it to this contract; adapt deliberately; test success, validation, unauthorized, timeout and malformed response; remove the old browser GAS bridge only after all callers pass.
