# Nobi Topup — Structural Readiness and Implementation Plan

Status: ordered plan; policy decisions for Phase 0/1 confirmed; no deployment authorization.

## Phase 0 — Architecture baseline
- [x] Confirm clean initial setup; no legacy DB/uploads need migration.
- [x] Inspect current branch files and identify mixed SQLite/GAS responsibilities.
- [x] Define runtime boundaries and proposed source layout.
- [x] Define proposed Sheets/Drive schema.
- [x] Define browser API and Vercel-to-GAS contract.
- [x] Review open decisions that require explicit user confirmation (see Decisions section); all Phase 0/1 policy decisions are now confirmed.
- [x] Inventory every current frontend API call and exact response shape in [FRONTEND_API_INVENTORY.md](./FRONTEND_API_INVENTORY.md).
- [x] Record code rollback point: `8d34a26d965c45d99ec52f54551efa55fdad42b5` (before this plan-documentation update).

Exit: architecture and compatibility map reviewed; implementation-affecting decisions must be confirmed before the phase that depends on them.

## Phase 1 — Modularize and harden the Express baseline

<escape>Status: COMPLETE (2026-11-04) — Express baseline scope only; not production-ready.</escape>
Progress: COMPLETE for the Phase 1 Express-baseline scope. Policy decisions are confirmed, documentation is reconciled, branch isolation is verified, and the final GitHub Actions run passed. Production persistence, globally shared rate limiting, enforced CSP, private Drive delivery and full browser E2E remain separate later release gates.

Completed:
- [x] Add Node.js API characterization smoke tests and `npm test`.
- [x] Add GitHub Actions test workflow scoped to `vercel-drive-setup`.
- [x] Centralize runtime paths in `src/config/paths.js`.
- [x] Move SQLite initialization, schema, migrations, seed data and Admin bootstrap to `src/db/sqlite.js`.
- [x] Extract session, upload, error-handler and security middleware under `src/middleware/`.
- [x] Extract public and Admin API route handlers into `src/routes/public.routes.js` and `src/routes/admin.routes.js`; keep `server.js` as composition/entry point.
- [x] Extract catalog, coupon eligibility, and pending order creation logic into `src/services/`.
- [x] Extract Admin authorization, async route handling, and shared validators into focused middleware/utility modules.
- [x] Centralize environment loading and runtime variables in `src/config/env.js` without changing existing defaults.
- [x] Keep existing route declarations and `server.js` as the current app composition/entry point.
- [x] Replace the literal example Admin password in `.env.example` with a placeholder.
- [x] Verify API characterization tests after extraction.

Remaining:
- [x] Remove fixed development Admin credentials and default Session Secret; require explicit configuration in every environment.
- [x] Separate public media uploads from private order slips and add Admin-only slip retrieval.
- [x] Fully decode and re-encode PNG/JPEG/WebP uploads; reject malformed/truncated images, MIME mismatches, animation, dimensions above 8,192 pixels per edge, more than 25 megapixels, and processed files above 3 MB.
- [x] Require same-origin Origin headers for Admin mutations and reject cross-site Fetch Metadata.
- [x] Enable CSP in Report-Only mode and verify the header.
- [x] Extract security setup and environment configuration without changing existing runtime behavior.
- [x] Expand characterization coverage for game/package/coupon/promotion CRUD and lists, coupon suggestions/validation, order creation/status, payment configuration, unsupported MIME, spoofed image signatures, oversized uploads, private slip access, same-origin checks, and fail-closed startup configuration.
- [x] Extract public and Admin route handlers in separate modules while preserving route paths and response bodies.
- [x] Extract payment-info and order-status business logic into focused services; API tests cover configured/unconfigured payment response, status completion, no-op, and forbidden reversal.
- [x] Keep SQLite as the isolated characterization baseline until the replacement repository adapter passes tests.

Latest verified CI: `41834884352` (final Phase 1 policy/documentation commit `68827f0b25d3c8dbd677a5d49b87f658d54b5eea`) — success. Job `api-smoke` completed successfully, including dependency installation and API characterization tests. Earlier expanded test run `41790083468` failed on an outdated expected total; the assertion was corrected from ฿20 to ฿19 after coupon discount changed from ฿2 to ฿3, and the corrected run passed.

