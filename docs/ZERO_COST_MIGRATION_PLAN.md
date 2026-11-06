# Nobi Topup — Zero-Cost Migration and Compatibility Plan

Status: approved architecture; P0/P1/P2 source implementation complete on vercel-drive-setup; real Google runtime, browser/device verification and deployment remain unauthorized.

## Scope and cost boundary

- Repository `rattasart153-ops/nobigaming`; edit only `vercel-drive-setup`; never modify `main`.
- Existing Google and GitHub accounts only.
- No paid services, billing, card entry, paid tiers/add-ons, Neon, hosted PostgreSQL, Vercel Blob or Vercel runtime.
- Use existing Apps Script quotas and Drive capacity. Exhaustion means safe stop, not automatic upgrade.
- Free quotas and terms may change; unlimited availability/storage cannot be promised.
- Synthetic data only.

## Target

Browser → Apps Script HtmlService → allowlisted `google.script.run` facade → Sheets + private Drive. The bridge is built into Apps Script; it is not a separately subscribed API provider, but backend calls consume Apps Script quotas.

## Why Option A is cancelled

The user explicitly requires zero cost at every stage. Vercel + Neon + Blob free allowances and plan terms cannot guarantee this constraint for the intended use. No Neon database or Blob store was provisioned as part of this switch.

## Phases

### P0 — Read-only compatibility audit
- Inventory frontend REST calls, payloads, response shapes, uploads/downloads.
- Map Express routes to GAS business handlers and callable facade methods.
- Identify Vercel/Node-only dependencies: request/response objects, cookies, multipart parsing, redirects and Node libraries.
- Review HtmlService constraints and secure session/file-transfer patterns.
- Produce a file-by-file port matrix. No business-logic changes.

### P1 — Apps Script web facade
- [x] Add doGet routing and HtmlService templates for storefront/Admin (P0-R11 source implementation).
- [x] Add explicit allowlisted server functions; no generic browser action/table dispatcher (P0-R12 source implementation).
- Use success/failure handlers and validate/authorize every call server-side.
- Keep secrets in Script Properties.

### P2 — Frontend adapter
- [x] Replace HtmlService Storefront/Admin REST transport with named google.script.run facade calls (P0-R13).
- [x] Preserve UI, Thai text, checkout, Member/Admin workflows and business semantics at source level.
- [x] Implement bounded Base64 slip/media upload and Admin slip retrieval without exposing Drive sharing URLs.
- [x] Keep Member/Admin session tokens and checkout upload capability in JavaScript memory only; refresh requires login again. Never store auth tokens in localStorage/sessionStorage.
- [x] Render PromptPay EMVCo payload with a locally bundled QR encoder.
- [ ] Complete real HtmlService browser/device verification after separate P6 authorization.

### P3 — Runtime and performance
- Static/offline tests, then isolated Apps Script runtime tests after separate approval.
- Benchmark PBKDF2, Sheets reads/writes, LockService contention, uploads/downloads and execution time.
- Confirm quotas, concurrency and Drive capacity are sufficient for synthetic test volume.

### P4 — Security and business rules
- Verify session expiry/revocation, Admin-only slip access, no Member IP collection, audit retention, coupon reservations, deadlines, idempotency and recovery.
- Test quota exhaustion and lock timeout fail-closed behavior.

### P5 — Browser/device tests
- Guest, Member, Admin, coupon, checkout, slip, order status and Admin CRUD on synthetic data only.

### P6 — Explicit authorization gates
Separate approval is required before creating an Apps Script project, spreadsheet, Drive folders, setting Script Properties, deploying the web app, initializing schema, bootstrapping Admin or enabling real payments/orders.

## Preserved business rules

Guest checkout; ASCII Member Login ID 4–30; public/member-only/member-game-spend coupons; UID allowlist; cumulative Completed post-discount spend; coupon reserve/consume/release; default 15-minute payment window; expiring coupon deadline through end of Asia/Bangkok expiry date; sessions 8h/30m idle; no Member IP history (approved decision B); non-IP login/security logs retained 90 days; private slips/media; manual Admin review.

## Current facts

- GAS source includes Schema v1 setup/repository primitives, business handlers, auth/session logic, coupon/order workflows, private Drive helpers and signed HTTP gateway.
- Signed gateway remains for legacy characterization only; `BrowserFacade.gs` exposes named typed `google.script.run` functions.
- HtmlService router, templates, typed facade adapters, memory-only session lifecycle, bounded file transfer and local QR rendering are implemented at source level. CI passed 116/116 on run 42165167680 (commit 23ec0cf0b36cbec819cf75314409d8aba09ceca9). This does not prove live GAS/Sheets/Drive or browser/device behavior.
- Apps Script runtime, quotas, concurrency and Drive ACLs are unverified.
- No live Google resources have been initialized; no web app deployed.


## Current implementation status — 2026-11-06

- P0-R11/R12: HtmlService router and typed browser facade implemented.
- P0-R13: Storefront/Admin frontend adapter, memory-only tokens, refresh-to-login behavior, Base64 file transfer and local PromptPay QR renderer implemented.
- CI: GitHub Actions run 42165167680 passed **116/116** tests on vercel-drive-setup.
- Remaining: real Apps Script runtime/quotas, Sheets/LockService concurrency, PBKDF2 latency, Drive ACLs, browser/device E2E and actual QR scanning. These require a separately authorized synthetic test environment. No Google resources or deployment are authorized by this status update.
