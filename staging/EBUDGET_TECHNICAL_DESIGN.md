# Nobi Gaming — E-Budget Technical Design

- **Status:** Design-only deliverable; implementation and deployment are not authorized by this document.
- **Repository:** `rattasart153-ops/nobigaming`
- **Branch:** `staging-runtime-test-kit` only
- **Scope:** STAGING architecture and synthetic test design only
- **Baseline inspected:** `staging/browser-import/Code.gs` on this branch; Schema v5
- **Production:** Explicitly excluded

> This document does not modify application code, Apps Script projects, Script Properties, deployments, Cloudflare resources, Google Sheets, Drive, or Production. Do not run migrations or create resources from this document.

## 1. Approved product policy

The following decisions were explicitly confirmed by the owner:

| Policy | Approved behavior |
|---|---|
| Wallet model | Prepaid credit wallet for registered members |
| Credit classes | Paid Credit and Bonus Credit are separate balances and separate ledger streams |
| Paid Credit expiry | Never expires |
| Bonus Credit expiry | Configurable per grant |
| Member top-up | Member creates request and submits payment evidence; Admin manually reviews and approves |
| Admin crediting | Admin can add credit directly, with a reason and audit record |
| Minimum top-up | 50 THB (5,000 satang) per request |
| Checkout | Wallet must cover the entire final order total; no wallet + bank-transfer split |
| Spend order | Bonus Credit first, then Paid Credit |
| Transfer between members | Not supported in initial scope |
| Cash withdrawal | Not supported in initial scope |

The following are design safeguards derived from those policies, not additional commercial promises: all amounts use integer satang; the browser cannot set balances or approve top-ups; ledger entries are append-only; mutations are idempotent; reserved credit is released on failed/cancelled orders; and financial actions are audited.

## 2. Existing architecture facts and compatibility constraints

The inspected STAGING source currently declares `NOBI.SCHEMA_VERSION = 5`. Its database schema is defined in `00_Config.gs`; database setup validates exact header order and currently recognizes upgrades only through Schema v5. The current gateway uses a version-1 signed envelope, HMAC-SHA256, timestamp validation, a nonce ledger, and an explicit `NOBI_GATEWAY.ALLOWED_ACTIONS` allowlist. The dispatcher and allowlist are separate source sections.

Consequences for a future implementation:

1. E-Budget requires a planned, additive **Schema v6** migration. Do not manually create tabs or edit headers before a reviewed migration exists.
2. The new Wallet actions must be added to both the dispatcher and the action allowlist. A dispatcher case alone is insufficient.
3. The existing gateway body limit is 7 MiB; current slip handling is limited to 3 MiB. The top-up proof path must preserve the approved 3 MiB application limit and must not increase the general gateway limit without a separate review.
4. Existing order, coupon reservation, idempotency, and order recovery behavior must be integrated rather than bypassed.
5. The existing private HtmlService STAGING app must remain private and unchanged unless a later change is explicitly approved.

Source locations for the baseline:
- `staging/browser-import/Code.gs`
- `google-apps-script/00_Config.gs`
- `google-apps-script/01_HttpEntry.gs`
- `google-apps-script/13_HttpGateway.gs`
- `google-apps-script/02_Database.gs`

## 3. Critical concurrency architecture decision

**One writer must own all financial mutations for a given STAGING spreadsheet.**

Apps Script `LockService.getScriptLock()` locks are scoped to an Apps Script project. Two different Apps Script projects pointing at the same spreadsheet do not share the same Script Lock. Therefore the existing private HtmlService project and the proposed API-only project cannot safely perform concurrent Wallet/order writes merely because both point to the same Sheet.

Before any implementation or live testing:
- Designate the API-only project as the sole writer for Wallet, top-up, order, coupon-reservation and order-status mutations once the API migration is active.
- The existing HtmlService project must not concurrently write those same records. Keep it frozen for financial writes or use it only in a strictly serialized test window after confirming no parallel requests are possible.
- All financial mutation entry points must route through one shared server-side transaction coordinator and one Script Lock.
- Do not use Cloudflare D1 session locks as a substitute for the Apps Script financial write lock.
- If both Apps Script projects must remain active writers, stop and redesign using a genuinely shared locking/transaction mechanism before proceeding.

Google Sheets does not provide multi-row ACID transactions. A Script Lock serializes cooperating calls inside the same project but does not make a sequence of Sheet writes crash-atomic. Use a write-ahead recovery journal and idempotent step markers for every multi-sheet financial mutation. If a journal cannot be recovered safely, freeze the affected wallet and require Admin reconciliation; never guess a balance.

## 4. Money and balance model

