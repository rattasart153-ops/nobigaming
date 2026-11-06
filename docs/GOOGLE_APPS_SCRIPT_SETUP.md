> **ACTIVE TARGET (2026-11-06):** Google Apps Script HtmlService + Sheets + private Google Drive is the approved zero-cost architecture. This document is a gated setup plan, not authorization to create resources or deploy. See [ZERO_COST_MIGRATION_PLAN.md](./ZERO_COST_MIGRATION_PLAN.md).

# Nobi Topup — Apps Script HtmlService Setup Plan

## Target design

Browser → Apps Script HtmlService → allowlisted `google.script.run` facade → Apps Script business logic → Sheets + private Drive.

Vercel, Neon, PostgreSQL hosting and Vercel Blob are not part of this architecture. Do not set Vercel environment variables for this project.

## Current source status

- `Code.gs` routes `doGet()` to the Storefront or Admin HtmlService template. Rendering does not initialize Sheets, create Drive resources or bootstrap Admin.
- `BrowserFacade.gs` exposes 28 named, typed, allowlisted browser functions. Generic browser action dispatch is not exposed.
- `Storefront.html` and `Admin.html` use the named `google.script.run` facade through compatibility adapters; neither page calls the legacy REST API.
- Member/Admin session tokens and checkout upload capability are held in JavaScript memory only. Refresh requires login again. The Storefront may persist only a non-secret order idempotency retry key in `sessionStorage`; no auth or checkout token is persisted in browser storage.
- Slip and Admin media uploads use bounded Base64 RPC payloads. Admin slip retrieval uses the authenticated facade; Drive sharing URLs are not exposed.
- PromptPay EMVCo payloads are rendered with the locally bundled QRCode.js encoder; no external QR API is used.
- Source-level frontend adapter work (P2) is complete. Static/offline regression coverage is included in `test/frontend-contract.test.js` and the Apps Script facade tests.
- The current schema remains version 3. Do not downgrade it to v1.
- The approved Member IP decision remains: do not collect or expose Member IP history.

## Verification status and limitations

- Latest documented source CI: GitHub Actions run [42169638381](https://github.com/rattasart153-ops/nobigaming/actions/runs/42169638381) completed successfully with 126/126 tests on the documentation commit. The P2 frontend adapter test run [42166229765](https://github.com/rattasart-ops/nobigaming/actions/runs/42166229765) completed successfully with 116/116 tests.
- These are Node/VM and static contract tests. They do not prove real Apps Script execution, actual Sheets/LockService behavior, Drive ACL enforcement, real QR scanning, or browser/device end-to-end behavior.
- No Apps Script project, spreadsheet or Drive folders have been created or initialized for this migration. No deployment, Admin bootstrap, live payment or production order has been performed.

## Gated implementation and verification sequence

1. P0 read-only compatibility inventory — complete.
2. HtmlService routing and typed browser facade — source complete.
3. P2 frontend transport adapter to `google.script.run` — source complete.
4. P2 static/offline regression tests — complete; CI results are listed above.
5. P3 isolated Apps Script runtime/performance verification — pending separate authorization.
6. P4 security and business-rule verification against an isolated synthetic environment — pending separate authorization.
7. P5 browser/device end-to-end tests using synthetic data — pending separate authorization.
8. Ask separately before deployment, Admin bootstrap, or any live payments/orders.

## Privacy requirements

- Drive folders and files must remain Restricted / Private.
- Never share slips or media as Anyone / Anyone with link.
- Slips are readable only by an authenticated Admin.
- Storefront media must be delivered only after checking a valid active catalog/promotion reference.
- Secrets belong in Script Properties; never commit them to GitHub or expose them to browser code.
- Never collect browser-supplied IP or represent a Google server IP as a Member IP.

## Cost controls

- Existing Google account only; no new service registration, billing, card entry or paid add-on.
- Use existing Apps Script quotas and Drive capacity. Check current quotas and remaining storage before any approved runtime test.
- On quota/storage exhaustion, fail closed and pause; never automatically upgrade or use a paid alternative.
- Google free quotas and terms may change; do not promise unlimited free operation.

## Authorization boundary

This guide does not authorize creating an Apps Script project, spreadsheet, Drive folders, setting Script Properties, initializing Schema v3, seeding data, bootstrapping Admin, installing triggers, deploying the web app, or accepting real orders/payments. Each requires separate explicit approval.
