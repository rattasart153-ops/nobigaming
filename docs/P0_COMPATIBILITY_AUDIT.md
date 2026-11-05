# Nobi Topup — P0 Compatibility Audit

Date: 2026-11-05  
Repository: `rattasart153-ops/nobigaming`  
Audited branch: `vercel-drive-setup`  
Audit mode: source-level/read-only inspection, with documentation and CI consistency corrections only  
Target: Apps Script HtmlService + Google Sheets + private Google Drive  
Production / Google resource creation / initialization / deployment: **not authorized**

## 1. Executive result

**P0 is not complete. The project is not ready for deployment or live use.**

The approved target architecture is documented, but the checked-in source is still a mixed transitional implementation:

- Browser pages call same-origin Express REST endpoints.
- Express gateway routes call the Apps Script signed HTTP gateway.
- Apps Script `doPost()` verifies signed requests and dispatches business actions.
- Apps Script `doGet()` currently returns JSON health/service metadata, not an HtmlService page.
- No `google.script.run` browser facade is currently exposed.
- No Apps Script HTML templates or HtmlService routing files are present in the repository tree.
- Apps Script/Sheets/Drive behavior has only been exercised by Node VM mocks and unit tests; it has not been verified in Google's real runtime.

This is a source compatibility gap, not permission to change the approved architecture. P1 must implement the HtmlService host and explicit callable facade while preserving all current business rules.

## 2. Branch and CI baseline

- Current branch HEAD at audit start: `aa00179aa0d5cc46168809ae4e690100d686ce83`.
- `main` → `vercel-drive-setup` comparison: ahead 497, behind 0; common base `b51b682b99e6e1dc06b949078e72402251683bb0`.
- Repository default branch is `main`; all changes in this audit were explicitly directed to `vercel-drive-setup`.
- Last CI run observed before audit: run `42000316537`, conclusion `success`, on the pre-audit HEAD.
- Project `package.json` requires Node `>=22 <23`, while the workflow selected Node 20. This was corrected to Node 22 on `vercel-drive-setup`; the new workflow run must still be observed before treating the correction as verified.

## 3. Verified source inventory

### Frontend

| File | Current transport | Confirmed behavior |
|---|---|---|
| `public/nobitopup.html` | HTTP `fetch()` | Public catalog/promotions, coupon validate/suggestions, payment info, create order, upload slip, member register/login/me/logout/password |
| `public/admin.html` | HTTP `fetch()` | Admin login/logout/me/dashboard, games/packages/coupons/promotions CRUD, orders, status changes, members/IP logs, private slip binary retrieval, multipart media upload |

Both pages currently use `credentials: 'same-origin'` for REST calls. The Admin uses cookie-session assumptions and binary slip retrieval; the storefront uses a two-request checkout (create Pending order, then submit slip) and browser session storage for retry state. These contracts must be preserved or explicitly adapted during the HtmlService migration.

### Express REST route inventory

| Route family | Current source | Backend behavior |
|---|---|---|
| `GET /api/health` | `src/routes/gateway-public.routes.js` | Health/storage status |
| `GET /api/public/catalog`, `/promotions` | `gateway-public.routes.js` | GAS catalog/promotions actions |
| `GET /api/public/coupons/suggestions`, `POST /api/public/coupons/validate` | `gateway-public.routes.js` | GAS coupon actions |
| `GET /api/public/payment-info` | `gateway-public.routes.js` | GAS paymentInfo action |
| `POST /api/public/orders`, `POST /api/public/orders/:id/slip` | `gateway-public.routes.js` | GAS createOrder/submitOrderSlip; multipart upload converted for gateway |
| `GET /api/public/media/:id` | `gateway-public.routes.js` | GAS publicMediaData |
| `POST /api/member/register|login|logout|password`, `GET /api/member/me` | `gateway-public.routes.js` | GAS member authentication/session actions |
| `POST /api/admin/login|logout|password`, `GET /api/admin/me|dashboard|orders`, `GET /api/admin/orders/:id/slip`, `PATCH /api/admin/orders/:id/status` | `src/routes/gateway-admin.routes.js` | GAS Admin authentication, orders and slip actions |
| `GET|POST|PUT|DELETE /api/admin/{games,packages,coupons,promotions}` | `gateway-admin.routes.js` | GAS adminList/adminUpsert/adminDelete |
| `GET /api/admin/members`, `PATCH /api/admin/members/:id/status`, `GET /api/admin/member-login-logs` | `gateway-admin.routes.js` | GAS member administration actions |
| `POST /api/admin/upload` | `gateway-admin.routes.js` | GAS private media storage |

The legacy local-SQLite route modules remain in `src/routes/public.routes.js` and `src/routes/admin.routes.js`; the current server composition and environment mode must continue to fail closed rather than silently falling back to SQLite for the approved target.

