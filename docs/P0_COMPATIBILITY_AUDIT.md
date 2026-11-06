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
| `05_Payments.gs` | PromptPay response | **Stub: returns configured=false even if PromptPay ID exists** |
| `06_Orders.gs` | Order creation, deadlines, slips, idempotency and write-ahead recovery journal | P0-R1 through R3 implemented; expanded fault-injection and linkage checks added; real Drive/Sheets concurrency remains unverified |
| `07_Auth.gs` | Admin/member auth and sessions | Present; PBKDF2 performance unverified in Apps Script |
| `08_Admin.gs` | Admin CRUD, audit, private files | Present; real Drive ACLs unverified |
| `09_Validation.gs` | Record validation | Present |
| `10_Utilities.gs` | Hashing, money, retention, rate limits | Present; runtime/performance unverified |
| `11_Repositories.gs` | Sheets repositories | Present; Sheets atomicity/concurrency unverified |
| `12_Seed.gs` | Default catalog seed | Present; must only run on an explicitly authorized synthetic database |
| `13_HttpGateway.gs` | Signed HTTP `doPost()` gateway | Present; target browser transport is not this gateway |
| `14_Retention.gs` | 90-day IP/log cleanup and daily trigger setup | P0-R4 source and mock tests added; IP columns use batched writes, log deletion uses bottom-up contiguous batches, trigger installation uses ScriptLock; trigger deliberately not installed on a real Google account |
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
| P0-07 | High | Sheets has no relational transaction; order + coupon redemption + idempotency rows require recovery after partial writes | P0-R1/R2 write-ahead journal and P0-R3 fault-injection coverage implemented. Recovery preflights full CREATE order/redemption/idempotency records before writes, validates legal transition states and patches, and rejects cross-order linkage; actual Apps Script concurrency/runtime verification remains open |
| P0-08 | High | PBKDF2-SHA256 120,000 iteration implementation has only reference/unit coverage; runtime cost unknown | P3: benchmark login latency and execution quotas; do not weaken to SHA-256-only |
| P0-09 | High | Private Drive access checks and folder boundaries are not verified against real Drive ACLs | P3/P4: test owner, parent-folder sharing, file sharing, cross-folder IDs and authenticated reads |
| P0-10 | Medium | Frontend API inventory contained a false statement that the current HTML already used GAS RPC; implementation plan contained a cancelled PostgreSQL decision in a section labelled as superseding the Apps Script target | Corrected in this P0 pass; keep historical notes explicitly labelled |
| P0-11 | Medium | CI used Node 20 while package.json declares Node 22 only | Corrected workflow to Node 22; await new CI result |

> **Coupon-rule clarification from prior approved decisions:** UID cumulative spend is based on Completed orders matching the same game and player UID, including Guest orders. The separate Member-game-spend threshold counts only Completed orders for that authenticated Member. Do not add a `member_id` requirement to UID spend; that would change the approved legacy UID rule. Existing test `UID cumulative spend coupon is enforced per game using Completed orders only` intentionally uses a Guest order.

| P0-12 | Critical | Pure HtmlService + `google.script.run` does not expose a trusted client remote IP to the server-side function. The documented Web App event object exposes request parameters/body metadata, not a remote-IP field; `google.script.run` invokes named server functions asynchronously without forwarding a trusted network address. | Hard compatibility blocker: preserve the approved Admin-only Member IP-history requirement. Do not substitute a client-supplied IP and call it verified. A trusted IP-observing server/proxy would be needed, which may conflict with strict Zero Cost and the approved no-new-service boundary. Stop before P1 until a compliant method is approved. |

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


## 5A. HtmlService security and platform constraints

Static source review confirms:

