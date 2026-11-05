# Nobi Topup — Current Architecture and Release Boundaries

Status: the source implementation on `vercel-drive-setup` is integrated and covered by Node/GitHub Actions tests. It is **not production-ready** until Apps Script runtime, quota, concurrency and browser/device end-to-end verification pass. No deployment or live database initialization is authorized.

## Safety and scope

- Develop only on `vercel-drive-setup`. Never modify `main`.
- Use the user's existing GitHub and Google accounts; do not require a new paid service.
- Keep the Sheets spreadsheet, Drive folders and uploaded files private.
- Never commit credentials, tokens, customer data, real slips, spreadsheet IDs or Drive folder IDs.
- Use synthetic records and dummy images for tests. Do not accept real payments or slips during verification.

## Runtime architecture

Browser → Vercel static pages and Express API → signed server-side Apps Script client → Apps Script HTTP gateway → Google Sheets and private Google Drive.

The browser calls same-origin Vercel routes only. It never calls `google.script.run`, the Apps Script URL, Sheets or Drive directly.

### Browser

- Existing storefront: `public/nobitopup.html`.
- Existing Admin: `public/admin.html`.
- Uses same-origin REST routes and multipart image uploads.
- Never stores Admin, Member or checkout tokens in localStorage/sessionStorage.
- Receives no Google shared secret, password hash, session-token hash or direct Drive URL.
- Admin-only IP history and slip views are available only behind Admin authorization.

### Vercel / Express

- `server.js` composes the current production gateway routes and the isolated local SQLite characterization fallback.
- In production/Vercel, both `APPS_SCRIPT_URL` and `APPS_SCRIPT_SHARED_SECRET` are mandatory. If absent, startup fails rather than falling back to SQLite or local durable uploads.
- `src/clients/apps-script.client.js` is the only server-side Apps Script transport. It signs each request, enforces bounded timeouts, validates response envelopes and trusted ContentService redirects, and does not retry mutations automatically.
- Express owns browser-facing routes, HttpOnly cookies, same-origin/CSRF checks, request validation, first-layer rate limits and error mapping.
- Vercel local upload directories are temporary staging only. Images are fully decoded/re-encoded and limited to 3 MB; final files are stored in private Drive.
- PromptPay QR generation remains in the existing Node payment-info service.
- SQLite is for local development/characterization only, not production persistence.

### Google Apps Script

- Sole application component allowed to access Sheets and Drive.
- Accepts signed server-to-server JSON requests only; fixed action allowlist, HMAC-SHA256 signature, ±5-minute timestamp freshness and nonce replay protection.
- Schema v1 business modules use schema-aware repository primitives with exact header checks, allowed fields, immutable primary keys, uniqueness checks and ScriptLock-protected writes.
- Revalidates identity, prices, coupon eligibility, order deadlines and upload permissions at the persistence boundary.
- Admin/Member passwords use PBKDF2-SHA256 (120,000 iterations) with per-account salts. This still requires a real Apps Script runtime benchmark.
- Admin and Member sessions are separate, opaque, token-hash-only records with 8-hour maximum lifetime and 30-minute idle timeout.
- Shared abuse controls use HMAC-keyed Sheets rate-limit buckets; raw IP/login identifiers are not written to that ledger.
- Multi-step Sheets/Drive operations use compensating cleanup because Sheets has no SQL transaction.

### Google Sheets and Drive

- Sheets schema v1 is declared in `google-apps-script/00_Config.gs`; headers are exact and versioned.
- Sheets are not SQL: no relational transactions, foreign keys or native unique constraints. Application-level checks and ScriptLock serialize critical sections.
- Orders, idempotency records, coupon reservations, Admin audit logs, Member login/IP history, sessions and shared rate limits are separate tables.
- Slips live in the configured private slip folder. Product/promotion media live in the configured private media folder.
- Files remain private in Drive. Storefront-visible images are delivered only through a Vercel proxy after verifying an active package/promotion reference, file privacy and configured folder membership.
- Private slips are returned only through an authenticated Admin proxy after checking the configured private slip folder.

## Current Apps Script source layout