Exit: existing API contracts are characterized, security changes are intentional and tested, and syntax/API regression tests pass. Frontend compatibility and durable production storage remain separate release gates.

## Phase 1 security findings
- See [PHASE1_SECURITY_FINDINGS.md](./PHASE1_SECURITY_FINDINGS.md) for evidence, remediation, and remaining release gates.
- See [PHASE1_ABUSE_CONTROL_DESIGN.md](./PHASE1_ABUSE_CONTROL_DESIGN.md) for the documented no-new-service multi-instance limiter strategy.
- Remaining material risks after the Phase 2 source integration: Apps Script runtime/quota behavior is not yet verified, CSP remains Report-Only, and browser/device end-to-end tests plus shared-abuse-control load tests are still release gates. Vercel production now fails closed without Apps Script configuration and does not initialize SQLite.
- Do not enable production orders until the critical/high findings are resolved and retested.

## Phase 0/1 exit blockers before Phase 2
- [x] Frontend GAS RPC calls and current response contracts inventoried.
- [x] Express route gaps and response-shape mismatches recorded.
- [x] User confirmed Login ID policy: ASCII English letters and digits only, 4–30 characters, case-insensitive.
- [x] Confirm image privacy requirement: slips and all other uploaded images remain private in Google Drive; storefront-visible assets must be served through an application proxy without public Drive sharing.
- [x] Complete full image decoding and document the shared multi-instance abuse-control strategy in [PHASE1_ABUSE_CONTROL_DESIGN.md](./PHASE1_ABUSE_CONTROL_DESIGN.md); implementation/load testing is a production integration gate for the shared backend.
- [x] User confirmed IP login history and Admin audit-log retention: 90 days, then delete or irreversibly anonymize.
- [x] User confirmed Admin and Member session policy: maximum lifetime 8 hours; idle timeout 30 minutes; revoke on logout or password change.
- [x] Phase 1 final acceptance review completed: approved policies documented, final CI passed, and `main` remains unchanged. Phase 1 is closed for its stated Express-baseline scope. Phase 2 has been explicitly authorized and is in progress on vercel-drive-setup; no deployment is authorized.

## Phase 2 — Apps Script gateway and storage
Progress: Schema v1 business handlers for Catalog, Coupon, Order, Admin and Authentication have been migrated to schema-aware repositories. Member registration/login/session/IP history, Admin sessions, password rotation, shared HMAC-keyed Sheets rate limits, coupon eligibility/reservations, order deadlines/idempotency/audit logs, private Drive slip/media storage and Vercel proxy routes are implemented in source. Express production mode now uses the signed Apps Script gateway and fails closed instead of falling back to SQLite. Node tests cover schema setup, PBKDF2 reference output, Vercel storage mode, gateway REST route contracts, locked session validation, private Drive folder boundaries, coupon/UID spend rules, expiry boundaries, order idempotency and slip retry behavior. Recent hardening also closes session revocation races, restricts media/slip reads to configured private folders, rejects external catalog media, validates coupon dates/usage limits and makes accepted slip retries idempotent. Apps Script runtime, quota, concurrency and full browser/device verification remain open.
- [x] Split legacy GAS business logic into focused files and replace the legacy `rpc()` entry with an explicit signed-HTTP action dispatcher; remove HtmlService/browser RPC assumptions.
- [x] Add signed, version-1 HTTP request envelope and fixed legacy action allowlist (`13_HttpGateway.gs`).
- [x] Add HMAC-SHA256 verification, timestamp freshness check and nonce replay ledger guarded by ScriptLock.
- [x] Add matching Vercel Node client with bounded timeout, typed errors and no implicit mutation retries.
- [x] Add Node tests for request signing, success response, gateway rejection and no implicit retry.
- [x] Implement schema-versioned, idempotent Sheets setup (schema version 1) that preflights all existing headers, stops on incompatibility or unknown versions, never clears existing content, and is covered by repeat-run/legacy-schema/version tests.
- [x] Add schema-aware repository primitives with exact header checks, allowed-field validation, immutable primary keys, unique-key checks, and ScriptLock-protected inserts/updates.
- [x] Harden legacy Sheets write helpers to fail closed on unknown tables, schema mismatches, unknown fields, missing primary keys, and primary-key mutation; add regression tests proving rejected writes do not alter data.
- [x] Migrate Catalog, Coupon, Order, Admin and Auth business handlers to the version 1 repository field model; keep live Sheets initialization blocked until runtime verification is complete.
- [x] Implement Member/Admin sessions, coupon reservations, order deadlines, audit and idempotency records against the approved Sheets schema.
- [x] Implement private Drive storage for slips and storefront/catalog/promotion images, plus Admin-authorized slip and reference-checked media proxy delivery.
- [x] Add offline VM tests of the GAS verifier for bad signature, stale timestamp, invalid action, missing nonce schema and replay rejection.
- [ ] Run the same security checks in an actual Apps Script test deployment, including concurrent nonce claims and quota behavior.
- [x] Wire the Express production API to the signed Apps Script gateway; add REST route contract tests. Full Apps Script runtime integration remains a separate gate.

