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

## Implemented scaffold functions

- `setupNobiDatabase()`: creates the Sheets and a private Drive folder.
- `initializeAdmin()`: creates the first admin from editor prompts.
- `publicCatalog()`, `publicPromotions()`, `validateCoupon()`.
- `createOrder(payload)`: validates selected active game/package, coupon, idempotency key and image type/size; stores slip in private Drive; records order and increments coupon usage under a script lock.
- `adminLogin()`, `adminLogout()`, `adminDashboard()`, `adminOrders()`, `adminSlipData()`, `adminSetOrderStatus()`, `adminList()`, `adminUpsert()`, `adminDelete()`.

These are Apps Script functions intended to be called by a trusted integration layer; they are not all exposed as safe direct HTTP endpoints. Any future client bridge must pass session tokens explicitly and must not expose private slip contents to unauthenticated callers.

## Known work remaining before launch

- Migrate the storefront and admin HTML from relative Express API calls to a secure Apps Script bridge.
- Build safe admin-only slip viewing (avoid returning full base64 blobs in order lists).
- Add stronger password hashing, session rotation/revocation UX, CSRF/origin strategy suitable for Apps Script, login throttling that survives quota/locking pressure, and admin password change/revoke-all.
- Fix referential integrity/deletion behavior for games/packages and define coupon usage semantics for rejected/cancelled orders.
- Validate image signatures, not only claimed MIME type; consider upload memory/runtime limits.
- Add CRUD/data validation for all fields, uniqueness constraints and migration/seed strategy.
- Add automated tests/manual test checklist for coupons, repeated requests, concurrent orders, uploads, private slip authorization, sessions, and all storefront/admin flows.
- Confirm Google account quotas and expected traffic before live use.
- Decide how PromptPay QR generation is retained in the GAS frontend (the existing `promptpay-qr` npm library cannot run inside Apps Script unchanged).

## Data model

Sheets are created for `admins`, `games`, `packages`, `coupons`, `promotions`, `orders`, and `sessions`. Unlike SQLite, IDs are UUIDs; code that assumes numeric IDs must be migrated accordingly.
