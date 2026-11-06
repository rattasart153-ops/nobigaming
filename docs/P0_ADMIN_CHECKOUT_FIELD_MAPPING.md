# P0-R9/R10 — Admin CRUD, Checkout Contract Mapping and Trusted IP Gate

Date: 2026-11-06  
Branch: `vercel-drive-setup`  
Baseline commit before this pair: `26907d088dbc1d94b6eda7139ee1a025ab7b9454`  
Scope: source-backed contract mapping and safe audit-propagation correction. No deployment, Google resource creation, billing, or production data.

## P0-R9 — Field-by-field Admin CRUD and checkout mapping

This is a migration contract reference, not a claim that the current Express routes are the approved final HtmlService transport. The current browser-facing source is Express REST -> signed GAS gateway -> `dispatchGatewayAction_`. The future HtmlService facade must preserve these semantics while accepting only typed, allowlisted arguments.

### Admin session and overview

| Browser operation | Browser request | GAS action and arguments | Browser response / behavior |
|---|---|---|---|
| Login | `POST /api/admin/login`, JSON `{username,password}` | `adminLogin(username,password,ipAddress)`; IP is server-derived | Sets HttpOnly `nobi_admin_session`; JSON `{ok:true,username}`. Raw GAS session token is not returned to browser JSON. |
| Logout | `POST /api/admin/logout`, Admin cookie | `adminLogout({token})` | Revokes session; clears cookie; `{ok:true}`. |
| Session check | `GET /api/admin/me`, Admin cookie | `adminMe({token})` | `{authenticated:boolean}`; invalid session clears cookie. |
| Change password | `POST /api/admin/password`, JSON `{currentPassword,newPassword}` | `adminChangePassword({token,currentPassword,newPassword,ipAddress})` | Returns GAS result; clears cookie after password rotation/revocation. |
| Dashboard | `GET /api/admin/dashboard` | `adminDashboard({token})` | `{orders,pending,completed,revenue,games,packages,coupons,promotions}`; revenue is Completed-order total. |
| Orders | `GET /api/admin/orders` | `adminOrders({token})` | Array of safe order records, enriched with `id,game_name,package_name,coupon_code,has_slip,subtotal,discount,total`. Does not expose `slip_file_id,checkout_token_hash,request_key`. |
| Change order status | `PATCH /api/admin/orders/:id/status`, JSON `{status}` | `adminSetOrderStatus({token,orderId,status,ipAddress})` | Only `Completed` or `Rejected`; normal success `{ok:true,status}`, no-op `{ok:true,unchanged:true}`; expired completion maps to HTTP 409. |
| View slip | `GET /api/admin/orders/:id/slip` | `adminSlipData({token,orderId,ipAddress})` | GAS returns `{name,mimeType,base64}`; Express returns private binary with `Cache-Control: private, no-store`. Admin session and private Drive folder/file validation are required. |

### Admin CRUD — common contract

Only four tables are exposed: `games`, `packages`, `coupons`, `promotions`. All routes require an authenticated Admin session. The GAS action allowlist independently restricts table names and fields.

| Operation | Browser route | GAS arguments | Browser result |
|---|---|---|---|
| List | `GET /api/admin/{table}` | `adminList({token,tableName})` | Array of converted records. Coupon rows additionally contain `used_count`; packages/coupons are enriched with `game_name`; coupons also get `member_spend_game_name`. |
| Create | `POST /api/admin/{table}` | `adminUpsert({token,tableName,record,ipAddress})` | HTTP 201, `{ok:true,id}`. |
| Update | `PUT /api/admin/{table}/:id` | `adminUpsert({token,tableName,record,ipAddress})`; route ID is copied to the table's primary-key field | HTTP 200, `{ok:true,id}`. |
| Delete | `DELETE /api/admin/{table}/:id` | `adminDelete({token,tableName,id,ipAddress})` | `{ok:true}`; deletion is rejected if protected references/redemptions exist. |

The server-derived IP is an audit argument, not a browser-editable form field. The GAS handler writes it into the Admin audit log. Never accept `ipAddress` from browser JSON.

### Admin CRUD — record fields and transformations

| Table | Browser input fields | GAS `record` fields / transformations | List response additions |
|---|---|---|---|
| Games | `name,category,description,active,sort_order` | `game_id` on update; `name` trimmed; `category` default `other`; `description`; `active` defaults true; numeric `sort_order` | `id = game_id` |
| Packages | `game_id,name,amount,unit,price,image_url,popular,active,sort_order` | `package_id` on update; `price` converted to integer `price_satang`; numeric `amount,sort_order`; boolean `popular,active`; image reference is resolved by GAS into private `image_file_id`, never accepted directly | `id,price` (baht), proxied `image_url,game_name`; internal `price_satang,image_file_id` hidden |
| Coupons | `code,discount_type,discount_value,min_spend,game_id,access_type,member_spend_game_id,member_min_game_spend,expires_at,usage_limit,active,allowed_player_ids,min_player_spend` | `coupon_id` on update; code normalized/display uppercase; fixed discount and monetary thresholds converted to satang, percent discount remains numeric percent; allowed player IDs split on newline/comma/semicolon and stored as JSON; `access_type` remains `public/member_only/member_game_spend`; UID allowlist and UID cumulative spend remain independent; `usage_limit` blank stays unlimited | `id,code,min_spend,min_player_spend,member_min_game_spend,allowed_player_ids,expires_at,game_name,member_spend_game_name,used_count`; internal normalized code and satang/JSON fields hidden |
| Promotions | `title,subtitle,image_url,link_url,active,sort_order,starts_at,ends_at` | `promotion_id` on update; text trimmed where applicable; `active` defaults true; numeric `sort_order`; image reference is resolved by GAS into private `image_file_id`, never accepted directly | `id` and proxied private `image_url`; internal `image_file_id` hidden |

