# Pre-P1.3 Completion Register

- **Repository:** `rattasart153-ops/nobigaming`
- **Branch:** `staging-runtime-test-kit` only
- **Purpose:** Close or explicitly resolve incomplete P1.1/P1.2 operational work before P1.3.
- **Safety:** STAGING source and synthetic tests only. No Apps Script project, Script Properties, Google Sheets, Drive, Cloudflare resource, trigger, or deployment is changed by this register.

## Ordered work

### 1. Server-side image decode/re-encode for top-up proof

**Status: REAL JPEG/PNG/WEBP DECODE–RE-ENCODE VERIFIED IN LOCAL WORKERD; PAGES ROUTE AND DRIVE INTEGRATION REMAIN.**

The API-only Apps Script still does not decode pixels. The trusted sanitizer is now implemented as a Cloudflare workerd-compatible module and has been exercised with the real SIP/WebP WASM codecs inside the local workerd runtime.

Implementation:
- `functions/_shared/slip-image-sanitizer.mjs`: full envelope checks, request body cap, pixel/dimension limits, decode/re-encode factory, output JPEG verification.
- `functions/_shared/sip-adapter.ts`: SIP workerd adapter and separately loaded WebP codec WASM.
- `workerd-test/worker.ts`: isolated Worker harness, not a Pages route or deploy target.
- `workerd-test/slip-image-sanitizer.workerd.mjs` and `workerd-test/fixtures.mjs`: actual runtime fixtures and integration tests.
- `vitest.image-sanitizer.config.mjs` and `wrangler.image-sanitizer-test.jsonc`: local workerd test configuration.
- `staging/CLOUDFLARE_IMAGE_SANITIZER.md`: detailed limits, dependency and verification notes.

The root package pins `@standardagents/sip@1.0.1` and `@jsquash/webp@1.5.0`. The sanitizer accepts JPEG, PNG and static WebP, caps input at 3 MiB, each dimension at 4,096 px and total pixels at 4 megapixels, rejects APNG/animated WebP and trailing payloads, and emits a fresh JPEG no larger than 2,500,000 bytes with dimensions no larger than 2,048 px.