The migrated GAS modules pass Node syntax/structure checks and PBKDF2 is verified against Node's reference implementation. They have not yet been imported into or runtime-tested in Apps Script. Benchmark the 120,000-iteration PBKDF2 implementation and test nonce replay, concurrent order/coupon claims, Drive privacy, and quota behavior before any live initialization. Do not call `setupNobiDatabase()` or `initializeAdmin()` until those gates pass. No deployment is authorized.

## Phase 3 — Durable authentication (source implementation complete; runtime verification pending)
- [x] Separate Admin and Member authentication, registration, login and logout.
- [x] PBKDF2-SHA256 password hashing (120,000 iterations) with per-account random salts.
- [x] Opaque HttpOnly cookie sessions; store token hashes only; enforce 8-hour lifetime, 30-minute idle timeout, revocation and password rotation.
- [x] Shared HMAC-keyed Sheets login throttling (10/IP/15m), registration throttling (5/IP/15m), account failure throttling (5/15m), Admin-only Member IP-history screen and 90-day log retention.
- [ ] Benchmark PBKDF2 and verify Apps Script execution/quota behavior in the real runtime.

## Phase 4 — Storefront workflows (source implementation complete; runtime verification pending)
- [x] Catalog and promotions from Sheets Schema v1.
- [x] Coupon suggestions/validation for Guest, Member, UID allowlist, game restrictions, cumulative Member spend per game and cumulative UID spend per game.
- [x] Guest and Member checkout with server-side package pricing and eligibility.
- [x] Enforce 15 minutes for orders without coupons or coupons without expiry; coupon orders with an expiry date remain payable through that date (Asia/Bangkok), with synchronous deadline checks.
- [x] Idempotent order creation and private Drive slip upload.
- [x] Reserve coupon capacity on Pending; consume on Completed only if slip was submitted before deadline; release on Rejected/Expired.

## Phase 5 — Admin and frontend integration (source implementation complete; end-to-end verification pending)
- [x] Admin login/session/dashboard/orders and status transitions with audit history.
- [x] Private slip proxy and private Drive image upload/proxy.
- [x] CRUD for games, packages, coupons and promotions.
- [x] Member registration/login UI and Admin-only IP-history screen.
- [x] Convert storefront and Admin to same-origin Vercel API; remove browser-side GAS RPC.
- [ ] Verify the complete workflows in real browsers/devices against a synthetic Apps Script test deployment.

## Phase 6 — Verification and release readiness
- Unit, integration, security and manual regression tests.
- Synthetic data only; never use real slips for tests.
- Validate Google quotas, Apps Script runtime, upload limits and Vercel function limits.
- Verify spreadsheet/folder/file privacy and absence of secrets in Git and browser bundles.
- Document environment, setup, recovery and rollback.
- Produce a release-readiness report.

