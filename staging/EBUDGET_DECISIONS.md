# Nobi Gaming — E-Budget Decision Register

- **Status:** Owner-requested policy closure for the E-Budget design
- **Branch:** `staging-runtime-test-kit` only
- **Scope:** STAGING design decisions; no implementation or deployment authorization
- **Authority:** This register resolves the eight open design decisions recorded in the E-Budget Technical Design, API Contract and Test Plan. Where older wording conflicts, this register is authoritative.

## Closed decisions

| ID | Topic | Final decision |
|---|---|---|
| D-01 | Credit channels | Two crediting paths: Member self-service top-up request with payment proof and manual Admin approval; Admin direct Paid Credit grant with reason and audit. This does not define two payment-provider channels. |
| D-02 | Top-up request expiry | A request in `AWAITING_PROOF` expires 24 hours after creation if proof is not submitted. Once proof is accepted and state becomes `PENDING_REVIEW`, it does not auto-expire; it remains pending until Admin approves or rejects. |
| D-03 | Bonus expiry configuration | Admin may set either a duration in whole days from grant time or an explicit expiry date/time. Store the resulting absolute timestamp. Interpret user-entered local date/time as Asia/Bangkok (UTC+7), and display it back clearly before confirmation. |
| D-04 | Non-expiring Bonus | Not allowed in the initial system. Every Bonus Grant must have a finite expiry strictly after its start time. Paid Credit remains never-expiring. |
| D-05 | Refund after capture | Admin may issue a full or partial Wallet refund only for a documented order-resolution case (e.g. fulfillment failure or approved service recovery). Refund is a compensating credit, not a ledger edit, and must restore the original source composition proportionally. For partial refunds, allocate the refund against the original captured Paid/Bonus amounts using deterministic satang rounding, never exceeding the original amount per source. Require reason and audit. |
| D-06 | Negative Admin adjustment | Disabled in the initial release. Admin cannot directly reduce Paid or Bonus balance. Corrections must use an explicit compensating transaction tied to an original transaction and an approved reason/workflow; no generic negative-adjustment endpoint or UI. |
| D-07 | Bonus held at expiry | A Bonus amount validly reserved before its expiry remains protected for that specific live order until it resolves. If the hold is released after the grant expiry, the released amount expires immediately and is not returned to spendable Bonus balance. |
| D-08 | Single financial writer | The API-only Apps Script project is the sole writer for Wallet, top-ups, orders, coupon reservations and financial order-state mutations once the API-only migration is activated. The legacy HtmlService Apps Script project must be prevented from writing those records before activation. No dual-writer period is allowed. |

## Operational clarifications

### Member top-up payment methods

- Member self-service top-up uses only payment methods already configured and approved for the STAGING payment instructions.
- Do not invent or enable a new bank, QR provider, payment gateway or automatic payment-verification integration as part of E-Budget.
- Admin direct credit is the second crediting path; it is not a payment method.
- Manual Admin review remains mandatory before member-submitted top-up becomes Paid Credit.

### Top-up state machine

`AWAITING_PROOF` --proof accepted before 24-hour deadline--> `PENDING_REVIEW`

`AWAITING_PROOF` --24-hour deadline reached--> `EXPIRED`

`PENDING_REVIEW` --Admin approves--> `APPROVED`

`PENDING_REVIEW` --Admin rejects with reason--> `REJECTED`

- `EXPIRED` and `REJECTED` never add credit.
- An expired request cannot accept proof or be approved; the member must create a new request.
- `PENDING_REVIEW` is not automatically rejected or expired. Admin queue monitoring is required.

### Refund allocation rule

- Record the exact Paid/Bonus amounts captured for every order.
- Full refund restores exactly those source amounts.
- Partial refund is allocated proportionally to the captured source amounts, rounded to integer satang by largest-remainder method with a stable tie-break (Bonus first, then Paid) and bounded by the original captured amounts.
- Refunds cannot exceed the unrefunded captured amount.
- If a Bonus source has since expired, the refund still restores the Bonus source as a new Bonus Grant with the original grant's remaining expiry semantics; if that expiry is already past, the refunded Bonus amount is immediately expired and cannot become spendable. Do not convert expired Bonus into Paid Credit.
- The refund operation requires a reason, order reference, Admin identity and idempotency key.

### Single-writer cutover gate

Before API-only becomes active:
1. Put the legacy STAGING HtmlService application into a maintenance/read-only state for all affected financial mutations.
2. Verify its server-side entry points cannot mutate Wallet, top-up, order, coupon reservation or financial status data.
3. Verify no old deployment, trigger or script path can still write those records.
4. Activate API-only as the only writer.
5. Run a synthetic smoke test and ledger reconciliation before enabling member Wallet checkout.

If the legacy project cannot be reliably prevented from writing, do not activate Wallet or migrate traffic. A shared spreadsheet is not a shared Script Lock.

## Consequence for future implementation

- Add `EXPIRED` to the top-up state model and implement a server-side expiry worker that is idempotent.
- Validate proof submission against the server-side 24-hour deadline.
- Require finite Bonus expiry and store resolved timestamps.
- Implement refund as a purpose-built compensating transaction; do not expose a generic negative adjustment.
- Make the single-writer cutover a release blocker.
- Update all tests and API schemas to match these decisions.

## Scope boundary

This register closes design decisions only. It does not authorize code changes, Schema v6 migration, Google Sheets edits, Apps Script project creation/configuration, Cloudflare resource creation, live payment tests, or deployment. Those require separate explicit approval.
