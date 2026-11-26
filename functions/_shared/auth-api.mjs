import { callAppsScript, GatewayError } from "./gateway-client.mjs";
import { clearSessionCookie, createSessionStore } from "./session-store.mjs";

const MAX_JSON_BYTES = 16 * 1024;
const encoder = new TextEncoder();

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function responseJson(body, status = 200, extraHeaders = {}) {
  const headers = new Headers(extraHeaders);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  headers.set("pragma", "no-cache");
  headers.set("x-content-type-options", "nosniff");
  return new Response(JSON.stringify(body), { status, headers });
}

function appOrigin(env) {
  try {
    return new URL(String(env.APP_ORIGIN || "")).origin;
  } catch {
    throw new HttpError(503, "APP_ORIGIN_NOT_CONFIGURED", "Application origin is not configured");
  }
}

function assertRequestHost(request, env) {
  if (new URL(request.url).origin !== appOrigin(env)) {
    throw new HttpError(403, "ORIGIN_NOT_ALLOWED", "Request origin is not allowed");
  }
}

function assertSameOriginPost(request, env) {
  const expected = appOrigin(env);
  assertRequestHost(request, env);
  const origin = request.headers.get("origin");
  if (!origin || origin !== expected) {
    throw new HttpError(403, "CSRF_ORIGIN_REJECTED", "Cross-origin request rejected");
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    throw new HttpError(403, "CSRF_FETCH_SITE_REJECTED", "Cross-origin request rejected");
  }
}

async function readJson(request) {
  const contentType = String(request.headers.get("content-type") || "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    throw new HttpError(415, "UNSUPPORTED_CONTENT_TYPE", "Content-Type must be application/json");
  }
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_JSON_BYTES) throw new HttpError(413, "REQUEST_TOO_LARGE", "Request body is too large");
  if (!request.body) throw new HttpError(400, "INVALID_JSON", "Request body is required");

  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_JSON_BYTES) {
      await reader.cancel();
      throw new HttpError(413, "REQUEST_TOO_LARGE", "Request body is too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid");
    return value;
  } catch {
    throw new HttpError(400, "INVALID_JSON", "Request body must be a JSON object");
  }
}

function errorStatus(error, fallback = 400) {
  if (error instanceof HttpError) return error.status;
  if (error instanceof GatewayError) {
    if (/RATE|BLOCK|TOO_MANY/.test(error.code)) return 429;
    if (/DUPLICATE|ALREADY_EXISTS|CONFLICT/.test(error.code)) return 409;
    if (/GATEWAY_NOT_CONFIGURED|GAS_UPSTREAM|GAS_HTTP|GAS_INVALID|GAS_RESPONSE|GAS_VERSION/.test(error.code)) return 502;
    return error.status || fallback;
  }
  return fallback;
}

function errorResponse(error, role) {
  const status = errorStatus(error, 500);
  const code = error.code || (error instanceof GatewayError ? error.code : "INTERNAL_ERROR");
  const message = status >= 500 ? "Service is temporarily unavailable" : String(error.message || "Request failed");
  const headers = role ? { "set-cookie": clearSessionCookie(role) } : {};
  return responseJson({ ok: false, error: { code, message } }, status, headers);
}

function gateway(deps, env, action, args) {
  return (deps.gateway || callAppsScript)(env, action, args);
}

function store(deps, env) {
  return deps.store || createSessionStore(env, deps.sessionOptions);
}

async function createLoginResponse(env, role, result, deps, publicData) {
  if (!result || !result.token || !result.expires_at) {
    throw new GatewayError("BACKEND_SESSION_MISSING", "Backend did not create a session", 502);
  }
  const displayName = role === "admin" ? result.username : result.member && result.member.full_name;
  const created = await store(deps, env).createSession(role, result.token, result.expires_at, displayName);
  return responseJson(
    { ok: true, data: publicData },
    200,
    { "set-cookie": created.cookieHeader },
  );
}

export async function handleMemberLogin(request, env, deps = {}) {
  try {
    assertSameOriginPost(request, env);
    const body = await readJson(request);
    const result = await gateway(deps, env, "memberLogin", {
      loginId: body.loginId,
      password: body.password,
      userAgent: String(request.headers.get("user-agent") || "").slice(0, 300),
    });
    return await createLoginResponse(env, "member", result, deps, { member: result.member });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleMemberRegister(request, env, deps = {}) {
  try {
    assertSameOriginPost(request, env);
    const body = await readJson(request);
    const result = await gateway(deps, env, "memberRegister", {
      fullName: body.fullName,
      loginId: body.loginId,
      password: body.password,
    });
    return responseJson({ ok: true, data: { memberId: result.member_id } }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleAdminLogin(request, env, deps = {}) {
  try {
    assertSameOriginPost(request, env);
    const body = await readJson(request);
    const result = await gateway(deps, env, "adminLogin", {
      username: body.username,
      password: body.password,
    });
    return await createLoginResponse(env, "admin", result, deps, { username: result.username });
  } catch (error) {
    return errorResponse(error);
  }
}

async function handleMe(request, env, role, deps) {
  try {
    assertRequestHost(request, env);
    const session = await store(deps, env).getSession(request, role);
    if (!session) {
      return responseJson(
        { ok: true, data: { authenticated: false } },
        200,
        { "set-cookie": clearSessionCookie(role) },
      );
    }
    const action = role === "member" ? "memberMe" : "adminMe";
    const result = await gateway(deps, env, action, { token: session.backendToken });
    if (!result || result.authenticated !== true) {
      await store(deps, env).deleteSession(session.sessionHash, role);
      return responseJson(
        { ok: true, data: { authenticated: false } },
        200,
        { "set-cookie": clearSessionCookie(role) },
      );
    }
    const data = role === "member"
      ? result
      : { authenticated: true, username: session.displayName };
    return responseJson({ ok: true, data });
  } catch (error) {
    return errorResponse(error, role);
  }
}

export function handleMemberMe(request, env, deps = {}) {
  return handleMe(request, env, "member", deps);
}

export function handleAdminMe(request, env, deps = {}) {
  return handleMe(request, env, "admin", deps);
}

async function handleLogout(request, env, role, deps) {
  try {
    assertSameOriginPost(request, env);
    const session = await store(deps, env).getSession(request, role);
    if (session) {
      const action = role === "member" ? "memberLogout" : "adminLogout";
      try {
        await gateway(deps, env, action, { token: session.backendToken });
      } finally {
        await store(deps, env).deleteSession(session.sessionHash, role);
      }
    }
    return responseJson({ ok: true }, 200, { "set-cookie": clearSessionCookie(role) });
  } catch (error) {
    return errorResponse(error, role);
  }
}

export function handleMemberLogout(request, env, deps = {}) {
  return handleLogout(request, env, "member", deps);
}

export function handleAdminLogout(request, env, deps = {}) {
  return handleLogout(request, env, "admin", deps);
}
