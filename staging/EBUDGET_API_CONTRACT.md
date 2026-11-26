# Nobi Gaming — E-Budget API Contract

- **Status:** Proposed API contract; no code or deployment authorized
- **Branch:** `staging-runtime-test-kit`
- **Depends on:** `staging/EBUDGET_TECHNICAL_DESIGN.md`
- **Scope:** STAGING only

## 1. Transport and trust boundaries

Browser -> Cloudflare Pages Function -> API-only Apps Script `doPost(e)` -> Wallet business logic -> STAGING Google Sheets / private Drive.

- Browser uses same-origin routes and a Secure HttpOnly session cookie.
- Pages Functions resolve the cookie to the server-side session and backend token.
- Pages Functions sign the Apps Script gateway envelope with the server-side HMAC secret.
- Browser never receives the Apps Script token or HMAC secret.
- Apps Script independently verifies HMAC, nonce, timestamp, action allowlist, Member/Admin session and all business rules.
- The current gateway is POST-only and returns a JSON envelope `{ok,version,result|error}`. Caller must inspect `ok`, not infer success from HTTP transport alone.
- Every new action name below is proposed; none is implemented in the current source.

## 2. Shared conventions

### Amounts

All API amounts are integer satang:
- THB 50.00 -> `5000`
- THB 125.50 -> `12550`

Reject decimals, strings with currency symbols, negative values, unsafe integers and amounts outside configured limits.

### Identity

Do not accept `memberId`, `adminId`, role or ownership as authoritative input for Member operations. Derive the actor from the verified backend session. Admin routes must call backend Admin authorization.

### Idempotency

Every POST mutation requires:
```json
{
  "requestKey": "random-unique-key",
  "..."
}
```

- Same key + same canonical payload: return the original result.
- Same key + different payload: `IDEMPOTENCY_CONFLICT`.
- Different key cannot duplicate a financial action when the same top-up/order/approval is already terminal.
- Each posted ledger transaction also has a unique immutable transaction ID.
- Retrying after network timeout must not cause a second credit, debit, capture or release.

### Error envelope

Pages Function response:
```json
{
  "ok": false,
  "error": {
    "code": "INSUFFICIENT_CREDIT",
    "message": "Wallet balance is insufficient"
  },
  "requestId": "opaque-request-id"
}
```

Never return stack traces, Script Properties, private Drive URLs, HMAC material, backend session tokens or internal sheet row numbers.

## 3. Member routes

### 3.1 Get wallet summary

`GET /api/member/wallet`

Gateway action: `memberWalletSummary`

Response:
```json
{
  "ok": true,
  "data": {
    "currency": "THB",
    "paidBalanceSatang": 50000,
    "bonusBalanceSatang": 15000,
    "paidOnHoldSatang": 0,
    "bonusOnHoldSatang": 2000,
    "paidAvailableSatang": 50000,
    "bonusAvailableSatang": 13000,
    "totalAvailableSatang": 63000,
    "expiringBonus": [
      {
        "grantId": "opaque-id",
        "availableSatang": 5000,
        "expiresAt": "2026-12-31T16:59:59.000Z"
      }
    ]
  }
}
```

Rules:
- Return only the authenticated member's data.
- `bonusBalanceSatang` is the posted unspent bonus balance; holds are shown separately.
- `totalAvailableSatang` is spendable now, not total posted balance.
- Do not return other members or internal sheet identifiers.

### 3.2 Get own ledger

`GET /api/member/wallet/ledger?cursor=...&limit=...`

Gateway action: `memberWalletLedger`

Response contains paginated entries:
```json
{
  "ok": true,
  "data": {
    "items": [
      {
        "ledgerId": "opaque-id",
        "creditType": "PAID",
        "entryType": "TOPUP_APPROVAL",
        "deltaSatang": 50000,
        "balanceAfterSatang": 50000,
        "referenceType": "TOPUP",
        "referenceId": "opaque-id",
        "reason": "Top-up approved",
        "createdAt": "2026-11-26T06:00:00.000Z"
      }
    ],
    "nextCursor": null
  }
}
```

Limit must be bounded server-side. Cursor must not allow access to another member's records.

### 3.3 List own top-ups

`GET /api/member/wallet/topups?cursor=...&limit=...`

Gateway action: `memberWalletTopups`

Return top-up ID, amount, state, payment method label, submitted/reviewed times and rejection reason. Never return private Drive URL or raw file ID.

### 3.4 Create top-up request

`POST /api/member/wallet/topups`

Gateway action: `memberCreateWalletTopup`

Request:
```json
{
  "requestKey": "random-unique-key",
  "amountSatang": 50000,
  "paymentMethod": "configured-method-key",
  "paymentReference": "optional-reference"
}
```

