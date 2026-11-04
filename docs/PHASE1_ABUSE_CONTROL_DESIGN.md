# Phase 1 — Multi-instance Abuse-Control Design

Status: design documented; implementation intentionally deferred until the approved Apps Script/Sheets repository is available. This is not a production security approval.

## Current baseline

The Express Admin login limiter uses `express-rate-limit` with the existing threshold of 10 requests per 15 minutes. Its default memory store is process-local. It is useful for local development and single-process tests, but it is not a reliable control across Vercel serverless instances or cold starts.

Do not describe the current limiter as globally enforced.

## Target strategy for the existing zero-new-service architecture

Use a shared limiter in the existing Google Apps Script backend, backed by a dedicated Sheets ledger and guarded by `LockService.getScriptLock()`. This avoids introducing a third-party account or paid datastore, but it must be load-tested against Apps Script quotas and execution limits before live use.

Proposed ledger:

`security_rate_limits`
- `bucket_key_hash`: HMAC-SHA256 of a normalized bucket identity; never store raw IP or credentials in this table.
- `window_start`: UTC timestamp for the fixed window.
- `attempt_count`: integer count.
- `blocked_until`: UTC timestamp or empty.
- `updated_at`: UTC timestamp.

## Enforcement rules

1. Preserve the current Admin login threshold: 10 attempts per 15-minute window.
2. Atomically read/check/increment the bucket under ScriptLock; concurrent requests must not bypass the threshold.
3. Derive the source IP only from a verified Vercel/platform proxy header. Never accept an IP supplied in a JSON body or an arbitrary client-controlled forwarding header.
4. Normalize the login identifier before hashing an account-specific bucket. Use a keyed HMAC so raw IP and login IDs are not written into the rate-limit ledger.
5. Apply the same shared enforcement to every application instance before password verification. The Express in-memory limiter may remain as a cheap local first layer, but it must not be treated as the global control.
6. Fail closed for authentication if the shared limiter is unavailable; do not silently fall back to an unbounded login path.
7. Prune expired buckets under a bounded maintenance process. Keep security audit/IP history separate from rate-limit buckets and apply the user-approved retention policy to audit records.
8. Do not block a member solely because the member logs in from a new IP. The approved new-IP policy is to record the login IP/time; ordinary brute-force throttling remains a separate control.

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
- No implementation in the current Phase 1 Express/SQLite baseline.
- No deployment or publication of Apps Script.
- No claim that Vercel's local in-memory limiter is production-safe.
