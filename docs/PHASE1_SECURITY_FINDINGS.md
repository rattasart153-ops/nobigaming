# Phase 1 — Security Findings Register

Status: findings recorded during structural refactoring and security hardening. This register is not a production approval.

## S-01 — Uploaded files are publicly addressable

- Status: Private Drive storage and application-proxy delivery are implemented in Phase 2 source; real Apps Script/Drive runtime verification remains open.
- Severity: High before mitigation; still a production blocker until Drive permissions and proxy access are verified in a synthetic Google deployment.
- Evidence: The previous Express build mounted the whole upload directory at `/uploads` and stored slips under that public path.
- Remediation in current branch: Public marketing images are stored under a dedicated public subdirectory. Checkout slips are stored in a separate private directory that is not mounted by `express.static`. Admin order lists expose only `has_slip`, never the filesystem path; `GET /api/admin/orders/:id/slip` streams the file only after Admin authentication and sets `Cache-Control: private, no-store` and `X-Content-Type-Options: nosniff`. Legacy `/uploads/<filename>` slip paths are resolvable only through the authenticated endpoint; the old root upload directory is no longer publicly mounted.
- Verification: CI checks that unauthenticated slip access returns 401, authenticated access returns the image, and the same filename is unavailable under `/uploads/`.
- Phase 2 source remediation: Slips and uploaded catalog/promotion media are stored in private Drive folders. Admin slip retrieval and storefront media delivery use authenticated/reference-checked application proxies; Drive files remain private.
- Remaining release gate: Verify actual Drive folder/file ACLs, parent-folder ownership, upload limits and proxy authorization in a synthetic Apps Script deployment. No deployment is authorized.

## S-02 — Upload validation trusts the supplied MIME type

- Status: Mitigated in the Express baseline; durable private Drive storage remains a production release gate.
- Severity: Medium.
- Evidence: The previous upload handler trusted the client-supplied MIME type and original filename extension.
- Remediation in current branch: Stored extensions are selected from the allowed MIME type, then the first bytes are checked against PNG/JPEG/WebP signatures. A mismatch is rejected with HTTP 415 and the uploaded file is deleted. The same validator is applied to checkout slips and Admin media uploads.
- Verification: CI includes a forged PNG MIME upload and verifies the rejected file is removed.
- Additional remediation: Sharp now fully decodes and re-encodes PNG/JPEG/WebP uploads, checks the decoded format against the declared MIME type, strips source metadata through re-encoding, rejects animation/multiple pages, limits the longest edge to 8,192 pixels and total pixels to 25 megapixels, and rejects processed output above 5 MB. Decode failures and malformed/truncated images are rejected and removed. CI covers a truncated file with a valid signature and an over-dimension image.

## S-03 — Session and application data use local SQLite files

- Severity: Critical for Vercel production persistence.
- Evidence: The original baseline stored SQLite data and sessions under the local data directory, which is ephemeral on Vercel.
- Impact: Instance replacement or scaling could lose or split orders, sessions and database state.
- Phase 2 source remediation: Vercel production mode now uses the signed Apps Script gateway and refuses SQLite fallback; Apps Script repositories use versioned Google Sheets for durable records and private Drive for files.
- Remaining release gate: Import and run the Apps Script project, then test concurrency, idempotency, quotas, backups/recovery and failure behavior against synthetic Google resources. The SQLite implementation remains only as a local characterization baseline.

## S-04 — Login rate limiting is process-local

- Severity: Medium.
- Evidence: `express-rate-limit` still uses a process-local in-memory first layer.
- Impact: That first layer is not shared between Vercel serverless instances and can reset when an instance is replaced.
- Phase 2 source remediation: A shared HMAC-keyed Sheets ledger guarded by Apps Script ScriptLock now enforces cross-instance Admin/Member login and registration thresholds. The process-local limiter is only an additional first layer.
- Remaining release gate: Load-test parallel attempts across simulated instances and measure lock contention, Sheet operations, Apps Script quotas and fail-closed behavior before production.

## S-05 — Cookie-authenticated mutation routes lack explicit CSRF tokens

- Status: Mitigated for browser-based Express Admin mutations by strict Origin checks; token-based CSRF remains a possible defense-in-depth improvement.
- Evidence: Admin API mutations previously relied on the session cookie alone.
- Remediation in current branch: Every unsafe Admin API method now requires an Origin header matching the request origin, and requests marked `Sec-Fetch-Site: cross-site` are rejected. Missing, malformed, and foreign Origin values are rejected before route handlers run.
- Verification: CI covers foreign Origin, missing Origin, and cross-site Fetch Metadata; same-origin Admin mutations continue to pass.
- Limitation: Non-browser clients must send the correct Origin header. Do not weaken this guard for convenience.