Validation:
- Authenticated active Member.
- Amount integer >= 5000 satang.
- Payment method must be in server-configured allowlist.
- Request key required.
- No credit is added at request creation.
- Response state is `AWAITING_PROOF`.

Response:
```json
{
  "ok": true,
  "data": {
    "topupId": "opaque-id",
    "amountSatang": 50000,
    "status": "AWAITING_PROOF"
  }
}
```

### 3.5 Submit top-up proof

`POST /api/member/wallet/topups/:topupId/slip`

Gateway action: `memberSubmitWalletTopupProof`

Request body is multipart at the Pages Function boundary. Pages Function validates envelope size, then sends a bounded image payload to Apps Script.

Validation:
- Authenticated Member owns the top-up.
- Top-up state is `AWAITING_PROOF`.
- PNG/JPEG/WebP only; maximum 3 MiB.
- Decode and re-encode before storing in private STAGING Slips folder.
- No public Drive URL.
- Successful proof storage transitions to `PENDING_REVIEW`.
- Repeated proof submission after state transition is rejected or returns the original accepted result; it must not create multiple files.

### 3.6 Create Wallet order

`POST /api/member/wallet/orders`

Gateway action: `memberCreateWalletOrder`

Request:
```json
{
  "requestKey": "random-unique-key",
  "gameId": "game-id",
  "packageId": "package-id",
  "playerId": "player-uid",
  "serverId": "optional-server-id",
  "couponCode": "optional-code"
}
```

Never accept member ID, package price, subtotal, discount, total, credit balance, payment status or hold amount from browser.

Server behavior:
1. Authenticate Member.
2. Re-read active game/package and trusted price.
3. Validate player fields and coupon rules.
4. Calculate final amount in satang.
5. Verify total available credit covers the full amount.
6. Reserve Bonus first, earliest expiry first; reserve Paid for the remainder.
7. Create order, coupon reservation (if any), hold and allocations through one recoverable transaction.
8. If insufficient, create neither order nor hold.

Response:
```json
{
  "ok": true,
  "data": {
    "orderId": "opaque-id",
    "orderNumber": "display-number",
    "paymentMethod": "WALLET",
    "totalSatang": 20000,
    "hold": {
      "status": "ACTIVE",
      "paidReservedSatang": 15000,
      "bonusReservedSatang": 5000
    }
  }
}
```

A Wallet order does not require a bank slip. Existing order state transitions must be reviewed before wiring capture/release.

## 4. Admin routes

### 4.1 Search wallets

`GET /api/admin/wallets?q=...&limit=...`

Gateway action: `adminWalletSearch`

Admin-only. Return only necessary member identifiers/display fields and aggregate wallet summary. Enforce bounded query and page size.

### 4.2 Wallet detail and ledger

- `GET /api/admin/wallets/:memberId` -> `adminWalletDetail`
- `GET /api/admin/wallets/:memberId/ledger` -> `adminWalletLedger`

Admin-only. Return source-specific balances, holds, grant status, ledger history and reconciliation state. Never allow arbitrary table/column selection.

### 4.3 Top-up queue

`GET /api/admin/wallet/topups?status=PENDING_REVIEW&cursor=...`

Gateway action: `adminWalletTopups`

Admin-only. List top-up ID, member, amount, payment method, reference, submission time and proof availability. Proof bytes are served only through a separate Admin-authorized same-origin route.

### 4.4 Approve top-up

`POST /api/admin/wallet/topups/:topupId/approve`

Gateway action: `adminApproveWalletTopup`

Request:
```json
{
  "requestKey": "random-unique-key",
  "confirmation": true,
  "reason": "Payment evidence verified"
}
```

Server:
- Require Admin.
- Re-read top-up and require `PENDING_REVIEW`.
- Require explicit confirmation.
- Post exactly one positive Paid ledger entry.
- Update wallet aggregate/version and top-up state through recovery journal.
- Add Admin audit event.
- A second approval cannot create another credit.

### 4.5 Reject top-up

`POST /api/admin/wallet/topups/:topupId/reject`

Gateway action: `adminRejectWalletTopup`

Request:
```json
{
  "requestKey": "random-unique-key",
  "reason": "Payment amount does not match"
}
```

Reason required. No credit ledger entry is created.

### 4.6 Direct Paid Credit

`POST /api/admin/wallets/:memberId/paid-credit`

Gateway action: `adminGrantPaidCredit`

Request:
```json
{
  "requestKey": "random-unique-key",
  "amountSatang": 10000,
  "reason": "Approved customer service compensation"
}
```

Positive amount only in initial scope. Negative adjustment is not part of this endpoint.

### 4.7 Create Bonus Grant

