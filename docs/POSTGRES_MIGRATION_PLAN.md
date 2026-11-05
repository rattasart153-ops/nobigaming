# Nobi Topup — PostgreSQL + Private Object Storage Migration Plan

Status: approved target architecture for implementation planning only. No database, Blob store, environment variables, or deployment has been provisioned by this document.

## Scope and branch safety

- Repository: `rattasart153-ops/nobigaming`.
- Work only on `vercel-drive-setup`; never modify `main`.
- Preserve the existing Thai storefront, Admin UI, route paths, request/response contracts, and approved business rules.
- Use synthetic data only. No real payment credentials, customer data, or real slips during development.
- Do not deploy Production, switch a production domain, or accept live orders without separate explicit authorization.
- Do not create a Neon account/database or Vercel Blob store until the user approves provisioning and the account/integration flow is available.

## Target architecture

Browser → Vercel Express REST API → Neon PostgreSQL + Vercel Blob (Private).

- Vercel/Express owns the application API and business logic. There is no Google Apps Script gateway in the target runtime.
- Neon PostgreSQL is the durable relational database for Admins, Members, sessions, games, packages, coupons, coupon reservations/redemptions, promotions, orders, audit logs, idempotency keys, and shared rate-limit state.
- Vercel Blob must be created as a **Private** store. Store slips and product/promotion media there. Never expose Blob tokens or permanent direct file URLs to browsers.
- All file reads pass through authenticated Express routes. Slip routes require Admin authorization; storefront media routes require a valid active catalog/promotion reference.
- Browser calls remain same-origin. Existing REST paths and response shapes are compatibility constraints.

## Free-first service choice and cost boundary

- Primary database candidate: Neon PostgreSQL Free through the Vercel Marketplace integration.
- File storage: Vercel Blob Private, using Hobby included usage only while within current quotas.
- Check actual plan, billing mode, included quotas, region, and payment requirements in the user's Vercel account before provisioning. Do not assume a Marketplace integration is free merely because a Free plan exists.
- Neon Free has usage limits and may suspend compute when monthly allowances are exhausted; the app must return a controlled service-unavailable response and must never fall back to ephemeral SQLite.
- Vercel Blob has included Hobby allowances but usage beyond them may incur charges or be paused depending on plan. Monitor storage, operations, and transfer.
- Vercel Hobby is intended for personal, non-commercial use. Use it for development/testing only unless the user's current plan terms explicitly permit the intended use. Before commercial launch, review Vercel plan eligibility and any required upgrade.
- Never silently enable paid resources or incur charges. Ask before any paid plan, paid add-on, or over-quota configuration.

## Data and transaction design

- Use PostgreSQL migrations checked into the repository; schema changes are versioned and repeatable.
- Use integer satang for all monetary values and UTC timestamps for storage. Coupon date-only expiry is interpreted in Asia/Bangkok.
- Add foreign keys, unique constraints, check constraints, and indexes for business invariants.
- Use database transactions and row-level locking for coupon capacity reservation, order transitions, and any multi-row mutation.
- Use unique idempotency constraints for order creation and slip submission so retries cannot create duplicate orders, reservations, or receipts.
- Use atomic SQL upserts for shared login/registration/account throttles; do not rely on process-local memory.
- Store only hashes of opaque session tokens. Admin and Member identities/sessions remain separate.
- Use a migration/seed process that is explicit, testable, and never runs destructive reset/seed operations automatically in production.

## Private file design

- Create separate logical prefixes for order slips and catalog/promotion media inside the Private Blob store.
- Decode and re-encode accepted PNG/JPEG/WebP images; preserve the 3 MB application limit unless payload tests justify a safer change.
- Store Blob pathname, content type, size, checksum, ownership/reference, and lifecycle metadata in PostgreSQL; do not store public URLs.
- Slip upload is accepted only before the order's server-calculated payment deadline. Admin reads require an authenticated Admin session and audit entry.
- Public catalog media is still private at storage level; the Express proxy serves it only after checking an active package/promotion reference.
- Add cleanup for orphaned blobs and compensating deletion if a DB transaction fails after upload. Never delete a referenced file during ordinary retries.

## Existing business rules to preserve

- Guest checkout remains allowed.
- Member Login ID: ASCII letters/digits only, 4–30 characters, case-insensitive.
- Coupons: public, member-only, and member-game-spend eligibility; UID allowlist and UID cumulative completed spend restrictions remain independent.
- Only Completed orders count toward Member/UID cumulative spend, after discount. Pending, Rejected, Expired, and Guest orders do not count.
- Reserve coupon capacity on Pending; consume on Completed; release on Rejected/Expired.
- Orders without a coupon or with a non-expiring coupon have 15 minutes to pay and upload a slip.
- Orders using a coupon with an expiry date remain payable through the end of that date in Asia/Bangkok, without an additional 15-minute cap.
- The server/database clock and persisted order deadline are authoritative.
- A slip accepted before the deadline may be reviewed and completed after the deadline.
- Admin and Member sessions: maximum lifetime 8 hours, idle timeout 30 minutes; revoke on logout/password change/suspension.
- Admin-only Member login/IP history and Admin audit logs retain 90 days, then delete or irreversibly anonymize.
- Manual Admin slip review remains the payment verification method; no automatic bank transfer verification or game-provider fulfillment is implied.

