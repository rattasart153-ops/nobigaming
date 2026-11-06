# Nobi Topup — Zero-Cost Migration and Compatibility Plan

Status: approved architecture; P0/P1/P2 source implementation complete on vercel-drive-setup; real Google runtime, browser/device verification and deployment remain unauthorized.

## Scope and cost boundary

- Repository `rattasart153-ops/nobigaming`; edit only `vercel-drive-setup`; never modify `main`.
- Existing Google and GitHub accounts only.
- No paid services, billing, card entry, paid tiers/add-ons, Neon, hosted PostgreSQL, Vercel Blob or Vercel runtime.
- Use existing Apps Script quotas and Drive capacity. Exhaustion means safe stop, not automatic upgrade.
- Free quotas and terms may change; unlimited availability/storage cannot be promised.
- Synthetic data only.

## Target

Browser → Apps Script HtmlService → allowlisted `google.script.run` facade → Sheets + private Drive. The bridge is built into Apps Script; it is not a separately subscribed API provider, but backend calls consume Apps Script quotas.

## Why Option A is cancelled

The user explicitly requires zero cost at every stage. Vercel + Neon + Blob free allowances and plan terms cannot guarantee this constraint for the intended use. No Neon database or Blob store was provisioned as part of this switch.

## Phases

### P0 — Read-only compatibility audit
- Inventory frontend REST calls, payloads, response shapes, uploads/downloads.
- Map Express routes to GAS business handlers and callable facade methods.
- Identify Vercel/Node-only dependencies: request/response objects, cookies, multipart parsing, redirects and Node libraries.
- Review HtmlService constraints and secure session/file-transfer patterns.
- Produce a file-by-file port matrix. No business-logic changes.

### P1 — Apps Script facade, Schema and Repository migration
- [x] Add doGet routing and HtmlService templates for storefront/Admin (P0-R11).
- [x] Add explicit allowlisted server functions; no generic browser action/table dispatcher (P0-R12).
- [x] Align business logic with the current versioned Sheets schema (current schema version: 3; do not downgrade to v1).
- [x] Migrate Catalog/Packages, Admin CRUD, Coupon, Order, Authentication and Session reads/writes to schema-aware repository functions.
- [x] Validate partial Admin updates against the merged record; preserve existing private media references when image_url is omitted.
- [x] Route Admin delete and 90-day authentication/audit log pruning through repository delete functions.
- [x] Fail closed on malformed coupon spend thresholds/history, invalid payment deadlines and invalid idempotency expiry metadata.
- [x] Add regression coverage for Catalog, Admin CRUD, coupon/order edge cases, authentication retention and repository-only writes.
- [x] Validate and authorize browser calls server-side; secrets remain in Script Properties.
- [ ] Verify real Sheets behavior, quotas and LockService concurrency after separate P6 authorization.

### P2 — Frontend adapter
- [x] Replace HtmlService Storefront/Admin REST transport with named google.script.run facade calls (P0-R13).
- [x] Preserve UI, Thai text, checkout, Member/Admin workflows and business semantics at source level.
- [x] Implement bounded Base64 slip/media upload and Admin slip retrieval without exposing Drive sharing URLs.
- [x] Keep Member/Admin session tokens and checkout upload capability in JavaScript memory only; refresh requires login again. Never store auth tokens in localStorage/sessionStorage.
- [x] Render PromptPay EMVCo payload with a locally bundled QR encoder.
- [ ] Complete real HtmlService browser/device verification after separate P6 authorization.

