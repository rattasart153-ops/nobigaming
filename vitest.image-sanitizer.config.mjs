import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: "./wrangler.image-sanitizer-test.jsonc",
      },
    }),
  ],
  test: {
    include: ["workerd-test/**/*.workerd.mjs"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    maxWorkers: 1,
  },
});
