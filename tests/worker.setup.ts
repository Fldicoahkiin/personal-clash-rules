import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { beforeAll } from "vitest";

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      TEST_MIGRATIONS: D1Migration[];
      DATA_ENCRYPTION_KEY: string;
      CONTROL_API_TOKEN: string;
      SUB_STORE_URL: string;
      SUB_STORE_ACCESS_CLIENT_ID: string;
      SUB_STORE_ACCESS_CLIENT_SECRET: string;
    }
  }
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
