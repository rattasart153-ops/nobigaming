# Nobi Gaming — Cloudflare Pages STAGING Migration Plan

- **Status:** Draft — Read-only audit completed; implementation not authorized
- **Repository:** rattasart153-ops/nobigaming
- **Allowed branch:** staging-runtime-test-kit only
- **Target:** Private Cloudflare Pages STAGING site deployed by GitHub Actions
- **Primary frontend source:** Apps Script STAGING Storefront.html, Admin.html and required Member.html
- **Backend/data:** Existing Google Apps Script STAGING, Google Sheets STAGING and private Google Drive STAGING
- **Production:** Out of scope and must remain untouched

> This document records the plan and audit findings. It does not authorize application-code changes, Cloudflare resource creation, Apps Script configuration/deployment changes, or Production activity.

---

## 1. Goals and non-goals

### Goals

1. Serve the Nobi Gaming STAGING storefront and Admin experience from Cloudflare Pages.
2. Use GitHub Actions and Wrangler for controlled deployment from one explicitly allowed branch.
3. Keep the site private so only the owner can access it during testing.
4. Preserve the current Apps Script STAGING business logic and STAGING-only data resources wherever practical.
5. Keep slips and media in the existing private STAGING Drive folders.
6. Make the browser communicate with same-origin Cloudflare Pages Functions; Pages Functions communicate with a separately secured server-side API boundary.
7. Test Storefront, Member and Admin flows before considering any later scope.

### Non-goals

- No Production migration, deployment, domain, credentials, data, Apps Script, Sheets or Drive changes.
- No merge to main, vercel-drive-setup, or any branch other than the authorized STAGING branch.
- No HubZell integration or automatic provider ordering.
- No replacement of Google Sheets or Google Drive in this phase.
- No public launch or public customer traffic.
- No domain purchase or paid Cloudflare plan without separate approval.

---

## 2. Non-negotiable repository and environment controls

| Area | Rule |
|---|---|
| GitHub repository | rattasart153-ops/nobigaming |
| Working branch | staging-runtime-test-kit only |
| Forbidden branches | main, vercel-drive-setup and all other branches |
| GitHub source of truth | Yes |
| Cloudflare project | New, dedicated STAGING project only |
| Apps Script | Existing Nobi Gaming STAGING project only, unless a separate API-only project is later approved |
| Google Sheets | Nobi Gaming STAGING DB only |
| Google Drive | STAGING Slips and STAGING Media folders only |
| Customer data | Synthetic test data only |
| Credentials | Never put secrets in source, commits, chat, screenshots or logs |
| Production | Must remain disconnected and untouched |

Every implementation task must re-check the current branch before writing. Every GitHub write must explicitly target staging-runtime-test-kit. Do not create a workflow that runs on main, wildcard branches or untrusted pull requests.

---

## 3. Read-only audit findings

These findings were checked against the files in staging-runtime-test-kit on 25 November 2026.

### 3.1 Current STAGING browser bundle

| File | Observed role | Cloudflare migration implication |
|---|---|---|
| staging/browser-import/Storefront.html | Storefront UI, browser-side request adapter, banner carousel, checkout and member entry points | Convert from Apps Script RPC to same-origin HTTP endpoints |
| staging/browser-import/Admin.html | Admin login/dashboard; local api() adapter maps REST-like paths to nobiAdminRpc calls | Preserve UI and replace RPC transport with same-origin HTTP |
| staging/browser-import/Member.html | Member login/register, dashboard, coupon rewards, order history and member checkout | Preserve as a required page; replace direct Apps Script RPC calls |
| staging/browser-import/QrCode.html | Included by Apps Script template syntax | Bundle or serve as a static local asset; Apps Script template directives will not execute on Pages |
| staging/browser-import/Code.gs | Combined Apps Script server-side code and browser facade | Remains the STAGING business-logic source unless API isolation is separately approved |
| staging/browser-import/appsscript.json | Apps Script V8 manifest and Asia/Bangkok timezone | Relevant to Apps Script, not a Cloudflare Pages config |

### 3.2 Frontend transport findings

