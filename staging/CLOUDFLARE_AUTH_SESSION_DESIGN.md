# Nobi Gaming — Cloudflare Pages Auth and Session Broker

- **Status:** Source-only implementation and Node/VM tests complete for authentication/session foundation; no Cloudflare resources, D1 database, secrets or deployment configured.
- **Branch:** `staging-runtime-test-kit`
- **Scope:** STAGING only. No Production or live Apps Script changes.

## 1. Explicit Pages routes

| Method | Route | API-only Apps Script action | Purpose |
|---|---|---|---|
| POST | `/api/auth/member/register` | `memberRegister` | Register; does not automatically create a session |
| POST | `/api/auth/member/login` | `memberLogin` | Create a Member browser session |
| GET | `/api/auth/member/me` | `memberMe` | Verify and read current Member session |
| POST | `/api/auth/member/logout` | `memberLogout` | Revoke Member backend session and browser session |
| POST | `/api/auth/admin/login` | `adminLogin` | Create an Admin browser session |
| GET | `/api/auth/admin/me` | `adminMe` | Verify current Admin session |
| POST | `/api/auth/admin/logout` | `adminLogout` | Revoke Admin backend session and browser session |

Each route is an explicit file under `functions/api/auth/`. There is no generic browser-supplied `action` proxy. Business routes for wallet/top-up operations and Member/Admin UI integration remain separate work.

## 2. Trust boundaries

Browser -> same-origin Pages Function -> HMAC-signed API-only Apps Script `doPost(e)` -> STAGING Sheets/private Drive.

- Browser receives only an opaque Secure HttpOnly cookie. It never receives the Apps Script session token, HMAC secret or encryption key.
- Pages Functions resolve the cookie to a D1 row, decrypt the Apps Script token in memory, then call one fixed Apps Script action.
- Apps Script independently verifies timestamp, nonce, HMAC, action allowlist and Member/Admin session.
- The Pages gateway client accepts only an HTTPS `script.google.com/macros/s/{deployment}/exec` URL and follows the Apps Script content redirect.
- The canonical HMAC payload property order is `version,timestamp,nonce,action,args`; the signature is HMAC-SHA256 encoded as lowercase hex.
- No CORS policy is enabled. POST routes require exact `Origin === APP_ORIGIN`, same-origin request URL, and reject cross-site `Sec-Fetch-Site`.
- JSON auth request bodies are capped at 16 KiB. Responses are `no-store` and `nosniff`.

## 3. Browser cookies and D1

Cookies are role-separated:
- Member: `__Host-nobi_member`
- Admin: `__Host-nobi_admin`

Both use `Path=/; Secure; HttpOnly; SameSite=Lax`, no `Domain` attribute and a maximum absolute lifetime of 8 hours. The `__Host-` prefix therefore remains compatible with the required host-only cookie rules.

The browser cookie is a random 256-bit base64url value. D1 stores only its SHA-256 hash; it does not store the raw cookie. The Apps Script token is encrypted at rest with AES-256-GCM using a fresh 96-bit IV and role/session-hash additional authenticated data. D1 stores the ciphertext and IV, never the plaintext token.

Session policy:
- Absolute lifetime: maximum 8 hours, additionally capped by the Apps Script `expires_at`.
- Idle timeout: 30 minutes, enforced in both D1 and Apps Script.
- Separate role cookie and role column prevent Member/Admin session crossover.
- Logout deletes the D1 session and clears the cookie. Backend logout is attempted first; if Apps Script is temporarily unavailable, the local browser session is still removed.
- Expired/idle rows are deleted when presented and opportunistically pruned during a new login.
- No Member IP address or IP history is stored in this D1 table.

D1 migration: `migrations/0001_pages_sessions.sql`.

## 4. Required environment bindings (not configured)

| Binding / secret | Purpose |
|---|---|
| `DB` | Cloudflare D1 binding for `nobi_pages_sessions` |
| `APP_ORIGIN` | Exact HTTPS origin allowed to use auth POST routes |
| `GAS_API_URL` | API-only Apps Script STAGING Web App `/exec` URL |
| `NOBI_GATEWAY_SECRET` | HMAC secret shared only by Pages Functions and API-only Apps Script |
| `SESSION_ENCRYPTION_KEY` | Base64 encoding of exactly 32 random bytes for AES-256-GCM |

No values are stored in this repository. Generate the encryption key outside source control (for example, `openssl rand -base64 32`) and add it only as a Cloudflare secret after the owner approves resource setup. Never paste secret values into chat or commits. Changing the encryption key invalidates existing D1 sessions unless a separately reviewed rotation procedure is implemented.

## 5. Verification

[GitHub Actions run 45851314205](https://github.com/rattasart153-ops/nobigaming/actions/runs/45851314205) passed on commit `1fdac2b6c58ea3149c0b6a35ad6acb803892a72f`:

- Node/VM suite: **224/224 passed**.
- Workerd image sanitizer suite: **9/9 passed**.
- Auth tests cover HMAC canonicalization/signature, Apps Script URL allowlisting, response validation, encrypted D1 token storage, cookie flags, role separation, 8-hour absolute expiry, 30-minute idle expiry, corrupt ciphertext deletion, idle-row pruning, origin rejection, registration/login, Member/Admin session checks and logout.

The auth/session tests use a synthetic D1 implementation and mocked Apps Script responses. They do not prove real Cloudflare D1 behavior, Pages deployment routing, live Apps Script redirect behavior, Apps Script V8 session behavior or Cloudflare Access configuration.

## 6. Remaining work before auth can be used

1. Create a dedicated Cloudflare STAGING Pages project and D1 database only after explicit owner approval.
2. Apply the D1 migration and configure the required bindings/secrets without exposing them.
3. Deploy only after approval, then verify real D1 CRUD, cookie behavior, Apps Script redirects, HMAC verification and session revocation with synthetic accounts.
4. Add role-checked wallet/top-up business routes; never expose arbitrary action proxying.
5. Integrate Member/Admin browser screens with these same-origin routes and test the complete flows.

No live Cloudflare resource, D1 database, secret, Apps Script project, Script Property, Sheet, Drive file, trigger or deployment was created or changed by this work.
