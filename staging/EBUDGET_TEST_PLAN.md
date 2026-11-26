# Nobi Gaming — E-Budget Test Plan

- **Status:** Design matrix plus Node/VM regression coverage; no tests have been executed against live Apps Script/Sheets
- **Branch:** `staging-runtime-test-kit`
- **Scope:** Synthetic STAGING data only
- **Prerequisite:** Approved Schema v6 implementation and single-writer architecture

## 1. Test rules

- Use synthetic Member/Admin accounts, synthetic payment references and synthetic proof images.
- Do not transfer real money or upload real payment slips.
- Do not use Production IDs, credentials, customer records, Drive folders or deployments.
- Never test two independent Apps Script projects as concurrent writers to the same financial tables; their Script Locks are not shared.
- Record request IDs, transaction IDs and expected/actual satang values. Do not record secrets, session tokens or full slip payloads.
- All money assertions use integer satang.

## 2. Functional test matrix

| ID | Area | Scenario | Expected result |
|---|---|---|---|
| EB-F-001 | Wallet | New member with no credit opens wallet | Zero Paid/Bonus; no other member data |
| EB-F-002 | Top-up | Create top-up for 5,000 satang | Accepted as minimum |
| EB-F-003 | Top-up | Create top-up for 4,999 satang | Validation failure; no request |
| EB-F-004 | Top-up | Create top-up with decimal/negative/string amount | Validation failure |
| EB-F-005 | Top-up | Submit valid PNG proof <=3 MiB | Private file stored; state becomes PENDING_REVIEW |
| EB-F-006 | Top-up | Submit unsupported file or >3 MiB | Rejected; no public file |
| EB-F-007 | Top-up | Member submits proof for another member's request | Forbidden; no state change |
| EB-F-008 | Top-up | Admin approves pending top-up | Exactly one Paid credit ledger entry; wallet increases |
| EB-F-009 | Top-up | Admin approves same request twice | No duplicate credit; stable original result or conflict |
| EB-F-010 | Top-up | Admin rejects pending top-up with reason | REJECTED; no credit added |
| EB-F-011 | Top-up | Admin attempts approve after rejection | Conflict; no credit added |
| EB-F-012 | Top-up | Member attempts to approve own request | Forbidden |
| EB-F-013 | Admin credit | Admin grants Paid Credit with reason | Paid balance increases; ledger and audit entries created |
| EB-F-014 | Admin credit | Grant with missing reason or zero/negative amount | Rejected |
| EB-F-015 | Bonus | Admin grants Bonus with valid expiry | Separate grant and Bonus ledger entry created |
| EB-F-016 | Bonus | Bonus grant has invalid date or expiry before start | Rejected |
| EB-F-017 | Bonus | Bonus expires | Remaining unreserved amount removed once; expiry ledger entry created |
| EB-F-018 | Bonus | Expiry job runs twice | No duplicate expiry debit |
| EB-F-019 | Spend order | Wallet has Bonus 5,000 and Paid 15,000; order costs 20,000 | Hold allocation uses 5,000 Bonus + 15,000 Paid |
| EB-F-020 | Spend order | Wallet total is less than order total | INSUFFICIENT_CREDIT; no order, hold or coupon reservation |
| EB-F-021 | Spend order | Wallet total equals order total | Order accepted; available balance becomes zero |
| EB-F-022 | Spend order | Client tampers with price/discount/total/member ID | Server ignores or rejects; trusted server total used |
| EB-F-023 | Spend order | Member tries split Wallet + transfer | Not supported; request rejected |
| EB-F-024 | Hold | Create order and hold | Hold ACTIVE; allocations sum exactly to total |
| EB-F-025 | Hold | Complete held order | One capture; correct Paid/Bonus debit; hold CAPTURED |
| EB-F-026 | Hold | Reject/cancel/expire held order | Hold RELEASED; no spend debit; original sources restored if still eligible |
| EB-F-027 | Hold | Release Bonus after its expiry | Released amount expires immediately; cannot be spent |
| EB-F-028 | Hold | Capture order after grant expiry when grant was reserved before expiry | Behavior follows the owner-approved hold-expiry policy |
| EB-F-029 | Coupon | Wallet order uses eligible coupon | Server calculates discount; coupon reservation and hold consistent |
| EB-F-030 | Coupon | Wallet order fails after coupon reservation attempt | No orphan coupon reservation or wallet hold |
| EB-F-031 | Refund | Captured order receives approved refund | Compensating entries restore original credit classes; original ledger unchanged |
| EB-F-032 | History | Member views own ledger and top-ups | Correct pagination and only own records |
| EB-F-033 | History | Member guesses another member's ledger cursor/ID | No data disclosure |
| EB-F-034 | Admin | Admin views wallet and top-up proof | Admin-authorized data only; no public Drive URL |