**Verified on commit `1ef9a1b97825a49a7df109024f4b5de332962a8e`:**
- Node/VM regression suite: **208/208 passed**.
- Real Cloudflare workerd sanitizer suite: **9/9 passed**.
- Real JPEG, PNG and WebP inputs were decoded and re-encoded; generated JPEGs were decoded again.
- EXIF metadata was removed from a JPEG fixture.
- Real APNG and animated WebP fixtures were rejected.
- MIME mismatch, appended JPEG payload, 5-megapixel input header (rejected before decode), and streamed body over 3 MiB were rejected.
- [GitHub Actions run 45849308801](https://github.com/rattasart153-ops/nobigaming/actions/runs/45849308801) completed successfully.

**Still not proven / release blockers:**
1. The isolated test proves local workerd and compiled-WASM compatibility, not a deployed Cloudflare Pages Function.
2. Peak memory/CPU at the maximum 4-megapixel WebP size has not been benchmarked under deployed Cloudflare limits; keep the pixel cap.
3. The authenticated Member upload route, CSRF/origin checks, signed Apps Script handoff and actual private Drive write path are not integrated.
4. Live Drive ACLs, Apps Script V8 behavior, deployed quotas and end-to-end proof retrieval remain unverified.

No Cloudflare resource, deployment, Apps Script project, Script Property, Sheet, Drive file, trigger or financial writer gate was changed by this work. Proof uploads remain disabled until the real Pages route and private Drive path are integrated and verified.

### 2. Top-up expiry worker scheduling

**Status: SOURCE AND SYNTHETIC APPS SCRIPT VM TESTS PASS; NOT ACTIVATED.**

- `runWalletTopupExpiry()` expires only `AWAITING_PROOF` requests at or after 24 hours; `PENDING_REVIEW` is not auto-expired.
- `ensureWalletTopupExpiryTrigger()` is a manual installer, not called at load time and not exposed through the signed gateway action allowlist.
- Installer fails closed unless all three single-writer gates are enabled.
- It creates an every-15-minute time-driven trigger and records the immutable trigger ID in `NOBI_WALLET_TOPUP_EXPIRY_TRIGGER_ID`.
- On repeat calls it preserves the trigger whose ID matches the stored marker and removes extra handler duplicates.
- If it finds handler triggers that are not marked as installer-managed, it removes them and creates a fresh 15-minute trigger because Apps Script does not expose the configured minute interval for an existing trigger.
- Synthetic GAS VM tests verify: no automatic install on source load; a closed gate creates nothing; first install creates the 15-minute trigger; repeat install is idempotent; unknown schedules are replaced; and duplicate handler triggers are removed.
- The Node regression suite passed **210/210 tests** and the Workerd image suite passed **9/9** on commit `70925e03eead823d099246859cd2b7a602b33ea1` in [GitHub Actions run 45849694382](https://github.com/rattasart153-ops/nobigaming/actions/runs/45849694382).

**Not activated:** no real Apps Script trigger has been installed, the trigger marker property has not been set in any live project, and no single-writer gate has been enabled. Actual installation must wait until the legacy financial writer is disabled, the API-only project is approved as sole writer, and the owner separately approves activation.

### 3. Member/Admin API and UI integration

**Status: AUTH/SESSION FOUNDATION IMPLEMENTED AND NODE/VM TESTED; WALLET BUSINESS ROUTES AND UI REMAIN.**

Explicit Pages Function auth routes now exist:
- Member: register, login, me, logout.
- Admin: login, me, logout.

Supporting source:
- `functions/_shared/gateway-client.mjs`: server-side HMAC-SHA256 Apps Script client, strict Apps Script URL allowlist, canonical payload order and response validation.
- `functions/_shared/session-store.mjs`: D1-backed opaque browser sessions; Apps Script tokens encrypted with AES-256-GCM; role-separated cookies; 8-hour absolute and 30-minute idle limits; expired/idle cleanup.
- `functions/_shared/auth-api.mjs`: same-origin checks, CSRF Origin/Sec-Fetch-Site checks, bounded JSON, no-store responses and fixed auth actions.
- `functions/api/auth/**`: explicit route files; no generic browser action proxy.
- `migrations/0001_pages_sessions.sql`: D1 session schema.
- `staging/CLOUDFLARE_AUTH_SESSION_DESIGN.md`: route contract, cookie/session design, bindings and verification boundary.

Verified on commit `1fdac2b6c58ea3149c0b6a35ad6acb803892a72f`: Node/VM suite **224/224 passed**, Workerd sanitizer suite **9/9 passed** in [GitHub Actions run 45851314205](https://github.com/rattasart153-ops/nobigaming/actions/runs/45851314205). Auth tests cover HMAC canonicalization, Apps Script URL validation, encrypted D1 token storage, cookie attributes, role separation, absolute/idle expiry, origin rejection, registration/login, Member/Admin session checks and logout.

**Still outstanding:**
1. Member/Admin wallet and top-up business routes, including sanitized proof upload and Admin-only private proof retrieval.
2. Member/Admin UI conversion from Apps Script RPC to same-origin HTTP routes.
3. Real D1 binding/migration, Pages route deployment, Apps Script STAGING end-to-end validation and private Drive ACL verification.

No D1 database, Cloudflare resource, secret, deployment or live Apps Script setting was created or changed. This item remains open until business routes, UI and real STAGING verification are complete.

### 4. Real Apps Script STAGING verification

**Status: NOT RUN.**

After the code and runtime are ready, test only with synthetic accounts, synthetic references and synthetic image fixtures in a disposable STAGING environment. Verify actual Apps Script V8 behavior, Sheets schema, Drive ACLs, trigger execution, quotas, idempotency and recovery. Node/VM tests are not a substitute.

### 5. Security and private Drive verification

**Status: NOT VERIFIED IN LIVE STAGING.**

Verify private folder and file ACLs, Admin-only proof retrieval, no share URLs, no public permissions, sanitized file output, size/dimension limits, and absence of sensitive payloads in logs.

## Exit gate before P1.3

P1.3 may begin only after items 1–5 are either completed and verified or explicitly accepted by the owner as documented blockers. A blocked security requirement must not be represented as complete. No financial write gate, trigger, live API, Cloudflare resource or deployment may be activated as part of this work.