`POST /api/admin/wallets/:memberId/bonus-grants`

Gateway action: `adminCreateBonusGrant`

Request:
```json
{
  "requestKey": "random-unique-key",
  "amountSatang": 5000,
  "reason": "Promotion reward",
  "sourceType": "PROMOTION",
  "sourceId": "promotion-id",
  "startsAt": "2026-11-26T00:00:00+07:00",
  "expiresAt": "2026-12-01T23:59:59+07:00"
}
```

Validate dates, timezone, amount, source and configured expiry policy. The non-expiring Bonus option remains unapproved until the owner decides.

### 4.8 Wallet order refund

`POST /api/admin/wallet/orders/:orderId/refund`

Gateway action: `adminRefundWalletOrder`

Request:
```json
{
  "requestKey": "random-unique-key",
  "amountSatang": 10000,
  "reason": "Order fulfillment failed; partial refund approved"
}
```

Rules:
- Admin-only; order must have a captured Wallet payment and refundable remainder.
- Require reason and explicit confirmation in the Admin UI.
- Full refund restores the original Paid/Bonus composition exactly.
- Partial refund uses deterministic largest-remainder allocation in integer satang, bounded by the unrefunded amount per source.
- Refund never converts Bonus Credit to Paid Credit. A Bonus portion whose original expiry has passed is immediately expired.
- Post compensating ledger entries and an audit event; never edit or delete original ledger rows.
- Same request key returns the original result; a different key cannot exceed the remaining refundable amount.

### 4.9 Reconciliation

`GET /api/admin/wallet/reconciliation`

Gateway action: `adminWalletReconciliation`

Read-only report of:
- Cached wallet vs ledger-derived Paid/Bonus totals.
- Bonus grant remaining totals vs Bonus ledger.
- Active hold vs allocation sums.
- Approved top-ups without exactly one ledger credit.
- Captured holds without matching debit entries.
- Recovery journal records not completed.

This route must not silently repair balances. Repairs require a separately authorized recovery operation and audit evidence.

## 5. Pages Function behavior

- Map only explicit routes; do not create a generic action proxy.
- Validate method, content type, body size, path IDs, cursor and payload schema.
- Authenticate cookie and re-check role on each protected request.
- Mutations require CSRF validation and same-origin Origin/Referer policy.
- Sign gateway requests server-side using exact canonical JSON property order: `version,timestamp,nonce,action,args`.
- Generate a new nonce for each gateway attempt. A new nonce does not make a duplicate business mutation safe; use idempotency keys.
- Follow/validate Apps Script ContentService redirect behavior in a live STAGING integration test.
- Inspect JSON `ok` and `version`; do not trust HTTP 200 alone.
- Do not cache Member/Admin responses.
- Never log secrets, session tokens, slip payloads or private file URLs.

## 6. Gateway action allowlist additions (proposed)

Add each of these names to both the allowlist and dispatcher only during an approved implementation:
`memberWalletSummary`, `memberWalletLedger`, `memberWalletTopups`, `memberCreateWalletTopup`, `memberSubmitWalletTopupProof`, `memberCreateWalletOrder`, `adminWalletSearch`, `adminWalletDetail`, `adminWalletLedger`, `adminWalletTopups`, `adminApproveWalletTopup`, `adminRejectWalletTopup`, `adminGrantPaidCredit`, `adminCreateBonusGrant`, `adminRefundWalletOrder`, `adminWalletReconciliation`.

Every action must validate its own argument schema and call Member/Admin authorization inside Apps Script. Do not rely only on Cloudflare authorization.

## 7. Contract decision status

The previously open API policy questions are closed by [E-Budget Decision Register](./EBUDGET_DECISIONS.md). The implementation must reflect: 24-hour expiry for requests still in `AWAITING_PROOF`; no auto-expiry for `PENDING_REVIEW`; finite Bonus expiry configured by duration or explicit timestamp; no non-expiring Bonus; purpose-built Admin refund operation with source-preserving compensating credits; no generic negative-adjustment endpoint; Bonus holds protected through order resolution; and API-only as the sole financial writer after a gated cutover.

No code, deployment or live API action is authorized by this document.

The API contract cannot be considered implementation-ready until the owner confirms:
1. Exact top-up payment method choices.
2. Whether unsubmitted top-up requests expire, and after how long.
3. Whether Bonus expiry is entered as a fixed date/time, duration, or both.
4. Whether Admin may issue non-expiring Bonus Credit.
5. Refund eligibility after a Wallet order has been captured.
6. Who may perform negative credit adjustments.
7. Whether a bonus grant reserved before expiry remains protected until its order resolves.
8. How the existing HtmlService STAGING project is prevented from being a concurrent writer.

No code, deployment or live API action is authorized by this document.
