# Nobi Gaming — Isolated Staging Runtime Test Kit

> This guide supersedes older setup notes that mention Schema v3/v4. The current STAGING source uses **Schema v5** and upgrades an existing Schema v4 STAGING database non-destructively.

- [Pre-P1.3 Completion Register](./PRE_P1_3_COMPLETION_REGISTER.md) — ordered blockers and release gates for unfinished P1.1/P1.2 work.
- [Cloudflare Image Sanitizer Prototype](./CLOUDFLARE_IMAGE_SANITIZER.md) — server-side proof-image sanitization design and verification boundary.

## Purpose and safety boundary

This kit prepares an isolated Google Apps Script + Sheets + Drive environment for runtime and browser testing. It is not production setup.

- Source branch: `staging-runtime-test-kit`, created from `vercel-drive-setup` commit `3a4b26fc14882c01e5f3decb9bb35768420e408f`.
- `main` is not modified.
- Create a brand-new standalone Apps Script project, a brand-new blank spreadsheet, and two brand-new Drive folders.
- Use synthetic names, IDs, orders, coupons, and image/slip files only.
- Do not use production Script Properties, spreadsheet IDs, Drive folder IDs, Admin credentials, customer records, slips, payment details, or deployment URLs.
- Do not enable public/anonymous access. Initial web-app access must be **Only myself**.
- Do not configure `NOBI_GATEWAY_SECRET`; the current HtmlService browser path uses the named `google.script.run` facade and does not need the legacy signed HTTP gateway.
- Do not run `clasp deploy` or update any existing deployment.
- Stop if Google asks for billing, a paid add-on, or a paid upgrade.

This guide does not create or authorize production resources. The owner performs the Google-side setup manually and can stop before any step.

## What is being tested

1. Real Apps Script V8 execution of the current source.
2. Schema v5 initialization on a new spreadsheet and non-destructive upgrade from STAGING Schema v4.
3. `LockService`, Sheets reads/writes, and repository concurrency under synthetic requests.
4. Restricted Drive folders, private file creation, and Admin-only slip retrieval.
5. Member registration/login/dashboard/password change/logout and coupon progress.
6. Guest checkout, coupon rules, order expiry, slip upload, and Admin order review.
7. HtmlService pages on a real browser/device, including mobile layout.\n8. Sheets-managed Banner Carousel, private Drive media delivery, and automatic slide rotation.

The existing Node/VM suite is useful regression coverage, but it does not prove Google's live runtime, Drive ACLs, browser behavior, or actual quota enforcement.

## Part A — Create isolated Google resources

Use the existing Google account. Do not reuse any production resource.

### 1. Create a new blank spreadsheet

1. Open Google Sheets and create a blank spreadsheet named `Nobi Gaming STAGING DB`.
2. Leave all tabs empty; do not copy production data.
3. Copy the spreadsheet ID from its URL. It is the text between `/d/` and `/edit`.
4. Keep the spreadsheet restricted to the owner. Do not enable link sharing.

### 2. Create two private Drive folders

Create these as two separate folders (not shared with anyone):

- `Nobi Gaming STAGING — Slips`
- `Nobi Gaming STAGING — Media`

For each folder, open Share / General access and confirm **Restricted**. Do not add editors or viewers. Copy each folder ID from its URL (the text after `/folders/`).

The app checks the folder's broad sharing mode and explicit editor/viewer lists. If it cannot verify privacy, the test should fail closed; do not loosen sharing to make it pass.

## Browser-only alternative (recommended for phone users)

If you are using a phone or do not want Terminal/clasp, use [BROWSER_ONLY_SETUP.md](./BROWSER_ONLY_SETUP.md). It provides one combined `Code.gs` bundle plus the four HTML files to paste directly into a newly created Apps Script project. This avoids both Terminal and the Apps Script API. After importing those files, continue at Part C below.\n\nFor the Sheets-managed Banner Carousel on an already configured STAGING project, follow [BANNER_SETUP.md](./BANNER_SETUP.md).

## Part B — Create a separate Apps Script project

### 3. Create the project

