# Nobi Topup — Google Apps Script migration (work in progress)

## Scope and safety

This is the first backend foundation for the agreed zero-budget direction: Google Apps Script + Google Sheets + Google Drive. It is **not a complete migration or production-ready deployment yet**. The existing Express/SQLite app remains unchanged; this branch adds a separate GAS backend so the current app is not broken while migration work continues.

- Work only on `vercel-drive-setup`; never edit `main`.
- Keep the spreadsheet and Drive folder private.
- Never commit passwords, Script Properties, session tokens, PromptPay IDs, or real customer slips.
- Google Sheets is not SQL and offers no relational transactions. Locks help serialize critical writes but cannot make a multi-step Drive + Sheets operation fully transactional.
- The current login password hash is SHA-256 with a per-user salt. Before production, replace it with a deliberately slow password KDF if a suitable implementation is available in Apps Script, or use Google identity/another established identity provider. Do not treat this scaffold as hardened production authentication.
- GAS web apps have execution quotas and time limits. Measure actual call volume before relying on this for a live shop.
- The repository storefront and Admin now use the Express REST API. The signed GAS gateway exists as a separate server-to-server entry point, but the Express repository adapter is not yet wired and no Apps Script deployment has been tested.

## Create the Google backend

1. Open Google Apps Script while signed in to the Google account you already use: https://script.google.com/
2. Create a new project named **Nobi Topup Backend**.
3. Replace the starter `Code.gs` with the repository's `google-apps-script/Code.gs` contents.
4. Add a script file named `13_HttpGateway.gs` and copy the repository file with that name into it. Apps Script combines top-level functions across files; keep function names unique.
5. In Project Settings, enable showing the `appsscript.json` manifest; replace it with `google-apps-script/appsscript.json`.
6. Save, select `setupNobiDatabase`, and click **Run**. Review and approve the Google permissions. This creates a spreadsheet and a Drive folder, and stores their IDs in Script Properties.
7. In **Project Settings → Script Properties**, add `NOBI_ADMIN_USERNAME` and `NOBI_ADMIN_PASSWORD` (14+ characters), save, then run `initializeAdmin` once. The bootstrap password property is deleted after the admin is created. Never put the password in source code or chat.
8. Add `NOBI_GATEWAY_SECRET` as a random secret of at least 32 characters. Configure the exact same value as Vercel's `APPS_SCRIPT_SHARED_SECRET`; never put it in Git or chat.
9. Do not deploy a public Web App yet. Complete the repository adapter, schema migration, private media proxy, authentication and automated/manual integration tests first. Deployment requires separate explicit approval.


## Vercel and Apps Script integration boundary

Do **not** create `Storefront` or `Admin` HtmlService files for the current architecture. The repository's `public/nobitopup.html` and `public/admin.html` are served by Vercel and call same-origin Express REST endpoints. Browser code must never call `google.script.run` or the Apps Script URL.

The new `13_HttpGateway.gs` file adds a signed `doPost(e)` entry point for server-to-server calls. The matching Node client is `src/clients/apps-script.client.js`. The client is intentionally not wired into the current Express routes yet; SQLite remains the active persistence layer until the Sheets repositories, API mapping, and tests are complete.

The GAS gateway uses:
- `NOBI_GATEWAY_SECRET` in Apps Script Script Properties.
- `APPS_SCRIPT_URL` and the same `APPS_SCRIPT_SHARED_SECRET` in Vercel environment configuration.
- Protocol version 1 with timestamp, nonce, fixed action name, arguments and HMAC-SHA256 signature.
- A private `gateway_nonces` sheet and ScriptLock for replay prevention.

Do not paste secrets into GitHub, chat, browser code, or source files. Do not deploy the Apps Script Web App yet. The gateway and legacy RPC handlers have not been exercised inside a real Apps Script deployment.

## Implemented scaffold functions

- `setupNobiDatabase()`: creates the Sheets and a private Drive folder.
- `initializeAdmin()`: creates the first admin from editor prompts.
- `publicCatalog()`, `publicPromotions()`, `validateCoupon()`.
- `createOrder(payload)`: validates selected active game/package, coupon, idempotency key and image type/size; stores slip in private Drive; records order and increments coupon usage under a script lock.
- `adminLogin()`, `adminLogout()`, `adminDashboard()`, `adminOrders()`, `adminSlipData()`, `adminSetOrderStatus()`, `adminList()`, `adminUpsert()`, `adminDelete()`.

These are Apps Script functions intended to be called by a trusted integration layer; they are not all exposed as safe direct HTTP endpoints. Any future client bridge must pass session tokens explicitly and must not expose private slip contents to unauthenticated callers.

## Known work remaining before launch

- Replace the legacy Sheets schema and RPC business logic with the approved versioned data model and focused repositories.
- Implement Member registration/login, separate Admin/Member sessions, approved coupon access modes and Admin-only IP audit history.
- Replace SHA-256-only password hashing with a deliberately slow KDF and test its Apps Script runtime cost.
- Implement coupon reservation/consume/release and payment-deadline lifecycle exactly as approved; the current GAS scaffold does not yet do this.
- Implement durable idempotency records for orders and gateway actions; the gateway nonce ledger protects transport replay but is not an order idempotency substitute.
- Implement private Drive subfolders for slips, catalog images and promotion images, plus authorized Vercel proxy delivery. Do not publish Drive files.
- Complete image decoding/re-encoding, pixel/dimension limits and upload rollback/reconciliation.
- Implement a Vercel repository adapter and map each Express route to a tested gateway action. SQLite is still the active persistence layer.
- Run GAS runtime tests for signature failures, stale timestamps, replay, concurrent writes, missing schema, private file access and quota behavior.
- Confirm Google account quotas and expected traffic before live use.
- Keep PromptPay QR generation in the existing Vercel Node layer unless a separately tested GAS-compatible approach is justified.

