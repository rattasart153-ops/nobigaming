# Nobi Topup — Google Apps Script / Sheets / Drive Setup

Status: source implementation is present on `vercel-drive-setup`; no live Apps Script project has been initialized or deployed from this repository connection. **Do not run setup, initialize Admin, publish the Web App or accept real orders until the release gates below pass and the user explicitly approves.**

## Safety and scope

- Work only on `vercel-drive-setup`; never modify `main`.
- Use the existing Google account. No additional paid service or account is required.
- Keep the spreadsheet and both Drive folders private.
- Never commit Script Properties, credentials, spreadsheet IDs, Drive folder IDs, session tokens or customer slips.
- Sheets is not SQL and does not provide multi-row transactions. ScriptLock serializes critical sections; Drive/Sheets workflows use compensating cleanup.
- Apps Script quotas and runtime limits must be measured before live traffic.

## Current architecture

Browser → Vercel static pages and Express REST API → signed Apps Script client → Apps Script `doPost(e)` gateway → Sheets and private Drive.

- The storefront and Admin are served by Vercel from `public/nobitopup.html` and `public/admin.html`.
- Browser code calls same-origin REST routes only; it does not use HtmlService, `google.script.run` or direct Apps Script requests.
- Express production mode requires `APPS_SCRIPT_URL` and `APPS_SCRIPT_SHARED_SECRET`. It fails closed rather than using SQLite or local file storage.
- SQLite remains a local development/characterization fallback only.
- `src/clients/apps-script.client.js` signs requests and validates the gateway response/redirect.
- Apps Script modules use Schema v1 repositories, separate Admin/Member sessions, coupon reservations, order deadlines, audit/idempotency records, private Drive storage and a fixed action allowlist.

## Source files to copy when runtime testing is authorized

1. Open Google Apps Script while signed in to the existing Google account: https://script.google.com/
2. Create one project named **Nobi Topup Backend**.
3. Copy every `.gs` file from the repository `google-apps-script/` directory into the same Apps Script project, preserving filenames.
4. Enable the manifest in Project Settings and replace it with `google-apps-script/appsscript.json`.
5. Save all files. Apps Script files share a global namespace; do not rename or duplicate functions.
6. Do not create HtmlService `Storefront` or `Admin` files. Vercel hosts both browser pages.

## Required private resources

Create these resources manually in the existing Google account only when authorized to initialize the test environment:

- One Google Spreadsheet for Schema v1 data. The first successful `setupNobiDatabase()` creates it if `NOBI_SHEET_ID` is absent, then records its ID in Script Properties.
- One private Drive folder for payment slips; configure its ID as `NOBI_PRIVATE_DRIVE_FOLDER_ID`.
- One private Drive folder for catalog and promotion images; configure its ID as `NOBI_PRIVATE_MEDIA_FOLDER_ID`.

Both folders must have Drive sharing access set to **Restricted / Private**. The code checks folder privacy, file privacy and parent-folder membership before serving protected files. Do not use “Anyone with the link”.

## Apps Script Script Properties

Set values in Project Settings → Script Properties only during the approved test setup:

| Property | Purpose |
|---|---|
| `NOBI_GATEWAY_SECRET` | Random secret of at least 32 characters; must exactly match Vercel `APPS_SCRIPT_SHARED_SECRET` |
| `NOBI_PRIVATE_DRIVE_FOLDER_ID` | Private folder ID for payment slips |
| `NOBI_PRIVATE_MEDIA_FOLDER_ID` | Private folder ID for catalog/promotion images |
| `NOBI_ADMIN_USERNAME` | First Admin username, 4–40 ASCII letters/digits/dot/underscore/hyphen |
| `NOBI_ADMIN_PASSWORD` | One-time bootstrap password, at least 14 characters; deleted after successful `initializeAdmin()` |

`NOBI_SHEET_ID` is written by `setupNobiDatabase()`. Never copy property values into Git, source files or chat.

## Vercel environment variables

Configure only after the synthetic Apps Script deployment is approved:

| Variable | Purpose |
|---|---|
| `APPS_SCRIPT_URL` | HTTPS Apps Script Web App URL ending in `/exec` |
| `APPS_SCRIPT_SHARED_SECRET` | Same value as `NOBI_GATEWAY_SECRET` |
| `APPS_SCRIPT_TIMEOUT_MS` | Bounded request timeout; current default is 30,000 ms |
| `PROMPTPAY_ID` | Existing PromptPay identifier used by the Vercel payment-info service |
| `NODE_ENV` | `production` in production |

Do not put Apps Script secrets in `NEXT_PUBLIC_*` variables, browser code or public build output.

