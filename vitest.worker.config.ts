import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
  test: {
    include: ["tests/worker.integration.ts", "tests/subscription-converter.worker.ts", "tests/rola.worker.ts", "tests/subscription-sync.worker.ts", "tests/live-shape.worker.ts"],
  },
});
