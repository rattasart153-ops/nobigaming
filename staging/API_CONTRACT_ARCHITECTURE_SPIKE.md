# Nobi Gaming — Phase 1 API Contract & Architecture Spike

- **Status:** Phase 1 design deliverable — source-mapped; implementation not authorized
- **Repository:** rattasart153-ops/nobigaming
- **Branch:** staging-runtime-test-kit only
- **Audit date:** 25 November 2026
- **Scope:** STAGING only
- **Production:** Explicitly excluded

> This document is a design and compatibility artifact. It does not change application code, Apps Script projects, Script Properties, deployments, Cloudflare resources, Google Sheets, Drive, or Production.

---

## 1. Executive decision

### Recommended architecture

Use a **separate API-only Google Apps Script STAGING project** as the public HTTP boundary for Cloudflare Pages Functions, while keeping the existing Apps Script HtmlService STAGING Web App set to **Only myself**.

The API-only project should:

1. Contain only the server-side business/data functions required by the gateway and its dependencies.
2. Expose a single `doPost(e)` entry point.
3. Not contain `doGet(e)`, HtmlService templates, Storefront, Admin, Member, or any page-serving route.
4. Require the existing versioned HMAC-SHA256 envelope for every request.
5. Execute as the deploying owner and access only the existing STAGING spreadsheet and private STAGING Drive folders.
6. Store its own `NOBI_GATEWAY_SECRET` in that API-only project's Script Properties.
7. Be deployed as a Web App with anonymous HTTP access only because Cloudflare server-to-server requests cannot rely on an interactive Google login; HMAC authentication and the action allowlist become mandatory application controls.

This is a **design recommendation, not an instruction to change the current deployment**. The existing HtmlService project must remain private and unchanged.

### Why this option

The current source has both `doGet(e)` (HtmlService page rendering) and `doPost(e)` (signed JSON gateway) in the same Apps Script project. Exposing that existing deployment to anonymous HTTP would expose the same deployment surface that contains the page renderer. The safer boundary is a separate API-only deployment with no page renderer.

A shared Apps Script library is not selected as the first option. The existing backend is tightly coupled to global constants, Script Properties, locks, persistence helpers, and many private helper functions. A library extraction would need a separate proof of execution context and resource ownership before it could safely replace a self-contained API-only project.

---

## 2. Source baseline and exact findings

Files inspected on `staging-runtime-test-kit`:

- `staging/browser-import/Code.gs`
- `staging/browser-import/Storefront.html`
- `staging/browser-import/Admin.html`
- `staging/browser-import/Member.html`
- `staging/browser-import/QrCode.html`
- `staging/browser-import/appsscript.json`
- `staging/README.md`
- `google-apps-script/13_HttpGateway.gs`
- `google-apps-script/01_HttpEntry.gs`

### 2.1 HtmlService coupling

The combined STAGING `Code.gs` contains:

- `doGet(e)`: selects Storefront, Admin, or Member and renders an HtmlService template.
- `include(filename)`: includes the QR-code HTML partial.
- `doPost(e)`: parses a signed JSON request and dispatches an allowlisted gateway action.

Therefore, the current project is both a page host and an API host. It must not be made public merely to let Cloudflare call `doPost`.

### 2.2 Existing gateway controls

The source defines:

- Gateway version: `1`.
- HMAC-SHA256 signature.
- Maximum clock skew: 5 minutes.
- Nonce syntax: 20–100 characters matching `[A-Za-z0-9_-]`.
- Nonce retention: 10 minutes.
- Nonce claim serialized with Script Lock and stored as a SHA-256 hash in `gateway_nonces`.
- Maximum request body: 7 MiB characters.
- Explicit action allowlist.
- Secret lookup from Script Property `NOBI_GATEWAY_SECRET`.
- JSON response envelope containing `ok`, `version`, and either `result` or `error`.

The gateway's `doPost` returns JSON through Apps Script ContentService. The caller must inspect the JSON `ok` property; it must not assume a normal HTTP status code is available for every application error.

