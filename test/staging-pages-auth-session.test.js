import test from "node:test";
import assert from "node:assert/strict";
import {
  callAppsScript,
  createGatewayEnvelope,
  GatewayError,
} from "../functions/_shared/gateway-client.mjs";
import {
  clearSessionCookie,
  createSessionStore,
} from "../functions/_shared/session-store.mjs";
import {
  handleAdminLogin,
  handleAdminMe,
  handleAdminLogout,
  handleMemberLogin,
  handleMemberMe,
  handleMemberRegister,
  handleMemberLogout,
} from "../functions/_shared/auth-api.mjs";

const NOW = Date.UTC(2026, 10, 26, 12, 0, 0);
const KEY = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 1)).toString("base64");
const ORIGIN = "https://nobi-staging.example";

class FakeD1 {
  constructor() { this.rows = new Map(); }
  prepare(sql) {
    const db = this;
    let args = [];
    const normalized = sql.replace(/\s+/g, " ").trim().toUpperCase();
    return {
      bind(...values) { args = values; return this; },
      async first() {
        if (normalized.startsWith("SELECT")) {
          const [hash, role] = args;
          const row = db.rows.get(hash);
          return row && row.role === role ? { ...row } : null;
        }
        throw new Error("Unexpected first() query: " + normalized);
      },
      async run() {
        if (normalized.startsWith("INSERT")) {
          const [session_hash, role, token_ciphertext, token_iv, display_name, created_at, expires_at, last_seen_at] = args;
          if (db.rows.has(session_hash)) throw new Error("duplicate session");
          db.rows.set(session_hash, {
            session_hash, role, token_ciphertext, token_iv, display_name,
            created_at, expires_at, last_seen_at,
          });
          return { meta: { changes: 1 } };
        }
        if (normalized.startsWith("UPDATE")) {
          const [last_seen_at, hash, role, expires_at, idleCutoff] = args;
          const row = db.rows.get(hash);
          if (row && row.role === role && row.expires_at > expires_at && row.last_seen_at > idleCutoff) {
            row.last_seen_at = last_seen_at;
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        }
        if (normalized.startsWith("DELETE")) {
          const [hash, role] = args;
          const row = db.rows.get(hash);
          const changes = row && row.role === role ? 1 : 0;
          if (changes) db.rows.delete(hash);
          return { meta: { changes } };
        }
        throw new Error("Unexpected run() query: " + normalized);
      },
    };
  }
}

function authRequest(path, body, origin = ORIGIN) {
  return new Request(ORIGIN + path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      "sec-fetch-site": "same-origin",
      "user-agent": "Nobi test browser",
    },
    body: JSON.stringify(body),
  });
}

function env(db = new FakeD1()) {
  return {
    DB: db,
    APP_ORIGIN: ORIGIN,
    GAS_API_URL: "https://script.google.com/macros/s/STAGING_DEPLOYMENT/exec",
    NOBI_GATEWAY_SECRET: "S".repeat(40),
    SESSION_ENCRYPTION_KEY: KEY,
  };
}

test("gateway envelope uses the exact Apps Script canonical property order and HMAC-SHA256", async () => {
  const secret = "A".repeat(40);
  const envelope = await createGatewayEnvelope(secret, "memberMe", { token: "opaque" }, {
    timestamp: NOW,
    nonce: "abcdefghijklmnopqrstuvwx_1234567890",
  });
  assert.deepEqual(Object.keys(envelope), ["version", "timestamp", "nonce", "action", "args", "signature"]);
  const canonical = JSON.stringify({
    version: 1,
    timestamp: NOW,
    nonce: "abcdefghijklmnopqrstuvwx_1234567890",
    action: "memberMe",
    args: { token: "opaque" },
  });
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const expected = Buffer.from(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(canonical))).toString("hex");
  assert.equal(envelope.signature, expected);
});

test("gateway client posts signed envelopes and validates the Apps Script JSON envelope", async () => {
  let captured;
  const result = await callAppsScript(env(), "memberMe", { token: "backend-token" }, async (url, init) => {
    captured = { url, init, body: JSON.parse(init.body) };
    return Response.json({ ok: true, version: 1, result: { authenticated: true } });
  });
  assert.equal(captured.url, env().GAS_API_URL);
  assert.equal(captured.init.method, "POST");
  assert.equal(captured.init.redirect, "follow");
  assert.equal(captured.body.action, "memberMe");
  assert.equal(captured.body.args.token, "backend-token");
  assert.equal(captured.body.signature.length, 64);
  assert.deepEqual(result, { authenticated: true });

  await assert.rejects(
    () => callAppsScript(env(), "memberMe", {}, async () =>
      Response.json({ ok: false, version: 1, error: { code: "AUTHENTICATION_FAILED", message: "Invalid login" } })),
    (error) => error instanceof GatewayError && error.code === "AUTHENTICATION_FAILED",
  );
});

