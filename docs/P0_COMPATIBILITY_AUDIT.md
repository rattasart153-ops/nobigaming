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
- Last pre-audit CI run: `42000316537`, conclusion `success`.
- Project `package.json` requires Node `>=22 <23`; workflow Node 20 mismatch was corrected to Node 22. CI run `42001254891` on the corrected workflow commit `891517675290e2a9dd158e1ec05f58ccb3e18b4d` completed successfully.

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
| `00_Config.gs` | Schema v3, sheet headers, session/log/upload constants | Present |
| `01_HttpEntry.gs` | Explicit action dispatcher | Dispatcher exists; it is not a browser facade |
| `02_Database.gs` | Spreadsheet setup/schema validation | Present; real Sheets behavior unverified |
| `03_Catalog.gs` | Catalog/promotions | Present |
| `04_Coupons.gs` | Coupon eligibility and suggestions | Present; business tests use mocks |
| `05_Payments.gs` | PromptPay response | P0-R7 implements a native EMVCo payload builder; QR image rendering remains a frontend responsibility and must use a local encoder |
| `06_Orders.gs` | Order creation, deadlines, slips, idempotency and write-ahead recovery journal | P0-R1 through R3 implemented; expanded fault-injection and linkage checks added; real Drive/Sheets concurrency remains unverified |
| `07_Auth.gs` | Admin/member auth and sessions | Present; PBKDF2 performance unverified in Apps Script |
| `08_Admin.gs` | Admin CRUD, audit, private files | Present; real Drive ACLs unverified |
| `09_Validation.gs` | Record validation | Present |
| `10_Utilities.gs` | Hashing, money, retention, rate limits | Present; runtime/performance unverified |
| `11_Repositories.gs` | Sheets repositories | Present; Sheets atomicity/concurrency unverified |
| `12_Seed.gs` | Default catalog seed | Present; must only run on an explicitly authorized synthetic database |
| `13_HttpGateway.gs` | Signed HTTP `doPost()` gateway | Present; target browser transport is not this gateway |
| `14_Retention.gs` | 90-day IP/log cleanup and daily trigger setup | P0-R4 source and mock tests added; IP columns use batched writes, log deletion uses bottom-up contiguous batches, trigger installation uses ScriptLock; trigger deliberately not installed on a real Google account |
| `Code.gs` | Web entry point | **P0-R11 implemented:** `doGet()` renders the selected HtmlService template; no DB initialization |
| `appsscript.json` | V8 manifest, Asia/Bangkok | Present; no HtmlService templates are referenced |

### Current GAS action dispatcher

`01_HttpEntry.gs` dispatches:  
`catalog`, `promotions`, `coupon`, `couponSuggestions`, `paymentInfo`, `createOrder`, `submitOrderSlip`, `adminLogin`, `memberRegister`, `memberLogin`, `memberMe`, `memberLogout`, `memberChangePassword`, `adminChangePassword`, `adminMe`, `adminLogout`, `adminDashboard`, `adminOrders`, `adminSlipData`, `adminSetOrderStatus`, `adminList`, `adminUpsert`, `adminDelete`, `adminMemberLoginLogs`, `adminMembers`, `adminSetMemberStatus`, `adminStoreMedia`, `publicMediaData`.

This dispatcher can be reused behind a narrower typed facade, but must not be exposed as a generic unrestricted browser entry point. The facade must validate argument shape, authentication and authorization per action.

## 4. P0 blockers and defects found

