# Nobi Topup — Zero-Cost Target Architecture

Status: user approved switching away from Vercel + Database to strict zero-cost Google architecture on 2026-11-05. Documentation/source planning only; no resource creation, initialization, deployment or live operation is authorized.

## Cost and branch boundaries

- Work only on `vercel-drive-setup`; never modify `main`.
- Use existing Google and GitHub accounts only.
- No paid services, billing, payment cards, paid add-ons, Neon, hosted PostgreSQL, Vercel Blob or Vercel runtime.
- Use only existing Google quotas and Drive capacity. If exhausted, fail closed; never upgrade or silently route to a paid provider.
- Google may change free quotas/terms; unlimited free service cannot be guaranteed.
- Synthetic data only; no real customer data, payment credentials or slips.

## Target architecture

Browser → Apps Script HtmlService → explicit `google.script.run` facade → Apps Script business logic → Sheets + private Drive.

Apps Script hosts the web app and backend. `google.script.run` is the built-in Apps Script client/server bridge, not a separately subscribed API provider. Sheets is persistent data storage. Drive stores slips and media in Restricted / Private folders. GitHub remains source control.

## Frontend compatibility

Current storefront/Admin call same-origin Express REST endpoints. Add a frontend service adapter mapping UI actions to allowlisted Apps Script functions. Preserve layout, Thai copy, validation, response semantics and business rules. Convert uploads/downloads to bounded Apps Script-compatible patterns. Re-check authorization server-side for every privileged call. Never expose secrets, password hashes, session hashes or private Drive URLs.

## Apps Script backend

Reuse Schema v1 config, repositories, business handlers, coupon/order logic, session controls and Drive privacy helpers after real-runtime verification. Replace the Express signed-HTTP gateway dependency with a narrow HtmlService callable facade. Never expose generic table read/write operations. Validate all arguments and authorization. Use LockService and idempotent recovery for multi-row mutations. Store secrets in Script Properties. Benchmark PBKDF2-SHA256 120,000 iterations before enabling authentication.

## Data and privacy

Sheets stores Admins, Members, sessions, games, packages, coupons, redemptions, promotions, orders, idempotency, rate limits and audit records. Money is integer satang; timestamps UTC; coupon expiry interpreted in Asia/Bangkok. Drive files/folders remain Restricted / Private; slips are Admin-only; catalog media requires an active reference.

## Business invariants

- Guest checkout; ASCII Member Login ID 4–30, case-insensitive.
- Coupon modes public/member_only/member_game_spend; UID allowlist and UID cumulative spend are independent.
- Only Completed post-discount Member orders count toward qualifying spend.
- Coupon Reserved on Pending, Consumed on Completed, Released on Rejected/Expired.
- Default payment/slip deadline 15 minutes; expiring coupon orders through end of expiry date Asia/Bangkok.
- Server computes prices, discounts, totals and deadlines; timely slips may be reviewed later.
- Sessions max 8h, idle 30m; revoke on logout/password change/suspension.
- No Member IP history (approved decision B); retain non-IP login/security events for 90 days.
- Private slips/media; manual Admin slip review only.

## Quota and safe-failure policy

Apps Script execution/daily/concurrency limits, Sheets operation volume and Drive capacity are hard constraints. Use bounded operations, pagination, lock timeouts and idempotent recovery. On quota/storage exhaustion, return a controlled unavailable result, avoid unbounded retries, and do not enable paid alternatives.

## Release gates

1. Read-only audit of frontend REST callers, GAS actions and payload/response contracts.
2. Produce route-to-function compatibility matrix and inspect HtmlService constraints.
3. Implement allowlisted callable facade and frontend adapter.
4. Run static/offline tests.
5. Import into an isolated Apps Script test project only after separate approval.
6. Benchmark PBKDF2, locks, Sheets scans, file transfer and execution time.
7. Verify Drive ACLs, Admin-only slip/IP access, session revocation, coupon/order concurrency and quota failure.
8. Browser/device E2E with synthetic data.
9. Separate approval required before project/resource creation, spreadsheet initialization, Drive folder creation, Script Properties, deployment, Admin bootstrap or live payments/orders.