### Apps Script source inventory

| File | Responsibility | P0 finding |
|---|---|---|
| `00_Config.gs` | Schema v1, sheet headers, session/log/upload constants | Present |
| `01_HttpEntry.gs` | Explicit action dispatcher | Dispatcher exists; it is not a browser facade |
| `02_Database.gs` | Spreadsheet setup/schema validation | Present; real Sheets behavior unverified |
| `03_Catalog.gs` | Catalog/promotions | Present |
| `04_Coupons.gs` | Coupon eligibility and suggestions | Present; business tests use mocks |
| `05_Payments.gs` | PromptPay response | **Stub: returns configured=false even if PromptPay ID exists** |
| `06_Orders.gs` | Order creation, deadlines, slips, idempotency | Present; real Drive/Sheets behavior unverified |
| `07_Auth.gs` | Admin/member auth and sessions | Present; PBKDF2 performance unverified in Apps Script |
| `08_Admin.gs` | Admin CRUD, audit, private files | Present; real Drive ACLs unverified |
| `09_Validation.gs` | Record validation | Present |
| `10_Utilities.gs` | Hashing, money, retention, rate limits | Present; runtime/performance unverified |
| `11_Repositories.gs` | Sheets repositories | Present; Sheets atomicity/concurrency unverified |
| `12_Seed.gs` | Default catalog seed | Present; must only run on an explicitly authorized synthetic database |
| `13_HttpGateway.gs` | Signed HTTP `doPost()` gateway | Present; target browser transport is not this gateway |
| `Code.gs` | Web entry point | **`doGet()` returns JSON via ContentService; it does not render HtmlService** |
| `appsscript.json` | V8 manifest, Asia/Bangkok | Present; no HtmlService templates are referenced |

### Current GAS action dispatcher

`01_HttpEntry.gs` dispatches:  
`catalog`, `promotions`, `coupon`, `couponSuggestions`, `paymentInfo`, `createOrder`, `submitOrderSlip`, `adminLogin`, `memberRegister`, `memberLogin`, `memberMe`, `memberLogout`, `memberChangePassword`, `adminChangePassword`, `adminMe`, `adminLogout`, `adminDashboard`, `adminOrders`, `adminSlipData`, `adminSetOrderStatus`, `adminList`, `adminUpsert`, `adminDelete`, `adminMemberLoginLogs`, `adminMembers`, `adminSetMemberStatus`, `adminStoreMedia`, `publicMediaData`.

This dispatcher can be reused behind a narrower typed facade, but must not be exposed as a generic unrestricted browser entry point. The facade must validate argument shape, authentication and authorization per action.

## 4. P0 blockers and defects found

| ID | Severity | Finding | Required action |
|---|---|---|---|
| P0-01 | Critical | GAS `doGet()` returns JSON; no HtmlService renderer or HTML template files exist | P1: implement HtmlService entry and template routing |
| P0-02 | Critical | Current HTML pages call Express REST, not `google.script.run`; they cannot run as the approved standalone HtmlService app | P1/P2: implement facade then frontend adapter |
| P0-03 | Critical | `01_HttpEntry.gs` dispatcher is invoked through signed `doPost()`; no browser-callable facade exists | P1: add allowlisted facade; do not expose arbitrary table/action dispatch |
| P0-04 | High | `paymentInfo_()` is an explicit stub and never returns a QR even when PromptPay is configured | P1/P2: implement compatible PromptPay QR generation without a paid service; test payload/amount correctness before real payment |
| P0-05 | High | Existing Admin slip and media paths transfer base64 data through Apps Script actions | P1/P3: design bounded upload/download and memory-safe limits; preserve 3 MB upload cap and private Drive access |
| P0-06 | High | Current frontend/Admin session model assumes Express same-origin cookie sessions; GAS business handlers issue opaque tokens | P1/P2: define secure HtmlService session transport, token lifecycle and XSS protections before switching |
| P0-07 | High | Sheets has no relational transaction; order + coupon redemption + idempotency rows require recovery after partial writes | P3/P4: test fault injection, recovery and lock contention in actual Apps Script runtime |
| P0-08 | High | PBKDF2-SHA256 120,000 iteration implementation has only reference/unit coverage; runtime cost unknown | P3: benchmark login latency and execution quotas; do not weaken to SHA-256-only |
| P0-09 | High | Private Drive access checks and folder boundaries are not verified against real Drive ACLs | P3/P4: test owner, parent-folder sharing, file sharing, cross-folder IDs and authenticated reads |
| P0-10 | Medium | Frontend API inventory contained a false statement that the current HTML already used GAS RPC; implementation plan contained a cancelled PostgreSQL decision in a section labelled as superseding the Apps Script target | Corrected in this P0 pass; keep historical notes explicitly labelled |
| P0-11 | Medium | CI used Node 20 while package.json declares Node 22 only | Corrected workflow to Node 22; await new CI result |

