const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_LIFETIME_MS = 8 * 60 * 60 * 1000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const ROLE_CONFIG = Object.freeze({
  member: { cookieName: "__Host-nobi_member" },
  admin: { cookieName: "__Host-nobi_admin" },
});

function configForRole(role) {
  const config = ROLE_CONFIG[String(role || "")];
  if (!config) throw new Error("Invalid session role");
  return config;
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(String(value || ""));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function base64Url(bytes) {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function parseCookie(header, name) {
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return "";
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function encryptionKey(env) {
  let raw;
  try {
    raw = base64ToBytes(env.SESSION_ENCRYPTION_KEY);
  } catch {
    throw new Error("SESSION_ENCRYPTION_KEY must be base64-encoded 32-byte key material");
  }
  if (raw.length !== 32) throw new Error("SESSION_ENCRYPTION_KEY must decode to exactly 32 bytes");
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function additionalData(role, sessionHash) {
  return encoder.encode("nobi-pages-session:v1:" + role + ":" + sessionHash);
}

function cookieHeader(role, value, maxAgeSeconds) {
  const name = configForRole(role).cookieName;
  return name + "=" + value +
    "; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=" + Math.max(0, Math.floor(maxAgeSeconds));
}

export function clearSessionCookie(role) {
  const name = configForRole(role).cookieName;
  return name + "=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT";
}

export function createSessionStore(env, options = {}) {
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const db = env && env.DB;
  if (!db || typeof db.prepare !== "function") throw new Error("D1 DB binding is not configured");

  async function createSession(role, backendToken, backendExpiresAt, displayName = "") {
    configForRole(role);
    const token = String(backendToken || "");
    if (!token || token.length > 512) throw new Error("Backend session token is invalid");
    const createdAt = now();
    const requestedExpiry = Date.parse(String(backendExpiresAt || ""));
    if (!Number.isFinite(requestedExpiry) || requestedExpiry <= createdAt) {
      throw new Error("Backend session expiry is invalid");
    }
    const expiresAt = Math.min(requestedExpiry, createdAt + MAX_LIFETIME_MS);
    const cookieValue = base64Url(crypto.getRandomValues(new Uint8Array(32)));
    const sessionHash = await sha256Hex(cookieValue);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await encryptionKey(env);
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: additionalData(role, sessionHash) },
      key,
      encoder.encode(token),
    );

    await db.prepare(
      "INSERT INTO nobi_pages_sessions (session_hash, role, token_ciphertext, token_iv, display_name, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(
      sessionHash,
      role,
      bytesToBase64(new Uint8Array(ciphertext)),
      bytesToBase64(iv),
      String(displayName || "").slice(0, 100),
      createdAt,
      expiresAt,
      createdAt,
    ).run();

    return {
      sessionHash,
      expiresAt,
      cookieHeader: cookieHeader(role, cookieValue, (expiresAt - createdAt) / 1000),
    };
  }

  async function getSession(request, role) {
    const config = configForRole(role);
    const cookieValue = parseCookie(request.headers.get("cookie"), config.cookieName);
    if (!/^[A-Za-z0-9_-]{43}$/.test(cookieValue)) return null;
    const sessionHash = await sha256Hex(cookieValue);
    const row = await db.prepare(
      "SELECT session_hash, role, token_ciphertext, token_iv, display_name, created_at, expires_at, last_seen_at FROM nobi_pages_sessions WHERE session_hash = ? AND role = ? LIMIT 1",
    ).bind(sessionHash, role).first();
    if (!row) return null;

    const current = now();
    const lastSeen = Number(row.last_seen_at);
    const expiresAt = Number(row.expires_at);
    if (row.role !== role || !Number.isFinite(expiresAt) || expiresAt <= current ||
        !Number.isFinite(lastSeen) || current - lastSeen >= IDLE_TIMEOUT_MS) {
      await db.prepare("DELETE FROM nobi_pages_sessions WHERE session_hash = ? AND role = ?")
        .bind(sessionHash, role).run();
      return null;
    }

    const updated = await db.prepare(
      "UPDATE nobi_pages_sessions SET last_seen_at = ? WHERE session_hash = ? AND role = ? AND expires_at > ? AND last_seen_at > ?",
    ).bind(current, sessionHash, role, current, current - IDLE_TIMEOUT_MS).run();
    if (updated && updated.meta && Number(updated.meta.changes) === 0) return null;

    try {
      const key = await encryptionKey(env);
      const plaintext = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: base64ToBytes(row.token_iv),
          additionalData: additionalData(role, sessionHash),
        },
        key,
        base64ToBytes(row.token_ciphertext),
      );
      return {
        sessionHash,
        role,
        backendToken: decoder.decode(plaintext),
        displayName: String(row.display_name || ""),
        expiresAt,
      };
    } catch {
      await db.prepare("DELETE FROM nobi_pages_sessions WHERE session_hash = ? AND role = ?")
        .bind(sessionHash, role).run();
      return null;
    }
  }

  async function deleteSession(sessionHash, role) {
    configForRole(role);
    if (!/^[a-f0-9]{64}$/.test(String(sessionHash || ""))) return;
    await db.prepare("DELETE FROM nobi_pages_sessions WHERE session_hash = ? AND role = ?")
      .bind(sessionHash, role).run();
  }

  return Object.freeze({ createSession, getSession, deleteSession });
}
