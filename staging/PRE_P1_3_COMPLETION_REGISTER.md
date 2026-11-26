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

**Status: SOURCE SUPPORT ADDED; NOT ENABLED.**

- `runWalletTopupExpiry()` already expires only `AWAITING_PROOF` requests at or after 24 hours.
- Added `ensureWalletTopupExpiryTrigger()` to the API-only bundle.
- Installer requires the single-writer mutation gate, is idempotent, removes duplicate triggers, and configures a 15-minute schedule.
- The installer is only a function definition. It has not been called; no trigger has been installed.
- Only run it after the API-only project is approved as the sole financial writer and all gate properties are intentionally enabled.

### 3. Member/Admin API and UI integration

**Status: NOT STARTED.**

Required: explicit Cloudflare Pages Function routes (no generic action proxy), authenticated Member/Admin sessions, CSRF/origin protections, server-side HMAC signing, no-store responses, and Member/Admin screens for top-up requests, proof submission, review, Paid Credit grants and Bonus grants. Do not expose Apps Script tokens, HMAC secrets, Drive IDs or private file URLs to the browser.

### 4. Real Apps Script STAGING verification

**Status: NOT RUN.**

After the code and runtime are ready, test only with synthetic accounts, synthetic references and synthetic image fixtures in a disposable STAGING environment. Verify actual Apps Script V8 behavior, Sheets schema, Drive ACLs, trigger execution, quotas, idempotency and recovery. Node/VM tests are not a substitute.

### 5. Security and private Drive verification

**Status: NOT VERIFIED IN LIVE STAGING.**

Verify private folder and file ACLs, Admin-only proof retrieval, no share URLs, no public permissions, sanitized file output, size/dimension limits, and absence of sensitive payloads in logs.

## Exit gate before P1.3

P1.3 may begin only after items 1–5 are either completed and verified or explicitly accepted by the owner as documented blockers. A blocked security requirement must not be represented as complete. No financial write gate, trigger, live API, Cloudflare resource or deployment may be activated as part of this work.
