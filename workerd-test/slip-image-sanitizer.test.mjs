import { describe, expect, it } from "vitest";
import { exports } from "cloudflare:workers";
import { fixtureBytes, IMAGE_FIXTURES } from "./fixtures.mjs";

function postImage(bytes, mime) {
  return exports.default.fetch(
    new Request("https://nobi-staging.invalid/sanitize", {
      method: "POST",
      headers: { "content-type": mime },
      body: bytes,
    }),
  );
}

async function expectSanitizedJpeg(response, originalFormat) {
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("image/jpeg");
  expect(response.headers.get("x-original-format")).toBe(originalFormat);

  const width = Number(response.headers.get("x-output-width"));
  const height = Number(response.headers.get("x-output-height"));
  expect(width).toBeGreaterThan(0);
  expect(height).toBeGreaterThan(0);
  expect(width).toBeLessThanOrEqual(2048);
  expect(height).toBeLessThanOrEqual(2048);

  const bytes = new Uint8Array(await response.arrayBuffer());
  expect(bytes.length).toBeGreaterThan(4);
  expect(bytes.length).toBeLessThanOrEqual(2_500_000);
  expect(Array.from(bytes.slice(0, 3))).toEqual([0xff, 0xd8, 0xff]);
  expect(Array.from(bytes.slice(-2))).toEqual([0xff, 0xd9]);
  return bytes;
}

describe("real SIP decode/re-encode inside Cloudflare workerd", () => {
  it.each(["jpeg", "png", "webp"])(
    "decodes %s and emits a fresh bounded JPEG",
    async (format) => {
      const fixture = IMAGE_FIXTURES[format];
      const response = await postImage(fixtureBytes(format), fixture.mime);
      const output = await expectSanitizedJpeg(response, format);

      // Decode the generated JPEG again through the real SIP decoder. This checks
      // that the returned bytes are not merely JPEG-looking headers.
      const secondPass = await postImage(output, "image/jpeg");
      await expectSanitizedJpeg(secondPass, "jpeg");
    },
  );

  it("rejects a claimed MIME type that does not match the file signature", async () => {
    const response = await postImage(fixtureBytes("jpeg"), "image/png");
    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({
      error: "PROOF_IMAGE_MIME_MISMATCH",
    });
  });

  it("rejects dimensions above the pixel ceiling before invoking a decoder", async () => {
    const bytes = fixtureBytes("jpeg");
    let sof = -1;
    for (let i = 0; i < bytes.length - 8; i += 1) {
      if (bytes[i] === 0xff && [0xc0, 0xc1, 0xc2, 0xc3].includes(bytes[i + 1])) {
        sof = i;
        break;
      }
    }
    expect(sof).toBeGreaterThanOrEqual(0);

    // JPEG SOF: marker, segment length, precision, height, width.
    bytes[sof + 5] = 0x13;
    bytes[sof + 6] = 0x88; // 5000 px
    bytes[sof + 7] = 0x13;
    bytes[sof + 8] = 0x88; // 5000 px

    const response = await postImage(bytes, "image/jpeg");
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      error: "PROOF_IMAGE_DIMENSIONS_UNSAFE",
    });
  });

  it("rejects a body larger than 3 MiB before decoding", async () => {
    const bytes = new Uint8Array(3 * 1024 * 1024 + 1);
    const response = await postImage(bytes, "image/jpeg");
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      error: "PROOF_IMAGE_TOO_LARGE",
    });
  });
});