Exit: all critical tests pass, remaining risks are documented, and user separately authorizes deployment.

## Decisions required before relevant code
1. Member login ID: CONFIRMED — ASCII English letters/digits only, 4–30 characters, case-insensitive.
2. Coupon lifecycle (confirmed): reserve capacity immediately on Pending; consume when Completed if the slip was submitted before the payment deadline; release on Rejected or Expired. Orders without a coupon, or using a non-expiring coupon, have 15 minutes. A coupon with an expiry date gives the order until the end of that date in Asia/Bangkok, without an extra 15-minute cap.
3. Login and Admin audit-log retention: CONFIRMED — 90 days, then delete or irreversibly anonymize.
4. Admin and Member session policy: CONFIRMED — 8-hour maximum lifetime, 30-minute idle timeout, revoke on logout or password change.
5. Benchmark a suitable slow password KDF in Apps Script; do not ship SHA-256-only password hashing.

## Safety rules
- Work only on vercel-drive-setup; never update main.
- Do not deploy or publish a GAS Web App without separate explicit authorization.
- Do not create or use live payment credentials during development.
- Do not accept real orders or slips during testing.
- Never delete or rewrite existing user data during setup.
- Make small reviewable commits and verify every changed file.


### Frontend REST integration update (2026-11-05)
- [x] Storefront and Admin use same-origin REST APIs; browser-side Apps Script RPC has been removed.
- [x] Checkout creates Pending first, then submits a slip using a one-time checkout token; UI displays the server-provided payment deadline.
- [x] Admin uses HttpOnly cookie sessions, private binary slip retrieval, payment deadline and Expired status.
- [x] Member registration/login/logout/password-change UI; Guest checkout remains available.
- [x] Admin coupon editor supports public/member-only/member-game-spend access rules.
- [x] Admin image upload stores files in private Drive; storefront images are delivered through a reference-checked API proxy.
- [x] Admin can inspect Member login/IP history; all returned IP details require an authenticated Admin session.
- [x] Add frontend syntax/contract test and verify it in GitHub Actions.

Still open: import and test the Apps Script project in its real runtime; benchmark PBKDF2 and quotas; run concurrency/replay/security tests; verify Drive permissions; finish real-browser/device end-to-end tests and production CSP/abuse-control review. Frontend and gateway source integration is not production readiness.


---

## Architecture decision update — 2026-11-05 (supersedes the Apps Script target)

The user selected **Option A: Vercel + Database**, with a **free-first** constraint. The target is now **Vercel Express + Neon PostgreSQL + Vercel Blob Private**. Google Apps Script, Google Sheets and Google Drive are no longer the target runtime or persistence layer. Existing GAS source is legacy migration input only until the PostgreSQL port is complete; do not deploy or initialize it.

The authoritative new migration plan is [POSTGRES_MIGRATION_PLAN.md](./POSTGRES_MIGRATION_PLAN.md). This section supersedes Phase 2–6 items below wherever they require Apps Script, Sheets, Drive, or a GAS test deployment. Earlier checklists remain as historical evidence of completed source work, not as current release tasks.

### New phase order
1. **P0 — Read-only baseline:** verify branch isolation, inventory all GAS/SQLite operations, schema fields, frontend REST contracts, tests and business rules; produce a file-by-file migration matrix.
2. **P1 — PostgreSQL foundation:** add Neon-compatible Node 22 database driver, transaction-capable connection handling, versioned migrations, constraints, indexes and isolated synthetic test fixtures.
3. **P2 — Business logic port:** move Catalog, Promotions, Coupons, Orders, Payments, Admin and Member workflows into Node services/repositories; use database transactions and row locks for coupon/order invariants.
4. **P3 — Authentication and abuse controls:** move Admin/Member accounts, hashed opaque sessions, atomic shared rate limits and audit/IP history to PostgreSQL.
5. **P4 — Private file storage:** replace Drive with Vercel Blob Private; retain Admin-only slip access and reference-checked catalog media proxy.
6. **P5 — Compatibility and browser tests:** preserve current storefront/Admin and same-origin REST contracts; test all Guest/Member/Admin workflows on synthetic data.
7. **P6 — Preview integration:** only after a separate provisioning approval, link a Neon Free database and Private Blob store, set Preview-only environment variables for `vercel-drive-setup`, and run synthetic migrations/seeds.
8. **P7 — Release readiness:** review free-tier limits, operational recovery, privacy, costs and commercial plan eligibility. Production deployment and live payments require separate approval.

