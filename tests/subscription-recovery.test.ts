import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/worker/api-error";
import { withSubscriptionRecovery } from "../src/worker/subscription-recovery";

describe("last successful subscription", () => {
  it("reuses only a fresh matching revision without rebuilding, and refreshes quota after expiry or revision changes", async () => {
    const records = new Map<string, string>();
    const storage = { get: async (key: string) => records.get(key) ?? null, put: async (key: string, value: string) => { records.set(key, value); } };
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const build = vi.fn(async () => new Response("verified", { headers: { "Subscription-Userinfo": "download=10; total=100" } }));
    const cache = { freshForMs: 6 * 3_600_000, revision: "source-a:deploy-a" };
    try {
      await withSubscriptionRecovery(storage, "cached", build, cache);
      clock.mockReturnValue(1_030_000);
      const cached = await withSubscriptionRecovery(storage, "cached", build, cache);
      expect(build).toHaveBeenCalledTimes(1);
      expect(cached.headers.get("x-subscription-refresh-status")).toBe("cached");
      expect(cached.headers.get("subscription-userinfo")).toBe("download=10; total=100");
      expect(cached.headers.get("cache-control")).toBe("no-store");
      expect(await cached.text()).toBe("verified");
      build.mockImplementation(async () => new Response("updated", { headers: { "Subscription-Userinfo": "download=20; total=100" } }));
      const updated = await withSubscriptionRecovery(storage, "cached", build, { ...cache, revision: "source-b:deploy-a" });
      expect(build).toHaveBeenCalledTimes(2);
      expect(updated.headers.get("subscription-userinfo")).toBe("download=20; total=100");
      await withSubscriptionRecovery(storage, "cached", build, { ...cache, revision: "source-b:deploy-b" });
      expect(build).toHaveBeenCalledTimes(3);
      clock.mockReturnValue(1_030_000 + 6 * 3_600_000 + 1);
      build.mockRejectedValue(new ApiError(502, "source_failed", "Upstream failed"));
      const recovered = await withSubscriptionRecovery(storage, "cached", build, { ...cache, revision: "source-b:deploy-b" });
      expect(build).toHaveBeenCalledTimes(4);
      expect(recovered.headers.get("x-subscription-refresh-status")).toBe("last-good");
      expect(recovered.headers.get("subscription-userinfo")).toBe("download=20; total=100");
    } finally { clock.mockRestore(); }
  });

  it("preserves a verified response on fetch failure, labels stale quota, and expires after 24 hours", async () => {
    const records = new Map<string, string>();
    const storage = { get: async (key: string) => records.get(key) ?? null, put: async (key: string, value: string) => { records.set(key, value); } };
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const build = vi.fn().mockResolvedValue(new Response("proxies: [verified]", { headers: { "Subscription-Userinfo": "upload=1; download=2; total=100" } }));
    try {
      expect((await withSubscriptionRecovery(storage, "test", build)).headers.get("x-subscription-refresh-status")).toBe("fresh");
      build.mockRejectedValue(new ApiError(502, "source_failed", "Upstream failed"));
      clock.mockReturnValue(1_000_100);
      const recovered = await withSubscriptionRecovery(storage, "test", build);
      expect(await recovered.text()).toBe("proxies: [verified]");
      expect(recovered.headers.get("x-subscription-refresh-status")).toBe("last-good");
      expect(recovered.headers.get("x-subscription-refresh-error")).toBe("source_failed");
      expect(recovered.headers.get("subscription-userinfo")).toBe("upload=1; download=2; total=100");
      clock.mockReturnValue(1_000_000 + 86400_001);
      await expect(withSubscriptionRecovery(storage, "test", build)).rejects.toMatchObject({ code: "source_failed" });
    } finally { clock.mockRestore(); }
  });

  it("does not turn invalid settings into success, and reports storage failure while returning fresh nodes", async () => {
    const storage = { get: async () => null, put: async () => { throw new Error("unavailable"); } };
    const result = await withSubscriptionRecovery(storage, "test", async () => new Response("valid"));
    expect(result.headers.get("x-subscription-recovery-storage")).toBe("unavailable");
    expect(await result.text()).toBe("valid");
    await expect(withSubscriptionRecovery(storage, "test", async () => { throw new ApiError(400, "invalid_source", "Invalid"); })).rejects.toMatchObject({ code: "invalid_source" });
  });
});
