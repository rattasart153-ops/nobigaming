import {
  createSlipImageSanitizer,
  readBoundedImageRequest,
  SlipImageError,
} from "../functions/_shared/slip-image-sanitizer.mjs";
import { sipSlipImageAdapter } from "../functions/_shared/sip-adapter.ts";

const sanitizeSlipImage = createSlipImageSanitizer(sipSlipImageAdapter);

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/sanitize") {
      return new Response("Not found", { status: 404 });
    }
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    try {
      const input = await readBoundedImageRequest(request);
      const result = await sanitizeSlipImage(
        input,
        request.headers.get("content-type"),
      );

      return new Response(result.bytes, {
        status: 200,
        headers: {
          "content-type": result.mimeType,
          "cache-control": "no-store",
          "x-original-format": result.originalFormat,
          "x-output-width": String(result.width),
          "x-output-height": String(result.height),
          "x-input-bytes": String(result.inputBytes),
          "x-output-bytes": String(result.outputBytes),
        },
      });
    } catch (error) {
      if (error instanceof SlipImageError) {
        return Response.json(
          { error: error.code },
          { status: error.status },
        );
      }
      return Response.json(
        { error: "PROOF_IMAGE_SANITIZATION_FAILED" },
        { status: 422 },
      );
    }
  },
};
