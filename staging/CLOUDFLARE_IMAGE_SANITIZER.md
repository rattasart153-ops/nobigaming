# STAGING — Top-up proof image sanitizer prototype

**Branch:** `staging-runtime-test-kit` only  
**Status:** real JPEG/PNG/WebP decode/re-encode verified in local Cloudflare workerd; no Pages route or live resource is deployed or connected to Apps Script.

## Purpose

Top-up proof uploads must be decoded and re-encoded in a trusted server runtime before the bytes reach private Drive. Apps Script currently checks signatures/structure and size but does not decode pixels. Browser-side Canvas conversion is not a security boundary.

This prototype adds a reusable Cloudflare Pages/workerd sanitizer module. It is not an HTTP endpoint and must only be called from an authenticated Pages Function after Member session and CSRF/origin checks. The future Pages route must forward only the returned JPEG bytes to the signed API-only Apps Script gateway. Never forward the original bytes.

## Limits

| Control | Limit |
|---|---:|
| Input size | 3 MiB |
| Accepted formats | JPEG, PNG, static WebP |
| Maximum side | 4,096 px |
| Maximum total pixels | 4,000,000 |
| Animated formats | Rejected (APNG and animated WebP) |
| Output | JPEG only |
| Maximum output size | 2,500,000 bytes |
| Output dimensions | At most 2,048 × 2,048 |
| JPEG quality | 82 |

The module validates the full JPEG/PNG/WebP container envelope before calling SIP. It rejects mismatched MIME declarations, malformed/truncated containers, trailing payloads, APNG/animated WebP, and images above the dimension/pixel ceiling. SIP then decodes and re-encodes the image as a fresh JPEG, removing source metadata and non-image payloads.

WebP decoding uses a full-image decoder in the current SIP implementation, unlike its scanline JPEG/PNG paths. The four-megapixel ceiling is therefore enforced before decode; the live Worker memory profile still requires measurement before this can be treated as release-ready.

## Files

- `functions/_shared/slip-image-sanitizer.mjs`: format/container checks, bounded request reader, pixel limits, SIP adapter factory and JPEG output verification.
- `functions/_shared/sip-adapter.ts`: Cloudflare workerd SIP adapter, including the separate WebP decoder WASM import.
- `test/staging-slip-image-sanitizer.test.js`: 15+ synthetic unit checks for validation, animation, trailing payloads, size/dimension limits and mocked codec output.
- `workerd-test/worker.ts` and `workerd-test/slip-image-sanitizer.workerd.mjs`: isolated Worker entry and real runtime integration tests.
- `workerd-test/fixtures.mjs`: real JPEG, PNG, WebP, APNG and animated WebP fixtures.
- `vitest.image-sanitizer.config.mjs` and `wrangler.image-sanitizer-test.jsonc`: local workerd/Vitest configuration; not a deploy configuration.

## Dependency

The root package pins `@standardagents/sip` to `1.0.1` and `@jsquash/webp` to `1.5.0`. SIP's workerd-specific entry loads the core WASM; the WebP codec WASM is imported separately. The package is exercised through Wrangler's compiled-WASM rule in the isolated workerd test config.

## Future Pages Function integration

1. Authenticate the Member session and validate CSRF/origin before reading the upload.
2. Parse the upload with a multipart parser that enforces a 3 MiB per-file limit, or use `readBoundedImageRequest()` for a raw-body internal hop.
3. Call `createSlipImageSanitizer(sipSlipImageAdapter)(fileBytes, file.type)`.
4. Build the signed Apps Script request using **only** `result.bytes`, `result.mimeType` and its bounded byte length. Base64-encode the sanitized JPEG for the current GAS contract.
5. Never pass the original upload, original filename, client dimensions, or client MIME claim to Drive. Do not log image bytes, base64, HMAC secrets, tokens, or Drive IDs.
6. Keep proof retrieval private and Admin-authorized.

## Verification completed

Run [GitHub Actions 45849308801](https://github.com/rattasart153-ops/nobigaming/actions/runs/45849308801) passed on commit `1ef9a1b97825a49a7df109024f4b5de332962a8e`:

- Node/VM regression suite: **208/208 passed**.
- Real Cloudflare workerd integration suite: **9/9 passed**.
- The workerd tests actually load the SIP/WebP WASM modules and decode/re-encode real JPEG, PNG and WebP fixtures, then decode the generated JPEG again.
- A valid EXIF-bearing JPEG is re-encoded without the EXIF marker or test metadata.
- Real APNG and animated WebP fixtures are rejected.
- JPEG trailing payload, MIME mismatch, a 5-megapixel header (rejected before decode), and a streamed body over 3 MiB are rejected.

The isolated Wrangler test config verifies local workerd compatibility and compiled-WASM bundling. It is **not** a deployed Cloudflare Pages test and does not exercise the actual Member session, CSRF/origin checks, HMAC forwarding, or private Drive write path.

## Remaining release boundary

- WebP's decoder performs a full-image decode. The 4-megapixel cap is enforced before decode, but peak memory/CPU at the maximum accepted size has not been benchmarked under deployed Cloudflare limits.
- The sanitizer is not yet called by a Member Pages Function. The actual authenticated upload route, signed Apps Script handoff, and proof storage must be integrated and tested before enabling uploads.
- Live Drive privacy/ACLs, Apps Script V8 behavior, Cloudflare session behavior and deployed quotas remain unverified.

No Pages route, Cloudflare resource, deployment, Apps Script project, Script Property, Sheet, Drive file, trigger, or financial writer gate was changed by these tests.