1. Open [Google Apps Script](https://script.google.com/home).
2. Create a **New project** named `Nobi Gaming STAGING`.
3. Do not open or edit any existing Apps Script project.
4. In Project Settings, note the Script ID. It is shown as the project ID.
5. In Apps Script Settings, enable the Google Apps Script API only if clasp reports that it is disabled. No billing should be required.

### 4. Upload this branch's Apps Script source with clasp

This part is easiest on a computer with Node.js 22 and Git installed.

In a terminal:

```bash
git clone --branch staging-runtime-test-kit https://github.com/rattasart153-ops/nobigaming.git
cd nobigaming
npm install -g @google/clasp
clasp login
```

Create a local file named `.clasp.json` in the repository root. **Do not commit this file.** Put the new STAGING Script ID from step 3 into it:

```json
{
  "scriptId": "PASTE_THE_NEW_STAGING_SCRIPT_ID_HERE",
  "rootDir": "google-apps-script"
}
```

Then upload the source to that newly created staging project:

```bash
clasp push
```

If clasp reports an unexpected existing project or asks to overwrite files in a project other than `Nobi Gaming STAGING`, cancel. Never point this local config at a production Script ID.

The source folder contains the current `.gs`, `.html`, and `appsscript.json` files. Do not upload the Node/Express `public/` frontend; the Apps Script HtmlService files are under `google-apps-script/`.

## Part C — Configure staging-only Script Properties

### 5. Set Script Properties

In the new Apps Script project, open **Project Settings → Script Properties** and add:

| Property | Value |
|---|---|
| `NOBI_SHEET_ID` | ID of the new blank STAGING spreadsheet |
| `NOBI_PRIVATE_DRIVE_FOLDER_ID` | ID of the new STAGING Slips folder |
| `NOBI_PRIVATE_MEDIA_FOLDER_ID` | ID of the new STAGING Media folder |
| `NOBI_ADMIN_USERNAME` | A new temporary staging-only Admin username (4–40 characters; A–Z, a–z, 0–9, dot, underscore, hyphen) |
| `NOBI_ADMIN_PASSWORD` | A new staging-only password of at least 14 characters |

Never paste passwords or Script Properties into ChatGPT, GitHub, source files, screenshots, or chat. Do not reuse any production password.

Do not add `NOBI_GATEWAY_SECRET`, production IDs, payment credentials, or customer data.

## Part D — Initialize the blank staging database

### 6. Run setup functions in this order

In the Apps Script editor, select and run each function manually, one at a time:

1. `setupNobiDatabase`
   - Expected: `ok: true`, `schemaVersion: 5`, `sheetCount: 19`.
   - Confirm the new STAGING spreadsheet now contains the schema tabs, including `member_coupon_alerts`.
   - If the function reports an incompatible schema, stop. Do not delete or rename tabs to force it through.
2. `seedDefaultCatalog`
   - Expected on a fresh empty database: 9 games and 54 packages added; status `COMPLETE`.
   - These are test catalog entries only. Prices are sample data, not live payment offers.
3. `initializeAdmin`
   - Expected: `ok: true`.
   - The bootstrap password property is deleted by the function after successful Admin creation. The username property remains; it is not the stored password.
   - If it reports an Admin already exists, stop and inspect this STAGING database. Do not reset or overwrite accounts blindly.

Do not run any initializer against a spreadsheet that contains real data.

## Part E — Deploy only the staging web app for browser testing

### 7. Create a staging-only deployment

After the three initialization functions succeed:

1. In the STAGING Apps Script project, choose **Deploy → New deployment → Web app**.
2. Description: `Nobi Gaming STAGING — private test`.
3. Execute as: **Me**.
4. Who has access: **Only myself**.
5. Deploy and authorize the Google permissions requested for this new test project.
6. Save the Web App URL as a private test URL. Do not post it publicly or replace any production URL.

Open the staging URL in your browser. Check:
- Storefront: the URL root.
- Admin: append `?page=admin`.
- Member: append `?page=member`.

This is a staging deployment only. Do not choose Anyone / Anyone with Google account, and do not edit an existing deployment.

## Part F — Run the manual test checklist

Use [TEST_CHECKLIST.md](./TEST_CHECKLIST.md). Keep all test identities, player UIDs, coupons, files, and orders synthetic. Do not transfer money or upload a real payment slip. The goal is to validate the software flow, not to simulate a real payment.

## Stop conditions

Stop and report the exact error (without secrets or private IDs) if any of these occurs:

- A Google resource shown is not clearly the new STAGING resource.
- A sheet/folder is not private or has an unexpected editor/viewer.
- Apps Script requests billing, a paid add-on, or a paid upgrade.
- Schema initialization reports incompatibility or missing version.
- The app shows real customer/payment data.
- A test unexpectedly sends a notification, creates a public link, or changes a production resource.
- Apps Script quotas or execution time are exceeded.

## Cleanup after testing

When tests are complete, do not delete anything until the results are recorded. Then, if you want to remove the staging environment, manually delete only the three resources created specifically for this test: the STAGING Apps Script project, STAGING spreadsheet, and the two STAGING Drive folders. Do not delete or modify any other project or resource.

## Current status

This kit is documentation and setup guidance only. No Google project, spreadsheet, Drive folder, Script Property, web-app deployment, or live test has been created by this commit.

## API-only Apps Script STAGING package

- [API-only setup and safety guide](./api-only/README.md)
- [API-only Code.gs](./api-only/Code.gs)

This is a separate project under construction. It is not deployed. The additive Schema v5 → v6 migration is included, but Wallet operations are not yet complete.

## E-Budget design documents (design only)

The following documents define the proposed Prepaid Credit Wallet for this STAGING branch. They are specifications only: **do not create Sheets tabs, run a migration, edit Apps Script, or deploy based on these documents until separately approved**.

- [E-Budget Technical Design](./EBUDGET_TECHNICAL_DESIGN.md) — approved policies, Schema v6 proposal, ledger/holds, single-writer constraint, recovery and open decisions.
- [E-Budget API Contract](./EBUDGET_API_CONTRACT.md) — proposed Member/Admin routes, gateway actions, payloads, validation and idempotency.
- [E-Budget Test Plan](./EBUDGET_TEST_PLAN.md) — functional, security, concurrency and recovery acceptance tests.
- [E-Budget Decision Register](./EBUDGET_DECISIONS.md) — closed owner decisions and final policies for all eight previously open issues.


## Separate API-only STAGING and E-Budget status

The new API-only Apps Script project is a separate project from the private HtmlService app. Its source is maintained under [`staging/api-only/`](./api-only/README.md); do not replace the existing browser-import source with it.

E-Budget P1.1–P1.2 code is under development in that API-only bundle. P1.2 includes member top-up request/proof flows, Admin review/approval/rejection, Admin Paid Credit grants and expiring Bonus grants. It is still **not ready to configure, initialize, or deploy**. The single-writer cutover gate must remain closed, and image decode/re-encode, Wallet order/hold processing, Bonus expiry posting, refunds, Cloudflare session routes, UI integration and live Apps Script tests remain outstanding.