- Store all monetary values as integer satang. Example: THB 50.00 = `5000`.
- Never use floating-point arithmetic for credit, order totals, discounts, holds or ledger deltas.
- Server derives package price, coupon discount, eligibility and final total from trusted records. Ignore client-submitted prices and balances.
- `wallets` contains cached aggregate balances for efficient display. The append-only `wallet_ledger` is the financial audit source of truth.
- Paid and Bonus balances must never be merged into one mutable number.
- Available credit is distinct from owned balance:
  - `paid_available = paid_balance - active_paid_holds`
  - `bonus_available = sum(unexpired grant remainder) - active_bonus_allocations`
  - `total_available = paid_available + bonus_available`
- An active hold reduces available credit but does not yet create a final spend debit. The final debit is posted when the related order reaches the approved completion state.
- A hold must preserve its exact credit-source allocations so that release returns the same type and bonus grant rather than converting Bonus Credit into Paid Credit.

## 5. Proposed Schema v6 additions

These are proposed tab names and exact header orders for review. They are not live Sheets tabs. Schema v6 migration must preflight every existing tab and metadata version before making any changes, preserve all existing rows, append only approved columns/tabs, and update the schema version only after all checks and writes succeed.

### 5.1 `wallets`

One row per member. This is a cached aggregate, not the only source of truth.

`member_id,paid_balance_satang,bonus_balance_satang,wallet_version,created_at,updated_at`

Rules:
- One wallet per `member_id`.
- Both balances are non-negative integers.
- `wallet_version` increments on each committed balance mutation.
- No guest wallet in the initial release.
- A wallet is created lazily on first approved credit grant or top-up approval, or during an explicit member-wallet initialization step.

### 5.2 `wallet_ledger`

Append-only record of all posted financial changes.

`ledger_id,transaction_id,member_id,credit_type,entry_type,delta_satang,balance_after_satang,reference_type,reference_id,idempotency_key,actor_type,actor_id,reason,created_at`

Allowed `credit_type`: `PAID`, `BONUS`.

Proposed `entry_type` values:
- `TOPUP_APPROVAL`
- `ADMIN_CREDIT`
- `BONUS_GRANT`
- `ORDER_CAPTURE`
- `ORDER_REFUND`
- `BONUS_EXPIRY`
- `ADMIN_ADJUSTMENT`
- `RECOVERY_CORRECTION`

Rules:
- Never update or delete a posted ledger row.
- Corrections use a new compensating entry with a reason and reference to the original transaction.
- Every posted transaction has a unique transaction ID.
- Every write has an idempotency key and a deterministic payload hash.
- `balance_after_satang` is the resulting balance for that credit type, not the combined wallet total.
- Negative deltas cannot take the corresponding balance below zero.
- A zero-value financial entry is not allowed.

### 5.3 `wallet_topups`

`topup_id,member_id,amount_satang,status,payment_method,payment_reference,slip_file_id,slip_mime_type,slip_size_bytes,submitted_at,reviewed_by_admin_id,reviewed_at,rejection_reason,idempotency_key,payload_hash,created_at,updated_at`

Proposed states:
- `AWAITING_PROOF`: request exists but no valid proof has been submitted.
- `PENDING_REVIEW`: proof submitted; waiting for Admin.
- `APPROVED`: Admin approval committed and Paid Credit ledger entry exists.
- `REJECTED`: Admin rejected; no credit was added.
- `CANCELLED`: member cancelled before proof submission/review, subject to future policy confirmation.

Rules:
- Amount must be integer satang and at least 5,000.
- Approval is manual only; no automatic bank/payment verification in initial scope.
- Approval must atomically (under the single-writer coordinator and recovery journal) change status and post exactly one `TOPUP_APPROVAL` ledger entry.
- A rejected or duplicate approval must never add credit.
- Store proof only in the private STAGING Slips folder; do not return Drive share URLs.
- Accept only PNG/JPEG/WebP, maximum 3 MiB, decode/re-encode server-side.
- Do not store full card details, bank passwords, OTPs or unrelated payment credentials.
- A payment reference, where provided, should be normalized and checked for duplicate use. Image similarity alone must not be treated as definitive proof of duplicate payment.

### 5.4 `wallet_holds`

`hold_id,order_id,member_id,status,total_satang,paid_reserved_satang,bonus_reserved_satang,created_at,expires_at,captured_at,released_at`

Proposed states: `ACTIVE`, `CAPTURED`, `RELEASED`, `EXPIRED`, `RECOVERY_REQUIRED`.

