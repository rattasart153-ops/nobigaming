# Frontend → Backend Compatibility Inventory

Branch: `vercel-drive-setup`

Status: source inventory completed. This is a compatibility record, not permission to switch either frontend to the Express API.

## Executive finding

Both HTML frontends currently use Google Apps Script RPC directly. The REST-looking calls in `public/admin.html` are a local JavaScript adapter that translates those calls into `google.script.run.rpc(action, args)`; they do not use HTTP fetch to call Express. The storefront in `public/nobitopup.html` calls `google.script.run` directly.

The Express API exists as a separate backend baseline. Until the adapters are deliberately replaced and end-to-end tested, serving these HTML files from Express does not make the pages compatible with the Express API. In particular, the storefront explicitly reports that it must be opened as an Apps Script Web App if `google.script.run` is absent.

## 1. Storefront call inventory

Source: `public/nobitopup.html`.

| UI operation | GAS RPC action | Request arguments | Current response contract / frontend use |
|---|---|---|---|
| Load catalog | `catalog` | none | `{games: [...], packages: [...]} `; frontend groups packages by `game_name`, reads `game_id`, `amount`, `price`, `popular`, `image_url`. |
| Load promotions | `promotions` | none | Array of active promotions; frontend reads `title`, `subtitle`, `link_url`, `image_url`. |
| Validate coupon | `coupon` | `{code, gameId, subtotal, playerId}` | `{valid, error, code, coupon_id, discount, total}`; frontend reads `valid`, `discount`, `error`. |
| Suggest coupon | `couponSuggestions` | `{gameId, subtotal, playerId}` | `{suggestion: null | {code, discount, message}}`. |
| Build PromptPay QR | `paymentInfo` | `{amount}` | GAS currently returns `{configured:false, message}` even when a PromptPay ID is configured because QR generation is not implemented there. |
| Submit order | `createOrder` | `{game_id, package_id, player_id, server_id, coupon_code, request_key, slip:{name,mimeType,base64}}` | `{ok, order, duplicate}`; frontend requires `ok` and reads `order.id`. The request sends the complete slip as base64 in the RPC payload. |

The storefront requires a player UID before checkout. It creates a `request_key` once for each submission attempt and sends the selected slip's name, MIME type, and base64 bytes.

## 2. Admin call inventory

Source: `public/admin.html`.

The `api(url, opts)` helper is not a REST client. It parses the local options and maps the URL to a GAS RPC action, passing the bearer-like token from `sessionStorage` as `args.token`.

| UI operation / pseudo-route | GAS RPC action | Request arguments | Current response contract / frontend use |
|---|---|---|---|
| `POST /api/admin/login` | `adminLogin` | `{username, password}` | `{ok, token, expires_at, username}`; token is stored in `sessionStorage`. |
| `POST /api/admin/logout` | `adminLogout` | `{token}` | `{ok:true}`; browser token is removed. |
| `GET /api/admin/me` | `adminMe` | `{token}` | `{authenticated:boolean}`. |
| `GET /api/admin/dashboard` | `adminDashboard` | `{token}` | `{orders, pending, completed, revenue}`. |
| `GET /api/admin/orders` | `adminOrders` | `{token}` | Array of orders; includes `slip_file_id` for the Admin UI to decide whether to show “ดูสลิป”. |
| `PATCH /api/admin/orders/:id/status` pseudo-route | `adminSetOrderStatus` | `{token, orderId, status}` | `{ok:true}` on success; GAS rejects status changes once an order has left Pending, except a no-op same status. |
| View slip button | `adminSlipData` | `{token, orderId}` | `{name, mimeType, base64}`; UI creates a data URL and renders the image. |
| `GET /api/admin/{games,packages,coupons,promotions}` | `adminList` | `{token, tableName}` | Array of records. |
| `POST/PUT /api/admin/{games,packages,coupons,promotions}` | `adminUpsert` | `{token, tableName, record}` | `{ok:true, id}`; the UI refreshes the list instead of consuming the returned record. |
| `DELETE /api/admin/{games,packages,coupons,promotions}/:id` | `adminDelete` | `{token, tableName, id}` | `{ok:true}`. |