| ID | Severity | Finding | Required action |
|---|---|---|---|
| P0-01 | Critical | GAS `doGet()` previously returned JSON with no HtmlService renderer | **P0-R11 source implemented:** `Code.gs` routes to Storefront/Admin templates; no resource initialization occurs during rendering. Runtime verification remains gated. |
| P0-02 | Critical | HtmlService pages needed a REST-to-RPC browser adapter | **Source implemented in P0-R13:** Storefront and Admin now use only named google.script.run facade methods; CI validates no fetch() calls in either HtmlService page. Real GAS runtime and browser/device integration remain gated. |
| P0-03 | Critical | `01_HttpEntry.gs` dispatcher was only reachable through signed `doPost()` | **P0-R12 source implemented:** `BrowserFacade.gs` exposes named typed functions, strict argument allowlists and no generic browser action dispatcher. Runtime verification remains gated. |
| P0-04 | High | PromptPay QR rendering | **Source implemented in P0-R13:** HtmlService uses a locally bundled MIT-licensed QRCode.js encoder to render the EMVCo payload; no external QR endpoint or paid service. Real QR scan/payment validation remains gated. |
| P0-05 | High | Admin slip and media transfer needed an HtmlService RPC path | **Source implemented in P0-R13:** slip upload, Admin media upload and slip retrieval use bounded Base64 RPC payloads with the existing 3 MiB file cap; Drive ACL checks remain server-side. Real Drive transfer/ACL validation remains gated. |
| P0-06 | High | HtmlService needs a browser-compatible session lifecycle | **Source implemented in P0-R13:** Member/Admin session tokens and checkout upload capability stay in JavaScript memory only; no auth token is written to localStorage/sessionStorage; refreshing requires login again. Dynamic server text is escaped and promo links are protocol-allowlisted. XSS review and HtmlService runtime security validation remain P4 gates; memory-only storage is not XSS-proof. |
| P0-07 | High | Sheets has no relational transaction; order + coupon redemption + idempotency rows require recovery after partial writes | P0-R1/R2 write-ahead journal and P0-R3 fault-injection coverage implemented. Recovery preflights full CREATE order/redemption/idempotency records before writes, validates legal transition states and patches, and rejects cross-order linkage; actual Apps Script concurrency/runtime verification remains open |
| P0-08 | High | PBKDF2-SHA256 120,000 iteration implementation has only reference/unit coverage; runtime cost unknown | P3: benchmark login latency and execution quotas; do not weaken to SHA-256-only |
| P0-09 | High | Private Drive access checks and folder boundaries are not verified against real Drive ACLs | P3/P4: test owner, parent-folder sharing, file sharing, cross-folder IDs and authenticated reads |
| P0-10 | Medium | Frontend API inventory contained a false statement that the current HTML already used GAS RPC; implementation plan contained a cancelled PostgreSQL decision in a section labelled as superseding the Apps Script target | Corrected in this P0 pass; keep historical notes explicitly labelled |
| P0-11 | Medium | CI used Node 20 while package.json declares Node 22 only | Corrected workflow to Node 22; await new CI result |

> **Coupon-rule clarification from prior approved decisions:** UID cumulative spend is based on Completed orders matching the same game and player UID, including Guest orders. The separate Member-game-spend threshold counts only Completed orders for that authenticated Member. Do not add a `member_id` requirement to UID spend; that would change the approved legacy UID rule. Existing test `UID cumulative spend coupon is enforced per game using Completed orders only` intentionally uses a Guest order.

| P0-12 | Critical | HtmlService + `google.script.run` does not expose a trusted visitor remote IP to Apps Script. | **Resolved by explicit user decision B:** remove the Admin-only Member IP-history requirement while keeping HtmlService + GAS-only and Zero Cost. Do not collect caller-supplied IPs or present them as verified. Code, Admin UI, retention and tests must enforce no Member IP collection; account-scoped abuse controls remain. |

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
- Member IP history is not collected or displayed under approved decision B; Member login/security events (without IP) remain Admin-only and are retained for 90 days.
- Slips and media remain Private; slips are Admin-only; manual slip review only.
- No live payment credentials, real customer data or real orders in development tests.


## 5A. HtmlService security and platform constraints

Static source review confirms:

