# STAGING — Top-up proof image sanitizer prototype

**Branch:** `staging-runtime-test-kit` only  
**Status:** source prototype and synthetic unit tests; not deployed or connected to Apps Script.

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
- `test/staging-slip-image-sanitizer.test.js`: synthetic unit tests for validation, animation, trailing payloads, size/dimension limits and mocked codec output.

## Dependency

The root package pins `@standardagents/sip` to `1.0.1`. Its package exports a workerd-specific entry that loads the bundled core WASM. The WebP codec WASM is imported separately, as in the upstream Worker example.

## Future Pages Function integration

1. Authenticate the Member session and validate CSRF/origin before reading the upload.
2. Parse the upload with a multipart parser that enforces a 3 MiB per-file limit, or use `readBoundedImageRequest()` for a raw-body internal hop.
3. Call `createSlipImageSanitizer(sipSlipImageAdapter)(fileBytes, file.type)`.
4. Build the signed Apps Script request using **only** `result.bytes`, `result.mimeType` and its bounded byte length. Base64-encode the sanitized JPEG for the current GAS contract.
5. Never pass the original upload, original filename, client dimensions, or client MIME claim to Drive. Do not log image bytes, base64, HMAC secrets, tokens, or Drive IDs.
6. Keep proof retrieval private and Admin-authorized.

## Verification boundary

The Node tests use a fake SIP adapter to test the module's own guards and contract. They do **not** prove the WASM decoder, Cloudflare Pages bundling, WebP codec loading, real image decode/re-encode, Worker memory/CPU limits, or Drive ACLs. Those require a separate Cloudflare/workerd STAGING runtime test with synthetic fixtures before proof uploads can be enabled.

No Pages route, Cloudflare resource, deployment, Apps Script project, Script Property, Sheet, Drive file, trigger, or financial writer gate is changed by this prototype.