Image URLs must be application media references, not direct Google Drive/Googleusercontent links. GAS checks that referenced media belongs to the configured private media folder. CRUD changes are audited under `UPSERT_<TABLE>` and `DELETE_<TABLE>`.

### Additional Admin operations

| Browser operation | GAS action / arguments | Result contract |
|---|---|---|
| List members | `adminMembers({token,search,limit})` | Member records; limit bounded by GAS handler. |
| Change member status | `adminSetMemberStatus({token,memberId,status,ipAddress})` | Result object; status transition revokes sessions as required. |
| Member login/IP history | `adminMemberLoginLogs({token,memberId,limit})` | Admin-only log array, newest first, bounded limit. IP data must remain restricted to authenticated Admin. |
| Upload media | `adminStoreMedia({token,media:{name,mimeType,base64},ipAddress})` | `{ok:true,file_id,url}`; PNG/JPEG/WebP, max 3 MB, private folder/file checks, audit before returning reference. |

### Checkout and payment contract

| Browser operation | Browser payload | GAS action / trusted values | Response / invariant |
|---|---|---|---|
| Catalog/promotions | No body | `catalog()`, `promotions()` | Catalog object `{games,packages}`; promotions array. |
| Coupon suggestions | Query `gameId,subtotal,playerId` | `couponSuggestions` receives those values plus Member token from server cookie; GAS derives Member ID from verified session | `{suggestion:null|{code,discount,message}}`. |
| Coupon validation | JSON `{code,gameId,subtotal,playerId}` | `coupon` receives values plus server-read Member token; GAS derives Member identity | Valid result maps to `{ok:true,message,discount,code}`; invalid maps HTTP 422 with `ok:false,message`. |
| Payment info | Query `amount` | `paymentInfo({amount})` | `{configured,promptpayId,amount,payload}`; payload is EMVCo PromptPay text, not a QR image. No external QR service. |
| Create order | Multipart `gameId,packageId,playerId,serverId,couponCode`, header `Idempotency-Key`; optional slip file | `createOrder({request_key,game_id,package_id,player_id,server_id,coupon_code,member_token})`; Member ID, package price, discount, totals and deadline are server-derived | GAS `{ok,order,duplicate,checkout_token}`; browser gets order and server deadline, never checkout token in JSON. Scoped HttpOnly checkout cookie is set. |
| Submit slip | Multipart `slip` to `/api/public/orders/:id/slip`; scoped checkout cookie | `submitOrderSlip({order_id,checkout_token,slip:{name,mimeType,base64}})` | `{ok:true,already_submitted,slip_submitted_at}`; accepted retries do not create duplicate Drive files. |
| Public media | Opaque media ID in URL | `publicMediaData({fileId})` | GAS returns media bytes as base64; public proxy only serves active catalog/promotion references after private-folder validation. |

Checkout invariants: request key is 16–128 allowed characters and bound to a canonical payload hash; same key/same payload replays the existing order; same key/different payload conflicts. Normal/no-expiry-coupon orders have 15 minutes. Orders using expiring coupons remain payable through the expiry date in Asia/Bangkok. Coupon capacity is Reserved on Pending, Consumed on Completed, Released on Rejected/Expired. Only a slip submitted before deadline may later be approved. Client totals and client-supplied Member IDs are never authoritative.

### Source defect found and corrected during P0-R9

The Admin `PUT /api/admin/{table}/:id` route called `adminUpsert` without forwarding `ipAddress`, unlike the matching POST route. GAS therefore wrote an empty IP into the audit event for updates. The route now forwards `String(req.ip || '')`, and a regression test asserts the update request sends the server-derived loopback address to the GAS client. This does not accept an IP from the browser.

## P0-R10 — Trusted Member IP-history compatibility decision

**Result: investigated; not safely resolvable under the currently approved HtmlService-only + existing-Google-account + Zero Cost constraints. P0-12 remains BLOCKED.**

Evidence from the approved architecture and source:

1. Current signed gateway architecture can obtain a server-side request IP at the Express ingress and pass it to GAS in a signed server-to-server request. That is a trusted server observation only when the ingress/proxy trust configuration is correctly controlled.
2. The approved target replaces that ingress with Apps Script HtmlService and `google.script.run`. The browser-callable server function receives named arguments, not a trusted remote socket address.
3. The documented Apps Script Web App event object does not expose a remote-IP field. `google.script.run` does not supply a trusted client IP as an implicit server argument.
4. Accepting `ipAddress`, `X-Forwarded-For`, query parameters, WebRTC/STUN results, or JavaScript-discovered addresses from the browser would be spoofable or would not establish the connecting public IP. It must not be stored as verified Member IP history.
5. Therefore the system cannot honestly preserve the approved Admin-only verified Member IP history using only the approved HtmlService execution path. Do not fabricate, relabel, or silently omit IP history.

No IP collection code was weakened or changed. No additional proxy/service, account, billing, paid tier, domain, or infrastructure was introduced.

**Release gate:** keep P0-12 open and do not start P1 or claim Phase 0 completion until a user-approved design provides a trusted IP-observing server boundary while preserving Zero Cost, or the user explicitly revises one of those constraints. Any such architecture/requirement change needs separate approval.

## Pair validation limits

- Automated regression tests exercise the Node route adapter with fake GAS responses; they do not prove real Apps Script runtime, Sheets, Drive, or network-ingress behavior.
- The Admin PUT audit-IP regression test is a deterministic local HTTP integration test and checks that the route derives the IP from the server request rather than the request body.
- No live Google resources, Web App deployment, production payment, real customer data, or real slip was used.
