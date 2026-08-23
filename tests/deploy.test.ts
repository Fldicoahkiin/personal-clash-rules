import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function projectFile(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("Cloudflare deployment", () => {
  it("keeps the site and stateless subscription API on one Worker", () => {
    const config = projectFile("wrangler.jsonc");
    expect(config).toContain('"main": "src/worker.ts"');
    expect(config).toContain('"binding": "ASSETS"');
    expect(config).not.toContain("DATA_ENCRYPTION_KEY");
    expect(config).not.toContain('"binding": "DB"');
    expect(config).not.toContain('"crons"');
  });

  it("does not require a database or private conversion host", () => {
    const types = projectFile("src/worker/types.ts");
    const setup = projectFile("docs/cloudflare-setup.md");
    expect(types).not.toContain("SUB_STORE_URL");
    expect(setup).not.toMatch(/VPS|Tunnel|SUB_STORE_URL|D1/u);
  });
});