The Admin UI's visible fields currently include games, packages, coupons (including UID allowlist and minimum spend), and promotions. The current coupon editor does not yet expose the approved Member access modes or Member game-spend eligibility fields.

## 3. Express API comparison and required adapters

| Concern | Existing GAS RPC frontend contract | Current Express API | Required compatibility work |
|---|---|---|---|
| Transport | `google.script.run.rpc` | HTTP REST + cookie session | Replace the GAS bridge with same-origin fetch only after each route is tested. |
| Coupon validation | `valid` / `error` | `ok` / `message` | Add a deliberate adapter or update UI and tests; do not silently assume fields match. |
| Coupon suggestion | `{suggestion}` | `{suggestion}` | Verify message text, rounding, and eligibility parity. |
| Order submission | Snake_case JSON with base64 slip | Multipart form with camelCase fields and file field `slip` | Convert payload, keep idempotency key semantics, and confirm ambiguous retry behavior. |
| Order result | `{ok, order, duplicate}` | `{message, order}` with HTTP 201 | Update UI to inspect HTTP status and response; add duplicate/idempotency handling. |
| Admin authentication | Token stored in sessionStorage and passed in every RPC | HttpOnly cookie session | Remove browser token handling and use same-origin credentials; verify login/logout/session expiry. |
| Admin order list | `slip_file_id` | `has_slip`; filesystem path is intentionally omitted | Update render condition to `has_slip`; never return a Drive ID or local path to the browser. |
| Slip retrieval | Base64 JSON via authorized GAS RPC | Binary response via Admin-only `GET /api/admin/orders/:id/slip` | Change view handler to fetch binary with cookie credentials and render an object URL; revoke it when no longer needed. |
| CRUD upsert | `{ok,id}` | Created/updated record | UI currently refreshes after save; verify status/error handling and use returned record only if needed. |
| Admin status transition | GAS prevents changing a reviewed order to another status | Express now allows Pending→Completed/Rejected, permits a no-op same status, and rejects reversals with HTTP 409 | Behavior aligned and covered by API tests; preserve this rule in the Sheets repository implementation. |
| Payment info | GAS currently returns configured=false (QR not implemented) | Express generates QR when `PROMPTPAY_ID` is configured | Decide which runtime owns PromptPay generation; do not expose real payment info during testing. |

## 4. Security and runtime notes

- Storefront sends payment slip bytes through Apps Script RPC as base64. The Express API now uses multipart upload and private local slip storage; this is not yet private Drive storage.
- Admin Apps Script RPC uses an opaque token stored in `sessionStorage`; Express uses an HttpOnly session cookie. These authentication models are not interchangeable without a frontend migration.
- The Express Admin API now requires a same-origin `Origin` header for unsafe methods and rejects `Sec-Fetch-Site: cross-site`.
- Express public images are served from a dedicated public upload subdirectory. Checkout slips are not mounted at `/uploads` and are available only through the authenticated Admin slip route.
- Apps Script `paymentInfo` is a stub; Express QR generation must not be assumed to exist in the current GAS-hosted UI.
- The Express backend still uses SQLite and local session storage. Vercel persistence is not production-ready. Express PromptPay generation is now isolated in `src/services/payment-info.service.js`; GAS `paymentInfo` remains a stub until its runtime is selected.

## 5. Migration acceptance checklist

For each frontend operation:
1. Capture a representative success, validation failure, unauthorized response, and backend error from the current GAS behavior.
2. Implement an explicit request/response adapter for the Express route.
3. Test the exact HTML UI against the route with synthetic data.
4. Confirm session handling, error messages, loading state, and duplicate-submit behavior.
5. For order creation, test upload size/type, server-side price, coupon revalidation, idempotency, private slip retrieval, and cleanup after failure.
6. Remove the GAS RPC path only after the replacement has passed the same checks.

No frontend migration, Apps Script publication, Vercel deployment, or live checkout is authorized by this inventory.