### 2.3 Defect found in existing gateway allowlist

The dispatcher contains:

`case 'banners': return publicBanners();`

But `banners` is absent from `NOBI_GATEWAY.ALLOWED_ACTIONS`.

**Impact:** a signed request for the banner action is rejected by the allowlist before the dispatcher runs. This is a source-level compatibility defect. It must be fixed and covered by a gateway contract test during a separately approved implementation phase. No code was changed during this audit.

### 2.4 Existing setup constraint

`staging/README.md` instructs the operator:

- Keep the current STAGING Web App access set to **Only myself**.
- Do not add `NOBI_GATEWAY_SECRET` to that existing HtmlService project.
- Do not use Production IDs, credentials, or customer data.

These instructions remain binding for the current HtmlService project.

---

## 3. Browser-to-backend API compatibility matrix

The current HTML pages use `google.script.run`. Cloudflare Pages does not supply that Apps Script browser bridge. Each page must instead call same-origin Pages Functions routes.

The route list below is a proposed HTTP contract derived from the current page adapters and facade calls. It is not yet an implementation.

### 3.1 Public Storefront routes

| Proposed route | Method | Existing facade / gateway action | Auth | Notes |
|---|---|---|---|---|
| `/api/public/catalog` | GET | `nobiGetCatalog` / `catalog` | Public | Current games, packages and prices |
| `/api/public/promotions` | GET | `nobiGetPromotions` / `promotions` | Public | Active promotion data |
| `/api/public/banners` | GET | `nobiGetBanners` / `banners` | Public | Gateway allowlist currently missing this action |
| `/api/public/media/:fileId` | GET | `nobiGetPublicMedia` / `publicMediaData` | Public banner/catalog media only | Must not become a general Drive file proxy |
| `/api/public/coupons/validate` | POST | `nobiValidateCoupon` / `coupon` | Public; optional verified member session | Recompute eligibility and amount on server |
| `/api/public/coupons/suggestions` | GET | `nobiGetCouponSuggestions` / `couponSuggestions` | Public; optional verified member session | Query values are untrusted inputs |
| `/api/public/payment-info` | GET | `nobiGetPaymentInfo` / `paymentInfo` | Public | Amount must be validated server-side |
| `/api/public/orders` | POST | `nobiCreateOrder` / `createOrder` | Guest or verified Member | Preserve Idempotency-Key and checkout-token semantics |
| `/api/public/orders/:orderId/slip` | POST | `nobiSubmitOrderSlip` / `submitOrderSlip` | One-time checkout token | Enforce deadline, file type, size and one-time use server-side |

### 3.2 Member routes

| Proposed route | Method | Existing facade / gateway action | Auth | Notes |
|---|---|---|---|---|
| `/api/member/register` | POST | `nobiRegisterMember` / `memberRegister` | Public registration | Enforce existing Login ID/password rules |
| `/api/member/login` | POST | `nobiLoginMember` / `memberLogin` | Public login | Rate limit; do not log credentials |
| `/api/member/me` | GET | `nobiGetMemberSession` / `memberMe` | Member session | Return only authenticated state |
| `/api/member/logout` | POST | `nobiLogoutMember` / `memberLogout` | Member session | Revoke server-side session |
| `/api/member/password` | PATCH | `nobiChangeMemberPassword` / `memberChangePassword` | Member session | Revoke old sessions as currently specified |
| `/api/member/dashboard` | GET | `nobiGetMemberDashboard` / `memberDashboard` | Member session | Member-scoped data |
| `/api/member/orders` | GET | `nobiGetMemberOrders` / `memberOrders` | Member session | Member-scoped order history |

The Member HTML also calls the public catalog, order creation, payment information, and slip submission operations. Those should reuse the public route contract above rather than create a second implementation.

### 3.3 Admin routes

