import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

async function readMigrations() {
  const directory = path.join(import.meta.dirname, "migrations");
  const names = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  return Promise.all(names.map(async (name) => {
    const sql = await readFile(path.join(directory, name), "utf8");
    return {
      name,
      queries: sql.split(";").map((query) => query.trim()).filter(Boolean),
    };
  }));
}

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readMigrations();
      return {
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          d1Databases: ["DB"],
          bindings: {
            TEST_MIGRATIONS: migrations,
            DATA_ENCRYPTION_KEY: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
            CONTROL_API_TOKEN: "worker-test-token",
          },
        },
      };
    }),
  ],
  test: {
    include: ["tests/worker.integration.ts", "tests/subscription-converter.worker.ts"],
    setupFiles: ["./tests/worker.setup.ts"],
  },
});
