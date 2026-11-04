# Nobi Topup — Structural Readiness and Implementation Plan

Status: ordered plan; no deployment authorization.

## Phase 0 — Architecture baseline
- [x] Confirm clean initial setup; no legacy DB/uploads need migration.
- [x] Inspect current branch files and identify mixed SQLite/GAS responsibilities.
- [x] Define runtime boundaries and proposed source layout.
- [x] Define proposed Sheets/Drive schema.
- [x] Define browser API and Vercel-to-GAS contract.
- [ ] Review open decisions that require explicit user confirmation (see Decisions section).
- [x] Inventory every current frontend API call and exact response shape in [FRONTEND_API_INVENTORY.md](./FRONTEND_API_INVENTORY.md).
- [x] Record code rollback point: `8d34a26d965c45d99ec52f54551efa55fdad42b5` (before this plan-documentation update).

Exit: architecture and compatibility map reviewed; no unresolved decision that could cause data loss or security regression.

## Phase 1 — Modularize without behavior changes
Progress: in progress. The first extraction group is complete and its API smoke suite passes in GitHub Actions.

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
- [x] Validate PNG/JPEG/WebP file signatures and reject MIME spoofing; full image decode/re-encode and dimension limits remain open.
- [x] Require same-origin Origin headers for Admin mutations and reject cross-site Fetch Metadata.
- [x] Enable CSP in Report-Only mode and verify the header.
- [x] Extract security setup and environment configuration without changing existing runtime behavior.
- [x] Expand characterization coverage for game/package/coupon/promotion CRUD and lists, coupon suggestions/validation, order creation/status, payment configuration, unsupported MIME, spoofed image signatures, oversized uploads, private slip access, same-origin checks, and fail-closed startup configuration.
- [x] Extract public and Admin route handlers in separate modules while preserving route paths and response bodies.
- [x] Extract payment-info and order-status business logic into focused services; API tests cover configured/unconfigured payment response, status completion, no-op, and forbidden reversal.
- [x] Keep SQLite as the isolated characterization baseline until the replacement repository adapter passes tests.

Latest verified CI runs: `41789682979` (environment centralization), `41789980248` (Admin router extraction/mount), `41790264334` (Multer 2.5.0 upload limits and oversized upload rejection), and `41790360883` (service/middleware wiring), `41790464278` (pending order service wiring), and `41790497080` (invalid checkout upload cleanup), `41790533090` (invalid coupon upload cleanup), `41791884105` (private slip isolation, same-origin hardening and startup fail-closed tests), `41792343333` (missing credential startup tests), `41792303043` (order transition tests), and `41792431314` (payment service wiring) — success. One expanded test run failed on an outdated expected total (`41790083468`); the assertion was corrected from ฿20 to ฿19 after coupon discount changed from ฿2 to ฿3, and the corrected run passed.

Exit: local behavior remains equivalent; syntax and route smoke tests pass.

## Phase 1 security findings
- See [PHASE1_SECURITY_FINDINGS.md](./PHASE1_SECURITY_FINDINGS.md) for evidence, remediation, and remaining release gates.
- Remaining material risks: local SQLite/session persistence on Vercel, process-local rate limiting, lack of full image decoding, CSP still Report-Only, and private slips still need durable Google Drive storage.
- Do not enable production orders until the critical/high findings are resolved and retested.

## Phase 0/1 exit blockers before Phase 2
- [x] Frontend GAS RPC calls and current response contracts inventoried.
- [x] Express route gaps and response-shape mismatches recorded.
- [ ] User review/confirmation of unresolved member, coupon lifecycle, audit retention, and session policy decisions.
- [ ] Decide final image storage policy. User's prior requirement is private Google Drive storage for slips and other uploaded images; implement that target, not public Drive sharing.
- [ ] Complete full image decoding and multi-instance abuse-control strategy.
- [ ] Do not begin live integration until the user approves unresolved policy decisions.

## Phase 2 — Apps Script gateway and storage
- Split GAS code into focused files.
- Implement signed, versioned HTTP request envelope and fixed action allowlist.
- Implement schema-versioned, idempotent Sheets setup that never clears existing content.
- Implement private Drive storage and normalized errors.
- Test bad signature, replay, invalid action and missing schema fail closed.

## Phase 3 — Durable authentication
- Implement separate Admin and Member auth.
- Implement slow password KDF and opaque cookie sessions.
- Store token hashes only; enforce expiry, revocation and rotation.
- Add login rate limits and Admin-only IP-history audit.

## Phase 4 — Storefront workflows
- Catalog and promotions.
- Coupon suggestions and validation.
- Guest and Member checkout.
- Server-side pricing and eligibility.
- Idempotent order creation and private slip upload.
- Explicit coupon reservation/finalization/release lifecycle.

## Phase 5 — Admin and frontend integration
- Admin login/session/dashboard/orders.
- Status transitions and audit history.
- Private slip proxy.
- CRUD for games, packages, coupons and promotions.
- Member listing and Admin-only IP history.
- Convert storefront and Admin to same-origin Vercel API.
- Remove browser-side GAS RPC only after end-to-end verification.

## Phase 6 — Verification and release readiness
- Unit, integration, security and manual regression tests.
- Synthetic data only; never use real slips for tests.
- Validate Google quotas, Apps Script runtime, upload limits and Vercel function limits.
- Verify spreadsheet/folder/file privacy and absence of secrets in Git and browser bundles.
- Document environment, setup, recovery and rollback.
- Produce a release-readiness report.

Exit: all critical tests pass, remaining risks are documented, and user separately authorizes deployment.

## Decisions required before relevant code
1. Member login ID length: proposal ASCII letters/digits, 4–30 characters; confirm.
2. Coupon lifecycle: decide when Pending reserves capacity, reservation expiry, and release behavior on Rejected.
3. Image policy: private Drive only or allow selected externally hosted marketing images.
4. Retention for login and Admin audit logs.
5. Admin and Member session lifetime and idle timeout.
6. Benchmark a suitable slow password KDF in Apps Script; do not ship SHA-256-only password hashing.

## Safety rules
- Work only on vercel-drive-setup; never update main.
- Do not deploy or publish a GAS Web App without separate explicit authorization.
- Do not create or use live payment credentials during development.
- Do not accept real orders or slips during testing.
- Never delete or rewrite existing user data during setup.
- Make small reviewable commits and verify every changed file.
