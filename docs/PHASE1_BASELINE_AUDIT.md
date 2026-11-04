# Phase 1 — Vercel Baseline Audit

Date: 2026-11-04
Branch: `vercel-drive-setup`
Baseline commit inspected: `dfcc6f663b43a89db6f9fabf95845f6b1bfdcac1`

## Scope

This is a read-only baseline and migration map for Phase 1. It does not change runtime behavior, API contracts, frontend behavior, database schema, or deployment configuration. No deployment or Google resource setup is performed.

## Repository baseline

- `server.js`: 27,229 characters; currently owns Express setup, middleware, SQLite schema and seed data, sessions, authentication, coupon validation, upload handling, all API routes, static files, and error handling.
- `package.json`: CommonJS application, Node >=20; start/dev scripts only. No test, lint, or type-check script is currently defined.
- `vercel.json`: Vercel Node function entry is `server.js`; all routes are sent to that handler; `public/**` is included.
- `public/nobitopup.html`: storefront currently calls Apps Script RPC directly for `catalog`, `promotions`, `coupon`, `couponSuggestions`, `paymentInfo`, and `createOrder`.
- `public/admin.html`: Admin UI also calls Apps Script RPC directly. It maps Admin actions to RPC names and stores the Admin token in `sessionStorage`.
- `google-apps-script/Code.gs`: one monolithic GAS file with `doGet()`, an RPC allowlist, Sheets/Drive operations, order/admin logic, and helpers. No `doPost()` JSON gateway is present in the inspected file.
- `.env.example`: contains a literal example Admin password. Replace with a non-secret placeholder before any deployment-oriented work.
- `.gitignore`: ignores `.env`, SQLite data, and uploaded files while retaining `uploads/.gitkeep`.

## Existing Express route inventory

### Public
- `GET /api/health`
- `GET /api/public/catalog`
- `GET /api/public/promotions`
- `GET /api/public/coupons/suggestions`
- `POST /api/public/coupons/validate`
- `GET /api/public/payment-info`
- `POST /api/public/orders` (multipart slip upload)

### Admin
- `POST /api/admin/login`
- `POST /api/admin/logout`
- `GET /api/admin/me`
- `GET /api/admin/dashboard`
- `GET|POST /api/admin/games`; `PUT|DELETE /api/admin/games/:id`
- `GET|POST /api/admin/packages`; `PUT|DELETE /api/admin/packages/:id`
- `GET|POST /api/admin/coupons`; `PUT|DELETE /api/admin/coupons/:id`
- `GET|POST /api/admin/promotions`; `PUT|DELETE /api/admin/promotions/:id`
- `GET /api/admin/orders`
- `PATCH /api/admin/orders/:id/status`
- `POST /api/admin/upload`

### Page routes
- `GET /` serves `public/nobitopup.html`
- `GET /admin` serves `public/admin.html`

## Critical compatibility gaps

1. **Two competing backend paths exist.** Express exposes a REST API, but both HTML frontends currently use Apps Script RPC directly. The browser is not yet using the Express API as the single backend boundary.
2. **The deployed GAS interface is not the planned gateway.** The inspected GAS entry point is `doGet()` + `rpc()`; a server-to-server JSON `doPost()` contract has not been implemented.
3. **The Express storage is not durable on Vercel.** The current server creates SQLite databases and upload/session directories. Its own warning says Vercel `/tmp` is ephemeral. This is not safe for production orders or sessions.
4. **The frontend contracts are not interchangeable yet.** The Admin HTML uses generic RPC actions (`adminList`, `adminUpsert`, `adminDelete`) while Express uses resource-specific REST routes. The storefront RPC payload/response shapes must be mapped before switching clients.
5. **GAS password hashing needs redesign before production.** The inspected helper derives a password hash with a single SHA-256 operation. Do not treat this as a production password-storage design; adopt and benchmark a suitable password KDF before member/admin authentication is migrated.
6. **No automated verification commands exist.** A refactor cannot currently be protected by an existing test suite. Add characterization tests or an equivalent API contract harness before moving route handlers.
7. **Environment example needs cleanup.** The Admin password in `.env.example` must become a placeholder and must never be copied into production environment settings.

## Proposed Phase 1 module extraction order

Keep CommonJS and the existing `server.js` entry point initially to minimize deployment changes.

1. `src/config/paths.js` — root/public/data/upload path resolution only.
2. `src/config/env.js` — environment parsing and required-setting validation.
3. `src/db/sqlite.js` and `src/db/schema.js` — SQLite initialization, schema, and seed data; no schema behavior changes in this extraction.
4. `src/middleware/security.js`, `session.js`, `uploads.js`, `error-handler.js`.
5. `src/services/catalog.service.js`, `coupon.service.js`, `payment.service.js`, `order.service.js`, `admin.service.js`.
6. `src/routes/public.routes.js`, `admin.routes.js`, `page.routes.js`.
7. `src/app.js` — compose middleware/routes and export the Express app.
8. Keep `server.js` as a thin compatibility entry that loads configuration, imports the app, and starts a local listener only when run directly.

Do not replace the legacy GAS business implementation in this phase. The frontend REST migration was completed later as a separate compatibility change; the Express REST API remains the active frontend boundary while the Apps Script gateway is not yet wired.

## Phase 1 acceptance gates

- Existing Express route paths, methods, status codes, JSON shapes, cookie/session settings, and upload constraints remain unchanged during extraction.
- Local start behavior and Vercel handler export behavior remain compatible.
- No frontend calls or visual layout are changed during the initial extraction. A separately approved compatibility change later migrated the storefront and Admin pages to same-origin Express REST; both inline scripts are syntax-checked by CI.
- No production storage is claimed: SQLite and local uploads remain development-only until the durable GAS/Sheets/Drive integration is implemented and verified.
- Add automated smoke/characterization tests for health, public catalog, Admin authentication/session, CRUD, order status, and upload validation before or alongside extraction.
- Validate syntax and module loading after each small extraction; do not perform a bulk rewrite.
- All commits target `vercel-drive-setup`; never write to `main`.

## Recommended immediate next action

Create the characterization-test baseline and extract only configuration/path constants first. Stop and review test results before moving database initialization or route handlers.
