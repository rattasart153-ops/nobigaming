# Multi-instance Abuse-Control Design and Implementation Status

Status: shared Apps Script/Sheets rate-limit ledger is implemented in source on vercel-drive-setup. It has not yet been load-tested in a real Apps Script deployment and is not production approval.

## Current baseline

The Express Admin/Member login limiter uses express-rate-limit with a threshold of 10 requests per 15 minutes. Its default memory store is process-local. It remains a cheap first layer for local/single-instance traffic, but it is not treated as a global control across Vercel serverless instances or cold starts.

## Shared strategy

Use the existing Google Apps Script backend and a dedicated Sheets ledger named security_rate_limits, guarded by LockService.getScriptLock(). This introduces no new external service or account.

Schema v1 ledger fields:
- bucket_key_hash: HMAC-SHA256 of a normalized bucket identity; never store raw IP or login IDs.
- window_start: UTC timestamp for the fixed window.
- attempt_count: integer count.
- blocked_until: UTC timestamp or empty.
- updated_at: UTC timestamp.

The HMAC key is NOBI_GATEWAY_SECRET. If the secret is missing or the source IP is unavailable, authentication fails closed.

## Enforcement rules implemented in source

1. Shared Admin/Member login IP bucket: 10 attempts per 15-minute window across all Vercel instances.
2. Member registration IP bucket: 5 registrations per 15-minute window.
3. Account-specific failure bucket: 5 failed password attempts per 15-minute window; a successful login clears the account failure bucket.
4. Every bucket identity is HMAC-keyed; raw IP addresses and login identifiers are not written to the rate-limit ledger.
5. All read/check/increment/reset operations use ScriptLock, so concurrent requests cannot simply race the counter.
6. Express obtains req.ip with one trusted proxy hop in Vercel mode; Apps Script rejects a missing source IP and never trusts an IP supplied in JSON.
7. The Express in-memory limiter remains an additional first layer only; the Sheets ledger is the shared enforcement.
8. Old buckets are pruned when the ledger grows beyond its maintenance threshold. If the ledger becomes too large, the shared limiter fails closed.
9. Member new-IP logins are recorded but are not blocked solely because the IP is new.
10. Member login/IP history and Admin audit logs remain separate from rate-limit buckets and follow the approved 90-day retention.

## Required tests before production

- Parallel requests at the threshold produce no more than the allowed number of accepted attempts.
- Requests routed to simulated independent Express instances share one counter.
- Missing/untrusted source IP fails closed and cannot be replaced by client-supplied values.
- Backend timeout/quota errors fail closed for authentication.
- Expired buckets are pruned without deleting audit history.
- New-IP login remains allowed when the account is not rate-limited.
- Load/quota tests establish safe throughput and lock contention limits.

## Explicit non-goals

- No new external service or paid account.
- No use of process-local rate limiting as the only production control.
- No deployment or publication of Apps Script.
- No claim that Vercel/Apps Script rate limits are production-safe until the required load and quota tests pass.