- `00_Config.gs` — schema v1, session/upload constants.
- `01_HttpEntry.gs` — explicit signed-HTTP action dispatcher.
- `02_Database.gs` — non-destructive, versioned Sheets setup and guarded legacy helpers.
- `03_Catalog.gs` — public catalog and promotion reads.
- `04_Coupons.gs` — Guest/Member/UID/game eligibility and expiry rules.
- `05_Payments.gs` — payment configuration boundary.
- `06_Orders.gs` — idempotent order creation, coupon reservation, deadlines, slip upload and expiry.
- `07_Auth.gs` — Admin/Member registration, login, sessions and password changes.
- `08_Admin.gs` — Admin dashboard, order/member controls, CRUD, audit and private Drive proxy.
- `09_Validation.gs` — schema v1 business-record validation.
- `10_Utilities.gs` — hashing, rate limits, retention, money and shared helpers.
- `11_Repositories.gs` — schema-aware Sheets repository primitives.
- `13_HttpGateway.gs` — signed POST verification, nonce replay protection and response envelope.
- `Code.gs` — minimal HTTP entry/liveness boundary.

Apps Script files share a global namespace; numeric prefixes are for human reading only, not execution order.

## Security and correctness invariants

- Admin and Member identities and sessions are separate. Cookies are HttpOnly, Secure in production and SameSite=Strict.
- Store only hashes of opaque session tokens. Re-read and validate session/account state while holding ScriptLock before refreshing last-seen.
- Logout, password changes, account suspension and auth-version changes revoke existing sessions.
- Bootstrap the first Admin from one-time Script Properties; delete the bootstrap password after initialization. No default credential is stored in source.
- Derive source IP from the Vercel proxy configuration; Apps Script rejects missing source IP and never trusts a client-supplied IP.
- Admin-only IP history and slip views are audited.
- Server calculates price, discount, totals and coupon eligibility from persisted records. Browser values are never authoritative.
- Order creation requires an idempotency key. Repeating an identical request cannot create a second order or coupon reservation.
- Payment deadline is enforced on order creation, slip submission and Admin completion.
- A Pending order with a slip accepted before the deadline may be completed after the deadline. Without an accepted slip before the deadline, it expires and releases its Reserved coupon capacity.
- Uploads accept PNG/JPEG/WebP only, are fully decoded/re-encoded in Vercel staging and capped at 3 MB; Apps Script independently checks signatures and size.
- Store all images/slips in private Drive folders; public media access is only through the reference-checked application proxy.
- Use integer satang for persisted money and ISO-8601 UTC timestamps; interpret coupon date-only expiry in Asia/Bangkok.
- Never cache sessions, Member data, coupon eligibility, orders or slip content in shared cache.

## Confirmed coupon rules

- `public`: Guest and Member may use, subject to other restrictions.
- `member_only`: authenticated Active Member only.
- `member_game_spend`: Active Member whose Completed, post-discount spend in the configured qualifying game reaches the threshold.
- UID allowlist and UID cumulative Completed spend in the selected checkout game are independent additional restrictions.
- Pending, Rejected, Expired and Guest orders do not count toward Member or UID cumulative spend.
- Coupon usage limits count Reserved and Consumed redemptions.
- Reservation occurs on Pending; consumption on Completed; release on Rejected/Expired.
- A coupon with an expiry date remains payable through the end of that date in Thailand; orders without an expiry date use a 15-minute payment window.

## Remaining release gates

- Import all source files into a real Apps Script project and verify syntax/runtime behavior.
- Benchmark PBKDF2 and Apps Script execution/quota usage.
- Test bad signatures, stale timestamps, nonce replay, invalid actions and concurrent nonce claims.
- Test concurrent order/coupon claims, idempotency, slip retries, deadlines and Admin status transitions.
- Verify private folder/file permissions and reference-checked media with synthetic Drive files.
- Run full storefront/Admin browser and device end-to-end tests against a synthetic deployment.
- Verify Vercel function duration and payload limits.
- Do not run `setupNobiDatabase()`, `initializeAdmin()`, publish the Apps Script Web App or deploy Vercel until the release gates pass and the user explicitly authorizes those actions.
