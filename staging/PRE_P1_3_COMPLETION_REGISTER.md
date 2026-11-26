# Pre-P1.3 Completion Register

- **Repository:** `rattasart153-ops/nobigaming`
- **Branch:** `staging-runtime-test-kit` only
- **Purpose:** Close or explicitly resolve incomplete P1.1/P1.2 operational work before P1.3.
- **Safety:** STAGING source and synthetic tests only. No Apps Script project, Script Properties, Google Sheets, Drive, Cloudflare resource, trigger, or deployment is changed by this register.

## Ordered work

### 1. Server-side image decode/re-encode for top-up proof

**Status: PROTOTYPE IMPLEMENTED; RELEASE BLOCKED pending real workerd validation and Drive-path integration.**

The API-only Apps Script currently checks the declared MIME type, byte limit, and PNG/JPEG/WebP structure before storing the original bytes. These checks are useful validation, but they do not decode pixels and re-encode a fresh image. Re-wrapping bytes in a new Blob is not sanitization.

Apps Script's built-in services do not provide a general-purpose image decoder/encoder. Do not claim that a browser Canvas conversion is a security boundary: a client can bypass it and call the API directly.

The prototype is implemented in [the sanitizer module](../functions/_shared/slip-image-sanitizer.mjs), [the workerd SIP adapter](../functions/_shared/sip-adapter.ts), [synthetic tests](../test/staging-slip-image-sanitizer.test.js), and [the prototype guide](./CLOUDFLARE_IMAGE_SANITIZER.md). It pins @standardagents/sip 1.0.1 and accepts JPEG/PNG/static WebP; input is capped at 3 MiB, dimensions at 4,096 px and 4 megapixels, animated APNG/WebP and trailing payloads are rejected, and output must be a fresh JPEG no larger than 2,500,000 bytes. WebP's separate decoder WASM is loaded through the SIP adapter.

The synthetic Node suite passed **208/208 tests** on commit `6da3a3f653baa3815ac3abae17e7ec5112f283d8` in [GitHub Actions run 45845521286](https://github.com/rattasart153-ops/nobigaming/actions/runs/45845521286) and [run 45845536042](https://github.com/rattasart153-ops/nobigaming/actions/runs/45845536042).

**Not yet proven:** tests inject a fake SIP adapter. They do not execute the real WASM decoder under Cloudflare workerd, measure Worker memory/CPU, verify Pages WASM bundling, or verify that only sanitized bytes reach private Drive. No Pages proof-upload route exists yet; Apps Script remains unchanged and this prototype is inactive. The upstream documentation confirms WebP requires full-image decode and higher memory, so the pixel ceiling must remain enforced.

Required before enabling proof uploads:
1. Select an approved server-side image-processing runtime compatible with the free-first architecture (candidate: a Cloudflare Pages Function using a reviewed WebAssembly image codec).
2. Decode the uploaded image in that trusted runtime; enforce pixel/dimension limits and reject malformed or decompression-bomb inputs.
3. Re-encode to a fresh PNG/JPEG/WebP output, strip metadata, and verify output format and size.
4. Ensure only sanitized bytes are forwarded to the private Drive storage path; never retain the untrusted original as the review artifact.
5. Add malformed image, truncated file, polyglot/trailing payload, oversized dimensions, animation and metadata tests.
6. Verify the deployed runtime with synthetic images before enabling proof uploads.

No external image-processing service or paid provider is authorized by this task. Until this is completed, proof upload remains a release blocker.

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