| Proposed route | Method | Existing facade / gateway action | Auth | Notes |
|---|---|---|---|---|
| `/api/admin/login` | POST | `nobiLoginAdmin` / `adminLogin` | Public login endpoint | Rate limit; no credential logging |
| `/api/admin/me` | GET | `nobiGetAdminSession` / `adminMe` | Admin session | Verify on server for every protected action |
| `/api/admin/logout` | POST | `nobiLogoutAdmin` / `adminLogout` | Admin session | Revoke session |
| `/api/admin/password` | PATCH | `nobiChangeAdminPassword` / `adminChangePassword` | Admin session | Revoke old sessions |
| `/api/admin/dashboard` | GET | `nobiGetAdminDashboard` / `adminDashboard` | Admin session | Admin-only metrics |
| `/api/admin/orders` | GET | `nobiGetAdminOrders` / `adminOrders` | Admin session | Admin-only |
| `/api/admin/orders/:orderId/status` | PATCH | `nobiSetAdminOrderStatus` / `adminSetOrderStatus` | Admin session | Enforce valid state transitions |
| `/api/admin/orders/:orderId/slip` | GET | `nobiGetAdminSlip` / `adminSlipData` | Admin session | Private slip bytes; never public URL |
| `/api/admin/members` | GET | `nobiGetAdminMembers` / `adminMembers` | Admin session | Validate search/limit |
| `/api/admin/member-login-logs` | GET | `nobiGetAdminMemberLoginLogs` / `adminMemberLoginLogs` | Admin session | Admin-only audit view |
| `/api/admin/members/:memberId/status` | PATCH | `nobiSetAdminMemberStatus` / `adminSetMemberStatus` | Admin session | Validate allowed status |
| `/api/admin/:table` | GET | `nobiListAdminRecords` / `adminList` | Admin session | Restrict table to games/packages/coupons/promotions |
| `/api/admin/:table` | POST | `nobiUpsertAdminRecord` / `adminUpsert` | Admin session | Allowlisted fields only |
| `/api/admin/:table/:id` | PUT | `nobiUpsertAdminRecord` / `adminUpsert` | Admin session | Immutable primary key handling |
| `/api/admin/:table/:id` | DELETE | `nobiDeleteAdminRecord` / `adminDelete` | Admin session | Restrict table and record ID |
| `/api/admin/upload` | POST | `nobiUploadAdminMedia` / `adminStoreMedia` | Admin session | Validate and re-encode image; private Drive |

### 3.4 Contract rules applying to every route

1. Pages Functions expose only the explicit routes above. Do not expose a generic `/api/action/:name` proxy.
2. Validate HTTP method, content type, payload shape, length, identifiers and numeric ranges at the Pages boundary and again in Apps Script business logic.
3. Do not trust a Member/Admin identity, role, price, discount, order status, expiry, or authorization flag supplied by the browser.
4. Member/Admin session validation remains server-side. Cloudflare Access is only the outer STAGING site gate; it is not application authorization.
5. Every state-changing route must have defined replay/idempotency behavior.
6. Return a stable JSON error envelope from Pages Functions. Map Apps Script `ok:false` and `error.code` values without exposing stack traces or internal identifiers.
7. Do not cache authenticated or private responses. Public catalog/banner cache policy must be explicit and short-lived.
8. Do not log passwords, tokens, HMAC signatures, slips, base64 uploads, private Drive identifiers or personal data.

---

## 4. Request signing contract

The current gateway's canonical JSON order is:

    {
      "version": 1,
      "timestamp": <Unix milliseconds>,
      "nonce": "<20-100 URL-safe characters>",
      "action": "<allowlisted action>",
      "args": { ... }
    }

The HMAC-SHA256 signature is calculated over the exact canonical JSON string produced by the Apps Script `gatewayCanonical_(envelope)` function. The transmitted envelope adds:

    "signature": "<64 lowercase hexadecimal characters>"

### Required client behavior