- Storefront defines a browser adapter around google.script.run. Its apiRequest() function translates REST-like paths for catalog, promotions, banners, coupons, payment information, orders, member login and session actions into named Apps Script facade calls.
- Admin has a local REST-like api() adapter. It translates Admin routes for login, dashboard, orders, slip retrieval, member administration, member login logs, CRUD, uploads and logout into nobiAdminRpc calls.
- Member defines rpc() and directly invokes named Apps Script facade functions through google.script.run.
- The Apps Script HTML entry point uses doGet(e) to choose Storefront, Admin or Member, and uses a template include for QrCode.html.
- Cloudflare Pages does not provide the Apps Script browser global google.script.run, Apps Script doGet routing or Apps Script template evaluation. These must be replaced; copying the HTML files unchanged is not a working migration.

### 3.3 Existing Apps Script HTTP Gateway findings

The STAGING bundle contains a signed HTTP doPost(e) gateway in addition to the HtmlService doGet(e) page entry point.

Observed controls in the gateway source:

- Gateway version is currently 1.
- HMAC-SHA256 signature validation is used.
- Request timestamp skew is limited to 5 minutes.
- Nonces are checked and retained for 10 minutes in a gateway_nonces sheet under a script lock.
- The gateway has an explicit action allowlist covering public catalog/order operations, member operations, admin operations and media operations.
- The gateway reads NOBI_GATEWAY_SECRET from Apps Script Script Properties.
- The gateway returns a JSON envelope; Apps Script ContentService does not provide arbitrary HTTP status codes, so callers must inspect the JSON ok field.

**Critical existing setup rule:** staging/README.md explicitly says not to add NOBI_GATEWAY_SECRET, not to use Production IDs/credentials, and to deploy the existing STAGING HtmlService Web App with access set to **Only myself**. The current deployment must remain that way.

The current doGet and doPost handlers are in the same Apps Script project/bundle. Simply making the existing HtmlService deployment public to expose doPost could also expose its page-serving doGet route. Do not change the existing deployment's access setting as a shortcut.

### 3.4 Existing backend/data safety

- The browser facade dispatches through a named allowlist and validates facade payloads before calling backend actions.
- Slip and media operations use the existing private Drive storage flow.
- Existing setup instructions require the STAGING spreadsheet and folders, STAGING-only Script Properties and an Admin credential created specifically for STAGING.
- The existing setup guide instructs the operator not to add gateway secrets or Production identifiers to this STAGING project.

---

## 4. Target architecture