## 3. Security and authorization matrix

| ID | Scenario | Expected result |
|---|---|---|
| EB-S-001 | Wallet request without Member session | UNAUTHENTICATED |
| EB-S-002 | Suspended/revoked Member session accesses wallet | Denied |
| EB-S-003 | Member calls Admin wallet endpoint | FORBIDDEN |
| EB-S-004 | Browser sends forged memberId or role | Ignored; identity derived from session |
| EB-S-005 | Browser attempts to set balance or ledger rows | Rejected; no generic table mutation path |
| EB-S-006 | Browser attempts to approve top-up | Forbidden; Admin authorization required |
| EB-S-007 | Missing/invalid HMAC signature | Gateway rejects |
| EB-S-008 | Stale timestamp or reused nonce | Gateway rejects |
| EB-S-009 | Wallet action omitted from allowlist | Gateway rejects; no dispatcher bypass |
| EB-S-010 | Cross-origin state-changing request without valid CSRF | Rejected |
| EB-S-011 | Inspect browser assets/storage | No HMAC secret or Apps Script session token |
| EB-S-012 | Inspect logs | No passwords, tokens, signatures, slip bytes or private URLs |
| EB-S-013 | Attempt access to private slip by non-Admin | Denied |
| EB-S-014 | Attempt direct public Drive URL access | No public file permission or share URL |
| EB-S-015 | Generic `adminUpsert/adminDelete` targets Wallet tables | Rejected by table allowlist |

## 4. Idempotency and concurrency matrix

All tests in this section must run through the single designated Apps Script writer.

| ID | Scenario | Expected result |
|---|---|---|
| EB-C-001 | Same top-up create key and same payload retried | Same top-up returned; one request |
| EB-C-002 | Same key reused with different amount | IDEMPOTENCY_CONFLICT |
| EB-C-003 | Approval retried after simulated timeout | One Paid credit ledger entry |
| EB-C-004 | Same Wallet order request submitted twice | Same order/hold returned; no double reservation |
| EB-C-005 | Two simultaneous orders each require the same available balance | At most one succeeds if combined total exceeds available |
| EB-C-006 | Two simultaneous Admin approvals for one top-up | Exactly one approval and one ledger credit |
| EB-C-007 | Two simultaneous orders attempt same Bonus grant remainder | No overspend; allocations remain within grant remainder |
| EB-C-008 | Two simultaneous captures for one hold | Exactly one capture |
| EB-C-009 | Two simultaneous releases for one hold | Exactly one release |
| EB-C-010 | Expiry worker races with a new hold | Grant cannot be both expired and reserved for the same satang |
| EB-C-011 | Same request key, altered payload hash | Conflict; no mutation |
| EB-C-012 | API-only and HtmlService project both attempt writes | Test must demonstrate writer isolation is enforced operationally; if not, release is blocked |

## 5. Recovery and reconciliation matrix

| ID | Failure injection point | Expected recovery |
|---|---|---|
| EB-R-001 | Crash after journal PREPARED, before any mutation | Safe retry resumes once |
| EB-R-002 | Crash after ledger append, before wallet cache update | Recovery detects ledger transaction ID and completes cache update without duplicate ledger |
| EB-R-003 | Crash after wallet update, before top-up status update | Recovery completes status or freezes for review; no duplicate credit |
| EB-R-004 | Crash after hold creation, before order patch | Journal reconciles order/hold/allocation relationship |
| EB-R-005 | Crash after order completed, before hold capture | Recovery completes capture exactly once |
| EB-R-006 | Crash during multi-grant Bonus allocation | Recovery completes or safely releases; no partial spend |
| EB-R-007 | Corrupt journal payload | Wallet enters RECOVERY_REQUIRED; spending frozen |
| EB-R-008 | Wallet cached balance differs from ledger-derived balance | Reconciliation reports mismatch; no silent correction |
| EB-R-009 | Approved top-up has no ledger row | Alert; no assumption that approval succeeded |
| EB-R-010 | Ledger row exists but top-up still pending | Recovery resolves deterministically or sends to MANUAL_REVIEW |
| EB-R-011 | Captured hold lacks matching debit rows | Reconciliation flags and freezes affected wallet |
| EB-R-012 | Expiry job repeated after partial completion | No duplicate expiry debit |

