'use strict';

const crypto = require('node:crypto');

class AppsScriptGatewayError extends Error {
  constructor(message, code = 'APPS_SCRIPT_GATEWAY_ERROR', status = 502) {
    super(message);
    this.name = 'AppsScriptGatewayError';
    this.code = code;
    this.status = status;
  }
}

function canonicalEnvelope(envelope) {
  return JSON.stringify({
    version: Number(envelope.version),
    timestamp: Number(envelope.timestamp),
    nonce: String(envelope.nonce),
    action: String(envelope.action),
    args: envelope.args || {}
  });
}

function createAppsScriptClient({ url, secret, fetchImpl = globalThis.fetch, timeoutMs = 12000 } = {}) {
  const endpoint = String(url || '').trim();
  const sharedSecret = String(secret || '');
  let endpointUrl;
  try { endpointUrl = new URL(endpoint); } catch (_) {}
  if (!endpointUrl || endpointUrl.protocol !== 'https:' || endpointUrl.hostname !== 'script.google.com' ||
      !/^\/macros\/s\/[^/]+\/(?:exec|dev)$/.test(endpointUrl.pathname) || endpointUrl.username || endpointUrl.password) {
    throw new AppsScriptGatewayError('Apps Script gateway URL must be a Google Apps Script Web App URL', 'GATEWAY_NOT_CONFIGURED', 503);
  }
  if (sharedSecret.length < 32) {
    throw new AppsScriptGatewayError('Apps Script shared secret must contain at least 32 characters', 'GATEWAY_NOT_CONFIGURED', 503);
  }
  if (typeof fetchImpl !== 'function') {
    throw new AppsScriptGatewayError('Fetch is unavailable in this runtime', 'GATEWAY_TRANSPORT_UNAVAILABLE', 503);
  }

  async function call(action, args = {}) {
    if (typeof action !== 'string' || !action.trim()) {
      throw new AppsScriptGatewayError('A gateway action is required', 'INVALID_ACTION', 400);
    }
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      throw new AppsScriptGatewayError('Gateway arguments must be an object', 'INVALID_ARGUMENTS', 400);
    }

    const envelope = {
      version: 1,
      timestamp: Date.now(),
      nonce: crypto.randomBytes(18).toString('base64url'),
      action,
      args
    };
    envelope.signature = crypto.createHmac('sha256', sharedSecret)
      .update(canonicalEnvelope(envelope), 'utf8')
      .digest('hex');

    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(envelope),
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      const timeout = error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      throw new AppsScriptGatewayError(
        timeout ? 'Apps Script gateway request timed out' : 'Apps Script gateway is unreachable',
        timeout ? 'GATEWAY_TIMEOUT' : 'GATEWAY_UNREACHABLE',
        502
      );
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers && response.headers.get('location');
      let redirectUrl;
      try { redirectUrl = new URL(location, endpoint); } catch (_) {}
      const host = redirectUrl && redirectUrl.hostname.toLowerCase();
      const trusted = host === 'script.google.com' || (host && host.endsWith('.googleusercontent.com'));
      // ContentService uses a 302/303 redirect to a one-time Google-hosted URL.
      // Never forward the signed POST body to a redirect destination.
      if (!trusted || ![302, 303].includes(response.status)) {
        throw new AppsScriptGatewayError('Apps Script gateway returned an unsafe redirect', 'UNTRUSTED_GATEWAY_REDIRECT', 502);
      }
      try {
        response = await fetchImpl(redirectUrl.toString(), {
          method: 'GET',
          redirect: 'error',
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(timeoutMs)
        });
      } catch (_) {
        throw new AppsScriptGatewayError('Apps Script ContentService response could not be retrieved', 'GATEWAY_REDIRECT_FAILED', 502);
      }
    }
    if (response.url) {
      let finalHost = '';
      try { finalHost = new URL(response.url).hostname.toLowerCase(); } catch (_) {}
      if (finalHost && finalHost !== 'script.google.com' && !finalHost.endsWith('.googleusercontent.com')) {
        throw new AppsScriptGatewayError('Apps Script gateway resolved to an untrusted host', 'UNTRUSTED_GATEWAY_REDIRECT', 502);
      }
    }

    let data;
    try { data = await response.json(); }
    catch (_) {
      throw new AppsScriptGatewayError('Apps Script gateway returned invalid JSON', 'INVALID_GATEWAY_RESPONSE', 502);
    }
    if (!response.ok) {
      throw new AppsScriptGatewayError('Apps Script gateway returned an HTTP error', 'GATEWAY_HTTP_ERROR', 502);
    }
    if (!data || data.version !== 1 || typeof data.ok !== 'boolean') {
      throw new AppsScriptGatewayError('Apps Script gateway response version is invalid', 'INVALID_GATEWAY_RESPONSE', 502);
    }
    if (!data.ok) {
      const error = data.error || {};
      throw new AppsScriptGatewayError(
        String(error.message || 'Apps Script gateway rejected the request'),
        String(error.code || 'GATEWAY_REQUEST_REJECTED'),
        502
      );
    }
    return data.result;
  }

  return Object.freeze({ call });
}

module.exports = { createAppsScriptClient, AppsScriptGatewayError, canonicalEnvelope };