Proposed request path:

    GitHub: staging-runtime-test-kit
              |
              | push to the one allowed branch
              v
    GitHub Actions
      - branch guard
      - tests / static checks
      - build static Pages assets + Pages Functions
      - deploy with Wrangler
              |
              v
    Cloudflare Pages — private STAGING project
      - /             Storefront
      - /admin        Admin
      - /member       Member
      - /api/*        Pages Functions
              |
              | signed server-to-server request
              v
    Dedicated, secured Apps Script API boundary (design decision pending)
              |
              v
    STAGING business logic + STAGING Sheets + private STAGING Drive

The existing Apps Script HtmlService deployment remains private (Only myself) and is not repurposed as a public API endpoint.

### 4.1 API boundary is a blocking design decision

The existing Apps Script bundle combines the page-serving doGet and signed API doPost handlers. Its setup guide prohibits adding the gateway secret to the current project and requires the existing Web App to remain private.

Before implementation, conduct a small architecture/design spike to select a safe API isolation method. Candidates to evaluate:

1. A separate API-only Apps Script project that exposes only the signed API entry point and securely reuses the STAGING business logic.
2. A carefully versioned shared Apps Script library or other supported code-sharing design, with explicit review of Apps Script library execution identity, Script Properties, scopes and data access.
3. Another Google-supported server-to-server integration that does not require making the current HtmlService deployment public.

The spike must prove all of the following before a decision is accepted:

- The current HtmlService Web App remains Only myself.
- No public route can render Storefront, Admin or Member from the current Apps Script deployment.
- The API-only boundary can access only STAGING Sheets and STAGING Drive.
- HMAC secrets remain server-side and are never sent to a browser.
- Sensitive operations still validate Member/Admin sessions and permissions inside trusted server-side code.
- Nonce/replay protection remains effective.
- No Production Script ID, spreadsheet ID, folder ID, credentials or customer data is introduced.

Do not assume that copying 13_HttpGateway.gs into another project is sufficient: the gateway dispatcher depends on business-logic functions, shared constants, persistence helpers and Script Properties from the combined project.

---

## 5. Frontend migration inventory

The target pages should preserve the current Apps Script STAGING UI as the baseline. This phase is a transport/runtime migration, not a redesign.

| UI area | Current behavior | Required Pages implementation |
|---|---|---|
| Storefront | google.script.run wrapped by nobiRpc and apiRequest() | Same-origin /api/* calls to Pages Functions |
| Catalog and prices | Catalog RPC | Read from STAGING backend; never hardcode live prices as authoritative |
| Promotions and coupons | Promotion/banner RPC and coupon validation/suggestions RPC | Same-origin API routes with server-side validation |
| Banner carousel | Reads active banners and resolves private media through backend; IndexedDB cache | Keep carousel behavior; use a safe media endpoint and do not expose Drive URLs |
| Guest checkout | Create order, receive checkout token, upload slip | Preserve server-side validation, idempotency, expiry and one-time upload authorization |
| Member login/register | Member facade calls and in-memory token | Design secure session transport; do not put long-lived credentials in browser storage |
| Member page | Direct RPC calls for dashboard, orders, coupons, catalog, order and slip submission | Map each operation to same-origin Pages Functions |
| Admin login | REST-like local paths mapped to nobiAdminRpc | Same-origin Admin API; server-side Admin authorization on every action |
| Admin orders/slips | Orders list, status changes, slip retrieval | Keep slip access Admin-only and private |
| Admin CRUD | Games, packages, coupons, promotions | Validate allowlisted tables, fields and actions on the server |
| Admin uploads | Image converted to base64 and sent to Admin facade | Preserve file type/size checks and server-side image validation/re-encoding |
| QR code helper | Apps Script template include | Bundle as a local static module/script |
| Page routing | Apps Script doGet query/path routing | Pages routes or explicit static route mapping for /, /admin and /member |

### 5.1 Required route inventory

Create a versioned API contract before coding. At minimum, map the existing UI operations into route groups:

- Public: catalog, promotions, banners, public media, coupon validation, coupon suggestions, payment information, order creation and slip submission.
- Member: register, login, session/me, logout, password change, dashboard, order history, member checkout and slip submission.
- Admin: login, logout, session/me, password change, dashboard, orders, order status, slip retrieval, games/packages/coupons/promotions CRUD, member list/status, member login logs and media upload.

The API contract must record HTTP method, request schema, response schema, authentication requirement, authorization rule, rate limit, idempotency behavior, file limits and error mapping for every route. Do not implement undocumented routes or a generic arbitrary-action proxy.

---

## 6. Authentication, privacy and data handling

### 6.1 Private site access

The Pages project must be private from its first deployment.

- Configure Cloudflare Access to allow only the owner's explicitly selected identity.
- Protect both Pages preview deployment hostnames and the project's *.pages.dev hostname. Cloudflare documentation notes that enabling preview access alone does not necessarily protect the main *.pages.dev hostname.
- Test unauthenticated access to every hostname and every route, including /api/*.
- Do not treat an obscure URL or an unlinked page as access control.
- Do not publish the STAGING URL publicly.

### 6.2 Member/Admin sessions

The current browser pages keep some session tokens in JavaScript memory. Moving to Pages changes the origin and request boundary. Before coding, define and test:

- Whether Pages Functions will maintain the existing opaque server-side session tokens or exchange them for a new cookie-based session.
- Prefer secure, HttpOnly, SameSite cookies for browser sessions where compatible with the existing backend.
- CSRF protection for state-changing requests.
- Origin/Host validation for same-origin mutations.
- Session idle timeout, absolute lifetime, logout revocation, password-change revocation and account suspension behavior.
- Separate Member and Admin authorization checks on every protected API operation.
- No session tokens, passwords, HMAC keys or Admin secrets in localStorage, IndexedDB, URLs, analytics, error messages or logs.

Cloudflare Access protects entry to the STAGING site; it does not replace application-level Member/Admin authorization.

### 6.3 Private media and slip uploads

- Google Drive folders remain private.
- Never return a public Drive share link or permanent public URL for a slip.
- Admin slip retrieval must require an authenticated Admin session and server-side authorization for the specific order.
- Member/Guest slip upload must use the order's existing checkout token and server-side expiry checks.
- Keep the existing PNG/JPEG/WebP policy and 3 MiB application limit unless a separate approved change is made.
- Validate file signatures/content server-side; do not trust the browser MIME type or filename.
- Avoid logging base64 content, slip bytes, payment identifiers or private Drive IDs.
- Review Cloudflare Pages Functions request-size and runtime limits before choosing the upload transport.

### 6.4 Server-to-server HMAC

If the API isolation spike selects the existing HMAC protocol, the Pages Function must sign the canonical envelope server-side. The shared secret belongs only in a Cloudflare secret binding and Script Properties of the dedicated API boundary. It must never appear in static assets, browser JavaScript, GitHub source, build logs or chat.

The current gateway protocol's version, canonical JSON property order, timestamp window, nonce format, replay ledger and action allowlist must be covered by automated contract tests. Any protocol change requires a versioned migration, not an unreviewed one-sided change.

---

## 7. GitHub Actions and Cloudflare deployment design

### 7.1 Project creation choice

Use a new Cloudflare Pages **Direct Upload** project, deployed by Wrangler from GitHub Actions.

This is preferred over connecting the Pages project to Git integration because the user selected GitHub Actions as the controlled deployment mechanism and requires a strict single-branch gate.

**Important Cloudflare constraint:** Cloudflare documents that a Pages project created with Direct Upload cannot later be converted to Git integration. If Git integration is needed in the future, a new project would be required. Confirm this trade-off before creating the Cloudflare project.

Pages Functions must be included in the Wrangler deployment using the supported Pages Functions project structure; dashboard drag-and-drop upload alone is not the deployment method for this architecture.

### 7.2 Workflow trigger and permissions

The future workflow should follow these rules:

- Trigger on push to exactly staging-runtime-test-kit.
- Optional manual trigger only if it deploys the same STAGING artifact to the same STAGING project.
- No main, wildcard branch, tag or untrusted pull-request deployment trigger.
- Use minimal GitHub token permissions (read-only contents unless a narrowly justified permission is required).
- Use a concurrency group so two STAGING deployments cannot race.
- Fail closed if the checked-out branch/ref is not exactly the allowed branch.
- Run tests and build before deployment; no deploy if any check fails.
- Pin third-party Actions to reviewed immutable commit SHAs where practical.
- Do not echo environment variables or secrets.
- Record the Git commit SHA and Cloudflare deployment identifier in the workflow summary.

### 7.3 GitHub Secrets and Cloudflare settings

Expected CI credentials, to be configured by the owner only after the workflow and project are reviewed:

| Secret / setting | Purpose | Handling |
|---|---|---|
| CLOUDFLARE_ACCOUNT_ID | Select the Cloudflare account | GitHub Actions Secret |
| CLOUDFLARE_API_TOKEN | Deploy to Pages | Account-scoped token with only the required Pages Edit permission |
| CLOUDFLARE_PAGES_PROJECT | Target project name | Non-secret variable, if supported by workflow design |
| API shared secret | Sign server-to-server API requests, if approved HMAC design is used | Cloudflare secret binding + dedicated API project's Script Property only; never a source file or browser variable |

Do not create or request these credentials during the documentation phase. Do not ask the user to paste them into chat.

### 7.4 Build output

The build output must contain only reviewed static frontend assets and Pages Functions required for STAGING. It must not include:

- Apps Script Script Properties or deployment URLs not intended to be public.
- Service account files, API tokens, private keys, .env files or local credential stores.
- SQLite databases, session databases, test customer data, private uploads or local data directories.
- Production configuration or secrets.
- Unneeded Express server files or the legacy Node server runtime.

---

## 8. Implementation phases and approval gates

| Phase | Work | Exit criteria | Approval |
|---|---|---|---|
| 0. Read-only audit | Source inspection and this plan | Findings and blockers documented | Completed |
| 1. API contract + architecture spike | Map frontend RPCs; prove safe API isolation without changing the current private Web App | Approved architecture decision, threat model and route contract | Required |
| 2. Frontend extraction | Create Pages-compatible static pages from the selected Apps Script HTML sources; replace template includes and page routing | Pages preview build succeeds; no google.script.run dependency remains | Required |
| 3. Pages Functions adapter | Implement explicit route handlers, auth, session, upload and error handling | Contract tests pass; no secret in client bundle | Required |
| 4. Private Cloudflare setup | Owner creates new Pages Direct Upload project and Access policies | All Pages hostnames and API routes are private | Required |
| 5. GitHub Actions CI/CD | Add branch-restricted test/build/deploy workflow | Wrong branch cannot deploy; failed checks block deployment | Required |
| 6. STAGING end-to-end tests | Test Storefront, Member, Admin, orders, slips, media, coupons, banners and security | Test checklist passes with synthetic data | Required |
| 7. STAGING acceptance | Review deployment, secrets, access and rollback | Owner accepts STAGING; Production remains unchanged | Required |

No phase automatically authorizes the next phase. Each phase requires explicit approval before the corresponding code or cloud changes.

---

## 9. Test plan and acceptance criteria

### 9.1 Access and isolation

- [ ] Unauthenticated visitor cannot load the main pages.dev hostname.
- [ ] Unauthenticated visitor cannot load preview/branch aliases.
- [ ] Unauthenticated visitor cannot call Pages Functions API routes.
- [ ] Only the owner's approved identity can pass Cloudflare Access.
- [ ] Existing Apps Script HtmlService STAGING URL still requires Google sign-in as Only myself.
- [ ] No request reaches Production Apps Script, Sheets, Drive or credentials.
- [ ] No Production URL or identifier is present in the Pages build output.

### 9.2 Storefront

- [ ] Storefront renders at /.
- [ ] Catalog, game list, package list and prices are loaded from STAGING Sheets.
- [ ] Promotions and coupons load and validate correctly.
- [ ] Banner carousel loads, rotates, pauses and caches as intended.
- [ ] Private banner/media retrieval does not expose Drive URLs.
- [ ] Guest order creation and idempotency work.
- [ ] Coupon expiry and payment deadline rules are enforced server-side.
- [ ] Slip upload works with allowed file types and size.
- [ ] Invalid, expired or reused checkout tokens are rejected.

### 9.3 Member

- [ ] Member page renders at /member.
- [ ] Register/login/logout work.
- [ ] Member dashboard, 30-day spend and coupon rewards load correctly.
- [ ] Member order history is scoped to the authenticated member.
- [ ] Password change revokes the old session.
- [ ] Suspended/revoked/expired sessions cannot access protected routes.
- [ ] Member order and slip flows work without exposing another member's data.

### 9.4 Admin

- [ ] Admin page renders at /admin.
- [ ] Admin login/logout and session validation work.
- [ ] Dashboard counts and revenue use STAGING data.
- [ ] Orders and slip viewing work; slip viewing is Admin-only.
- [ ] Order status transitions enforce existing server rules.
- [ ] Games, packages, coupons and promotions CRUD work.
- [ ] Member search/status and login-log views are Admin-only.
- [ ] Media uploads remain private.
- [ ] A Member or unauthenticated caller cannot invoke Admin APIs.

### 9.5 CI/CD and rollback

- [ ] Push to staging-runtime-test-kit runs tests and builds.
- [ ] Only the approved STAGING Pages project is deployed.
- [ ] A push to main does not run this deployment workflow.
- [ ] A simulated wrong-branch invocation fails before deployment.
- [ ] Failed tests/build do not deploy.
- [ ] Workflow logs contain no credentials, tokens, slips or personal data.
- [ ] A previous known-good STAGING deployment can be restored without touching Production.

---

## 10. Rollback strategy

1. Stop further deployments by disabling the STAGING workflow or revoking its narrowly scoped token if compromise is suspected.
2. Identify the last known-good STAGING deployment and its Git commit SHA.
3. Redeploy the known-good artifact to the STAGING Pages project only.
4. If an API boundary is involved, disable or roll back that STAGING endpoint independently.
5. Revoke and rotate only STAGING secrets if exposed.
6. Confirm the existing Apps Script HtmlService STAGING deployment remains private and unchanged.
7. Confirm Production branches, deployments, Apps Script, Sheets and Drive were not changed.

Do not use a Production deployment as a rollback target.

---

## 11. Cost and operational assumptions

- Use Cloudflare Free where required Pages, Access and Functions capabilities and quotas are sufficient.
- Use the existing GitHub account and available Actions quota.
- Continue using the existing Google account and STAGING resources.
- Use the assigned pages.dev hostname; no domain purchase is required for initial STAGING.
- Check current Cloudflare and GitHub quotas before enabling automation.
- Stop and ask for approval if the dashboard requests billing activation, a paid upgrade or a paid add-on.

A zero-cost target is a planning goal, not a guarantee of unlimited usage or permanent free availability.

---

## 12. Open decisions / blockers

These items must be resolved before implementation:

1. **API isolation:** How to expose a signed server-to-server API without making the current HtmlService Web App public. This is the main blocker.
2. **Session transport:** Whether Pages Functions will maintain the existing opaque server-side session tokens or introduce secure HttpOnly cookie sessions, with backend compatibility and CSRF controls.
3. **Cloudflare Access identity:** Confirm the exact owner identity to allow in Cloudflare Access. Do not store that identity in public source.
4. **Pages Direct Upload commitment:** Confirm acceptance that a Direct Upload project cannot later be converted to Git integration; a new project would be needed to switch.
5. **Pages Functions upload limits:** Verify current request body, runtime and execution limits against the existing 3 MiB slip/media application limits.
6. **Route contract:** Complete a method-by-method inventory and schema for every Storefront, Member and Admin operation before implementing the adapter.

---

## 13. Source references

### Repository files inspected

- staging/browser-import/Storefront.html
- staging/browser-import/Admin.html
- staging/browser-import/Member.html
- staging/browser-import/Code.gs
- staging/browser-import/appsscript.json
- staging/README.md
- staging/BROWSER_ONLY_SETUP.md
- staging/TEST_CHECKLIST.md
- google-apps-script/01_HttpEntry.gs
- google-apps-script/13_HttpGateway.gs

### Official Cloudflare documentation

- Pages Direct Upload: https://developers.cloudflare.com/pages/get-started/direct-upload/
- Direct Upload with CI: https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/
- Pages Preview Deployments and Access: https://developers.cloudflare.com/pages/configuration/preview-deployments/
- Pages Functions: https://developers.cloudflare.com/pages/functions/get-started/
- Pages Functions Wrangler configuration: https://developers.cloudflare.com/pages/functions/wrangler-configuration/
- Pages known issues / protecting *.pages.dev: https://developers.cloudflare.com/pages/platform/known-issues/

---

## 14. Current execution status

- [x] Read-only source audit
- [x] Confirmed primary frontend source: Apps Script STAGING Storefront and Admin
- [x] Included Member page as a required dependency
- [x] Documented current Apps Script Gateway and existing private-deployment constraint
- [x] Drafted Cloudflare Pages + GitHub Actions STAGING plan
- [ ] API isolation architecture spike
- [ ] API contract approval
- [ ] Frontend extraction
- [ ] Pages Functions implementation
- [ ] Cloudflare Pages project creation
- [ ] Cloudflare Access configuration
- [ ] GitHub Actions workflow
- [ ] STAGING deployment and acceptance

**No application code, Cloudflare resources, Apps Script settings, deployments, Sheets, Drive folders or Production resources were changed as part of this document.**