## 6. P1.2 automated regression coverage

Node/VM tests now include a synthetic Sheets/Drive runtime for the member top-up lifecycle (create, retry, proof storage, Admin proof review, approval, rejection, 24-hour expiry), direct Paid Credit, finite Bonus Grant and ledger/balance separation. Additional tests cover explicit expiry timezone handling, PromptPay-only configuration, request-key validation, private-ID projection, single-writer gates, recovery journal schema/idempotency and action allowlist boundaries. These tests do not emulate real Google Drive ACLs, Apps Script image decoding, true concurrent Sheets writes, Apps Script quotas or Cloudflare cookie/session behavior.

## 7. Acceptance gates

E-Budget is not ready for staging deployment until all gates pass:

1. Schema v6 migration preflight and upgrade tests pass on a disposable synthetic STAGING copy.
2. Existing Schema v5 tabs and rows remain unchanged except explicitly reviewed additive changes.
3. Single-writer financial mutation architecture is demonstrated.
4. Every mutation has idempotency and recovery-journal coverage.
5. Ledger-derived balances match cached wallet balances.
6. Bonus grant remainder, active allocations and expiry calculations reconcile.
7. All authorization and private-file tests pass.
8. Top-up approval is manual only.
9. Full Wallet checkout works without slip upload and rejects insufficient balances.
10. Coupon, order and Wallet holds resolve consistently for every terminal order status.
11. All functional, security, concurrency and recovery tests pass.
12. Browser/mobile UI tests pass on the actual STAGING environment.
13. No Production resource, deployment, credential or customer data was accessed.

## 7. Policy-closure test additions

The policy decisions are closed by [E-Budget Decision Register](./EBUDGET_DECISIONS.md). Add and require these cases before release:

| ID | Scenario | Expected result |
|---|---|---|
| EB-D-001 | Submit proof just before 24-hour AWAITING_PROOF deadline | Accepted if server time is before deadline; state becomes PENDING_REVIEW |
| EB-D-002 | Submit proof at/after 24-hour deadline | Rejected; request is EXPIRED; no credit |
| EB-D-003 | PENDING_REVIEW remains unreviewed past 24 hours | Remains PENDING_REVIEW; no automatic expiry or credit |
| EB-D-004 | Create Bonus using duration | Absolute expiry is calculated once and persisted |
| EB-D-005 | Create Bonus without expiry | Rejected |
| EB-D-006 | Create Bonus with expiry <= start time | Rejected |
| EB-D-007 | Full refund after capture | Original Paid/Bonus source amounts are restored as compensating entries |
| EB-D-008 | Partial refund with fractional satang allocation | Largest-remainder allocation is deterministic and bounded by original source capture |
| EB-D-009 | Refund after original Bonus grant expiry | Bonus is not converted to Paid; expired Bonus refund is immediately expired |
| EB-D-010 | Attempt generic negative Admin adjustment | No endpoint/UI permission; request rejected |
| EB-D-011 | Legacy HtmlService attempts financial write after cutover | Write denied; API-only remains sole writer |
| EB-D-012 | API-only cutover while legacy writer is still active | Release gate fails; Wallet activation blocked |

The Test Plan remains unexecuted until a separately approved implementation is available.

The following cases need explicit policy confirmation before expected results can be finalized:
- Allowed top-up payment methods.
- Expiry duration for a top-up request with no proof.
- Bonus expiry UI semantics (fixed timestamp, duration, or both).
- Whether a Bonus Grant may have no expiry.
- Whether a grant reserved before expiry stays valid until order resolution.
- Refund rules after capture.
- Permission model for negative Admin adjustments.
- How the existing HtmlService project is prevented from being a concurrent financial writer.

No test in this document has been run. This is a checklist for a future, separately approved implementation.