Rules:
- At most one active Wallet hold per order.
- Hold amount equals the server-calculated final order total.
- Hold is created with the order under the same financial transaction coordinator.
- A hold cannot exceed available Paid + eligible Bonus Credit.
- A hold is captured exactly once on successful order completion.
- A hold is released exactly once on order rejection, cancellation or expiry.
- Hold expiry must be coordinated with the order's server-side lifecycle; do not let a browser timestamp release a hold.

### 5.5 `wallet_hold_allocations`

`allocation_id,hold_id,credit_type,bonus_grant_id,amount_satang,allocation_order,created_at`

Purpose: preserve exactly which balance sources funded a hold.

Allocation order:
1. Bonus grants eligible at hold creation, ordered by earliest expiry first.
2. Paid Credit for the remaining amount.

For Paid Credit, `bonus_grant_id` is blank. For Bonus Credit it must identify the exact grant. The allocation total must equal the hold total. The sum of Bonus allocations must equal `bonus_reserved_satang`; the Paid allocation must equal `paid_reserved_satang`.

### 5.6 `wallet_bonus_grants`

`bonus_grant_id,member_id,granted_satang,remaining_satang,source_type,source_id,reason,starts_at,expires_at,status,created_by_admin_id,created_at,updated_at`

Rules:
- Each bonus grant is a separate lot.
- `expires_at` is configured per grant; timezone interpretation is Asia/Bangkok and the stored value is an unambiguous ISO timestamp.
- `remaining_satang` is the unspent grant amount, including amounts currently held; availability subtracts active hold allocations.
- A grant cannot be spent before `starts_at` or after expiry unless the amount was validly reserved before expiry and remains attached to a live order hold.
- When a hold is released after the grant's expiry, the released amount is immediately expired and cannot become available again.
- Expiry is recorded as a negative Bonus ledger entry; do not silently overwrite the grant or wallet balance.
- Bonus expiry processing must be idempotent and safe to rerun.
- Whether an Admin may issue a non-expiring Bonus Grant is an unresolved policy setting; do not assume it is allowed by default.

### 5.7 `wallet_recovery_journal`

`journal_id,operation,transaction_id,member_id,hold_id,topup_id,step_state,ledger_payload_json,wallet_patch_json,bonus_patch_json,order_patch_json,attempts,last_error_code,created_at,updated_at`

Purpose: recover safely from Apps Script termination between related Sheet writes.

Proposed states: `PREPARED`, `APPLYING`, `COMPLETED`, `RECOVERY_REQUIRED`, `MANUAL_REVIEW`.

Rules:
- Write a prepared journal record before applying a multi-sheet mutation.
- Each write step must be repeatable and guarded by deterministic IDs.
- Mark completed only after all expected rows/patches have been verified.
- Recovery must never append a second ledger entry for the same transaction ID.
- If state cannot be reconciled deterministically, freeze new spending for that member wallet and surface an Admin alert.

### 5.8 Existing `orders` table extension

Add, through a reviewed Schema v6 migration, these columns at the end of the existing header row:

`payment_method,wallet_hold_id`

- Existing rows migrate to `payment_method=MANUAL` (or another explicitly verified legacy value); do not rewrite order history without a reviewed mapping.
- Wallet orders use `payment_method=WALLET` and reference their hold.
- Existing manual-payment orders remain unchanged.
- Do not change the meaning of existing order statuses without reviewing all current transitions.

### 5.9 Reuse of existing tables

- Reuse `admin_audit_logs` for every Admin top-up decision, direct credit adjustment and Bonus Grant.
- Reuse `idempotency_records` only as a supporting request-deduplication layer; immutable ledger transaction IDs remain the durable financial deduplication key.
- Keep `system_metadata` schema versioning and the existing gateway nonce table.
- Do not put wallet transactions into generic `adminList/adminUpsert/adminDelete` table editing. Wallet data requires purpose-built server actions and validations.

## 6. Transaction workflows

### 6.1 Member top-up request

1. Require an authenticated active Member session.
2. Validate amount as an integer number of satang, at least 5,000.
3. Validate payment method against a server-side configured allowlist.
4. Create a unique top-up request in `AWAITING_PROOF`; bind it to the authenticated member.
5. Accept proof only for that top-up and member; validate file size/type and re-encode it into the private folder.
6. Change state to `PENDING_REVIEW` only after proof storage succeeds.
7. Return top-up reference and current state. Do not add credit yet.

### 6.2 Manual Admin approval

1. Require a valid Admin session and a top-up in `PENDING_REVIEW`.
2. Require an explicit confirmation and verify amount, payment reference and proof.
3. Create a recovery journal entry.
4. Under the single-writer lock, re-read top-up state and confirm it is still pending.
5. Post one positive Paid ledger entry; update cached wallet balance/version; mark top-up `APPROVED`; write Admin audit log.
6. Verify all writes and mark journal `COMPLETED`.
7. A retry after timeout returns the already committed result; it must not credit again.