## Data model

Current `Code.gs` still contains a legacy scaffold schema. The target schema is specified in [DATA_MODEL.md](./DATA_MODEL.md), including separate Admin/Member sessions, coupon redemption ledger, order deadlines, idempotency records, audit logs and gateway nonce ledger. The schema migration is not complete.


## เงื่อนไขคูปองเพิ่มเติม

ในหน้าแอดมินของระบบเดิม สามารถกำหนดเงื่อนไขคูปองได้เพิ่มดังนี้:

- **จำกัดเกม:** เลือกเกมที่คูปองใช้ได้ หรือเว้นว่างเพื่อไม่จำกัดเกม
- **จำกัด UID เฉพาะ:** ใส่ UID ที่อนุญาต คั่นด้วยจุลภาคหรือขึ้นบรรทัดใหม่ และต้องเลือกเกมด้วย
- **ยอดเติมสะสมขั้นต่ำของ UID:** ตรวจยอดรวม `total` จากออเดอร์ที่มีสถานะ `Completed` เท่านั้น โดยนับเฉพาะ UID เดียวกันในเกมที่ลูกค้าเลือก ยอด Pending/Rejected ไม่นับ และเป็นยอดหลังหักส่วนลด
- **ยอดซื้อขั้นต่ำต่อออเดอร์:** ยังคงเป็นเงื่อนไขแยกต่างหากจากยอดเติมสะสม

ตัวอย่าง: ตั้งเกม RoV, ยอดเติมสะสมขั้นต่ำ 500 บาท หมายถึง UID นั้นต้องมีออเดอร์ RoV ที่แอดมินอนุมัติสำเร็จรวมกันอย่างน้อย 500 บาทก่อนจึงใช้คูปองได้

หมายเหตุ: กฎดังกล่าวถูกเพิ่มในโค้ดของระบบเดิมและโครงสร้าง GAS แล้ว แต่หน้าเว็บยังไม่ได้ย้ายจาก Express API ไปเชื่อม Apps Script โดยสมบูรณ์ การทดสอบปลายทางจริงยังจำเป็นก่อนใช้งานจริง.

## Current integration status (2026-11-02)

- The repository storefront JavaScript now calls the Apps Script RPC bridge for catalog, promotions, coupon validation/suggestions, and order submission. Slip files are converted to base64 in the browser and sent to Apps Script.
- The admin JavaScript now calls the RPC bridge for login, session check, dashboard, orders, CRUD, status changes, and on-demand slip viewing. Admin tokens are kept in tab-scoped `sessionStorage`; this is not an HttpOnly cookie and XSS defenses remain important.
- The GAS entry point serves `Storefront` and `Admin` HtmlService files. **You must create those two HTML files manually in the Apps Script editor and paste the matching repository files**; GitHub changes do not automatically update an existing Apps Script project.
- PromptPay QR generation is not yet implemented in Apps Script. The payment-info bridge reports that it is not configured rather than pretending to return a QR.
- No live Apps Script deployment, Google account permission check, end-to-end test, concurrency test, or unauthorized-slip test has been performed from this repository connection. Do not accept real customer payments or slips until those tests pass.


## Security and correctness test cases (must pass before accepting payments)

| Test | Procedure | Expected result |
|---|---|---|
| Duplicate order request | Submit the same `request_key` twice, including two near-simultaneous calls | One order row, one slip file, one coupon usage increment; the retry returns the original order |
| Coupon usage limit | Set a coupon limit of 1 and submit two different requests concurrently | At most one order is accepted with that coupon |
| UID/game restrictions | Try a whitelisted coupon with another UID or another game | Validation and final order creation both reject it |
| Cumulative spend | Compare Pending, Rejected and Completed orders for the same UID/game | Only Completed order totals count |
| Forged image MIME | Upload text or another file while claiming `image/png` | Signature check rejects it |
| Oversized upload | Upload a file larger than 5 MB | Rejected before Drive persistence |
| Anonymous slip access | Open the Drive file URL while signed out or in an unrelated Google account | Access denied; folder and files are not shared publicly |
| Anonymous admin RPC | Call `adminOrders`, `adminSlipData`, `adminSetOrderStatus`, and CRUD RPC without a valid token | Every call fails authorization |
| Invalid/expired token | Change a token, revoke a session, and test after expiry | Admin calls fail and UI returns to login |
| Status replay | Approve/reject an already reviewed order and then try to reverse it | A reviewed order cannot be silently rewritten |
| Persistence | Submit an order, then reload/reopen the web app | Order remains in Sheets and slip remains in private Drive |

Record the test date, deployment version, test account, and observed result. Use synthetic orders and dummy image files only. Never use real customer slips for security testing.
