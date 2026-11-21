# Nobi Gaming STAGING — Manual Runtime and Browser Checklist

Run only against the private STAGING Web App created by `staging/README.md`. Use synthetic data only.

Record each test as PASS / FAIL / NOT RUN, with a short sanitized note. Never record passwords, session tokens, full private resource IDs, or real customer information.

## 1. Initialization and access

- [ ] `setupNobiDatabase` returns `ok: true`, Schema v4, and 18 sheets.
- [ ] Spreadsheet includes `member_coupon_alerts` with the expected header row.
- [ ] `seedDefaultCatalog` adds the expected synthetic catalog and can be safely rerun without duplicating packages.
- [ ] `initializeAdmin` creates the staging Admin account and removes the bootstrap password property.
- [ ] Root Storefront page renders without a server exception.
- [ ] `?page=admin` renders the Admin login page.
- [ ] `?page=member` renders the Member login/registration page.
- [ ] The deployed app is accessible only to the staging owner.

## 2. Member account and sessions

- [ ] Register a synthetic Member with a valid ASCII Login ID and alphanumeric password (8–200 characters).
- [ ] Reject a Login ID outside the documented 4–30 ASCII character policy.
- [ ] Reject a password shorter than 8 characters or containing non-alphanumeric characters.
- [ ] Login succeeds with the correct credentials.
- [ ] Wrong credentials fail without exposing internal details.
- [ ] Member dashboard loads and shows only that Member's profile/orders.
- [ ] Password change succeeds with the current password.
- [ ] After password change, the page returns to the login state and the old session is invalid.
- [ ] Logout invalidates the session.
- [ ] Refreshing the page does not restore an old in-memory token; login is required again.
- [ ] Idle/absolute session expiry is verified where practical; do not wait for expiry if it would incur excessive quota.

## 3. Catalog and guest checkout

- [ ] Storefront shows seeded games and packages.
- [ ] Guest can select a game/package and enter a synthetic player ID.
- [ ] Invalid or missing required fields are rejected server-side.
- [ ] Payment information renders using only the staging configuration/sample values.
- [ ] Order creation produces a Pending order with the expected amount and deadline.
- [ ] Repeated request with the same idempotency key does not create a duplicate order.
- [ ] A conflicting payload with a reused idempotency key is rejected.
- [ ] No real payment is made.

## 4. Coupons and rolling 30-day member spend

- [ ] Admin can create a public synthetic coupon.
- [ ] Public coupon validates for an eligible synthetic order.
- [ ] Member-only coupon rejects a guest and accepts an authenticated Member.
- [ ] `member_game_spend` requires qualifying Completed spend for the configured game only.
- [ ] `member_total_spend` requires qualifying Completed spend across all games.
- [ ] Pending, Rejected, Expired, guest, and older-than-30-day orders do not count toward member spend.
- [ ] Spend uses the post-discount `total_satang` value.
- [ ] Progress and 75% / 80% / 90% / 100% alerts behave as expected.
- [ ] Coupon expiry and minimum-order rules are rechecked at checkout.
- [ ] UID allowlist and UID cumulative-spend restrictions remain independent of Member spend qualification.

## 5. Order deadlines, slip upload, and Admin review

- [ ] Normal order receives a 15-minute payment/slip deadline.
- [ ] Coupon order without coupon expiry receives the 15-minute deadline.
- [ ] Order using an expiring coupon follows the expiry-day end in Asia/Bangkok, not the normal 15-minute deadline.
- [ ] Expired Pending order is rejected by server-side deadline enforcement.
- [ ] Valid synthetic PNG/JPEG/WebP slip within 3 MiB is accepted before its deadline.
- [ ] Invalid MIME/signature, malformed, truncated, or oversized file is rejected.
- [ ] Slip is not accessible from the public Storefront.
- [ ] Unauthenticated Admin slip request is rejected before Drive read.
- [ ] Authenticated staging Admin can retrieve the test slip.
- [ ] Admin can mark a synthetic order Completed or Rejected.
- [ ] Coupon reservation is consumed on Completed and released on Rejected/Expired.
- [ ] No real transfer, bank receipt, or customer slip is used.

## 6. Private Drive ACLs and media

- [ ] Slips folder is Restricted and has no explicit editors/viewers.
- [ ] Media folder is Restricted and has no explicit editors/viewers.
- [ ] Uploaded synthetic media remains private and belongs to the staging Media folder.
- [ ] No file is shared as Anyone or Anyone with the link.
- [ ] Public media endpoint returns only active catalog/promotion media referenced by the staging database.
- [ ] A missing/unverifiable/private-ACL failure fails closed.
- [ ] No Google Drive sharing URL is exposed in the browser.

## 7. Runtime, concurrency, and quotas

- [ ] Apps Script V8 executes core Storefront, Member, and Admin flows without runtime errors.
- [ ] Sheets read/write operations succeed on the staging spreadsheet.
- [ ] Two near-simultaneous synthetic order requests do not create duplicate records or over-reserve coupon capacity.
- [ ] Lock acquisition timeout fails closed and does not partially commit an order.
- [ ] A quota/service error does not report a successful write when the write failed.
- [ ] Note execution time and observed latency for setup, login, dashboard, order creation, coupon validation, and slip upload.
- [ ] Stop on quota exhaustion; do not request a paid upgrade.

## 8. Browser and device checks

- [ ] Desktop Chrome: Storefront layout and interactions.
- [ ] Desktop Chrome: Admin login, dashboard, order review, and coupon CRUD.
- [ ] Desktop Chrome: Member registration, dashboard, order history, and coupon wallet.
- [ ] Android Chrome: Storefront layout and checkout controls fit the screen.
- [ ] Android Chrome: Member and Admin forms do not overflow or overlap.
- [ ] Android Chrome: QR code displays clearly and can be scanned only as a visual check; do not pay.
- [ ] Browser refresh clears in-memory Member/Admin session as expected.
- [ ] Back navigation does not reveal protected data after logout.

## 9. Acceptance decision

- [ ] All critical security tests pass.
- [ ] No production resource was touched.
- [ ] No real payment or customer data was used.
- [ ] Failures are documented with sanitized messages and reproduction steps.
- [ ] Remaining issues are fixed and re-tested on the STAGING environment before any separate deployment discussion.

**Important:** passing this checklist is not authorization to launch, expose the app publicly, connect production data, accept real orders, or process real payments.
