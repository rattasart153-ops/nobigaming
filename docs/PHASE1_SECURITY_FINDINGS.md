# Phase 1 — Security Findings Register

Status: findings recorded during read-only review and structural refactoring. This register is not a production approval.

## S-01 — Uploaded files are publicly addressable

- Severity: High
- Evidence: Express mounts the entire upload directory at `/uploads` using `express.static`; order creation stores slip paths under that same prefix.
- Impact: A person who obtains or guesses a slip URL may retrieve a payment slip without Admin authentication. The same public mount is also used by the storefront/Admin for uploaded images.
- Current action: Recorded; the static mount is intentionally unchanged during behavior-preserving Phase 1 extraction.
- Required remediation: Move payment slips to private Drive storage and serve them only through an authenticated, authorization-checked Admin endpoint. Separate public marketing images from private order evidence. Verify that old slip paths are not exposed by any public route.
- Release gate: Must be closed before production orders are enabled.

## S-02 — Upload validation trusts the supplied MIME type

- Severity: Medium
- Evidence: Multer's file filter checks `file.mimetype` and derives the stored extension from `file.originalname`; it does not inspect file signatures or decode the image.
- Impact: A client can label non-image content as PNG/JPEG/WebP. MIME and extension checks alone do not prove that the uploaded bytes are a safe image.
- Current action: CI covers rejection of an explicitly unsupported MIME type; it does not yet cover spoofed MIME or malformed image bytes.
- Required remediation: Inspect file signatures and decode/re-encode supported images before storage; enforce size and pixel/dimension limits. Add spoofed-MIME and malformed-image tests.

## S-03 — Session and application data use local SQLite files

- Severity: Critical for Vercel production persistence
- Evidence: The application stores its SQLite database and connect-sqlite3 session store under the configured local data directory. On Vercel, the path resolves under `/tmp`.
- Impact: Vercel instance replacement or scaling can lose or split orders, sessions, and database state. The existing startup warning correctly identifies this as ephemeral storage.
- Current action: Warning retained; SQLite is kept only as the characterization baseline.
- Required remediation: Complete the Apps Script/Sheets persistence adapter and private Drive file storage, then run concurrency, idempotency, quota, and recovery tests before any production use.

## S-04 — Login rate limiting is process-local

- Severity: Medium
- Evidence: `express-rate-limit` uses its default in-memory store.
- Impact: Counters are not shared between serverless instances and can reset when an instance is replaced.
- Required remediation: Use a shared store or enforce rate limits at a trusted edge/shared backend. Test multi-instance behavior.

## S-05 — Cookie-authenticated mutation routes lack explicit CSRF tokens

- Severity: High
- Evidence: Admin mutation routes rely on the session cookie and do not implement a CSRF token/origin validation layer.
- Impact: SameSite=Lax is useful defense-in-depth but should not be treated as the only CSRF control for all deployment/browser flows.
- Required remediation: Add origin/host validation and a CSRF strategy appropriate to the same-origin frontend; test cross-site mutation attempts.

## S-06 — Development Admin bootstrap has a known fallback password

- Severity: Medium; high if a deployment is misconfigured as non-production
- Evidence: When `NODE_ENV` is not `production` and Admin variables are absent, the SQLite bootstrap uses a fixed development username/password fallback.
- Impact: A deployment with an incorrect environment mode could create a predictable Admin credential.
- Current action: `.env.example` no longer advertises the fallback password; runtime behavior is not changed in this compatibility phase.
- Required remediation: Remove fixed credential fallbacks and require explicit one-time bootstrap credentials in every environment; never commit or log them.

## S-07 — Content Security Policy is disabled

- Severity: Medium
- Evidence: Helmet is configured with `contentSecurityPolicy: false`; cross-origin embedder policy is also disabled.
- Impact: CSP does not provide a browser-side mitigation layer for injected script/content. COEP may be disabled for compatibility but should be justified.
- Required remediation: Inventory inline scripts, external assets, and payment QR rendering; introduce a tested CSP in report-only mode before enforcement.


## S-08 — Multer 1.x dependency is deprecated and has known security advisories

- Status: Remediated in source; keep under dependency monitoring.
- Evidence: `package.json` permits Multer 1.x (`^1.4.5-lts.1`); the CI install log resolved a 1.x LTS build and npm warned that Multer 1.x is affected by vulnerabilities patched in 2.x.
- Impact: The upload parser is part of a public order-submission route and an Admin upload route, so parser vulnerabilities can expose the application to denial-of-service or other upload-handling risks.
- Remediation: Upgraded the dependency range to Multer `^2.5.0` and added multipart limits for one file, ten fields, twelve total parts, and nesting depth one. Valid synthetic PNG, unsupported MIME, and oversized-file cases are included in CI.
- Verification: Multer upgrade CI run `41790235366` and multipart-limits CI run `41790242496` passed. The expanded oversized-upload test run `41790264334` also passed.
- Ongoing requirement: Monitor upstream advisories and keep the patched version range current.

## Phase 1 scope note

The Phase 1 changes are structural extractions and characterization tests. The findings above are deliberately not silently “fixed” by changing existing frontend contracts. They remain explicit blockers or follow-up requirements for the storage, authentication, and release phases.