### P3 — Runtime and performance
- [x] Review source-level hot paths in the schema-aware Sheets repository.
- [x] Reuse one table snapshot for primary-key and unique-key checks during repository Insert/Update; preserve ScriptLock, schema validation, uniqueness rules and fail-closed behavior.
- [x] Add offline regression tests that assert one table-body read per Insert/Update, one header validation read and exactly one successful write; duplicate writes perform no write.
- [x] Add offline lock-lifecycle regression tests: repository writes request the 15-second ScriptLock wait, release after success and validation failure, and fail closed without writing when lock acquisition times out.
- [x] Add offline synthetic media-upload regressions: reject mismatched image signatures, truncated images and decoded payloads above 3 MiB before any Drive file is created; verify private ACL enforcement and cleanup after audit failure.
- [x] Strengthen server-side image-container checks: PNG chunk boundaries and CRC-32, JPEG marker/segment bounds and terminal EOI, and WebP RIFF/chunk lengths; use a valid PNG fixture and reject truncated/corrupted payloads.
- Latest P3 offline regression CI before P4 changes: [run 42202070008](https://github.com/rattasart153-ops/nobigaming/actions/runs/42202070008) passed **135/135** tests on commit `8df69f67da31dbcdf63e7dd484a44602fa3d49d9`.
- [x] Retain the PBKDF2-SHA256 reference-vector test to verify the 120,000-iteration implementation has not been weakened or changed.
- [ ] Benchmark PBKDF2 latency on the actual Apps Script V8 runtime; Node/VM timings are not a substitute.
- [ ] Measure real Sheets read/write latency and LockService contention under concurrent synthetic requests.
- [ ] Measure Base64 upload/download throughput, Drive operations and end-to-end Apps Script execution time with synthetic files.
- [ ] Confirm actual Apps Script quotas, concurrent execution limits and available private Drive capacity against the intended synthetic test volume.
- [ ] Full image decode/re-encode remains unverified: the offline Apps Script validator checks container structure but is not a pixel decoder. Do not treat this as equivalent to a trusted image-processing pipeline; verify it in an approved runtime before production.
- Offline P3 regression CI: [run 42178679222](https://github.com/rattasart153-ops/nobigaming/actions/runs/42178679222) passed **128/128** tests on commit `603ee4a6557ac11960dabececfad8e23c81f9583`.
- Runtime measurements and Google resource checks remain unavailable until Google sign-in is restored; no Apps Script project, spreadsheet, Drive folder or deployment has been created. User elected to continue offline-safe P3 work in the meantime.

### P4 — Security and business rules
- [x] Add offline session regressions for Admin/Member absolute expiry, the 30-minute idle boundary, malformed timestamps, auth-version invalidation, logout revocation, password-change revocation of all sessions, stale credential/KDF race rejection and no last-seen refresh after rejection.
- [x] Add offline Admin slip-access regressions proving authentication precedes Drive reads, files/folders must remain private, failed audit writes do not return slip bytes, and revocation during a Drive read is rechecked under ScriptLock before any slip response is returned.
- [x] Add offline repository quota-exhaustion regressions for Sheets read and append failures; verify no business row is written and ScriptLock is released. Existing lock-timeout tests verify writes fail closed when ScriptLock cannot be acquired.
- [x] Existing order workflow regressions cover coupon reservation/release/consume, Bangkok expiry deadlines, one-time slip submission, idempotency payload conflicts, recovery replay and lock-protected writes.
- [x] Existing retention regressions cover immediate legacy IP clearing, 90-day non-IP security event retention, Bangkok daily trigger idempotency and retry after partial cleanup failure.
- [x] Run and inspect the complete P4 regression CI: [run 42203721676](https://github.com/rattasart153-ops/nobigaming/actions/runs/42203721676) passed **153/153** tests, 0 failed, on `vercel-drive-setup`.
- [x] Mocked race tests verify stale password-change snapshots are rejected and an Admin session revoked while Drive is being read cannot receive the slip response; the final check and audit run under ScriptLock.
- [x] Mocked ScriptLock timeout at the final slip authorization boundary fails closed and does not return bytes or write a view audit.
- [ ] Real Google Apps Script quota enforcement, real simultaneous execution scheduling, and actual Drive ACL enforcement remain integration verification items; mock tests cannot prove Google service behavior.

### P5 — Browser/device tests
- Guest, Member, Admin, coupon, checkout, slip, order status and Admin CRUD on synthetic data only.

### P6 — Explicit authorization gates
Separate approval is required before creating an Apps Script project, spreadsheet, Drive folders, setting Script Properties, deploying the web app, initializing schema, bootstrapping Admin or enabling real payments/orders.

## Preserved business rules

Guest checkout; ASCII Member Login ID 4–30; public/member-only/member-game-spend coupons; UID allowlist; cumulative Completed post-discount spend; coupon reserve/consume/release; default 15-minute payment window; expiring coupon deadline through end of Asia/Bangkok expiry date; sessions 8h/30m idle; no Member IP history (approved decision B); non-IP login/security logs retained 90 days; private slips/media; manual Admin review.

## Current facts

- GAS source includes versioned Schema v3 setup/repository primitives, migrated business handlers, auth/session logic, coupon/order workflows, private Drive helpers and the legacy signed HTTP gateway.
- Signed gateway remains for legacy characterization only; `BrowserFacade.gs` exposes named typed `google.script.run` functions.
- HtmlService router, templates, typed facade adapters, memory-only session lifecycle, bounded file transfer and local QR rendering are implemented at source level. After P1 source migration, CI run 42169477217 (commit 1162c96c0df44558df83e5ff2c92482c10493d5c) passed 126/126 tests. This does not prove live GAS/Sheets/Drive or browser/device behavior.
- Apps Script runtime, quotas, concurrency and Drive ACLs are unverified.
- No live Google resources have been initialized; no web app deployed.


## Current implementation status — 2026-11-06

- P0-R11/R12: HtmlService router and typed browser facade implemented.
- P0-R13: Storefront/Admin frontend adapter, memory-only tokens encapsulated in adapter closures, refresh-to-login behavior, Base64 file transfer and local PromptPay QR renderer implemented.
- P1 / Phase 2.1: Schema v3 and repository migration completed for Catalog/Packages, Admin CRUD, Coupons, Orders, Authentication and Session. Admin partial updates preserve omitted fields/media; log retention deletes use repositories; malformed spend/deadline/idempotency data fails closed.
- CI: GitHub Actions run 42169477217 passed **126/126** tests on vercel-drive-setup (commit 1162c96c0df44558df83e5ff2c92482c10493d5c).
- Remaining: real Apps Script runtime/quotas, Sheets/LockService concurrency, PBKDF2 latency, Drive ACLs, browser/device E2E and actual QR scanning. These require a separately authorized synthetic test environment. No Google resources or deployment are authorized by this status update.
\n\n## P4 offline implementation status — 2026-11-06\n\n- P4 source-level regression coverage has been expanded on `vercel-drive-setup` for Admin/Member absolute and idle session expiry, logout, auth-version invalidation, password-change revocation of all sessions, Admin-only private slip delivery, audit-gated slip responses and fail-closed Sheets quota exceptions.
- The complete offline CI run [42202817942](https://github.com/rattasart153-ops/nobigaming/actions/runs/42202817942) passed **149/149** tests with 0 failures. The earlier initial test failures were test-harness cross-realm assertion issues; those assertions were corrected and the final run passed.\n- Coupon/order/recovery and retention behaviors continue to be covered by the existing offline regression suites; no business-rule or architecture change was introduced by this test-only P4 increment.\n- The offline/source-only P4 regression increment is passing. This does not close P4 runtime acceptance: real Apps Script quota behavior, concurrent revocation/slip access, actual Drive ACLs and ScriptLock contention remain unverified until a separately authorized synthetic Google runtime is available. No Apps Script runtime, Google resources, deployment, real customer data or payment flow was used.\n

## P4 completion record — mock/offline acceptance

- P4 offline/mock acceptance is complete on `vercel-drive-setup`.
- Final verified test run: [GitHub Actions run 42203721676](https://github.com/rattasart153-ops/nobigaming/actions/runs/42203721676), **153 passed / 0 failed / 0 skipped**.
- Added an atomic authorization boundary for Admin slip delivery: after the Drive read, the Admin session is revalidated under ScriptLock immediately before the audit write and response construction. If logout, suspension, password change, or another revocation wins during the Drive read, no slip bytes are returned.
- Added stale-credential race tests for Admin and Member password changes; a request whose credential snapshot changed during the expensive password KDF is rejected without partial session mutation.
- All mock data is synthetic and isolated. No Google account, Apps Script project, spreadsheet, Drive folder, deployment, real customer data, or payment transaction was used.
- This completion means P4's source/offline/mock test scope is complete. It does not claim that live Google Apps Script runtime, real Sheets quotas, real Drive permissions, or real cross-execution LockService behavior has been verified.
