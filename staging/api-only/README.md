# Nobi Gaming — API-only Apps Script STAGING

This folder contains the isolated HTTP-only Apps Script source for the Cloudflare migration.

## Safety boundary

- Use a **new, separate** Apps Script project named `Nobi Gaming API STAGING`.
- Do not paste this source into the existing private HtmlService STAGING project.
- Do not point this project at Production Sheets, Drive folders, Script Properties or credentials.
- The source intentionally has **no `doGet` and no HtmlService page renderer**. Its only public entry point is signed `doPost(e)`.
- Keep the existing HtmlService STAGING project private (`Only myself`).
- Do not deploy this API-only project until a separate deployment approval is given.
- Do not create Cloudflare resources or change any existing deployment as part of importing the source.

## Source baseline

- Derived from `staging/browser-import/Code.gs` (the combined Schema v5 runtime bundle).
- The older modular files under `google-apps-script/` are not the source for this package; their config currently declares Schema v4.
- The Phase 1 gateway allowlist defect for `banners` is corrected here.
- The API-only bundle contains the additive Schema v5 → v6 migration and seven Wallet tabs. P1.1 adds guarded ledger/recovery primitives only; it does not expose Wallet gateway actions. Every mutation fails closed unless three explicit single-writer cutover properties are satisfied. The package remains **not ready for Wallet traffic**.

## Import

1. Create a brand-new Apps Script project named `Nobi Gaming API STAGING`.
2. Add one script file named `Code.gs` and paste the complete contents of [Code.gs](./Code.gs).
3. Set the project timezone to Asia/Bangkok and runtime to V8.
4. Do not configure Script Properties or deploy yet. The required API-only properties and migration sequence will be documented with the E-Budget P1 implementation.
5. Stop here until the P1 Schema v6 package and its tests are complete.

## P1.1 implementation status

- Added strict integer-satang validation, ledger-derived balance checks, lazy wallet creation, and a write-ahead credit journal apply/prepare primitive.
- Journal replay checks immutable transaction IDs before appending and verifies cached balances against ledger totals.
- Mutation gate requires `NOBI_WALLET_WRITES_ENABLED=true`, `NOBI_FINANCIAL_WRITER_MODE=API_ONLY`, and `NOBI_LEGACY_WRITER_DISABLED=true`. Do not set these properties yet; the legacy writer cutover has not been performed.
- No Wallet action is in the gateway allowlist, no top-up/order/refund workflow is enabled, and no UI is connected.

## Verification

The repository test suite includes static API-boundary checks and Schema v6 tests for fresh initialization, additive v5 migration and fail-closed preflight. Passing Node tests does not replace a live Apps Script runtime test.