- Generate a cryptographically secure nonce for every attempt.
- Use the same exact canonical property order and JSON serialization as Apps Script.
- Use the same secret only in Cloudflare Pages Function server-side secret bindings and the API-only Apps Script Script Property.
- Never sign requests in browser JavaScript.
- Never reuse a nonce, including when retrying a timed-out request.
- Retry only operations with a safe idempotency strategy. A new signature/nonce does not make a duplicate order safe by itself.
- Verify the gateway response `version` and `ok` fields before using `result`.

### Important response transport detail

Apps Script ContentService responses may be served through a redirected content URL. The Cloudflare adapter must be integration-tested against the actual STAGING API-only deployment, including redirect handling, final content type, JSON parsing, timeout behavior and non-2xx/invalid response handling. Do not infer that a successful fetch call means the business operation succeeded; inspect the signed gateway JSON envelope.

---

## 5. API-only Apps Script isolation spike

### 5.1 Proposed project shape

Create a separate STAGING-only Apps Script project, provisionally named:

`Nobi Gaming STAGING API`

The project would be populated from a reviewed server-side source bundle derived from the existing STAGING Code.gs. It would contain:

- Required backend configuration and schema constants.
- Repository/Sheets helpers.
- Business logic used by the allowlisted gateway actions.
- Private Drive media/slip helpers.
- HMAC gateway verification, nonce ledger and explicit action dispatcher.
- One `doPost(e)` entry point.

It must exclude:

- `doGet(e)`.
- `include(filename)`.
- Storefront.html, Admin.html, Member.html and QrCode.html.
- Any HtmlService page rendering or template-serving function.
- Production IDs, Production credentials or Production data.

### 5.2 Deployment configuration

For the API-only project only:

- Execute as: owner/deployer.
- Access: anonymous HTTP access is required for Cloudflare server-to-server calls if no Google OAuth identity is used.
- Application authentication: HMAC-SHA256 is mandatory on every POST.
- The gateway must reject missing/invalid secret, invalid signature, stale timestamp, malformed nonce, replayed nonce, unknown action and malformed arguments.
- The API project Script Properties must point only to STAGING Sheet and STAGING private Drive folders.
- The current HtmlService STAGING Web App remains **Only myself** and is not redeployed or edited.

This public network endpoint is not considered private merely because its URL is obscure. Its protection depends on HMAC, strict allowlisting, rate controls, server-side authorization and monitoring. If anonymous Apps Script Web App access is not available for the user's Google account, stop and reassess rather than weakening the existing deployment.

### 5.3 Data and identity safety

The API-only project must use the same STAGING data resources but must not create a second database. The owner must verify the configured spreadsheet ID and private folder IDs directly in the Apps Script Script Properties before deployment. Those values must not be copied into GitHub documentation.

Member/Admin sessions and role checks must continue to be validated by the backend functions. Pages Functions must never decide that a request is Admin merely because it came from the Cloudflare Access-protected browser.

### 5.4 Source synchronization risk

A separate API-only project creates a source synchronization obligation. Before implementation, choose one controlled update method:

- A generated API-only import bundle committed to the allowed STAGING branch, with a documented reproducible exclusion list; or
- A manually maintained API-only Apps Script project with explicit source-diff checks against the canonical STAGING server bundle.

Do not rely on an undocumented manual copy. Any change to shared business logic must be tested against both the existing Apps Script browser test project and the API-only project.

### 5.5 Spike pass/fail tests

The architecture is accepted only if all tests pass:

- [ ] Existing HtmlService STAGING Web App remains Only myself.
- [ ] API-only project has no doGet or HtmlService page-rendering route.
- [ ] GET/HEAD requests to the API-only deployment cannot return Storefront/Admin/Member HTML.
- [ ] POST without signature is rejected.
- [ ] POST with invalid signature is rejected.
- [ ] Stale timestamp is rejected.
- [ ] Reused nonce is rejected.
- [ ] Unknown action is rejected.
- [ ] Banner action is explicitly allowlisted before banner route is accepted.
- [ ] Member action cannot access another member's data.
- [ ] Non-Admin action cannot read Admin slips or invoke Admin mutations.
- [ ] Only STAGING spreadsheet and STAGING Drive resources are reachable.
- [ ] HMAC secret is absent from browser assets, Git history and logs.
- [ ] No Production resource or deployment is touched.