Reject follows a similar guarded path but posts no financial credit. Require a rejection reason.

### 6.3 Admin direct credit and Bonus Grant

- Direct Paid Credit addition is an explicit Admin adjustment with a reason and audit record.
- Bonus Credit is created as a distinct grant with source, amount, start time and configured expiry.
- Admin cannot edit a previous ledger row to correct an error.
- Negative adjustments should be a separate privileged operation, require a reason and ideally a second confirmation. No negative-adjustment UI should be exposed until this authority is explicitly approved.

### 6.4 Wallet checkout and hold

1. Require an authenticated active Member session.
2. Accept product/package ID, game/player fields, coupon code if applicable, and idempotency key. Do not accept price, discount, total or member ID as trusted values.
3. Recalculate package price and coupon eligibility on the server.
4. Validate final total is greater than zero and integer satang.
5. Under the single-writer lock, re-read wallet, eligible Bonus grants, order idempotency record and coupon availability.
6. Allocate eligible Bonus Credit first (earliest expiry first), then Paid Credit.
7. Create order, coupon reservation (if any), Wallet hold and hold-allocation rows in one recoverable operation.
8. If available credit is insufficient, create no order and no hold.
9. Return the order reference, amount and Wallet hold state. Do not ask for a bank slip for a Wallet-paid order.

### 6.5 Capture, release and refunds

- On valid order completion: capture the hold, append negative ledger entries per allocation, decrement each Bonus grant's remaining amount, update wallet aggregate, finalize coupon redemption and mark hold captured.
- On rejection/cancellation/expiry: release the hold and its allocations; do not create a spend debit.
- If an order was already captured and a later authorized refund is required, create positive compensating ledger entries using the original credit-type allocations. Do not reopen or rewrite the original ledger entries.
- The exact refund policy and which order outcomes permit refund after capture remain subject to the existing order-status policy and future owner approval.

### 6.6 Bonus expiry

- Process grants in server time using Asia/Bangkok policy.
- Expire only the unreserved remainder.
- Create one negative Bonus ledger entry per expiry transaction, update the cached Bonus balance and grant state through the recovery journal.
- A grant with an active allocation remains protected only for that hold. If the hold is released after expiry, expire the released amount immediately.
- A repeated expiry job must not post duplicate ledger entries.

## 7. Proposed API surface

All routes are same-origin Cloudflare Pages Function routes. Pages Functions authenticate the Secure HttpOnly session cookie, enforce CSRF for mutations, and call the API-only Apps Script gateway server-to-server. The browser never receives Apps Script session tokens or the HMAC secret.

### Member routes

| HTTP route | Gateway action (proposed) | Purpose |
|---|---|---|
| `GET /api/member/wallet` | `memberWalletSummary` | Paid, Bonus, available balances and expiring grants |
| `GET /api/member/wallet/ledger` | `memberWalletLedger` | Paginated own ledger only |
| `GET /api/member/wallet/topups` | `memberWalletTopups` | Own top-up history |
| `POST /api/member/wallet/topups` | `memberCreateWalletTopup` | Create request; amount >= 5,000 satang |
| `POST /api/member/wallet/topups/:id/slip` | `memberSubmitWalletTopupProof` | Submit proof for own request |
| `POST /api/member/wallet/orders` | `memberCreateWalletOrder` | Full Wallet checkout and hold |

### Admin routes

| HTTP route | Gateway action (proposed) | Purpose |
|---|---|---|
| `GET /api/admin/wallets` | `adminWalletSearch` | Search members and wallet summaries |
| `GET /api/admin/wallets/:memberId` | `adminWalletDetail` | Member wallet detail |
| `GET /api/admin/wallets/:memberId/ledger` | `adminWalletLedger` | Member ledger |
| `GET /api/admin/wallet/topups` | `adminWalletTopups` | Pending and historical requests |
| `POST /api/admin/wallet/topups/:id/approve` | `adminApproveWalletTopup` | Manual approval |
| `POST /api/admin/wallet/topups/:id/reject` | `adminRejectWalletTopup` | Rejection with reason |
| `POST /api/admin/wallets/:memberId/paid-credit` | `adminGrantPaidCredit` | Direct Paid Credit addition |
| `POST /api/admin/wallets/:memberId/bonus-grants` | `adminCreateBonusGrant` | Issue Bonus Credit |
| `GET /api/admin/wallet/reconciliation` | `adminWalletReconciliation` | View mismatches and recovery-required wallets |

