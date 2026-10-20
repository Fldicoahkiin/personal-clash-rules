import { describe, expect, it, vi } from "vitest";
import { normalizeSourceBundle } from "../src/worker/sub-store/normalize";
import { readRemoteSource } from "../src/worker/sub-store/remote";
import type { SubscriptionEnv } from "../src/worker/types";

describe("subscription upstream failures", () => {
  it("reuses validated source content and quota across output requests, isolates UA and expires the cache", async () => {
    const stored = new Map<string, string>();
    const env = { SUBSCRIPTIONS: { get: async (key: string) => stored.get(key) ?? null, put: async (key: string, value: string) => { stored.set(key, value); } } } as SubscriptionEnv;
    const input = { profileName: "", sourceUserAgent: "clash.meta", subscriptionUrls: ["https://provider.example/sub"], nodes: [] };
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("trojan://test@node.example:443#Demo", { headers: { "Subscription-Userinfo": "upload=1; download=2; total=10" } }));
    const now = vi.spyOn(Date, "now").mockReturnValue(1800000000000);
    try {
      const first = await normalizeSourceBundle(env, input);
      expect(await normalizeSourceBundle(env, input)).toEqual(first);
      expect(spy).toHaveBeenCalledOnce();
      await normalizeSourceBundle(env, { ...input, sourceUserAgent: "Shadowrocket" });
      expect(spy).toHaveBeenCalledTimes(2);
      now.mockReturnValue(1800000300001);
      spy.mockImplementation(async () => new Response("<html>empty</html>"));
      await expect(normalizeSourceBundle(env, input)).rejects.toMatchObject({ code: "no_nodes_found" });
      expect(spy).toHaveBeenCalledTimes(3);
    } finally { spy.mockRestore(); now.mockRestore(); }
  });
  it("reports challenge evidence without returning the source URL, cookies or response body", async () => {
    const cancel = vi.fn();
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new ReadableStream({ cancel }), {
      status: 403,
      headers: { "CF-Mitigated": "challenge", "CF-Ray": "a4942df21d672617-NRT", Server: "cloudflare", "Content-Type": "text/html; charset=UTF-8", "Set-Cookie": "private-cookie" },
    }));
    try {
      const error = await readRemoteSource("https://provider.example/private-token", "clash.meta").catch(value => value);
      expect(error).toMatchObject({ code: "source_failed", upstream: { status: 403, challenge: true, cloudflare: true, responseType: "html", rayId: "a4942df21d672617-NRT", redirects: 0, checkedAt: expect.any(String) } });
      expect(cancel).toHaveBeenCalledOnce();
      expect(JSON.stringify(error)).not.toMatch(/private-token|private-cookie|provider\.example/);
      expect(spy).toHaveBeenCalledOnce();
    } finally { spy.mockRestore(); }
  });

  it("does not classify an ordinary 403 as a challenge or return arbitrary header values", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("private-body", {
      status: 403, headers: { "CF-Ray": "private-token", "CF-Mitigated": "anything", "Content-Type": "text/private-token", Server: "private-token" },
    }));
    try {
      const error = await readRemoteSource("https://provider.example/sub", "clash.meta").catch(value => value);
      expect(error.upstream).toMatchObject({ status: 403, challenge: false, cloudflare: false, responseType: "other", redirects: 0 });
      expect(error.upstream.rayId).toBeUndefined();
      expect(JSON.stringify(error)).not.toMatch(/private-body|private-token/);
    } finally { spy.mockRestore(); }
  });

  it("releases redirect responses and reports the final upstream status", async () => {
    const cancel = vi.fn();
    const spy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(new ReadableStream({ cancel }), { status: 302, headers: { Location: "https://provider.example/download" } }))
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { "Content-Type": "application/json" } }));
    try {
      const error = await readRemoteSource("https://provider.example/sub", "clash.meta").catch(value => value);
      expect(error.upstream).toMatchObject({ status: 429, responseType: "json", redirects: 1 });
      expect(cancel).toHaveBeenCalledOnce();
      expect(spy).toHaveBeenCalledTimes(2);
    } finally { spy.mockRestore(); }
  });

  it("rejects explicit challenges even with HTTP 200 but accepts YAML with a misleading HTML content type", async () => {
    const spy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("challenge", { headers: { "CF-Mitigated": "challenge" } }))
      .mockResolvedValueOnce(new Response("proxies: []", { headers: { "Content-Type": "text/html" } }));
    try {
      await expect(readRemoteSource("https://provider.example/sub", "clash.meta")).rejects.toMatchObject({ code: "source_failed", upstream: { challenge: true } });
      await expect(readRemoteSource("https://provider.example/sub", "clash.meta")).resolves.toMatchObject({ content: "proxies: []" });
    } finally { spy.mockRestore(); }
  });
});