## S-06 — Development Admin bootstrap has a known fallback password

- Status: Remediated in current branch.
- Evidence: Earlier development mode supplied a fixed Admin username/password when environment variables were missing.
- Remediation: Removed both fallbacks. Startup now requires explicit `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and `SESSION_SECRET` in every environment. The Admin login form no longer pre-fills a username, and README setup instructions explain the required configuration.
- Verification: The API test harness supplies isolated credentials and still starts successfully. Negative startup tests confirm missing `SESSION_SECRET` and missing Admin credentials both fail closed (CI run `41792343333`).

## S-07 — Content Security Policy is disabled

- Status: Report-Only policy added; enforcement remains open.
- Evidence: The previous Helmet configuration disabled CSP entirely.
- Remediation in current branch: Helmet now emits a Content-Security-Policy-Report-Only header with an initial policy allowing the current inline scripts/styles, Google Fonts, required Google Apps Script origins, data images, and HTTPS images. This is intentionally report-only to avoid breaking the existing Apps Script-hosted frontend before its resource inventory is complete.
- Verification: CI asserts the report-only header is present.
- Remaining work: Review browser reports after frontend migration, remove unsafe-inline where possible, then enforce a restrictive policy. COEP remains disabled for compatibility and must be reviewed separately.

## S-08 — Multer 1.x dependency is deprecated and has known security advisories

- Status: Remediated in source; keep under dependency monitoring.
- Evidence: The prior dependency range permitted Multer 1.x.
- Remediation: Upgraded the dependency range to Multer `^2.5.0` and added multipart limits for one file, ten fields, twelve total parts, and nesting depth one.
- Verification: Multer upgrade CI run `41790235366`, multipart-limits run `41790242496`, and expanded oversized-upload run `41790264334` passed.
- Ongoing requirement: Monitor upstream advisories and keep the patched version range current.

## S-09 — Rejected checkout requests could leave orphaned uploaded files

- Status: Remediated in source and covered by CI.
- Evidence: Multer writes the uploaded file before the order handler validates the selected game/package, player UID, and coupon.
- Impact: Repeated invalid submissions could consume upload disk quota and leave unnecessary payment-related files behind.
- Remediation: The public order route removes the uploaded file when game/package or player validation fails; the order service removes it when coupon validation or database insertion fails.
- Verification: CI runs `41790497080` and `41790533090` passed with synthetic upload tests confirming cleanup for invalid game, player, and coupon submissions.

## S-10 — Public and private uploads shared one directory

- Status: Remediated in current Express baseline.
- Evidence: Admin marketing media and customer payment slips previously shared the same directory and static mount.
- Remediation: Public Admin uploads now use `uploads/public`; payment slips use a separately configured private directory (`NOBI_PRIVATE_SLIP_DIR`, defaulting to `DATA_DIR/private-slips`). Only the public subdirectory is mounted at `/uploads`.
- Verification: CI verifies private slip files cannot be fetched from the public upload route and can be retrieved only through the Admin-protected slip endpoint.
- Phase 2 source remediation: Uploaded marketing/catalog/promotion assets are stored in private Drive and exposed only through a reference-checked application media proxy; Drive sharing is not made public.
- Remaining release gate: Verify private ACLs, cross-folder reference rejection and proxy behavior using synthetic Drive files in the real Apps Script runtime.

## Phase 1 scope note — historical baseline

This paragraph records the state at the close of Phase 1 and is superseded by the Phase 2 implementation status above. Phase 1 alone did not include durable Sheets/Drive persistence or a signed gateway connection. Phase 2 has since implemented those integrations in source, but actual Apps Script runtime, Google permissions, concurrency, quota and browser/device verification remain release gates. Do not enable production orders until those gates pass.


## Confirmed Phase 1 policy decisions (2026-11-04)

The user has approved the following target policies:
- Member Login ID: ASCII English letters and digits only, 4–30 characters, case-insensitive (`^[A-Za-z0-9]{4,30}$`).
- Member login/IP history and Admin audit logs: retain for 90 days, then delete or irreversibly anonymize.
- Admin and Member sessions: maximum lifetime 8 hours, idle timeout 30 minutes, revoke on logout or password change.

These decisions close the policy-confirmation blocker for Phase 1. They do not mean that Member authentication, durable session enforcement, or scheduled log-retention enforcement has already been implemented; those belong to later implementation phases. Phase 1 acceptance remains subject to final branch and CI verification. No deployment is authorized.