---

## 6. Session transport decision

### Recommended first implementation

Preserve the existing opaque Apps Script Member/Admin session tokens at the backend, but do not expose them to browser storage or pass them in query strings.

Pages Functions should act as a same-origin session broker:

1. Browser logs in through Pages Functions.
2. Pages Functions calls the API-only Apps Script action.
3. The Apps Script token is stored server-side in a short-lived session record or encrypted server-side session store.
4. Browser receives only a random opaque session cookie with `Secure`, `HttpOnly`, `SameSite=Lax` (or stricter where compatible), and an appropriate `Path`.
5. Every protected Pages Function resolves the cookie to the backend token and rechecks Member/Admin authorization at Apps Script.
6. Logout, password change, expiry and suspension revoke both the Apps Script token and the Pages-side session.
7. State-changing requests require CSRF protection and same-origin validation.

This is a design target, not yet proven compatible with the current Apps Script session persistence. The current Member page stores its token in JavaScript memory; the Admin page also keeps an Admin token in page JavaScript. The migration should improve token isolation rather than reproduce that exposure.

### Session storage decision required

Before implementation, choose a supported Cloudflare-side session store. Do not assume Pages Functions have durable process memory. Evaluate the free-tier suitability and consistency requirements of Cloudflare D1 or Durable Objects, including the operational cost/limits, before selecting. If no persistent Cloudflare-side session store is approved, an alternative must be designed without placing backend tokens in the browser.

---

## 7. Upload and private media contract

### Slip upload

- Browser sends the slip to same-origin Pages Function.
- Pages Function checks content length and multipart structure.
- API-only Apps Script validates the one-time checkout token, order ownership/eligibility, deadline and allowed file type.
- Maximum application upload remains 3 MiB.
- Accepted formats remain PNG, JPEG and WebP.
- Server must decode/re-encode the image before storing it in the private STAGING Slips folder.
- Never return a Drive share URL.

### Admin media upload

- Admin-only route.
- Same 3 MiB application limit unless separately approved.
- PNG/JPEG/WebP only.
- Server-side content validation and re-encoding.
- Save only to the private STAGING Media folder.
- Return an opaque media reference or same-origin URL, not a public Drive URL.

### Public banner/catalog media

- Only media intentionally marked for public storefront display can be returned to unauthenticated storefront requests.
- The endpoint must validate that the file ID belongs to a public catalog/banner record before reading it.
- It must not become a generic Drive file-ID fetch endpoint.
- Private slips must never be reachable through this endpoint.

---

## 8. Cloudflare Pages and GitHub Actions contract

### Deployment model

Use Cloudflare Pages Direct Upload with Wrangler invoked by GitHub Actions, targeting a dedicated STAGING Pages project. The workflow must trigger only on push to `staging-runtime-test-kit`, fail closed on any other ref, and deploy no unreviewed artifact.

### Branch and workflow guardrails

- Exact branch filter: `staging-runtime-test-kit`.
- Job-level check that `github.ref` equals `refs/heads/staging-runtime-test-kit`.
- Minimal GitHub token permissions.
- Concurrency group to prevent overlapping deployments.
- Build and tests must pass before deploy.
- No deployment from pull requests or forks.
- No workflow trigger on main or wildcard branch.
- No secrets printed in logs.
- Cloudflare API token restricted to the required account and Pages deployment permission.
- Project name fixed to the STAGING Pages project; no Production project variable.

### Important Cloudflare project choice

Cloudflare documents that a Pages Direct Upload project cannot later be converted into a Git-integrated Pages project. This trade-off must be accepted before the project is created. The user's requested GitHub Actions + Wrangler deployment path is compatible with Direct Upload.

---

## 9. API contract error model

Pages Functions should expose a stable error shape, for example:

    {
      "ok": false,
      "error": {
        "code": "VALIDATION_FAILED",
        "message": "Request could not be completed"
      }
    }