- Historical baseline: both copied pages initially used fetch() and Express cookie sessions. P0-R13 replaced the HtmlService templates' transport with named google.script.run calls; legacy public/ pages remain the Express characterization baseline.
- Storefront `sessionStorage` currently holds checkout retry/idempotency state, not Admin or Member authentication tokens.
- Current HtmlService Admin keeps its opaque Admin token in JavaScript memory only and starts unauthenticated after every page refresh; it does not use cookie sessions or browser storage for authentication.
- Both pages retain inline scripts/styles and some innerHTML rendering. Current templates escape server-controlled promotion, coupon, package and Admin table values and restrict promotion links to safe relative/HTTPS URLs. A full XSS review, CSP strategy and HtmlService sandbox compatibility remain open; this is not claimed to be XSS-proof.
- Current HtmlService storefront/Admin file flows convert PNG/JPEG/WebP to Base64 and call named facade methods. The 3 MiB file limit and 4,194,304-character encoded boundary are enforced; actual GAS payload/runtime limits still need synthetic verification.
- `google.script.run` is asynchronous, has legal-type restrictions for parameters/returns, and allows at most 10 concurrent calls. The frontend adapter must serialize dependent mutations, use success/failure handlers, and never rely on call execution order. See [Google's google.script.run reference](https://developers.google.com/apps-script/guides/html/reference/run) and [server communication guide](https://developers.google.com/apps-script/guides/html/communication).
- Apps Script Web App `doGet(e)` event documentation lists query parameters, path information and POST metadata; it does not document a remote client IP field. See [Google's Web Apps request event documentation](https://developers.google.com/apps-script/guides/web#request_parameters).

### Trusted IP collection decision — approved B (2026-11-06)

The platform limitation remains true: HtmlService + `google.script.run` does not expose a trusted visitor remote-IP value. The user explicitly selected option B, authorizing the project to retain the HtmlService + Apps Script-only / Zero Cost architecture and remove the Member IP-history requirement.

The source must therefore:
- Ignore caller-supplied IP arguments in Member registration/login and Member security events.
- Keep legacy schema columns only for compatibility, writing empty values and excluding them from Admin responses.
- Preserve Member login/security events without IP (timestamp, outcome, failure reason and user-agent metadata) for 90 days.
- Remove Member IP-history navigation and columns from the Admin UI.
- Immediately clear legacy Member IP data, Member session IP data, Member login-log IP data, and untrusted Admin session/audit IP values through the retention cleanup.
- Replace Apps Script IP-based login/registration buckets with HMAC-keyed account-scoped rate limits. This does not provide per-network rate limiting; do not describe it as such.

P0-12 is resolved as a requirements decision, not because a trusted IP source was discovered. No proxy, external service, new account, billing, paid tier, or deployment is authorized or needed for this decision.

## 6. File-by-file port matrix

| File(s) | P1/P2 action | Preserve / verify |
|---|---|---|
| `Code.gs` | **Implemented P0-R11:** HtmlService router selects `Storefront` or `Admin` template | No DB initialization or Admin bootstrap in `doGet()` |
| `Storefront.html`, `Admin.html` | **Implemented P0-R11/P0-R13:** HtmlService templates plus named RPC adapters and memory-only session handling | Preserve Thai copy/layout; verify browser/device behavior and XSS controls in P4/P5 |
| `01_HttpEntry.gs`, `BrowserFacade.gs` | **Implemented P0-R12:** keep dispatcher internal and expose named typed facade functions only | Strict payload allowlists; business handlers enforce authorization and invariants |
| `13_HttpGateway.gs` | Retain only if needed for internal/diagnostic compatibility; not the browser app transport | Never expose shared HMAC secret to browser |
| `02_Database.gs`, `11_Repositories.gs` | Keep Sheets repository foundation | Schema checks, lock behavior, recovery, quota handling |
| `03_Catalog.gs`, `04_Coupons.gs`, `06_Orders.gs`, `08_Admin.gs`, `09_Validation.gs`, `10_Utilities.gs` | Preserve business handlers; adapt facade arguments only | All business invariants, authorization, idempotency and safe failures |
| `05_Payments.gs`, `QrCode.html` | **Implemented:** EMVCo payload plus locally bundled QR renderer | No external paid QR service; real device scan and exact-amount verification remain gated |
| `07_Auth.gs` | Preserve auth/session core; connect to facade/session transport | PBKDF2 benchmark, token protection, revocation, rate limiting |
| `Storefront.html` | **Implemented P0-R13:** named RPC adapter for catalog, coupons, QR, checkout/slip and Member flows | Verify on a real HtmlService browser after P6 approval; only idempotency metadata remains in sessionStorage |
| `Admin.html` | **Implemented P0-R13:** named RPC adapter for Admin login, dashboard, orders, CRUD, member history, slip retrieval and private media upload | Verify all flows in a real HtmlService browser after P6 approval |
| `src/routes/gateway-*.routes.js`, `src/clients/apps-script.client.js` | Legacy Express gateway; do not use as the final web host | Keep unchanged until P1/P2 replacement is tested; do not silently enable Vercel |
| `src/db/sqlite.js`, legacy `src/routes/*.routes.js` | Local characterization baseline only | No SQLite fallback for hosted/live use |
| `test/*.test.js` | Extend static/unit tests for new facade and templates | Keep existing regression tests and add real-runtime checks later |


## 6A. Request/response contract details for the HtmlService facade

The browser facade must expose named, typed operations rather than accepting arbitrary REST paths. The following mapping is grounded in the current gateway route adapters and `01_HttpEntry.gs` dispatcher:

| UI action | Current browser input | Server-derived / protected input | GAS action and argument contract |
|---|---|---|---|
| Load catalog | none | none | `catalog` |
| Load promotions | none | none | `promotions` |
| Coupon suggestions | `gameId, subtotal, playerId` | Member ID from verified session | `couponSuggestions`: `gameId, subtotal, playerId, memberId` |
| Validate coupon | `code, gameId, subtotal, playerId` | Member ID from verified session | `coupon`: `code, gameId, subtotal, playerId, memberId` |
| PromptPay information | `amount` | PromptPay ID from Script Properties | `paymentInfo`: `amount` |
| Create order | `gameId, packageId, playerId, serverId, couponCode`, Idempotency-Key | Member token from verified session; price, discount and deadline from Sheets | `createOrder`: `request_key, game_id, package_id, player_id, server_id, coupon_code, member_token` |
| Submit slip | `orderId, slip file` | Order-scoped checkout token | `submitOrderSlip`: `order_id, checkout_token, slip{name,mimeType,base64}` |
| Member register | `fullName, loginId, password` | No IP value is collected; Login ID is normalized server-side | `memberRegister(fullName, loginId, password)`; account-scoped registration limiter |
| Member login | `loginId, password` | No IP value is collected; user-agent metadata is retained when available | `memberLogin(loginId, password, userAgent)`; account-scoped login limiter |
| Member session | none / logout / password change | Member token from protected session | `memberMe, memberLogout, memberChangePassword` |
| Admin login | `username, password` | No IP value is collected | `adminLogin(username, password)`; account-scoped login limiter |
| Admin session | none / logout / password change | Admin token from protected session | `adminMe, adminLogout, adminChangePassword` |
| Admin dashboard/orders | none | Admin token | `adminDashboard, adminOrders` |
| Admin order status | `orderId, status` | Admin token; no IP value | `adminSetOrderStatus(token, orderId, status)`; audit IP field remains blank |
| Admin slip view | `orderId` | Admin token; no IP value | `adminSlipData(token, orderId)`; audit IP field remains blank |
| Admin list | table allowlist only | Admin token | `adminList`: `token, tableName` |
| Admin create/update | allowlisted record fields per table | Admin token; no IP value | `adminUpsert(token, tableName, record)`; audit IP field remains blank |
| Admin delete | allowlisted table + record ID | Admin token; no IP value | `adminDelete(token, tableName, id)`; audit IP field remains blank |
| Member administration | search/limit/status/member ID | Admin token; no IP value | `adminMembers, adminSetMemberStatus, adminMemberLoginLogs`; responses contain no IP fields |
| Admin media upload | image file | Admin token; no IP value | `adminStoreMedia(token, media)`; audit IP field remains blank |
| Public media | opaque media reference | Active record reference and private Drive folder checks | `publicMediaData`: `fileId` |

### Payload and response risks to resolve before P1/P2 acceptance

- Current frontend uses two-step order/slip submission; the GAS order handler must preserve the one-time order-scoped upload authorization and idempotent retry semantics without exposing reusable tokens to page storage.
- Current Admin browser relies on HttpOnly cookie sessions, whereas GAS handlers issue opaque tokens. The facade design must not silently downgrade to long-lived tokens in `localStorage` or weaken Admin authorization.
- Admin media upload and public media retrieval currently move base64 through the Express/GAS gateway. HtmlService RPC must impose bounded file size, validate before Drive writes, and avoid large unbounded response payloads.
- Member registration currently forwards `userAgent` through the Express route but the GAS dispatcher does not pass it into `memberRegister`; inspect whether the registration audit schema requires it and either wire it through or explicitly document why it is not collected.
- `paymentInfo_` remains a stub; the facade must return a consistent explicit unconfigured/error response until PromptPay QR generation is implemented and verified.

## 7. P0 exit checklist

- [x] Verify repository, branch and branch isolation.
- [x] Verify actual frontend transport from checked-in HTML.
- [x] Inventory Express route families and GAS dispatcher actions.
- [x] Identify missing HtmlService entry/facade and current payment QR stub.
- [x] Record file-by-file port matrix.
- [x] Correct false frontend transport documentation.
- [x] Mark the PostgreSQL option as cancelled history.
- [x] Align CI Node runtime with package engine.
- [x] Observe and record CI result after the Node 22 workflow change (`42001254891`: success).
- [x] Review frontend session/storage and HtmlService client-call constraints.
- [x] Check trusted IP-history feasibility against official Apps Script request/API documentation.
- [x] Complete detailed field-by-field response/payload mapping for every Admin CRUD and checkout action — see [P0_ADMIN_CHECKOUT_FIELD_MAPPING.md](./P0_ADMIN_CHECKOUT_FIELD_MAPPING.md) (P0-R9).
- [x] Complete source-level HTML/session/storage and HtmlService call-constraint review.
- [x] Resolve P0-12 by implementing the user's explicit decision B: no Member IP history; preserve login/security events without IP.

**P0-12 status: RESOLVED BY USER DECISION B.** Do not reintroduce IP collection. Other Phase 0 items and their release gates remain independently applicable.

## 8. Safety gates

- No Google project, Spreadsheet, Drive folder or other resource was created.
- No Script Properties, payment credentials, Admin account or real data were initialized.
- No GAS Web App, Vercel Preview or Production deployment was performed during this audit.
- No production order or payment was accepted.
- Continue only on `vercel-drive-setup`; never modify `main`.


## 9. P0-R5/R6 recovery, gateway and request-count verification

### P0-R5 — idempotency and recovery fault handling

- The slip-upload catch path previously trashed a newly created Drive file whenever the following Sheets order update threw. A Sheets update may commit even when its response is lost; in that case the order could already reference the file, and unconditional trashing would leave a broken slip reference.
- The catch path now re-reads the order. It trashes the file only when the order does not reference it. If the re-read itself fails, it preserves the private file and prefers a possible orphan over destructive loss of an already-committed slip.
- Added a fault-injection test where the order write commits and then throws. The test verifies the file remains private/present, the order reference remains valid, and a retry returns the already-submitted result without creating a second Drive file.
- Existing CREATE/TRANSITION recovery tests continue to cover idempotent journal replay, partial primary writes, and uncertain journal finalization. These are deterministic test-harness checks, not a simulation of parallel Apps Script executions.

### P0-R6 — HMAC, nonce and GAS request count

- The Node client and Apps Script gateway use the same canonical JSON envelope and HMAC-SHA256 signature. A new test mutates signed action arguments and verifies rejection occurs before the nonce is claimed.
- Nonce claim still occurs only after signature validation, uses a ScriptLock around expiry pruning, replay scan and append, rejects duplicate nonce hashes, fails closed on corrupt timestamps or a full active ledger, and retains the existing 10-minute window / 5,000 active-row ceiling.
- Added a lock-boundary test asserting that nonce pruning, reads and append all occur while ScriptLock is held. The local harness verifies lock use; actual simultaneous Apps Script executions and Sheets contention remain untested.
- Removed redundant `adminMe` / `memberMe` preflight gateway calls from protected route middleware. Middleware now requires the HttpOnly cookie and forwards its token; each protected business handler performs authoritative session validation inside the same signed GAS action. Logout remains a token-revocation operation.
- Coupon validation and suggestions now send the Member token inside the signed server-to-server envelope. Apps Script derives the optional Member ID from the verified session, avoiding a separate `memberMe` round-trip. Invalid/expired Member sessions retain Guest behavior for public coupons; infrastructure failures are not silently converted to Guest.
- Route tests assert protected Admin requests do not make a redundant `adminMe` request and Member coupon validation does not make a separate `memberMe` request.

### CI evidence for this pair

- P0-R5 workflow run `42129198977`: **77 tests passed, 0 failed**.
- P0-R6 workflow run `42129480514`: **79 tests passed, 0 failed**.
- Both runs executed on `vercel-drive-setup`. No live Apps Script, Sheets, Drive, deployment, or production transaction was used.
- At the time of this historical R5/R6 run, P0-12 had not yet been resolved. The later explicit decision B and implementation are recorded in Pair 5 below.

## 10. P0-R1 through P0-R6 consolidated revalidation — 2026-11-06

- Re-read the current source and regression tests for the recovery journal, schema migrations, retention cleanup, slip-file uncertainty handling, HMAC envelope verification, nonce replay protection, and gateway session-call reduction.
- Confirmed the current database schema is version 3. The setup preflight explicitly supports upgrades from schema versions 1 and 2 to version 3, preserves existing business rows, and refuses unknown versions or incompatible headers. Version 2 migration coverage preserves the recovery journal and business rows.
- Corrected the stale schema-version comment at the top of `google-apps-script/08_Admin.gs`; the implementation uses the current versioned Sheets schema, not a version 1-only schema.
- Revalidated the optional Member identity path. Invalid/expired/idle-expired/revoked/suspended Member sessions fall back to Guest identity for public coupon checks, while infrastructure errors continue to propagate. Added regression coverage in `test/apps-script-auth-session.test.js`.
- Latest consolidated GitHub Actions run on `vercel-drive-setup`: run `42146915664`, commit `5cd3bc5c8c4324c480e99713ff144f47d6fce083`, result **success — 80 tests passed, 0 failed**.
- The passing suite includes CREATE/TRANSITION journal recovery and fault injection, schema v1/v2-to-v3 migration checks, 90-day retention and trigger tests, uncertain Drive slip-write preservation, HMAC argument tampering, nonce replay/capacity/locking/corruption tests, and the optional Member-to-Guest regression.
- These remain local Node test-harness/fake-service checks. They do not prove live Google Apps Script, real Sheets LockService contention, Drive ACL behavior, or production runtime/quota performance.
- No deployment, production transaction, Google resource creation, billing change, or paid service was performed. Work remains isolated to `vercel-drive-setup`; `main` was not modified.

## 11. P0-R7 / P0-R8 — PromptPay and Drive privacy hardening — 2026-11-06

### P0-R7 — zero-cost PromptPay payload generation

- Replaced the paymentInfo_() placeholder with an Apps Script-native EMVCo PromptPay payload builder. It performs no network request and uses no paid QR service.
- Supports Thai mobile numbers in local and international forms, 13-digit national/tax IDs, and 15-digit e-wallet IDs. It validates identifiers rather than silently stripping arbitrary letters.
- Builds PromptPay merchant account information, THB currency, optional fixed amount, static/dynamic initiation method, and CRC-16 checksum.
- paymentInfo_() now returns {configured, promptpayId, amount, payload} when configured. It intentionally returns the payload string, not a QR image: the current Express storefront continues using its existing local promptpay-qr + qrcode service. The future HtmlService UI must render the returned payload with a locally hosted QR encoder; it must not call a third-party QR-image endpoint or send PromptPay IDs to an external image service.
- Added compatibility tests against the existing promptpay-qr package for mobile, international mobile, national/tax ID and e-wallet formats, plus static/dynamic payload, CRC, invalid ID/amount and unconfigured cases.

### P0-R8 — fail-closed private Drive validation and upload cleanup

- assertDriveFileInPrivateFolder_() now requires both the configured folder and file to expose sharing metadata and requires both to report DriveApp.Access.PRIVATE. Missing metadata fails closed instead of silently skipping the ACL check.
- The validator confirms the file has the configured private folder as a parent. Slip uploads and Admin media upload, media reads and Admin media references use the same validator.
- Slip upload now rejects folders with missing sharing metadata and verifies the newly created file's sharing state and parent before writing the order reference. Failed verification follows the existing safe cleanup path and trashes only an unlinked file.
- Admin media upload now verifies folder, file and parent, and trashes the unreferenced file if ACL verification or Audit Log persistence fails. It returns a media reference only after the audit write succeeds.
- Added regression tests for shared file/folder access, missing sharing metadata, wrong parent folder, Admin media audit failure cleanup and slip upload cleanup. Existing uncertain slip-commit recovery behavior remains intact.

### Validation status and limits

- Source and test changes are isolated to vercel-drive-setup.
- GitHub Actions run 42148644591 on commit e566919bcdc854578fc116cd07f95abbc011025c completed successfully with 94/94 tests. The final expanded regression run 42148809409 on commit c62b0ad64bc4dea05f112a9584212537f3a31999 completed successfully with 95/95 tests and 0 failures, including the missing-folder-sharing-metadata case.
- Node VM mocks cannot prove the behavior of real Google Drive inherited permissions, actual file/folder ACLs, or Apps Script execution. Those checks still require a separately authorized synthetic Google test environment; no Google resource or deployment was created here.
- At the time of this historical R7/R8 validation, P0-12 had not yet been resolved. The later explicit decision B and implementation are recorded in Pair 5 below.


## 12. P0-R9/R10 — Admin/checkout mapping and trusted IP decision — 2026-11-06

### P0-R9 — Admin CRUD and checkout contract mapping

- Added [P0_ADMIN_CHECKOUT_FIELD_MAPPING.md](./P0_ADMIN_CHECKOUT_FIELD_MAPPING.md) with field-by-field browser request, GAS action arguments, response shape, record conversions, authentication requirements and business invariants for Admin sessions, dashboard/orders, all four CRUD tables, member administration, media upload, coupon validation and checkout/slip workflow.
- Reconciled stale PromptPay stub descriptions in this audit with P0-R7's implemented EMVCo payload builder.
- Found and fixed the Admin CRUD PUT route defect: it previously omitted the request-derived IP argument when calling the legacy GAS gateway. The route-level regression test verifies the legacy adapter forwards the server-observed request address, not a browser body value. Under approved HtmlService target decision B, the Apps Script business layer now discards IP arguments and does not persist them.
- Added a dedicated regression test for no Member IP collection, no IP fields in Admin member responses, no IP history UI, account-scoped rate limiting and immediate legacy-IP cleanup.

### P0-R10 — Trusted IP decision B and implementation

- The user explicitly selected B: keep HtmlService + Apps Script-only and Zero Cost; remove the Admin Member IP-history requirement. This supersedes earlier documentation that treated Member IP history as immutable.
- Member registration/login no longer accept IP arguments or write Member IP fields. Member sessions and login logs store no IP; `is_new_ip` is always false. The optional User-Agent is client-reported metadata, not a verified device identity.
- Admin member listing and Member login/security history APIs omit IP fields. The Admin UI no longer offers IP history or displays IP columns.
- Apps Script rate limits are now HMAC-keyed and account-scoped (10 Admin login attempts per normalized username, 10 Member login attempts per normalized Login ID, 5 registrations per normalized Login ID per 15 minutes); existing five-failure account lockout remains.
- Retention immediately clears legacy Member, Member-session, Member-login-log and untrusted Admin-session/Admin-audit IP fields, while retaining non-IP login/audit events for 90 days.
- No trusted IP capability is claimed. This is a requirements decision, not a technical workaround.

### Validation boundary

- R9 source, mapping documentation and regression test are retained. R10 implementation updates `07_Auth.gs`, `08_Admin.gs`, `10_Utilities.gs`, `14_Retention.gs`, `public/admin.html`, and the relevant tests/docs.
- Focused validation completed: all changed Apps Script files and Node test files pass JavaScript syntax compilation; the Admin inline script parses; source assertions confirm no IP arguments reach Apps Script handlers or Member responses; an in-memory retention execution clears legacy IP fields while retaining recent non-IP security events. The dedicated regression tests were added to the repository.
- Full `npm test` / GitHub Actions result is **not yet confirmed** for the latest commit: the GitHub status query returned no check statuses. Do not treat focused checks as a passing full CI run.
- These in-memory checks do not prove live Apps Script, Google Sheets LockService contention, Drive ACLs, or production runtime/quota behavior. No deployment, live Google resource, billing, paid service, production payment, or real customer data was used. Work remains isolated to `vercel-drive-setup`; `main` was not modified.


## 13. P0-R11/R12 — HtmlService router and typed browser facade — 2026-11-06

### P0-R11 — HtmlService entry point and templates

- Replaced the JSON-only doGet() in google-apps-script/Code.gs with an explicit page router: default storefront and ?page=admin for the Admin template.
- Added Storefront.html and Admin.html as copies of the existing public HTML, preserving the existing UI and adding only the top-level navigation base plus a migration note.
- Rendering does not initialize Sheets, create Drive folders, bootstrap Admin, or write Script Properties.
- Unknown page values fall back to the storefront; page selection cannot become an arbitrary template filename.

### P0-R12 — named, typed, allowlisted google.script.run facade

- Added BrowserFacade.gs with named functions for catalog/promotions, coupon validation/suggestions, payment info, create order/slip, Member registration/login/session/password, Admin login/session/password/dashboard/orders/slips/CRUD/member administration/media, and referenced public media.
- Internal payload validation and dispatcher helpers end in underscore and are not callable through google.script.run. No generic browser-supplied action name or table operation is exposed.
- Each public wrapper accepts a narrow set of named fields, rejects unknown fields (including browser-supplied IP), validates nested media/slip keys and bounds base64 payload length, then calls a fixed existing business action.
- Follow-up review tightened both slip and Admin media Base64 limits to 4,194,304 characters, the encoded ceiling for the existing 3 MiB file cap; boundary tests accept the exact ceiling and reject one character above it.
- Existing GAS business handlers remain responsible for authentication, authorization, record allowlists, order/coupon invariants, and private Drive checks.

### Validation boundary

- Added test/apps-script-web-entry-facade.test.js and test/apps-script-browser-facade.test.js for route selection, template parity, exposed function inventory, action mapping, strict argument allowlists, no-IP enforcement, and bounded file payloads.
- Focused in-tool checks passed: changed GAS and test sources compile; both template inline scripts parse; router selection and safe fallback work in a mock HtmlService harness; typed facade mappings work and reject injected IP fields; template copies match their public source plus the intended base tag.
- After correcting the initial CI failures (stale JSON doGet expectation, obsolete IP-based rate-limit test, cross-VM assertions and no-IP line parsing), GitHub Actions run 42158907908 on source/test commit f3872aab0c39933e31156f862ec7ac3bce238172 completed successfully: **113 tests passed, 0 failed**. The api-smoke job installed dependencies and ran npm test under Node 22.
- At the end of P0-R12, P0-02 was still open. It was subsequently implemented in P0-R13; see the current status section below.
- At the end of P0-R12, P0-06 was still open. P0-R13 implemented memory-only tokens and re-login after refresh; residual XSS/runtime security verification remains open and tokens must never be stored in localStorage/sessionStorage.
- No Google resources, Script Properties, Admin bootstrap, deployment, billing, paid service, real customer data, or real payment were used. Work remains on vercel-drive-setup; main is unchanged.


## 14. P0-R13 — HtmlService frontend adapter, sessions and local QR — 2026-11-06

### Frontend transport

- Replaced the Storefront and Admin HtmlService REST adapters with named google.script.run calls to the fixed functions in BrowserFacade.gs. The HtmlService pages no longer call fetch(); REST-like route strings are only internal compatibility dispatch keys inside the local adapter.
- Storefront now maps catalog/promotions, coupon validation/suggestions, PromptPay info, create-order/slip, Member register/login/session/logout/password to the typed facade. Admin maps login/session/logout, dashboard/orders/status/slip, members/login history, four CRUD tables and private media upload to the typed facade.
- Admin records receive UI-only id and game-name mappings from the raw GAS schema fields; write calls restore the correct GAS primary-key field. Member IP fields remain absent.

### Session and file-transfer behavior

- Member and Admin opaque session tokens are held only in private adapter closures in page JavaScript memory, not exposed as global token identifiers. No authentication token is written to localStorage or sessionStorage; after refresh the page starts unauthenticated and the user must log in again. The server continues to enforce 8-hour maximum lifetime, 30-minute idle timeout, revocation and account status.
- The order-scoped checkout upload capability is also memory-only. The non-secret order idempotency key/fingerprint may remain in sessionStorage to support retry; the checkout token itself is never persisted. After refresh, the same order attempt must be recreated with the same details (and re-login if it belonged to a Member) to recover the server-issued upload capability.
- Storefront slip upload, Admin media upload and Admin slip retrieval use bounded Base64 payloads through named facade methods. PNG/JPEG/WebP and the existing 3 MiB file limit are preserved. Drive access validation remains in Apps Script and no Drive URL is exposed as a public file link.
- Catalog/promotion images are delivered only when referenced by an active package/promotion and pass the existing private Drive checks; the HtmlService client receives a data URL rather than a Drive sharing URL.

### PromptPay QR and XSS precautions

- Added a locally bundled QRCode.js encoder (google-apps-script/QrCode.html) with its MIT notice. Storefront renders the EMVCo payload returned by paymentInfo_() in the browser; no external QR-image API, paid service or third-party runtime script request is used.
- Dynamic package/coupon/promotion text is escaped before HTML insertion; promotion destinations are limited to fragment links, same-origin relative paths (not protocol-relative URLs) or HTTPS URLs. Admin table/editor values continue to use HTML escaping and fixed field definitions.
- Memory-only tokens reduce persistence exposure but do not make an active XSS harmless. Full XSS review, CSP/sandbox compatibility and browser testing remain open; no claim of XSS-proof behavior is made.

### Validation and remaining gates

- GitHub Actions run 42165709874 on final adapter-closure commit 1df56ef3a1fd25133eea69be5056b9c8f3791a73 completed successfully: **116 tests passed, 0 failed**. This includes inline-script parsing, named-facade transport assertions, memory-only token checks, HtmlService routing/template checks and local QR asset syntax/license checks.
- This is Node/VM CI, not a live browser or real Google runtime test. P3/P4/P5 still require a separately authorized synthetic Apps Script/Sheets/Drive environment for LockService/Sheets concurrency, PBKDF2 execution time, real Drive ACLs, upload/download quotas, real QR scanning, and browser/device workflows.
- No Google resources, Script Properties, Admin bootstrap, deployment, billing, paid service, production data or live payment was used. Only vercel-drive-setup was modified; main remains unchanged.
