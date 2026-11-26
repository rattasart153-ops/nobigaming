// Cloudflare Pages/workerd adapter for @standardagents/sip.
// The package's workerd export supplies its core JPEG/PNG WASM. WebP uses a
// separate @jsquash decoder binary, which SIP expects through this global hook.
import webpDecoderWasm from '@jsquash/webp/codec/dec/webp_dec.wasm';
import { collect, inspect, ready, transform } from '@standardagents/sip';

const runtime = globalThis as typeof globalThis & {
  __SIP_CODEC_WASM__?: Record<string, unknown>;
};

runtime.__SIP_CODEC_WASM__ = {
  ...(runtime.__SIP_CODEC_WASM__ || {}),
  webp: webpDecoderWasm,
};

export const sipSlipImageAdapter = Object.freeze({
  ready,
  inspect,
  transform,
  collect,
});
