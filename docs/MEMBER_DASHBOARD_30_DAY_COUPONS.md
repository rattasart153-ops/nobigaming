# Member Dashboard and Rolling 30-Day Coupon Rules

## Member page
- The HtmlService page is available at the Web App path `/member` (and `?page=member` for compatibility).
- Storefront account modal links authenticated members to the dedicated page.
- Members can register/login, view their profile, change their password, place an order, apply a coupon, submit a slip, and view their latest 50 orders.
- Member and checkout tokens remain memory-only in the page. Reloading requires login again; an in-progress slip upload must be completed before leaving the page.

## Rolling spend window
- The window is the 30 x 24-hour period immediately preceding the server's current time.
- Only orders with status `Completed`, matching the authenticated member ID, and a `completed_at` timestamp inside the window are counted.
- The amount is `total_satang`, i.e. after coupon discount.
- Spend is calculated separately per game and across all games.
- Guest orders, Pending, Rejected, Expired, and orders older than 30 days are excluded.
- UID cumulative-spend restrictions remain a separate rule and are not changed by this member-spend window.

## Coupon scopes
- `member_game_spend`: requires a completed 30-day spend threshold in the configured qualifying game.
- `member_total_spend`: requires a completed 30-day spend threshold across all games. The existing member threshold column is reused to avoid changing the existing coupons sheet header.
- The coupon's optional `game_id` still restricts which game can redeem it; it does not change the total-spend qualification scope.
- Coupon validity, minimum order, expiry, UID restrictions, and capacity are rechecked by the server at checkout.

## Progress notifications
- Milestones: 75%, 80%, and 90%; 100% produces an unlock notification.
- Milestones crossed between dashboard visits are emitted together.
- The `member_coupon_alerts` sheet stores the last notified stage per member/coupon. If the rolling balance falls below a previous stage, the stage resets and may notify again if crossed later.
- Alerts are generated when the member dashboard is read; there is no background push notification service.

## Schema
- Schema version 4 adds the `member_coupon_alerts` sheet. Existing coupon sheet columns are unchanged.
- `setupNobiDatabase` creates the new sheet and updates the schema version after preflight checks.
- No live Sheets setup, Google deployment, or production data operation is performed by this source change.