test("gateway client rejects a non-Apps-Script URL before making a request", async () => {
  const bad = { ...env(), GAS_API_URL: "https://attacker.example/collect" };
  let called = false;
  await assert.rejects(
    () => callAppsScript(bad, "memberMe", {}, async () => { called = true; }),
    (error) => error instanceof GatewayError && error.code === "GAS_API_URL_INVALID",
  );
  assert.equal(called, false);
});

test("D1 session store encrypts backend tokens and issues role-separated Secure HttpOnly cookies", async () => {
  let now = NOW;
  const runtime = env();
  const store = createSessionStore(runtime, { now: () => now });
  const created = await store.createSession("member", "gas-secret-token", new Date(NOW + 8 * 60 * 60 * 1000).toISOString(), "Test Member");
  assert.match(created.cookieHeader, /^__Host-nobi_member=/);
  assert.match(created.cookieHeader, /; Path=\//);
  assert.match(created.cookieHeader, /; Secure/);
  assert.match(created.cookieHeader, /; HttpOnly/);
  assert.match(created.cookieHeader, /; SameSite=Lax/);
  assert.match(created.cookieHeader, /Max-Age=28800/);

  const row = [...runtime.DB.rows.values()][0];
  assert.notEqual(row.token_ciphertext, "gas-secret-token");
  assert.notEqual(row.token_iv, "");
  assert.equal(row.role, "member");

  const cookiePair = created.cookieHeader.split(";")[0];
  const request = new Request(ORIGIN + "/api/auth/member/me", { headers: { cookie: cookiePair } });
  const session = await store.getSession(request, "member");
  assert.equal(session.backendToken, "gas-secret-token");
  assert.equal(session.displayName, "Test Member");
  assert.equal(await store.getSession(request, "admin"), null);

  await store.deleteSession(session.sessionHash, "member");
  assert.equal(runtime.DB.rows.size, 0);
  assert.match(clearSessionCookie("member"), /Max-Age=0/);
  now += 1;
});

test("D1 session store expires idle and absolute sessions and deletes corrupt ciphertext", async () => {
  let now = NOW;
  const runtime = env();
  const store = createSessionStore(runtime, { now: () => now });
  const idle = await store.createSession("member", "idle-token", new Date(NOW + 8 * 60 * 60 * 1000).toISOString());
  const idleRequest = new Request(ORIGIN, { headers: { cookie: idle.cookieHeader.split(";")[0] } });
  now += 30 * 60 * 1000;
  assert.equal(await store.getSession(idleRequest, "member"), null);
  assert.equal(runtime.DB.rows.size, 0);

  now = NOW;
  const absolute = await store.createSession("admin", "admin-token", new Date(NOW + 60 * 60 * 1000).toISOString());
  const absoluteRequest = new Request(ORIGIN, { headers: { cookie: absolute.cookieHeader.split(";")[0] } });
  now += 60 * 60 * 1000;
  assert.equal(await store.getSession(absoluteRequest, "admin"), null);
  assert.equal(runtime.DB.rows.size, 0);

  now = NOW;
  const corrupt = await store.createSession("member", "corrupt-token", new Date(NOW + 60 * 60 * 1000).toISOString());
  const row = [...runtime.DB.rows.values()][0];
  row.token_ciphertext = "not-valid-ciphertext";
  const corruptRequest = new Request(ORIGIN, { headers: { cookie: corrupt.cookieHeader.split(";")[0] } });
  assert.equal(await store.getSession(corruptRequest, "member"), null);
  assert.equal(runtime.DB.rows.size, 0);
});

test("D1 session store rejects missing or incorrectly sized encryption keys", async () => {
  assert.throws(() => createSessionStore({}), /D1 DB binding/);
  const store = createSessionStore({ DB: new FakeD1(), SESSION_ENCRYPTION_KEY: Buffer.from("short").toString("base64") });
  await assert.rejects(
    () => store.createSession("member", "token", new Date(NOW + 60_000).toISOString()),
    /exactly 32 bytes/,
  );
});

test("member login stores the backend token server-side and never returns it to the browser", async () => {
  const runtime = env();
  const store = createSessionStore(runtime, { now: () => NOW });
  const calls = [];
  const response = await handleMemberLogin(
    authRequest("/api/auth/member/login", { loginId: "Nobi1234", password: "Pass12345" }),
    runtime,
    {
      store,
      gateway: async (_env, action, args) => {
        calls.push({ action, args });
        return {
          token: "backend-member-token",
          expires_at: new Date(NOW + 8 * 60 * 60 * 1000).toISOString(),
          member: { member_id: "M-1", full_name: "Nobi", login_id: "Nobi1234" },
        };
      },
    },
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie"), /^__Host-nobi_member=/);
  const body = await response.json();
  assert.equal(body.data.member.full_name, "Nobi");
  assert.equal(JSON.stringify(body).includes("backend-member-token"), false);
  assert.deepEqual(calls.map((call) => call.action), ["memberLogin"]);
  assert.equal(calls[0].args.userAgent, "Nobi test browser");
  assert.equal(runtime.DB.rows.size, 1);
});

test("member registration calls only the registration action and does not create a session", async () => {
  const runtime = env();
  const calls = [];
  const response = await handleMemberRegister(
    authRequest("/api/auth/member/register", { fullName: "Nobi", loginId: "Nobi1234", password: "Pass12345" }),
    runtime,
    { gateway: async (_env, action, args) => { calls.push({ action, args }); return { member_id: "M-2" }; } },
  );
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { ok: true, data: { memberId: "M-2" } });
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(runtime.DB.rows.size, 0);
  assert.deepEqual(calls.map((call) => call.action), ["memberRegister"]);
});

test("wrong Origin is rejected before credentials reach Apps Script", async () => {
  const runtime = env();
  let called = false;
  const response = await handleMemberLogin(
    authRequest("/api/auth/member/login", { loginId: "Nobi1234", password: "Pass12345" }, "https://evil.example"),
    runtime,
    { gateway: async () => { called = true; return {}; } },
  );
  assert.equal(response.status, 403);
  assert.equal(called, false);
});

test("member me resolves the HttpOnly cookie and checks the backend session", async () => {
  const runtime = env();
  const store = createSessionStore(runtime, { now: () => NOW });
  const created = await store.createSession("member", "backend-member-token", new Date(NOW + 8 * 60 * 60 * 1000).toISOString());
  const request = new Request(ORIGIN + "/api/auth/member/me", { headers: { cookie: created.cookieHeader.split(";")[0] } });
  let observed;
  const response = await handleMemberMe(request, runtime, {
    store,
    gateway: async (_env, action, args) => {
      observed = { action, args };
      return { authenticated: true, member: { member_id: "M-1", full_name: "Nobi", login_id: "Nobi1234" } };
    },
  });
  assert.equal(response.status, 200);
  assert.equal(observed.action, "memberMe");
  assert.equal(observed.args.token, "backend-member-token");
  assert.deepEqual((await response.json()).data.member, { member_id: "M-1", full_name: "Nobi", login_id: "Nobi1234" });
});

test("backend-revoked member session is deleted and cookie is cleared", async () => {
  const runtime = env();
  const store = createSessionStore(runtime, { now: () => NOW });
  const created = await store.createSession("member", "revoked-token", new Date(NOW + 8 * 60 * 60 * 1000).toISOString());
  const request = new Request(ORIGIN + "/api/auth/member/me", { headers: { cookie: created.cookieHeader.split(";")[0] } });
  const response = await handleMemberMe(request, runtime, {
    store,
    gateway: async () => ({ authenticated: false }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, { authenticated: false });
  assert.match(response.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal(runtime.DB.rows.size, 0);
});

test("admin login and me use a separate cookie and preserve the admin display name", async () => {
  const runtime = env();
  const store = createSessionStore(runtime, { now: () => NOW });
  const login = await handleAdminLogin(
    authRequest("/api/auth/admin/login", { username: "owner", password: "StrongAdminPass123" }),
    runtime,
    {
      store,
      gateway: async (_env, action) => {
        assert.equal(action, "adminLogin");
        return { token: "backend-admin-token", expires_at: new Date(NOW + 8 * 60 * 60 * 1000).toISOString(), username: "Owner" };
      },
    },
  );
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie");
  assert.match(cookie, /^__Host-nobi_admin=/);
  const me = await handleAdminMe(
    new Request(ORIGIN + "/api/auth/admin/me", { headers: { cookie: cookie.split(";")[0] } }),
    runtime,
    { store, gateway: async (_env, action, args) => {
      assert.equal(action, "adminMe");
      assert.equal(args.token, "backend-admin-token");
      return { authenticated: true };
    } },
  );
  assert.deepEqual((await me.json()).data, { authenticated: true, username: "Owner" });
});

test("logout revokes the backend token, deletes D1 session and clears only that role cookie", async () => {
  const runtime = env();
  const store = createSessionStore(runtime, { now: () => NOW });
  const created = await store.createSession("member", "logout-token", new Date(NOW + 8 * 60 * 60 * 1000).toISOString());
  const cookieRequest = new Request(ORIGIN + "/api/auth/member/logout", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      "sec-fetch-site": "same-origin",
      cookie: created.cookieHeader.split(";")[0],
    },
    body: "{}",
  });
  let observed;
  const response = await handleMemberLogout(cookieRequest, runtime, {
    store,
    gateway: async (_env, action, args) => { observed = { action, args }; return { ok: true }; },
  });
  assert.equal(response.status, 200);
  assert.equal(observed.action, "memberLogout");
  assert.equal(observed.args.token, "logout-token");
  assert.equal(runtime.DB.rows.size, 0);
  assert.match(response.headers.get("set-cookie"), /^__Host-nobi_member=/);
  assert.match(response.headers.get("set-cookie"), /Max-Age=0/);
});
