'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SLIP_IMAGE_LIMITS,
  SlipImageError,
  createSlipImageSanitizer,
  readBoundedImageRequest,
  validateSlipImageDimensions,
  validateSlipImageEnvelope,
} = require('../functions/_shared/slip-image-sanitizer.mjs');

function u32be(value) {
  return Uint8Array.of((value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255);
}

function u32le(value) {
  return Uint8Array.of(value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255);
}

function join(...parts) {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

function pngChunk(type, data = new Uint8Array()) {
  const name = new TextEncoder().encode(type);
  return join(u32be(data.length), name, data, Uint8Array.of(0, 0, 0, 0));
}

function makePng(extraChunks = []) {
  const signature = Uint8Array.of(0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a);
  const ihdr = new Uint8Array(13);
  ihdr.set(u32be(10), 0);
  ihdr.set(u32be(10), 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return join(signature, pngChunk('IHDR', ihdr), ...extraChunks, pngChunk('IDAT', Uint8Array.of(1,2,3)), pngChunk('IEND'));
}

function webpChunk(type, data) {
  const name = new TextEncoder().encode(type);
  const pad = data.length % 2 ? Uint8Array.of(0) : new Uint8Array();
  return join(name, u32le(data.length), data, pad);
}

function makeWebp({ animated = false } = {}) {
  const flags = animated ? 0x02 : 0;
  const vp8x = new Uint8Array(10);
  vp8x[0] = flags;
  const vp8 = Uint8Array.of(0x10, 0, 0, 0);
  const chunks = [webpChunk('VP8X', vp8x), webpChunk('VP8 ', vp8)];
  if (animated) chunks.push(webpChunk('ANMF', Uint8Array.of(1,2,3,4)));
  const body = join(new TextEncoder().encode('WEBP'), ...chunks);
  return join(new TextEncoder().encode('RIFF'), u32le(body.length), body);
}

const jpeg = Uint8Array.of(0xff,0xd8,0xff,0xdb,0x00,0x02,0xff,0xd9);
const sanitizedJpeg = Uint8Array.of(0xff,0xd8,0xff,0xc0,0x00,0x02,0xff,0xd9);

function fakeSip(overrides = {}) {
  const calls = { ready: 0, inspect: 0, transform: 0, collect: 0, options: null };
  const sip = {
    async ready() { calls.ready += 1; },
    async inspect() {
      calls.inspect += 1;
      return { info: { format: 'jpeg', width: 1000, height: 1000 }, source: { opaque: true } };
    },
    transform(source, options) {
      calls.transform += 1;
      calls.options = options;
      assert.deepEqual(source, { opaque: true });
      return { encoded: true };
    },
    async collect() {
      calls.collect += 1;
      return {
        data: sanitizedJpeg.buffer.slice(sanitizedJpeg.byteOffset, sanitizedJpeg.byteOffset + sanitizedJpeg.byteLength),
        info: { mimeType: 'image/jpeg', width: 1000, height: 1000 },
        stats: { bytesOut: sanitizedJpeg.length },
      };
    },
  };
  return { sip: { ...sip, ...overrides }, calls };
}

test('accepts bounded static JPEG, PNG and WebP envelopes with matching MIME types', () => {
  assert.equal(validateSlipImageEnvelope(jpeg, 'image/jpeg'), 'jpeg');
  assert.equal(validateSlipImageEnvelope(makePng(), 'image/png'), 'png');
  assert.equal(validateSlipImageEnvelope(makeWebp(), 'image/webp'), 'webp');
});

test('rejects unsupported MIME types and MIME/signature mismatches', () => {
  assert.throws(() => validateSlipImageEnvelope(jpeg, 'image/gif'), (e) => e.code === 'PROOF_IMAGE_MIME_UNSUPPORTED');
  assert.throws(() => validateSlipImageEnvelope(jpeg, 'image/png'), (e) => e.code === 'PROOF_IMAGE_MIME_MISMATCH');
});

test('rejects empty and oversized inputs before image decoding', () => {
  assert.throws(() => validateSlipImageEnvelope(new Uint8Array(), 'image/jpeg'), (e) => e.code === 'PROOF_IMAGE_EMPTY');
  assert.throws(() => validateSlipImageEnvelope(new Uint8Array(SLIP_IMAGE_LIMITS.inputBytes + 1), 'image/jpeg'), (e) => e.code === 'PROOF_IMAGE_TOO_LARGE');
});

test('rejects JPEG trailing payloads and truncated JPEGs', () => {
  assert.throws(() => validateSlipImageEnvelope(join(jpeg, Uint8Array.of(1,2,3)), 'image/jpeg'), (e) => e.code === 'PROOF_IMAGE_TRAILING_DATA');
  assert.throws(() => validateSlipImageEnvelope(jpeg.slice(0, -2), 'image/jpeg'), (e) => e.code === 'PROOF_IMAGE_TRAILING_DATA');
});

test('rejects PNG trailing payloads, truncation and APNG animation chunks', () => {
  assert.throws(() => validateSlipImageEnvelope(join(makePng(), Uint8Array.of(1)), 'image/png'), (e) => e.code === 'PROOF_IMAGE_TRAILING_DATA');
  assert.throws(() => validateSlipImageEnvelope(makePng([pngChunk('acTL', Uint8Array.of(0,0,0,1,0,0,0,0))]), 'image/png'), (e) => e.code === 'PROOF_IMAGE_ANIMATED');
  assert.throws(() => validateSlipImageEnvelope(makePng().slice(0, -4), 'image/png'), (e) => e.code === 'PROOF_IMAGE_TRUNCATED');
});

test('rejects animated WebP and RIFF trailing payloads', () => {
  assert.throws(() => validateSlipImageEnvelope(makeWebp({ animated: true }), 'image/webp'), (e) => e.code === 'PROOF_IMAGE_ANIMATED');
  assert.throws(() => validateSlipImageEnvelope(join(makeWebp(), Uint8Array.of(1)), 'image/webp'), (e) => e.code === 'PROOF_IMAGE_TRAILING_DATA');
});

test('rejects unsafe image dimensions and pixel bombs before decode', () => {
  assert.throws(() => validateSlipImageDimensions({ width: 5000, height: 1 }), (e) => e.code === 'PROOF_IMAGE_DIMENSIONS_UNSAFE');
  assert.throws(() => validateSlipImageDimensions({ width: 2500, height: 2000 }), (e) => e.code === 'PROOF_IMAGE_DIMENSIONS_UNSAFE');
  assert.deepEqual(validateSlipImageDimensions({ width: 2000, height: 2000 }), { width: 2000, height: 2000 });
});

test('sanitizer decodes and returns only bounded JPEG bytes with metadata removed', async () => {
  const { sip, calls } = fakeSip();
  const sanitize = createSlipImageSanitizer(sip);
  const result = await sanitize(jpeg, 'image/jpeg');
  assert.equal(result.mimeType, 'image/jpeg');
  assert.equal(result.originalFormat, 'jpeg');
  assert.equal(result.outputBytes, sanitizedJpeg.length);
  assert.deepEqual(Array.from(result.bytes), Array.from(sanitizedJpeg));
  assert.equal(calls.ready, 1);
  assert.equal(calls.inspect, 1);
  assert.equal(calls.transform, 1);
  assert.equal(calls.collect, 1);
  assert.deepEqual(calls.options, { width: 2048, height: 2048, quality: 82 });
});

test('sanitizer rejects an unsafe inspected dimension before transform/collect', async () => {
  const { sip, calls } = fakeSip({
    async inspect() {
      return { info: { format: 'jpeg', width: 6000, height: 3000 }, source: {} };
    },
  });
  const sanitize = createSlipImageSanitizer(sip);
  await assert.rejects(() => sanitize(jpeg, 'image/jpeg'), (e) => e.code === 'PROOF_IMAGE_DIMENSIONS_UNSAFE');
  assert.equal(calls.transform, 0);
  assert.equal(calls.collect, 0);
});

test('sanitizer rejects unexpected codec output format and output size', async () => {
  const badFormat = fakeSip({
    async collect() {
      return { data: sanitizedJpeg.buffer, info: { mimeType: 'image/png', width: 10, height: 10 } };
    },
  });
  await assert.rejects(() => createSlipImageSanitizer(badFormat.sip)(jpeg, 'image/jpeg'), (e) => e.code === 'PROOF_IMAGE_SANITIZATION_FAILED');

  const tooLarge = fakeSip({
    async collect() {
      const data = new Uint8Array(SLIP_IMAGE_LIMITS.outputBytes + 1);
      data.set(sanitizedJpeg);
      data[data.length - 2] = 0xff;
      data[data.length - 1] = 0xd9;
      return { data: data.buffer, info: { mimeType: 'image/jpeg', width: 10, height: 10 } };
    },
  });
  await assert.rejects(() => createSlipImageSanitizer(tooLarge.sip)(jpeg, 'image/jpeg'), (e) => e.code === 'PROOF_IMAGE_SANITIZATION_FAILED');
});

test('bounded request reader enforces actual streamed bytes, not just Content-Length', async () => {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(4));
      controller.enqueue(new Uint8Array(5));
      controller.close();
    },
  });
  const request = new Request('https://staging.invalid/proof', { method: 'POST', body, duplex: 'half' });
  await assert.rejects(() => readBoundedImageRequest(request, 8), (e) => e.code === 'PROOF_IMAGE_TOO_LARGE');
});
