# Nobi Topup — Google Apps Script migration (work in progress)

## Scope and safety

This is the first backend foundation for the agreed zero-budget direction: Google Apps Script + Google Sheets + Google Drive. It is **not a complete migration or production-ready deployment yet**. The existing Express/SQLite app remains unchanged; this branch adds a separate GAS backend so the current app is not broken while migration work continues.

- Work only on `vercel-drive-setup`; never edit `main`.
- Keep the spreadsheet and Drive folder private.
- Never commit passwords, Script Properties, session tokens, PromptPay IDs, or real customer slips.
- Google Sheets is not SQL and offers no relational transactions. Locks help serialize critical writes but cannot make a multi-step Drive + Sheets operation fully transactional.
- The current login password hash is SHA-256 with a per-user salt. Before production, replace it with a deliberately slow password KDF if a suitable implementation is available in Apps Script, or use Google identity/another established identity provider. Do not treat this scaffold as hardened production authentication.
- GAS web apps have execution quotas and time limits. Measure actual call volume before relying on this for a live shop.
- Existing HTML uses relative `fetch('/api/...')` calls and is not yet wired to `google.script.run`; frontend conversion and end-to-end testing remain outstanding.

## Create the Google backend

1. Open Google Apps Script while signed in to the Google account you already use: https://script.google.com/
2. Create a new project named **Nobi Topup Backend**.
3. Replace the starter `Code.gs` with the repository's `google-apps-script/Code.gs` contents.
4. In Project Settings, enable showing the `appsscript.json` manifest; replace it with `google-apps-script/appsscript.json`.
5. Save, select `setupNobiDatabase`, and click **Run**. Review and approve the Google permissions. This creates a spreadsheet and a Drive folder, and stores their IDs in Script Properties.
6. In **Project Settings → Script Properties**, add `NOBI_ADMIN_USERNAME` and `NOBI_ADMIN_PASSWORD` (14+ characters), save, then run `initializeAdmin` once. The bootstrap password property is deleted after the admin is created. Never put the password in source code or chat.
7. Do not deploy a public web app yet. First finish the frontend bridge, upload encoding, auth/session storage and end-to-end checks.
8. After those checks pass, deploy as a Web App using the narrowest viable execution/access settings. Recheck that the slip folder and spreadsheet remain private. Do not share either with “Anyone”.


## Import the HtmlService front end and connect it

After copying `Code.gs` and the manifest into the Apps Script project:

1. In the Apps Script editor, click **+ → HTML** and create a file named exactly `Storefront` (without `.html`). Copy the complete contents of [public/nobitopup.html](../public/nobitopup.html) into it.
2. Create a second HTML file named exactly `Admin`. Copy [public/admin.html](../public/admin.html) into it.
3. Save all files. The storefront is served by the web app URL; the admin login page is served by adding `?page=admin` to that URL.
4. The pages now use the allowlisted `rpc()` bridge via `google.script.run`; do not expose Sheets or Drive IDs in browser code. Admin RPC calls require a server-issued session token. The order list returns only a Drive file ID; the image bytes are returned only by the separately authorized `adminSlipData` call.
5. Run `setupNobiDatabase` and `initializeAdmin` as described above. Add game/package/coupon/promotion rows using the admin page after the web app is deployed for testing.
6. Deploy a **test deployment** first. Check that the web app runs as the shop's Google account, that the spreadsheet and slip folder remain private, and that unauthenticated users cannot call any admin RPC successfully.

**Important deployment caveat:** the storefront is intended to be public, so a Web App deployment may need “Anyone” access while executing as the owner. That makes every public RPC callable by the internet. The allowlist intentionally exposes only catalog, promotions, coupon validation/suggestions, payment-info status, and order creation without admin credentials. Do not add unrestricted Drive/Sheets methods to this allowlist. Admin authentication is a custom token layer and is not equivalent to Google-managed identity or an HttpOnly cookie.

## Implemented scaffold functions

- `setupNobiDatabase()`: creates the Sheets and a private Drive folder.
- `initializeAdmin()`: creates the first admin from editor prompts.
- `publicCatalog()`, `publicPromotions()`, `validateCoupon()`.
- `createOrder(payload)`: validates selected active game/package, coupon, idempotency key and image type/size; stores slip in private Drive; records order and increments coupon usage under a script lock.
- `adminLogin()`, `adminLogout()`, `adminDashboard()`, `adminOrders()`, `adminSlipData()`, `adminSetOrderStatus()`, `adminList()`, `adminUpsert()`, `adminDelete()`.

These are Apps Script functions intended to be called by a trusted integration layer; they are not all exposed as safe direct HTTP endpoints. Any future client bridge must pass session tokens explicitly and must not expose private slip contents to unauthenticated callers.

## Known work remaining before launch

- Copy the updated storefront/admin HTML into the two HtmlService files exactly as described above; repository HTML files are not automatically imported into Apps Script.
- Verify admin-only slip viewing end-to-end; the bridge returns slip bytes only after `requireAdmin_`, and never includes base64 in order-list responses.
- Add stronger password hashing, session rotation/revocation UX, CSRF/origin strategy suitable for Apps Script, login throttling that survives quota/locking pressure, and admin password change/revoke-all.
- Fix referential integrity/deletion behavior for games/packages and define coupon usage semantics for rejected/cancelled orders.
- Validate image signatures, not only claimed MIME type; consider upload memory/runtime limits.
- Add CRUD/data validation for all fields, uniqueness constraints and migration/seed strategy.
- Run automated/manual tests for coupon limits under concurrent submissions, duplicate request keys, upload rollback, forged MIME/signatures, private slip authorization, session expiry/revocation, and all storefront/admin flows.
- Confirm Google account quotas and expected traffic before live use.
- Decide how PromptPay QR generation is retained in the GAS frontend (the existing `promptpay-qr` npm library cannot run inside Apps Script unchanged).

## Data model

Sheets are created for `admins`, `games`, `packages`, `coupons`, `promotions`, `orders`, and `sessions`. Unlike SQLite, IDs are UUIDs; code that assumes numeric IDs must be migrated accordingly.


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