## Initialization sequence — gated

The following steps are **not authorized yet**. First complete the runtime and integration tests.

1. Confirm the Apps Script project contains all current source files and manifest.
2. Confirm both Drive folders are Restricted / Private.
3. Configure Script Properties for the synthetic test environment.
4. Run `setupNobiDatabase()` once. It preflights existing headers and schema version, creates missing sheets, and never clears or silently changes incompatible existing data.
5. Verify Schema v1 headers, including `security_rate_limits`, `gateway_nonces`, `idempotency_records`, `coupon_redemptions`, Admin/Member sessions and audit logs.
6. Set one-time bootstrap Admin properties and run `initializeAdmin()`. It hashes the password using PBKDF2-SHA256 (120,000 iterations) and deletes the bootstrap password property after success.
7. Verify the Admin row and password/session flow using synthetic data only.
8. Deploy the Apps Script Web App only to the approved access setting required for the signed server-to-server Vercel gateway. The browser must never call the Web App directly.
9. Configure Vercel environment variables and deploy only after separate approval.

## Upload and privacy limits

- PNG/JPEG/WebP only.
- Vercel staging fully decodes/re-encodes images and caps the processed file at **3 MB**.
- Apps Script independently validates file signatures and caps slip/media uploads at **3 MB**.
- 3 MB is intentional: base64 expansion and JSON/multipart overhead must fit within Vercel's function payload limits. Do not raise the cap without a separately designed chunked/direct-upload flow.
- Slips are stored in the private slip folder and can be fetched only through an authenticated Admin route.
- Catalog/promotion images are stored in the private media folder and served only when referenced by an active package/promotion record.
- Direct Drive URLs and externally hosted images are rejected by the Admin record validation path.

## Coupon and order rules implemented in source

- Guest checkout remains allowed.
- `public` coupons may be used by Guest and Member; `member_only` and `member_game_spend` require an authenticated Active Member.
- Member-game spend and UID-game spend count only Completed orders and use post-discount totals. Pending/Rejected/Expired and Guest orders do not count.
- Optional UID allowlist is checked independently.
- Coupon capacity is Reserved when Pending, Consumed when Completed, and Released when Rejected/Expired.
- Orders without a coupon, or with a coupon without an expiry date, have a 15-minute payment deadline.
- Orders using an expiring coupon may submit payment/slip through 23:59:59.999 Asia/Bangkok on the expiry date.
- The server enforces deadlines during creation, slip submission and Admin completion. Admin may review a timely submitted slip after the deadline.
- Identical order retries use the same Idempotency-Key and cannot create duplicate orders/reservations/files. Slip-upload retries return the already accepted submission without creating another Drive file.

## Verification required before live use

| Test | Procedure | Expected result |
|---|---|---|
| Schema safety | Initialize a fresh synthetic spreadsheet and repeat setup | Exact Schema v1 headers; repeat is idempotent |
| Legacy header mismatch | Create a sheet with incompatible headers | Setup fails before altering existing data |
| Gateway signature | Alter signature, body, timestamp or action | Request rejected |
| Gateway replay | Replay the same nonce | Second request rejected |
| Concurrency | Parallel order/coupon claims with usage limit 1 | At most one reservation accepted |
| Idempotency | Repeat same key/payload, then same key/different payload | Same order on replay; conflict on changed payload |
| Deadline | Test 15-minute and coupon-expiry boundaries in Asia/Bangkok | Late slip rejected; timely slip can be reviewed later |
| Slip retry | Repeat accepted slip upload with same token | Existing submission returned; no second Drive file |
| Drive privacy | Attempt access to shared folder/file and wrong parent folder | Fails closed |
| Admin authorization | Request slips/IP history without valid Admin session | Rejected and no protected data returned |
| Session controls | Revoke, suspend, change password, idle and expire sessions | Old sessions fail |
| Abuse controls | Parallel attempts from multiple simulated Vercel instances | Shared HMAC-keyed Sheets thresholds enforced |
| Quota/performance | Benchmark PBKDF2, Sheet scans, locks and Drive calls | Runtime stays within Apps Script quotas and time limits |
| Browser/device | Complete guest/member/admin workflows in real browsers/devices | All flows pass using synthetic data |

Record test date, code commit, deployment version and observed result. Never use real customer slips for security testing.

## Important operational limitation

A successful GitHub Actions run proves the Node-side tests passed; it does not prove Apps Script runtime compatibility, Google permissions, Drive privacy, Sheets concurrency or live quotas. Do not accept real customer payments or slips until all release gates pass and deployment is separately approved.