### Current migration status
- [x] User selected Vercel + Database, free-first.
- [x] Read current branch `package.json`, `server.js`, `README.md`, architecture and implementation plan.
- [x] Confirmed current Vercel startup still hard-requires `APPS_SCRIPT_URL` and `APPS_SCRIPT_SHARED_SECRET`; this must be removed only after the PostgreSQL adapter is complete.
- [x] Recorded the target architecture and ordered migration plan.
- [ ] Complete P0 operation/schema/route/test inventory and migration matrix.
- [ ] Implement P1 PostgreSQL foundation and isolated database tests.
- [ ] Port business logic and authentication.
- [ ] Implement Private Blob adapter and private proxy routes.
- [ ] Complete Preview-only integration and browser tests.

### Free-tier and commercial-use guardrails
- Neon Free and Vercel Blob Hobby allowances are subject to provider limits and may change. Confirm the actual Vercel Marketplace billing mode and quotas before provisioning.
- Vercel Hobby is intended for personal, non-commercial use. It may be used for development/testing subject to current terms; before a commercial store launch, verify eligibility and obtain approval for any required plan change.
- No paid add-ons, paid plan upgrades, over-quota configuration, Neon account/database creation, Blob store creation, Production environment changes, or live data initialization without explicit approval.
- If free-tier compute/storage/transfer limits are exhausted, fail safely with a clear service error. Never fall back to ephemeral SQLite or silently incur charges.

### Unchanged business requirements
All confirmed Guest checkout, Member Login ID, coupon eligibility, UID/game spend, coupon reservation/consumption/release, payment deadline, Asia/Bangkok expiry, idempotency, 3 MB image validation, private slip/media access, Admin IP-history/audit retention, session lifetime/idle timeout, and manual slip-review rules remain mandatory. See [POSTGRES_MIGRATION_PLAN.md](./POSTGRES_MIGRATION_PLAN.md) for the complete invariant list.


---

## Latest architecture decision — 2026-11-05

The user requires zero cost at every stage and approved switching away from Option A. The active target is Google Apps Script HtmlService + Google Sheets + private Google Drive, using the existing Google account only. The frontend must use an allowlisted google.script.run facade instead of Vercel REST endpoints. This is a built-in Apps Script bridge, not a separately subscribed API provider.

The Vercel + Neon PostgreSQL + Vercel Blob direction is cancelled. See ZERO_COST_MIGRATION_PLAN.md. The old PostgreSQL plan is historical only.

### New phases
1. P0 read-only compatibility audit: inventory frontend REST calls, payloads, response shapes, GAS actions, file transfer and Node-only dependencies; produce a port matrix.
2. P1 Apps Script web facade: HtmlService routing/templates and explicit allowlisted server functions.
3. P2 frontend adapter: replace Vercel fetch calls with google.script.run while preserving UI and business rules.
4. P3 runtime/performance: after separate approval, benchmark PBKDF2, Sheets, LockService, file transfer and quotas.
5. P4 security/business verification: sessions, private Drive, coupon/order invariants, idempotency and recovery.
6. P5 synthetic browser/device tests.
7. P6 separate approvals for project/resource creation, initialization, deployment, Admin bootstrap and live payments/orders.

Status: architecture docs updated; P0 audit and port matrix not yet complete; source code has not yet been ported. No Google resources have been created or initialized. No billing enabled. Work remains on vercel-drive-setup; main untouched.

Cost guardrails: no new service, paid tier, billing, card entry, Neon, hosted PostgreSQL, Vercel Blob or Vercel runtime. Use only existing Google quotas/storage. On exhaustion, fail closed; never auto-upgrade. Google may change quotas/terms, so unlimited free service cannot be guaranteed.