## Migration phases

### P0 — Baseline and compatibility map
- Confirm branch HEAD and main isolation.
- Inventory current Apps Script action handlers, Sheets schema, SQLite schema, REST routes, frontend callers, tests, and all documented business rules.
- Map every Apps Script/SQLite operation to a PostgreSQL repository/service operation.
- Record rollback commit and preserve current Preview configuration.

Exit: complete operation/field mapping and no unresolved business-rule changes.

### P1 — PostgreSQL foundation
- Add Neon serverless PostgreSQL driver and a transaction-capable connection strategy compatible with Node 22/Vercel Functions.
- Add database connection module, migrations, repository interfaces, and synthetic seed fixtures.
- Implement schema constraints, indexes, transaction helpers, health diagnostics, and safe startup behavior.
- Keep local tests isolated; do not create production tables or run migrations against a live store.

Exit: migration and repository tests pass against an isolated disposable PostgreSQL test database.

### P2 — Port business logic from Apps Script/SQLite
- Move catalog, promotion, coupon eligibility, order lifecycle, payment info, Admin CRUD, Member auth, audit, and shared rate-limit logic into Node services/repositories.
- Use transaction + row locks for coupon reservations and order state transitions.
- Preserve same-origin REST paths, payloads, status codes, and frontend behavior.
- Remove the production Apps Script startup requirement only after PostgreSQL implementation is complete and covered by tests.
- Keep SQLite only as a local characterization adapter if useful; never as Vercel/production persistence.

Exit: service, integration, concurrency, and compatibility tests pass without Apps Script.

### P3 — Authentication and abuse controls
- Port Admin/Member auth and registration to PostgreSQL.
- Preserve PBKDF2-SHA256 password hashing with per-account salts unless a separately reviewed migration changes it.
- Store opaque session-token hashes only; enforce 8-hour maximum lifetime and 30-minute idle timeout.
- Implement shared, atomic PostgreSQL rate-limit buckets and 90-day audit/IP-history retention.
- Verify CSRF, Origin, cookie flags, session revocation, and account suspension.

Exit: auth/security tests pass across multiple simulated application instances.

### P4 — Private Blob integration
- Add Private Blob upload/read/delete adapters.
- Add database metadata and reference checks.
- Implement authenticated Admin slip proxy and active-catalog media proxy.
- Verify private access, token secrecy, upload validation, retry idempotency, orphan cleanup, and audit events.

Exit: synthetic private-file integration tests pass; no file is publicly accessible by URL.

### P5 — Frontend and API regression
- Keep existing storefront/Admin pages and same-origin API contracts.
- Verify Guest checkout, Member checkout, all coupon eligibility variants, deadline boundaries, slip retries, Admin status changes, CRUD, and IP history.
- Run mobile and desktop browser tests against a synthetic Preview deployment.

Exit: full browser regression passes with no frontend contract breakage.

### P6 — Vercel Preview integration
- Only after code and tests are ready, request approval to provision/link a Neon Free database and Private Blob store.
- Add Preview-only environment configuration for `vercel-drive-setup`; never change Production environment variables.
- Run migrations and seed only synthetic test data in the Preview database.
- Confirm usage/billing boundaries and test health, API, uploads, and browser flows.

Exit: Preview runtime and integration tests pass with synthetic data.

### P7 — Release readiness
- Review quotas, cold starts, Vercel function duration/body limits, DB connection behavior, backups/restore, retention, privacy, and operational alerts.
- Produce a cost and risk report with expected free-tier limits and upgrade triggers.
- Production deployment, domain changes, real PromptPay credentials, and live order acceptance each require separate explicit authorization.

## Immediate next work

1. Complete P0 read-only inventory on `vercel-drive-setup`.
2. Update architecture/setup/readme documents to mark Google Apps Script + Sheets + Drive as superseded for the target runtime.
3. Build a file-by-file migration matrix before changing application code.
4. Implement P1 in small commits and run CI after each logical change.

## Explicit non-goals

- No Google Apps Script API or Apps Script runtime deployment.
- No Google Sheets or Google Drive as the application database/file store.
- No SQLite persistence on Vercel.
- No public storage for slips or private catalog media.
- No new paid plan, live data initialization, production deployment, or live payment processing without explicit approval.