The adapter should preserve safe application messages for expected validation errors, but never return stack traces, Apps Script internals, property names, secret state, spreadsheet IDs, Drive IDs or raw exception objects.

Minimum mapped error categories:

- `UNAUTHENTICATED`
- `FORBIDDEN`
- `VALIDATION_FAILED`
- `RESOURCE_NOT_FOUND`
- `RESOURCE_EXPIRED`
- `RESOURCE_CONFLICT`
- `RATE_LIMITED`
- `GATEWAY_NOT_CONFIGURED`
- `UPSTREAM_UNAVAILABLE`
- `UPSTREAM_INVALID_RESPONSE`
- `INTERNAL_ERROR`

---

## 10. Phase 1 decision record

| Decision | Recommendation | Status |
|---|---|---|
| Keep current Apps Script HtmlService deployment private | Yes, Only myself | Fixed constraint |
| Expose existing combined doPost deployment publicly | No | Rejected |
| Create separate API-only Apps Script STAGING project | Yes | Recommended; owner approval required before creation |
| Use HMAC v1 as server-to-server authentication | Yes, after contract tests | Recommended |
| Add missing banners action to allowlist | Yes | Confirmed source defect; code fix requires implementation approval |
| Use Pages Functions as explicit API adapter | Yes | Recommended |
| Generic arbitrary-action proxy | No | Rejected |
| Keep Member page in migration | Yes | Required dependency |
| Preserve UI as source baseline | Yes | Fixed user direction |
| Store Apps Script tokens in browser localStorage | No | Rejected |
| Use secure same-origin session cookie | Yes, subject to persistent-store design | Recommended |
| Use Cloudflare Pages Direct Upload + Wrangler | Yes | Recommended; irreversible project-type trade-off |
| Deploy to Production | No | Prohibited |

---

## 11. Remaining blockers before Phase 2

1. Owner explicitly approves creation of a separate API-only Apps Script STAGING project.
2. Confirm the Google account can deploy that API-only project with anonymous access while keeping the existing HtmlService deployment private.
3. Approve the source synchronization strategy for the API-only bundle.
4. Complete field-level request/response schemas and validation for every route.
5. Select and approve a Cloudflare-side persistent session store, or a compatible alternative.
6. Verify Apps Script ContentService redirect behavior from a Pages Function against a test-only API deployment.
7. Fix the missing `banners` action in the gateway allowlist and add regression tests during implementation.
8. Confirm current Cloudflare Access and Pages Functions quotas/limits before creating resources.

---

## 12. Official references

- Apps Script Web Apps: https://developers.google.com/apps-script/guides/web
- Apps Script Web App and API executable access configuration: https://developers.google.com/apps-script/manifest/web-app-api-executable
- Apps Script Libraries: https://developers.google.com/apps-script/guides/libraries
- Apps Script deployments: https://developers.google.com/apps-script/concepts/deployments
- Cloudflare Pages Direct Upload: https://developers.cloudflare.com/pages/get-started/direct-upload/
- Cloudflare Pages Direct Upload with CI: https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/
- Cloudflare Pages Functions: https://developers.cloudflare.com/pages/functions/get-started/

---

## 13. Phase 1 completion checklist

- [x] Re-opened the exact STAGING branch source files.
- [x] Mapped Storefront, Member and Admin facade operations to proposed HTTP routes.
- [x] Identified the combined doGet/doPost exposure risk.
- [x] Identified the missing banners action in the Gateway allowlist.
- [x] Recommended a separate API-only Apps Script STAGING boundary.
- [x] Defined HMAC v1 requirements and known response-handling constraints.
- [x] Defined Member/Admin session and private media design requirements.
- [x] Documented GitHub Actions / Cloudflare Pages deployment constraints.
- [ ] Owner approval for API-only Apps Script project creation.
- [ ] Phase 2 implementation authorization.

**No application code, Cloudflare resources, Apps Script settings, deployments, Sheets, Drive folders, or Production resources were changed during Phase 1.**
