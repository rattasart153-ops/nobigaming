const GATEWAY_VERSION = 1;
const MAX_RESPONSE_CHARS = 2 * 1024 * 1024;
const encoder = new TextEncoder();

export class GatewayError extends Error {
  constructor(code, message, status = 502) {
    super(message || "Backend request failed");
    this.name = "GatewayError";
    this.code = String(code || "GATEWAY_ERROR");
    this.status = status;
  }
}

function bytesToHex(bytes) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function base64Url(bytes) {
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function createGatewayEnvelope(secret, action, args, options = {}) {
  const keyText = String(secret || "");
  if (keyText.length < 32) {
    throw new GatewayError("GATEWAY_NOT_CONFIGURED", "Backend authentication is not configured", 503);
  }
  const actionName = String(action || "");
  if (!/^[A-Za-z][A-Za-z0-9]{1,63}$/.test(actionName)) {
    throw new GatewayError("INVALID_ACTION", "Invalid backend action", 500);
  }
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new GatewayError("INVALID_ARGUMENTS", "Invalid backend arguments", 500);
  }

  const timestamp = Number.isSafeInteger(options.timestamp) ? options.timestamp : Date.now();
  const nonceBytes = options.nonceBytes || crypto.getRandomValues(new Uint8Array(32));
  const nonce = options.nonce || base64Url(nonceBytes);
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(nonce)) {
    throw new GatewayError("INVALID_NONCE", "Invalid backend nonce", 500);
  }

  // Property order must exactly match gatewayCanonical_() in Apps Script.
  const canonical = JSON.stringify({
    version: GATEWAY_VERSION,
    timestamp,
    nonce,
    action: actionName,
    args,
  });
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(keyText),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signatureBytes = await crypto.subtle.sign("HMAC", key, encoder.encode(canonical));
  return {
    version: GATEWAY_VERSION,
    timestamp,
    nonce,
    action: actionName,
    args,
    signature: bytesToHex(new Uint8Array(signatureBytes)),
  };
}

function validAppsScriptUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" &&
      url.hostname === "script.google.com" &&
      /^\/macros\/s\/[^/]+\/exec$/.test(url.pathname);
  } catch {
    return false;
  }
}

export async function callAppsScript(env, action, args, fetchImpl = fetch) {
  if (!validAppsScriptUrl(env && env.GAS_API_URL)) {
    throw new GatewayError("GAS_API_URL_INVALID", "Apps Script API URL is not configured correctly", 503);
  }
  const envelope = await createGatewayEnvelope(env.NOBI_GATEWAY_SECRET, action, args);
  let response;
  try {
    response = await fetchImpl(env.GAS_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(envelope),
      redirect: "follow",
    });
  } catch {
    throw new GatewayError("GAS_UPSTREAM_UNAVAILABLE", "Backend is temporarily unavailable", 502);
  }

  let raw;
  try {
    raw = await response.text();
  } catch {
    throw new GatewayError("GAS_RESPONSE_UNREADABLE", "Backend returned an unreadable response", 502);
  }
  if (raw.length > MAX_RESPONSE_CHARS) {
    throw new GatewayError("GAS_RESPONSE_TOO_LARGE", "Backend response exceeded the allowed size", 502);
  }
  if (!response.ok) {
    throw new GatewayError("GAS_HTTP_ERROR", "Backend request failed", 502);
  }

  let envelopeResponse;
  try {
    envelopeResponse = JSON.parse(raw);
  } catch {
    throw new GatewayError("GAS_INVALID_RESPONSE", "Backend returned an invalid response", 502);
  }
  if (!envelopeResponse || Number(envelopeResponse.version) !== GATEWAY_VERSION) {
    throw new GatewayError("GAS_VERSION_MISMATCH", "Backend protocol version mismatch", 502);
  }
  if (envelopeResponse.ok !== true) {
    const error = envelopeResponse.error || {};
    throw new GatewayError(error.code || "GAS_ACTION_FAILED", error.message || "Backend request failed", 400);
  }
  return envelopeResponse.result;
}
