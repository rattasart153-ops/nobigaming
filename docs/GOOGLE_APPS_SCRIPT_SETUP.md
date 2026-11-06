> **ACTIVE TARGET (2026-11-05):** Google Apps Script + Sheets + private Drive is the approved zero-cost architecture. This document is a gated setup plan, not authorization to create resources or deploy. See [ZERO_COST_MIGRATION_PLAN.md](./ZERO_COST_MIGRATION_PLAN.md).

# Nobi Topup — Apps Script HtmlService Setup Plan

## Target design

Browser → Apps Script HtmlService → allowlisted `google.script.run` facade → Apps Script business logic → Sheets + private Drive.

Vercel, Neon, PostgreSQL hosting and Vercel Blob are not part of this architecture. Do not set Vercel environment variables for this project.

## Current status

- Existing GAS source contains Schema v1, repositories, business handlers, authentication/session logic, coupon/order workflows, private Drive helpers and an HTTP gateway originally intended for Express.
- The current storefront/Admin still use Vercel REST routes. They are not yet compatible with HtmlService.
- `Code.gs` now routes `doGet` to `Storefront.html` or `Admin.html`; no database initialization or Admin bootstrap occurs during page rendering.
- `BrowserFacade.gs` exposes named, typed, allowlisted functions for the existing public, Member and Admin business actions. Generic browser action dispatch is not exposed.
- Template JavaScript still calls the legacy REST endpoints. The P2 `google.script.run` frontend adapter remains outstanding; the app is not yet end-to-end functional.
- GAS runtime, quotas, concurrency, file handling and Drive ACLs have not been verified.
- No Apps Script project, spreadsheet or Drive folders have been created/initialized for this migration.

## Gated implementation sequence

1. Complete P0 read-only inventory of all frontend REST routes, payloads, response contracts, GAS actions and Node-only dependencies.
2. Design the HtmlService routing/template structure and narrow callable facade.
3. Port the frontend transport layer to `google.script.run`, preserving UI and business rules.
4. Run static/offline tests.
5. Only after separate approval, create an isolated Apps Script test project using the existing Google account.
6. Import source and test runtime compatibility, PBKDF2, LockService, Sheets performance, file transfer and quotas.
7. Only after separate approval, create/initialize a synthetic test spreadsheet and private Drive folders.
8. Verify all security, privacy, concurrency and browser/device tests using synthetic data.
9. Ask separately before deployment, Admin bootstrap, or any live payments/orders.

## Privacy requirements

- Drive folders and files must remain Restricted / Private.
- Never share slips or media as Anyone / Anyone with link.
- Slips are readable only by an authenticated Admin.
- Storefront media must be delivered only after checking a valid active catalog/promotion reference.
- Secrets belong in Script Properties; never commit them to GitHub or expose them to browser code.

## Cost controls

- Existing Google account only; no new service registration, billing, card entry or paid add-on.
- Check current Apps Script quotas and remaining Drive storage before tests.
- On quota/storage exhaustion, fail closed and pause; never automatically upgrade or use a paid alternative.
- Google free quotas and terms may change; do not promise unlimited free operation.

## Authorization boundary

This guide does not authorize creating a project, spreadsheet, Drive folders, setting Script Properties, initializing Schema v1, bootstrapping Admin, deploying the web app, or accepting real orders/payments. Each requires separate explicit approval.