- Neither frontend currently calls `google.script.run`; both use `fetch()`. Their existing REST cookie/session behavior cannot be copied unchanged into HtmlService.
- Storefront `sessionStorage` currently holds checkout retry/idempotency state, not Admin or Member authentication tokens.
- Admin relies on same-origin HttpOnly cookie sessions and does not persist an Admin bearer token in browser storage.
- Both HTML pages contain inline scripts/styles and dynamic `innerHTML` rendering. Existing escaping and server-side validation must be re-reviewed after migration; CSP enforcement and HtmlService sandbox compatibility remain open.
- The storefront submits slips and Admin media through multipart REST endpoints today. The GAS gateway converts file bytes to base64; the new RPC path must have explicit size limits and sequential/bounded calls.
- `google.script.run` is asynchronous, has legal-type restrictions for parameters/returns, and allows at most 10 concurrent calls. The frontend adapter must serialize dependent mutations, use success/failure handlers, and never rely on call execution order. See [Google's google.script.run reference](https://developers.google.com/apps-script/guides/html/reference/run) and [server communication guide](https://developers.google.com/apps-script/guides/html/communication).
- Apps Script Web App `doGet(e)` event documentation lists query parameters, path information and POST metadata; it does not document a remote client IP field. See [Google's Web Apps request event documentation](https://developers.google.com/apps-script/guides/web#request_parameters).

### IP-history feasibility blocker


### Zero-cost Google-only feasibility check (2026-11-05)

The follow-up check examined whether existing Apps Script or Google logging facilities can replace the missing trusted request IP without adding a server/proxy or incurring charges.

1. **Apps Script Web App request event (`doGet(e)` / `doPost(e)`) — not viable.** Google's documented event fields include query parameters, path information, content length, and POST body metadata. There is no documented remote address or trusted client-IP field. A value added to query/body by the browser remains client-controlled. See [Web Apps request parameters](https://developers.google.com/apps-script/guides/web#request_parameters).
2. **HtmlService `google.script.run` — not viable for trusted IP.** It invokes a named server-side Apps Script function from the HTML page; it does not expose the browser's network peer address to that function. The client cannot turn a browser-supplied IP into trusted server metadata. See [google.script.run reference](https://developers.google.com/apps-script/guides/html/reference/run).
3. **Apps Script execution logs / Cloud Logging — not a substitute.** Google's Apps Script logging documentation describes execution logs, Cloud Logging, Error Reporting, and temporary active-user keys. The documented user key is a rotating pseudonymous identifier, not a network IP. It cannot satisfy the required IP-history field. See [Apps Script logging](https://developers.google.com/apps-script/guides/logging).
4. **Cloud Audit Logs — not an acceptable workaround.** Cloud Audit Logs can include a caller IP for supported Google Cloud resource API audit events, but this is not a documented per-visitor IP feed for Apps Script HtmlService executions. Google also states that resources accessible without signing in to Google Cloud/Workspace/Cloud Identity/Drive Enterprise do not generate Data Access audit logs. Data Access logs are disabled by default, and enabling them may incur additional charges. Therefore this path is neither a proven source for public storefront visitor IPs nor compatible with the strict no-cost rule. See [Cloud Audit Logs](https://docs.cloud.google.com/logging/docs/audit).
5. **UrlFetchApp / public IP echo services — not viable.** UrlFetch requests originate from Google's outbound network IP ranges, so the result identifies Google's egress, not the original browser visitor. Asking the browser to call an IP echo service and submit the result to Apps Script would still be client-controlled and spoofable. See [UrlFetch Service](https://developers.google.com/apps-script/reference/url-fetch).

**Finding:** No supported Google-only, zero-additional-cost mechanism was identified that supplies a trusted visitor IP to the approved HtmlService + `google.script.run` application. This is a platform boundary, not a code defect. Do not implement a browser-reported IP, Google outbound IP, rotating user key, or audit-log guess as if it were a verified Member IP address. Do not enable any audit logging or Cloud feature that could create charges as part of this investigation.

**Decision:** P0-12 remains a hard blocker. Keep the original Admin-only Member IP-history requirement unchanged. Keep the zero-cost constraint unchanged. Do not start P1, deploy, provision a proxy/server, or alter the requirement unless the user explicitly approves a compliant change. No source code or Google resources were changed during this feasibility check.


The approved policy requires Admin to view Member IP history. The former Express gateway obtained the address from the server request and forwarded it to GAS. In a direct HtmlService + `google.script.run` deployment, the GAS function does not receive the original browser network connection metadata. A value fetched or submitted by browser JavaScript is client-controlled and must not be treated as verified IP history. No code change can safely preserve this requirement without an IP-observing server/proxy. Because adding a service or a potentially billable intermediary is outside the approved Zero Cost boundary, P1 must not proceed by silently weakening or relabelling this requirement.

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
| Member register | `fullName, loginId, password` | Source IP and user agent must be server-derived where available | `memberRegister`: currently receives `fullName, loginId, password, ipAddress`; dispatcher currently does not forward userAgent |
| Member login | `loginId, password` | Source IP and user agent | `memberLogin`: `loginId, password, ipAddress, userAgent` |
| Member session | none / logout / password change | Member token from protected session | `memberMe, memberLogout, memberChangePassword` |
| Admin login | `username, password` | Source IP | `adminLogin`: `username, password, ipAddress` |
| Admin session | none / logout / password change | Admin token from protected session | `adminMe, adminLogout, adminChangePassword` |
| Admin dashboard/orders | none | Admin token | `adminDashboard, adminOrders` |
| Admin order status | `orderId, status` | Admin token, source IP | `adminSetOrderStatus`: `token, orderId, status, ipAddress` |
| Admin slip view | `orderId` | Admin token, source IP | `adminSlipData`: `token, orderId, ipAddress` |
| Admin list | table allowlist only | Admin token | `adminList`: `token, tableName` |
| Admin create/update | allowlisted record fields per table | Admin token, source IP | `adminUpsert`: `token, tableName, record, ipAddress` |
| Admin delete | allowlisted table + record ID | Admin token, source IP | `adminDelete`: `token, tableName, id, ipAddress` |
| Member administration | search/limit/status/member ID | Admin token, source IP | `adminMembers, adminSetMemberStatus, adminMemberLoginLogs` |
| Admin media upload | image file | Admin token, source IP | `adminStoreMedia`: `token, media{name,mimeType,base64}, ipAddress` |
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
- [ ] Complete detailed field-by-field response/payload mapping for every Admin CRUD and checkout action.
- [x] Complete source-level HTML/session/storage and HtmlService call-constraint review.
- [ ] Resolve P0-12 trusted Member IP-history compatibility without changing approved requirements or Zero Cost constraints.

**P0 status: BLOCKED pending user-approved resolution of P0-12.** Source inventory, payload matrix, static security review, file matrix and CI checks are complete. Do not start P1 until trusted Member IP history can be preserved within the approved constraints.

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
- P0 remains blocked by the unresolved trusted Member IP-history compatibility issue documented under P0-12. Do not start P1 or change the approved IP-history / Zero Cost requirements without a separate user decision.

## 10. P0-R1 through P0-R6 consolidated revalidation — 2026-11-06

- Re-read the current source and regression tests for the recovery journal, schema migrations, retention cleanup, slip-file uncertainty handling, HMAC envelope verification, nonce replay protection, and gateway session-call reduction.
- Confirmed the current database schema is version 3. The setup preflight explicitly supports upgrades from schema versions 1 and 2 to version 3, preserves existing business rows, and refuses unknown versions or incompatible headers. Version 2 migration coverage preserves the recovery journal and business rows.
- Corrected the stale schema-version comment at the top of `google-apps-script/08_Admin.gs`; the implementation uses the current versioned Sheets schema, not a version 1-only schema.
- Revalidated the optional Member identity path. Invalid/expired/idle-expired/revoked/suspended Member sessions fall back to Guest identity for public coupon checks, while infrastructure errors continue to propagate. Added regression coverage in `test/apps-script-auth-session.test.js`.
- Latest consolidated GitHub Actions run on `vercel-drive-setup`: run `42146915664`, commit `5cd3bc5c8c4324c480e99713ff144f47d6fce083`, result **success — 80 tests passed, 0 failed**.
- The passing suite includes CREATE/TRANSITION journal recovery and fault injection, schema v1/v2-to-v3 migration checks, 90-day retention and trigger tests, uncertain Drive slip-write preservation, HMAC argument tampering, nonce replay/capacity/locking/corruption tests, and the optional Member-to-Guest regression.
- These remain local Node test-harness/fake-service checks. They do not prove live Google Apps Script, real Sheets LockService contention, Drive ACL behavior, or production runtime/quota performance.
- No deployment, production transaction, Google resource creation, billing change, or paid service was performed. Work remains isolated to `vercel-drive-setup`; `main` was not modified.
