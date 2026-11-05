# Nobi Topup — Target Architecture and Release Boundaries

Status: the user selected a free-first Vercel + Database architecture on 2026-11-05. Target runtime: **Vercel Express + Neon PostgreSQL + Vercel Blob Private**. This is an approved architecture plan, not a statement that the database or Blob store has been provisioned. No production deployment, live database initialization, or live payment processing is authorized.

## Safety and scope

- Develop only on `vercel-drive-setup`. Never modify `main`.
- Keep the existing storefront, Admin UI, same-origin REST paths and response contracts wherever possible.
- Use synthetic records and dummy images only. Do not accept real payments or slips during testing.
- Never commit credentials, tokens, customer data, real slips, database URLs, Blob tokens or private file paths.
- Do not create a Neon account/database or Blob store, set environment variables, enable paid services, or modify Production without separate explicit approval.
- Vercel Hobby is intended for personal/non-commercial use. Verify plan eligibility before commercial launch.

## Target runtime architecture

Browser → Vercel static pages and Express REST API → Neon PostgreSQL + Vercel Blob Private.

The browser calls same-origin Vercel routes only. It never receives database credentials, Blob tokens, password hashes, session-token hashes, or permanent private-file URLs.

### Browser

- Existing storefront: `public/nobitopup.html`.
- Existing Admin: `public/admin.html`.
- Uses same-origin REST routes and multipart image uploads.
- Never stores Admin, Member or checkout tokens in localStorage/sessionStorage.
- Admin-only IP history and slip views remain behind Admin authorization.

### Vercel / Express

- Express owns all browser-facing REST routes, business logic orchestration, HttpOnly cookies, same-origin/CSRF checks, request validation, rate limits and error mapping.
- Production persistence will be PostgreSQL. SQLite may remain only as an isolated local characterization adapter; it must never be used for Vercel/production persistence.
- The current `server.js` still hard-requires `APPS_SCRIPT_URL` and `APPS_SCRIPT_SHARED_SECRET`. Remove this requirement only after the PostgreSQL adapter and migrated business services are complete and tested.
- Use a Node 22-compatible Neon PostgreSQL driver with a transaction-capable connection strategy. Verify connection lifecycle, pool limits and interactive transaction behavior in Vercel Functions.
- PromptPay QR generation remains in the existing Node payment-info service. No live PromptPay credential is configured during testing.
- Vercel local disk is temporary. All persistent uploaded files go to Private Blob.

### Neon PostgreSQL

PostgreSQL is the source of truth for:
- Admin and Member accounts, credential metadata, sessions and login/IP history.
- Games, packages, coupons, coupon eligibility rules, reservations/redemptions and promotions.
- Orders, order state transitions, payment deadlines and idempotency records.
- Admin audit events, shared rate-limit buckets, file metadata and schema migration versions.

Use versioned SQL migrations, foreign keys, unique/check constraints and indexes. Persist money as integer satang and timestamps in UTC. Interpret date-only coupon expiry in Asia/Bangkok.

Use real database transactions and row-level locks for coupon capacity reservation and order transitions. Use unique idempotency constraints for order creation and slip submission. Use atomic upserts for shared rate limiting. Do not depend on process-local memory for shared correctness.

### Vercel Blob Private

- Create a **Private** Blob store only; never use Public access for slips or private catalog media.
- Store slips and product/promotion media in separate logical prefixes.
- Store pathname, content type, byte size, checksum, owner/reference and lifecycle metadata in PostgreSQL. Do not persist or expose public URLs.
- All reads pass through Express. Slip reads require Admin authorization and audit logging. Catalog media reads require an active package/promotion reference.
- Preserve PNG/JPEG/WebP validation, full decode/re-encode, and the 3 MB application limit unless a separately tested change is approved.
- Implement safe retry behavior and orphan-file cleanup. Do not delete referenced files during retries.

## Security and correctness invariants

- Admin and Member identities and sessions are separate. Cookies are HttpOnly, Secure in production and SameSite=Strict.
- Store only hashes of opaque session tokens. Enforce 8-hour maximum lifetime and 30-minute idle timeout; revoke on logout, password change or account suspension.
- Preserve PBKDF2-SHA256 password hashing with per-account salts unless a separately reviewed migration is approved.
- Admin-only IP history and sensitive slip access are audited. Login/IP history and Admin audit records retain 90 days, then delete or irreversibly anonymize.
- Derive client IP only from the trusted Vercel proxy configuration; never trust a client-supplied IP header without validation.
- Server calculates package price, discounts, totals and coupon eligibility from persisted records. Browser values are never authoritative.
- Order creation requires an idempotency key. Identical retries cannot create duplicate orders or coupon reservations.
- Payment deadline is enforced by the server/database on order creation and slip submission. A slip accepted before the deadline may be reviewed and completed afterward.
- Orders without a coupon or using a non-expiring coupon have 15 minutes to pay and upload a slip.
- Orders using an expiring coupon remain payable through the end of that expiry date in Asia/Bangkok, without an additional 15-minute cap.
- Coupon capacity is Reserved on Pending, Consumed on Completed, and released on Rejected/Expired.
- Only Completed orders count toward Member/UID cumulative spend, after discount. Pending, Rejected, Expired and Guest orders do not count.
- Never cache sessions, Member data, coupon eligibility, orders or slip content in a shared cache.

## Confirmed coupon rules

- `public`: Guest and Member may use, subject to other restrictions.
- `member_only`: authenticated Active Member only.
- `member_game_spend`: Active Member whose Completed, post-discount spend in the configured qualifying game reaches the threshold.
- UID allowlist and UID cumulative Completed spend in the selected checkout game are independent additional restrictions.
- Coupon usage limits count Reserved and Consumed redemptions.

## Legacy source boundary

- `google-apps-script/`, `docs/GOOGLE_APPS_SCRIPT_SETUP.md` and `docs/VERCEL_GOOGLE_SETUP.md` describe the superseded architecture.
- Treat Apps Script/Sheets/Drive code as migration reference until equivalent PostgreSQL/Blob behavior is implemented and tested.
- Do not deploy Apps Script, initialize Sheets, create Drive folders, or set Apps Script secrets as part of the new plan.
- Remove obsolete GAS modules and gateway dependencies only after the migration matrix confirms that every required behavior has a tested replacement.

## Release gates

1. Complete a read-only mapping of every GAS/SQLite operation, field, route, frontend caller and test.
2. Implement PostgreSQL migrations, repositories, transaction helpers and disposable synthetic test fixtures.
3. Port catalog, coupon, order, payment, Admin and Member business logic without breaking REST contracts.
4. Verify concurrency, idempotency, coupon reservations, order deadlines, authentication, rate limits and session revocation across multiple simulated instances.
5. Verify Private Blob upload, Admin-only slip reads, reference-checked media reads, token secrecy and orphan cleanup.
6. Run full storefront/Admin browser tests on synthetic Preview data.
7. Review quotas, connection lifecycle, Vercel function duration/body limits, backups/restore, privacy and cost controls.
8. Obtain separate explicit authorization before Production deployment, domain changes, real payment credentials or live order acceptance.
