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
- [x] Fully decode and re-encode PNG/JPEG/WebP uploads; reject malformed/truncated images, MIME mismatches, animation, dimensions above 8,192 pixels per edge, more than 25 megapixels, and processed files above 5 MB.
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
Progress: Schema v1 business handlers for Catalog, Coupon, Order, Admin and Authentication have been migrated to schema-aware repositories. Member registration/login/session/IP history, Admin sessions, password rotation, coupon eligibility/reservations, order deadlines/idempotency/audit logs, private Drive slip/media storage and Vercel proxy routes are implemented in source. Express production mode now uses the signed Apps Script gateway and fails closed instead of falling back to SQLite. Node tests cover schema setup, PBKDF2 reference output, Vercel storage mode and gateway REST route contracts. Apps Script runtime, quota, concurrency and full browser/device verification remain open.
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
- [ ] Add GAS runtime tests for bad signature, stale timestamp, replay, invalid action, missing schema, concurrent nonce claims and quota behavior.
- [x] Wire the Express production API to the signed Apps Script gateway; add REST route contract tests. Full Apps Script runtime integration remains a separate gate.

The migrated GAS modules pass Node syntax/structure checks and PBKDF2 is verified against Node's reference implementation. They have not yet been imported into or runtime-tested in Apps Script. Benchmark the 120,000-iteration PBKDF2 implementation and test nonce replay, concurrent order/coupon claims, Drive privacy, and quota behavior before any live initialization. Do not call `setupNobiDatabase()` or `initializeAdmin()` until those gates pass. No deployment is authorized.

## Phase 3 — Durable authentication (source implementation complete; runtime verification pending)
- [x] Separate Admin and Member authentication, registration, login and logout.
- [x] PBKDF2-SHA256 password hashing (120,000 iterations) with per-account random salts.
- [x] Opaque HttpOnly cookie sessions; store token hashes only; enforce 8-hour lifetime, 30-minute idle timeout, revocation and password rotation.
- [x] Admin and Member login throttling; Admin-only Member IP-history screen and 90-day log retention.
- [ ] Benchmark PBKDF2 and verify Apps Script execution/quota behavior in the real runtime.

## Phase 4 — Storefront workflows (source implementation complete; runtime verification pending)
- [x] Catalog and promotions from Sheets Schema v1.
- [x] Coupon suggestions/validation for Guest, Member, UID allowlist, game restrictions and cumulative Member spend per game.
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