## 5. Business invariants that must not change

- Guest checkout remains enabled.
- Member Login ID: ASCII letters/digits, 4–30 characters, case-insensitive.
- Coupons remain public, member-only and member-game-spend; UID allowlist and UID cumulative spend remain separate restrictions.
- Only Completed Member orders after discount count toward Member qualifying spend; Pending, Rejected, Expired and Guest orders do not count.
- Coupon reservation occurs on Pending; consumption on Completed; release on Rejected/Expired.
- Normal orders and orders with non-expiring coupons: 15-minute payment/slip deadline.
- Orders using coupons with an expiry date: deadline through the end of the expiry date in Asia/Bangkok, without an additional 15 minutes.
- Server-side calculation of price, discount, total and deadline; a slip submitted before deadline can be reviewed later.
- Sessions: 8-hour maximum lifetime, 30-minute idle timeout; revoke on logout, password change and suspension.
- Admin-only member IP history; retain 90 days then delete or irreversibly anonymize.
- Slips and media remain Private; slips are Admin-only; manual slip review only.
- No live payment credentials, real customer data or real orders in development tests.

## 6. File-by-file port matrix

| File(s) | P1/P2 action | Preserve / verify |
|---|---|---|
| `Code.gs` | Replace JSON-only `doGet()` with HtmlService router and template output | No DB initialization or Admin bootstrap in `doGet()` |
| New `*.html` templates | Add storefront/Admin templates using existing HTML as source | Keep Thai copy, layout, responsive UI and accessibility |
| `01_HttpEntry.gs` | Keep internal dispatcher; add explicit typed browser facade functions | Per-action argument validation and authorization |
| `13_HttpGateway.gs` | Retain only if needed for internal/diagnostic compatibility; not the browser app transport | Never expose shared HMAC secret to browser |
| `02_Database.gs`, `11_Repositories.gs` | Keep Sheets repository foundation | Schema checks, lock behavior, recovery, quota handling |
| `03_Catalog.gs`, `04_Coupons.gs`, `06_Orders.gs`, `08_Admin.gs`, `09_Validation.gs`, `10_Utilities.gs` | Preserve business handlers; adapt facade arguments only | All business invariants, authorization, idempotency and safe failures |
| `05_Payments.gs` | Implement PromptPay QR generation | No external paid QR service; verify Thai PromptPay payload and exact amount |
| `07_Auth.gs` | Preserve auth/session core; connect to facade/session transport | PBKDF2 benchmark, token protection, revocation, rate limiting |
| `public/nobitopup.html` | Move into HtmlService template and replace REST adapter with RPC client | Catalog, coupon, QR, checkout, slip, member flows and retry behavior |
| `public/admin.html` | Move into HtmlService template and replace REST adapter with RPC client | Admin CRUD, members/IP, order review, private slip/media |
| `src/routes/gateway-*.routes.js`, `src/clients/apps-script.client.js` | Legacy Express gateway; do not use as the final web host | Keep unchanged until P1/P2 replacement is tested; do not silently enable Vercel |
| `src/db/sqlite.js`, legacy `src/routes/*.routes.js` | Local characterization baseline only | No SQLite fallback for hosted/live use |
| `test/*.test.js` | Extend static/unit tests for new facade and templates | Keep existing regression tests and add real-runtime checks later |

## 7. P0 exit checklist

- [x] Verify repository, branch and branch isolation.
- [x] Verify actual frontend transport from checked-in HTML.
- [x] Inventory Express route families and GAS dispatcher actions.
- [x] Identify missing HtmlService entry/facade and current payment QR stub.
- [x] Record file-by-file port matrix.
- [x] Correct false frontend transport documentation.
- [x] Mark the PostgreSQL option as cancelled history.
- [x] Align CI Node runtime with package engine.
- [ ] Observe and record CI result after the Node 22 workflow change.
- [ ] Complete detailed field-by-field response/payload mapping for every Admin CRUD and checkout action.
- [ ] Complete Apps Script HTML templating/security review before P1 implementation.

**P0 status: PARTIALLY COMPLETE.** The source/architecture blockers and file-level matrix are recorded. Remaining contract-detail and post-fix CI checks must pass before P0 is closed.

## 8. Safety gates

- No Google project, Spreadsheet, Drive folder or other resource was created.
- No Script Properties, payment credentials, Admin account or real data were initialized.
- No GAS Web App, Vercel Preview or Production deployment was performed during this audit.
- No production order or payment was accepted.
- Continue only on `vercel-drive-setup`; never modify `main`.
