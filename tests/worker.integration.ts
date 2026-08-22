import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("Worker entrypoint", () => {
  it("returns a private health response with security headers", async () => {
    const response = await exports.default.fetch("https://example.com/health");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      service: "personal-clash-rules",
    });
  });

  it("rejects state-changing methods", async () => {
    const response = await exports.default.fetch("https://example.com/", {
      method: "POST",
    });

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD");
  });
});