These action names are proposed and are not present in the current gateway. Every action must be explicitly added to both the action allowlist and dispatcher during an approved implementation. No generic action passthrough is permitted.

### Common mutation request rules

Every mutation includes:
- `requestKey`: cryptographically random, unique per user intent.
- Authenticated identity derived from server session, never from body.
- Strict integer satang values and allowlisted enums.
- Payload hash stored with the idempotency record.
- Stable result for a retry with the same key and same payload.
- Conflict response if the same key is reused with a different payload.

Suggested error codes:
- `UNAUTHENTICATED`
- `FORBIDDEN`
- `VALIDATION_FAILED`
- `INSUFFICIENT_CREDIT`
- `TOPUP_NOT_REVIEWABLE`
- `IDEMPOTENCY_CONFLICT`
- `RESOURCE_CONFLICT`
- `RESOURCE_NOT_FOUND`
- `WALLET_FROZEN`
- `RECOVERY_REQUIRED`
- `GATEWAY_EXECUTION_FAILED`

## 8. Security, privacy and operational controls

- Member may read only their own wallet, top-ups and ledger.
- Admin-only endpoints must call backend Admin authorization for every request.
- Cloudflare Access (if used to gate STAGING) is not a substitute for Member/Admin application authorization.
- Secure HttpOnly cookie; Secure; SameSite=Lax or stricter where compatible; Path=/; server-side session store; CSRF token and Origin validation for state-changing routes.
- Keep Apps Script backend tokens encrypted at rest in Cloudflare session storage; never put them in localStorage, sessionStorage, URLs or browser-readable JavaScript.
- HMAC secret remains only in Cloudflare server-side secret binding and API-only Apps Script Script Properties.
- Do not log credentials, session tokens, HMAC signatures, slip bytes/base64, full private Drive IDs or unnecessary personal data.
- Rate-limit login, top-up creation, proof submission and Admin review endpoints.
- Keep proof files private and Admin-only.
- Freeze a wallet on unrecoverable journal mismatch; no silent balance repair.
- Reconciliation compares wallet cached balances to ledger-derived balances and Bonus grant totals, accounting for active holds and expired grants.
- Preserve audit evidence for who approved/rejected/adjusted, when, reason, request ID and target.
- No member-to-member transfer, cash-out, guest wallet, split payment or automatic payment verification in initial scope.

## 9. Delivery phases after separate implementation approval

1. **P0 — Design validation:** approve this contract, unresolved policy decisions and single-writer architecture.
2. **P1 — Schema v6 and Wallet core:** migration, wallet, ledger, bonus lots, recovery journal, reconciliation.
3. **P2 — Admin operations:** top-up queue, manual approve/reject, direct Paid Credit, Bonus Grant, audit.
4. **P3 — Member top-up:** request, proof upload, status and history.
5. **P4 — Wallet checkout:** full-balance check, Bonus-first allocation, hold/capture/release and coupon integration.
6. **P5 — Hardening:** concurrency, recovery, security, browser tests and financial reconciliation.

No phase is automatically authorized by this design document.

## 10. Decision status

The eight previously open decisions are now closed by the owner-requested [E-Budget Decision Register](./EBUDGET_DECISIONS.md). That register is authoritative if any earlier draft wording in this document differs. The resolved policies cover the two crediting paths, 24-hour proof-submission window, configurable finite Bonus expiry, refunds, disabled negative adjustments, Bonus holds at expiry, and API-only single-writer cutover.

Implementation remains unauthorized until separately approved.

1. **Top-up payment methods:** which exact methods should members choose from? The app should use an Admin-configured allowlist; no method is assumed here.
2. **Top-up request expiry:** should an unsubmitted proof request expire, and after how long? No expiry is invented in this design.
3. **Bonus expiry input:** should Admin choose a fixed date/time or a duration from the grant date? Both are technically possible; the UI needs one or both confirmed.
4. **Non-expiring bonus:** should Admin be allowed to issue Bonus Credit with no expiry, or must every bonus grant expire?
5. **Refund after capture:** which completed/fulfilled order scenarios permit a credit refund, and who can authorize it?
6. **Negative Admin adjustment:** should any Admin be allowed to reduce credit, or should it require a higher role/second approval?
7. **Bonus hold semantics:** this design protects a grant reserved before expiry until its order resolves; confirm that this is the intended customer policy.
8. **Legacy app write freeze:** confirm how the existing HtmlService STAGING project will be prevented from writing Wallet/order/coupon data concurrently once API-only is active.

Until these decisions are confirmed and implementation is separately authorized, keep this as a design artifact only.
