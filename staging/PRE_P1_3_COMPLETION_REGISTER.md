# Pre-P1.3 Completion Register

- **Repository:** `rattasart153-ops/nobigaming`
- **Branch:** `staging-runtime-test-kit` only
- **Purpose:** Close or explicitly resolve incomplete P1.1/P1.2 operational work before P1.3.
- **Safety:** STAGING source and synthetic tests only. No Apps Script project, Script Properties, Google Sheets, Drive, Cloudflare resource, trigger, or deployment is changed by this register.

## Ordered work

### 1. Server-side image decode/re-encode for top-up proof

**Status: BLOCKED — implementation runtime not yet selected.**

The API-only Apps Script currently checks the declared MIME type, byte limit, and PNG/JPEG/WebP structure before storing the original bytes. These checks are useful validation, but they do not decode pixels and re-encode a fresh image. Re-wrapping bytes in a new Blob is not sanitization.

Apps Script's built-in services do not provide a general-purpose image decoder/encoder. Do not claim that a browser Canvas conversion is a security boundary: a client can bypass it and call the API directly.

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
