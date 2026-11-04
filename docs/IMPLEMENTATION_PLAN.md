# Nobi Topup — Structural Readiness and Implementation Plan

Status: ordered plan; no deployment authorization.

## Phase 0 — Architecture baseline
- [x] Confirm clean initial setup; no legacy DB/uploads need migration.
- [x] Inspect current branch files and identify mixed SQLite/GAS responsibilities.
- [x] Define runtime boundaries and proposed source layout.
- [x] Define proposed Sheets/Drive schema.
- [x] Define browser API and Vercel-to-GAS contract.
- [ ] Review open decisions.
- [ ] Inventory every current frontend API call and exact response shape.
- [ ] Record branch commit SHA as rollback point.

Exit: architecture and compatibility map reviewed; no unresolved decision that could cause data loss or security regression.

## Phase 1 — Modularize without behavior changes
Progress: in progress. The first extraction group is complete and its API smoke suite passes in GitHub Actions.

Completed:
- [x] Add Node.js API characterization smoke tests and `npm test`.
- [x] Add GitHub Actions test workflow scoped to `vercel-drive-setup`.
- [x] Centralize runtime paths in `src/config/paths.js`.
- [x] Move SQLite initialization, schema, migrations, seed data and Admin bootstrap to `src/db/sqlite.js`.
- [x] Extract session, upload and error-handler middleware under `src/middleware/`.
- [x] Keep existing route declarations and `server.js` as the current app composition/entry point.
- [x] Replace the literal example Admin password in `.env.example` with a placeholder.
- [x] Verify API characterization tests after extraction.

Remaining:
- [ ] Extract security setup and environment configuration without changing behavior.
- [ ] Expand characterization coverage for CRUD, order status and upload validation.
- [ ] Move service and route handlers in small groups while preserving exact contracts.
- [ ] Keep SQLite until the replacement repository adapter passes tests.

Latest verified CI run: `41789068727` — success.

Exit: local behavior remains equivalent; syntax and route smoke tests pass.

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
