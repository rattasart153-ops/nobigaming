/**
 * Nobi Gaming — private top-up proof image sanitizer.
 *
 * This module is deliberately not an HTTP route. An authenticated Pages Function
 * must call it before forwarding the returned JPEG bytes to the signed Apps Script
 * gateway. Never forward or store the original upload.
 */

export const SLIP_IMAGE_LIMITS = Object.freeze({
  inputBytes: 3 * 1024 * 1024,
  outputBytes: 2_500_000,
  maxDimension: 4096,
  maxPixels: 4_000_000,
  outputEdge: 2048,
  jpegQuality: 82,
});

const MIME_TO_FORMAT = Object.freeze({
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
});

export class SlipImageError extends Error {
  constructor(code, status = 422) {
    super(code);
    this.name = 'SlipImageError';
    this.code = code;
    this.status = status;
  }
}

function asBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  throw new SlipImageError('PROOF_IMAGE_INVALID', 400);
}

function ascii(bytes, start, length) {
  let value = '';
  for (let i = 0; i < length; i += 1) value += String.fromCharCode(bytes[start + i]);
  return value;
}

function readU32BE(bytes, offset) {
  return (
    bytes[offset] * 0x1000000 +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3]
  );
}

function readU32LE(bytes, offset) {
  return (
    bytes[offset] +
    (bytes[offset + 1] << 8) +
    (bytes[offset + 2] << 16) +
    bytes[offset + 3] * 0x1000000
  );
}

function validateJpegEnvelope(bytes) {
  if (
    bytes.length < 4 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes[2] !== 0xff
  ) {
    throw new SlipImageError('PROOF_IMAGE_INVALID_JPEG');
  }

  // Require EOI at the very end. This rejects appended payloads/polyglots.
  if (bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) {
    throw new SlipImageError('PROOF_IMAGE_TRAILING_DATA');
  }
}

function validatePngEnvelope(bytes) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 45 || !signature.every((value, index) => bytes[index] === value)) {
    throw new SlipImageError('PROOF_IMAGE_INVALID_PNG');
  }

  let offset = 8;
  let chunkCount = 0;
  let sawHeader = false;
  let sawImageData = false;
  let sawEnd = false;

  while (offset < bytes.length) {
    if (++chunkCount > 512) {
      throw new SlipImageError('PROOF_IMAGE_INVALID_PNG');
    }
    if (offset + 12 > bytes.length) {
      throw new SlipImageError('PROOF_IMAGE_TRUNCATED');
    }

    const chunkLength = readU32BE(bytes, offset);
    const chunkType = ascii(bytes, offset + 4, 4);
    const chunkEnd = offset + 12 + chunkLength;

    if (!Number.isSafeInteger(chunkEnd) || chunkEnd > bytes.length) {
      throw new SlipImageError('PROOF_IMAGE_TRUNCATED');
    }

    if (!sawHeader) {
      if (chunkType !== 'IHDR' || chunkLength !== 13) {
        throw new SlipImageError('PROOF_IMAGE_INVALID_PNG');
      }
      sawHeader = true;
    } else if (chunkType === 'IHDR') {
      throw new SlipImageError('PROOF_IMAGE_INVALID_PNG');
    }

    // APNG is animated. Proofs are intentionally restricted to still images.
    if (chunkType === 'acTL' || chunkType === 'fcTL' || chunkType === 'fdAT') {
      throw new SlipImageError('PROOF_IMAGE_ANIMATED');
    }

    if (chunkType === 'IDAT') sawImageData = true;

    if (chunkType === 'IEND') {
      if (chunkLength !== 0 || !sawImageData || chunkEnd !== bytes.length) {
        throw new SlipImageError('PROOF_IMAGE_TRAILING_DATA');
      }
      sawEnd = true;
      break;
    }

    offset = chunkEnd;
  }

  if (!sawHeader || !sawImageData || !sawEnd) {
    throw new SlipImageError('PROOF_IMAGE_TRUNCATED');
  }
}

function validateWebpEnvelope(bytes) {
  if (
    bytes.length < 30 ||
    ascii(bytes, 0, 4) !== 'RIFF' ||
    ascii(bytes, 8, 4) !== 'WEBP'
  ) {
    throw new SlipImageError('PROOF_IMAGE_INVALID_WEBP');
  }

  // RIFF size includes the WEBP marker and all chunks, but not "RIFF" + size.
  if (readU32LE(bytes, 4) + 8 !== bytes.length) {
    throw new SlipImageError('PROOF_IMAGE_TRAILING_DATA');
  }

  let offset = 12;
  let chunkCount = 0;
  let hasImageChunk = false;

  while (offset < bytes.length) {
    if (++chunkCount > 128 || offset + 8 > bytes.length) {
      throw new SlipImageError('PROOF_IMAGE_INVALID_WEBP');
    }

    const chunkType = ascii(bytes, offset, 4);
    const chunkLength = readU32LE(bytes, offset + 4);
    const dataStart = offset + 8;
    const paddedLength = chunkLength + (chunkLength % 2);
    const chunkEnd = dataStart + paddedLength;

    if (!Number.isSafeInteger(chunkEnd) || chunkEnd > bytes.length) {
      throw new SlipImageError('PROOF_IMAGE_TRUNCATED');
    }

    if (chunkType === 'ANIM' || chunkType === 'ANMF') {
      throw new SlipImageError('PROOF_IMAGE_ANIMATED');
    }

    if (chunkType === 'VP8X') {
      if (chunkLength < 10) throw new SlipImageError('PROOF_IMAGE_INVALID_WEBP');
      // VP8X animation flag is bit 1 of the feature flags byte.
      if ((bytes[dataStart] & 0x02) !== 0) {
        throw new SlipImageError('PROOF_IMAGE_ANIMATED');
      }
    }

    if (chunkType === 'VP8 ' || chunkType === 'VP8L') hasImageChunk = true;
    offset = chunkEnd;
  }

  if (offset !== bytes.length || !hasImageChunk) {
    throw new SlipImageError('PROOF_IMAGE_INVALID_WEBP');
  }
}

