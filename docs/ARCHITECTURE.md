# Nobi Topup — Target Architecture

Status: architecture baseline only. Not production-ready and does not authorize deployment.

## Safety and scope
- Develop only on vercel-drive-setup. Never modify main.
- Do not deploy Vercel or publish a GAS Web App without separate approval.
- Use the existing GitHub and Google accounts only.
- Start with an empty database. No SQLite or upload migration is required.
- Never commit credentials, tokens, customer data, real slips, spreadsheet IDs or Drive folder IDs.
- Keep Sheets, Drive folders and uploaded files private.

## Target runtime
Browser → Vercel static pages and Express API → server-side Apps Script client → Apps Script HTTP gateway → Google Sheets and private Google Drive.

The browser must call only same-origin Vercel routes. It must never call google.script.run, the Apps Script URL, Sheets or Drive directly.

## Component responsibilities

### Browser
- Renders storefront and Admin.
- Calls same-origin /api routes.
- Sends slip images as multipart uploads.
- Never stores auth tokens in localStorage or sessionStorage.
- Never receives Google resource IDs, shared secrets, password hashes, token hashes or public Drive URLs.

### Vercel / Express
- Serves HTML and static assets.
- Owns browser-facing routes, cookies, CSRF/origin checks, rate limits, request validation and error mapping.
- Owns separate Admin and Member browser sessions.
- Stores only hashes of random opaque session tokens.
- Calls Apps Script through one server-side client module.
- Calculates PromptPay QR using the existing Node dependency.
- Proxies private slip access only after Admin authorization.
- Does not depend on local durable files, SQLite or local upload folders.

### Google Apps Script
- Sole application component allowed to access Sheets and Drive.
- Accepts signed server-to-server JSON requests from Vercel only.
- Uses a fixed action allowlist; never dispatches arbitrary function names from client input.
- Revalidates critical business rules at the persistence boundary.
- Uses ScriptLock for short critical read-check-write sections.
- Stores uploaded files in a private Drive folder.
- Returns normalized JSON and opaque IDs, never spreadsheet rows or public Drive links.

### Google Sheets and Drive
- Sheets are tables with explicit headers and stable string IDs; do not assume SQL transactions, foreign keys or unique constraints.
- Drive files are private. Sheets store file IDs only.
- Multi-step Sheets + Drive operations require compensating cleanup and reconciliation because they are not one atomic transaction.

## Vercel source layout
Keep server.js as the compatibility entry point and local launcher. Move implementation into modules in small behavior-preserving steps.

- src/app.js — Express composition
- src/config/env.js and constants.js — validated configuration
- src/routes — health, public, auth, member, admin and upload routes
- src/middleware — request ID, validation, rate limits, auth guards, security headers and error handler
- src/clients/apps-script.client.js — only module that calls GAS
- src/services — auth, member, catalog, coupon, order, admin, upload and payment logic
- src/repositories — data access facade
- src/validators — request schemas
- src/utils — errors, crypto, IDs, money, dates and safe logging
- public — existing storefront and Admin pages
- google-apps-script — split GAS source files listed below
- docs — architecture, data model, API contract and implementation plan

## Apps Script source layout
Use separate .gs files in one Apps Script project:
- 00_Config.gs
- 01_HttpEntry.gs
- 02_Auth.gs
- 03_Database.gs
- 04_Repositories.gs
- 05_Catalog.gs
- 06_Coupons.gs
- 07_Orders.gs
- 08_Members.gs
- 09_Admin.gs
- 10_Files.gs
- 11_Validation.gs
- 12_Utilities.gs

Numeric prefixes are for human reading order, not execution order. Apps Script files share a global namespace; avoid duplicate global names.

## Security and correctness rules
- Admin and Member identities and sessions are separate.
- Cookies use HttpOnly, Secure in production and SameSite=Lax; no token in browser storage.
- Store only session token hashes. Enforce expiry and revocation on every protected request.
- Use slow password hashing with per-account salt. Do not ship SHA-256-only password hashing.
- Bootstrap first Admin from a one-time Script Property and delete it after successful initialization. No default password in source.
- Derive client IP only from the verified Vercel platform proxy configuration; never trust a client-supplied IP.
- Admin-only IP history access is audited.
- Server calculates price, discount and totals from stored records. Never trust browser totals or roles.
- Order creation uses an idempotency key. Repeated identical requests must not create another order or Drive file.
- Validate uploaded image signature, MIME type and 5 MB size limit.
- Private slips are returned only through an authorized Vercel proxy.
- Use integer satang for money; avoid floating-point arithmetic.
- Use ISO-8601 UTC timestamps and display in Asia/Bangkok.
- Centralize environment validation, schemas, error codes and logging.
- Bound Apps Script call timeouts. Retry only safe reads or mutations protected by stable idempotency keys.
- Never cache sessions, member data, coupon eligibility, orders or slip content in shared cache.

## Confirmed coupon rules
- everyone: Guest and Member can use, subject to other restrictions.
- member_only: Member only.
- member_game_spend: Member only, with accumulated Completed spend in a selected game meeting the configured threshold.
- Spend uses paid total after discount; Pending, Rejected and Guest orders do not count.
- Coupon redemption game and spend-eligibility game are separate fields.
- Legacy UID allowlist and UID cumulative spend remain additional independent restrictions.
- Recheck eligibility inside locked order creation.
- Coupon reservation/release behavior for Pending and Rejected orders must be decided before implementing the write path.

## Structural readiness gate
Do not start feature migration until the module boundaries, Sheets schema, browser API contract, GAS request contract, authentication boundaries, order/upload invariants and legacy compatibility map are reviewed.