export function validateSlipImageEnvelope(input, claimedMimeType) {
  const bytes = asBytes(input);

  if (bytes.length === 0) throw new SlipImageError('PROOF_IMAGE_EMPTY', 400);
  if (bytes.length > SLIP_IMAGE_LIMITS.inputBytes) {
    throw new SlipImageError('PROOF_IMAGE_TOO_LARGE', 413);
  }

  const mime = String(claimedMimeType || '').trim().toLowerCase();
  const expectedFormat = MIME_TO_FORMAT[mime];
  if (!expectedFormat) throw new SlipImageError('PROOF_IMAGE_MIME_UNSUPPORTED', 415);

  let detectedFormat = 'unknown';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    detectedFormat = 'jpeg';
  } else if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    ascii(bytes, 1, 3) === 'PNG'
  ) {
    detectedFormat = 'png';
  } else if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    detectedFormat = 'webp';
  }

  if (detectedFormat !== expectedFormat) {
    throw new SlipImageError('PROOF_IMAGE_MIME_MISMATCH', 415);
  }

  if (detectedFormat === 'jpeg') validateJpegEnvelope(bytes);
  if (detectedFormat === 'png') validatePngEnvelope(bytes);
  if (detectedFormat === 'webp') validateWebpEnvelope(bytes);

  return detectedFormat;
}

export function validateSlipImageDimensions(info) {
  const width = Number(info?.width);
  const height = Number(info?.height);
  const limits = SLIP_IMAGE_LIMITS;

  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > limits.maxDimension ||
    height > limits.maxDimension ||
    width * height > limits.maxPixels
  ) {
    throw new SlipImageError('PROOF_IMAGE_DIMENSIONS_UNSAFE', 413);
  }

  return { width, height };
}

/**
 * Read a raw request body without trusting Content-Length. This helper is intended
 * for the Pages Function's raw-image internal hop, not multipart form parsing.
 */
export async function readBoundedImageRequest(request, maxBytes = SLIP_IMAGE_LIMITS.inputBytes) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new SlipImageError('PROOF_IMAGE_TOO_LARGE', 413);
  }
  if (!request.body) throw new SlipImageError('PROOF_IMAGE_EMPTY', 400);

  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;

      total += value.byteLength;
      if (total > maxBytes) {
        try { await reader.cancel(); } catch (_) {}
        throw new SlipImageError('PROOF_IMAGE_TOO_LARGE', 413);
      }
      chunks.push(value);
    }
  } finally {
    try { reader.releaseLock(); } catch (_) {}
  }

  if (total === 0) throw new SlipImageError('PROOF_IMAGE_EMPTY', 400);

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * Factory keeps the image library injectable so validation and failure paths can
 * be tested without pretending a Node mock is a real Cloudflare WASM execution.
 */
export function createSlipImageSanitizer(sip) {
  if (!sip || !['ready', 'inspect', 'transform', 'collect'].every((key) => typeof sip[key] === 'function')) {
    throw new TypeError('A complete SIP adapter is required');
  }

  let readyPromise;

  return async function sanitizeSlipImage(input, claimedMimeType) {
    const bytes = asBytes(input);
    const envelopeFormat = validateSlipImageEnvelope(bytes, claimedMimeType);

    try {
      if (!readyPromise) {
        readyPromise = Promise.resolve().then(() => sip.ready()).catch((error) => {
          readyPromise = null;
          throw error;
        });
      }
      await readyPromise;

      const inspected = await sip.inspect(bytes);
      if (!inspected?.info || inspected.info.format !== envelopeFormat) {
        throw new SlipImageError('PROOF_IMAGE_FORMAT_UNVERIFIED');
      }

      validateSlipImageDimensions(inspected.info);

      const encoded = sip.transform(inspected.source, {
        width: SLIP_IMAGE_LIMITS.outputEdge,
        height: SLIP_IMAGE_LIMITS.outputEdge,
        quality: SLIP_IMAGE_LIMITS.jpegQuality,
      });
      const result = await sip.collect(encoded);
      const output = asBytes(result?.data);

      if (
        result?.info?.mimeType !== 'image/jpeg' ||
        output.length < 4 ||
        output.length > SLIP_IMAGE_LIMITS.outputBytes ||
        output[0] !== 0xff ||
        output[1] !== 0xd8 ||
        output[output.length - 2] !== 0xff ||
        output[output.length - 1] !== 0xd9
      ) {
        throw new SlipImageError('PROOF_IMAGE_SANITIZATION_FAILED');
      }

      const outputDimensions = validateSlipImageDimensions(result.info);
      if (
        outputDimensions.width > SLIP_IMAGE_LIMITS.outputEdge ||
        outputDimensions.height > SLIP_IMAGE_LIMITS.outputEdge
      ) {
        throw new SlipImageError('PROOF_IMAGE_SANITIZATION_FAILED');
      }

      return {
        bytes: output,
        mimeType: 'image/jpeg',
        originalFormat: envelopeFormat,
        width: outputDimensions.width,
        height: outputDimensions.height,
        inputBytes: bytes.length,
        outputBytes: output.length,
      };
    } catch (error) {
      if (error instanceof SlipImageError) throw error;
      // Do not leak codec details or user-controlled data into API responses/logs.
      throw new SlipImageError('PROOF_IMAGE_DECODE_FAILED', 422);
    }
  };
}
