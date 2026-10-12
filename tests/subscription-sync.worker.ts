import { exports } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { parse } from "yaml";

function input() {
  return {
    id: crypto.randomUUID().replaceAll("-", "").slice(0, 16), managementToken: "test-token-".padEnd(32, "0"),
    target: "clash-party-config",
    config: { name: "", sources: [
      { type: "subscription", value: "https://airport.example/private-url" },
      { type: "node", value: "socks5://home:secret@home.example:9004#MyHome" },
    ] },
    snapshot: { readAt: new Date(Date.now() - 120_000).toISOString(), sources: [{
      content: "trojan://airport-secret@node.example:443#JP-01",
      metadata: { profileName: "Airport", usage: { upload: "10", download: "20", total: "100", expire: "0" } },
    }] },
  };
}
const post = (body: unknown) => exports.default.fetch("https://example.com/api/subscriptions/sync", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

describe("locally read, cloud distributed subscriptions", () => {
  it("uses one protected link for nodes, quota and later updates without fetching the airport from CF", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("CF must not read this source"));
    try {
      const body = input();
      const created = await post(body);
      expect(created.status).toBe(201);
      const data = await created.json<{ url: string; profileName: string; sourceMode: string; usage: { combined: { total: string } } }>();
      expect(data.profileName).toBe("Airport");
      expect(data.sourceMode).toBe("local-sync");
      expect(data.usage.combined.total).toBe("100");
      expect(JSON.stringify(data)).not.toMatch(/management|airport-secret|private-url/);
      const first = await exports.default.fetch(data.url);
      expect(first.headers.get("subscription-userinfo")).toBe("upload=10; download=20; total=100; expire=0");
      expect(first.headers.get("x-subscription-synced-at")).toBe(body.snapshot.readAt);
      expect(parse(await first.text()).proxies).toHaveLength(2);
      body.snapshot.readAt = new Date().toISOString();
      body.snapshot.sources[0].metadata.usage.download = "30";
      const update = await post(body);
      expect(update.status).toBe(200);
      expect((await update.json<{ url: string }>()).url).toBe(data.url);
      const refreshed = await exports.default.fetch(data.url);
      expect(refreshed.headers.get("subscription-userinfo")).toContain("download=30");
      expect(parse(await refreshed.text()).proxies).toContainEqual(expect.objectContaining({ name: "MyHome", type: "socks5" }));
      expect(spy).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });

  it("rejects wrong credentials, empty sources, count mismatches and older revisions without replacing the last snapshot", async () => {
    const body = input();
    const created = await post(body);
    const { url } = await created.json<{ url: string }>();
    const first = await (await exports.default.fetch(url)).text();
    expect((await post({ ...body, managementToken: "a".repeat(32) })).status).toBe(403);
    expect((await post({ ...body, snapshot: { ...body.snapshot, sources: [] } })).status).toBe(400);
    expect((await post({ ...body, snapshot: { ...body.snapshot, sources: [{ ...body.snapshot.sources[0], content: "proxies: []" }] } })).status).toBe(422);
    expect((await post({ ...body, snapshot: { ...body.snapshot, readAt: new Date(Date.now() - 3600_000).toISOString() } })).status).toBe(409);
    expect(await (await exports.default.fetch(url)).text()).toBe(first);
    const resolved = await exports.default.fetch("https://example.com/api/subscriptions/resolve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
    expect(JSON.stringify(await resolved.json())).not.toMatch(/managementHash|managementToken|airport-secret/);
  });

  it("retains overdue content with a timestamp and warning, not a fake fresh quota or empty profile", async () => {
    const body = input();
    body.snapshot.readAt = new Date(Date.now() - 8 * 3_600_000).toISOString();
    const { url } = await (await post(body)).json<{ url: string }>();
    const response = await exports.default.fetch(url);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-subscription-refresh-status")).toBe("sync-overdue");
    expect(response.headers.get("warning")).toContain("overdue");
    expect(response.headers.get("x-subscription-last-success")).toBe(body.snapshot.readAt);
    expect(parse(await response.text()).proxies).toHaveLength(2);
  });

  it("keeps snapshot input out of the shared remote cache and rejects oversized or malformed metadata", async () => {
    const body = input();
    expect((await post({ ...body, snapshot: { ...body.snapshot, sources: [{ content: "x".repeat(1_048_577), metadata: {} }] } })).status).toBe(413);
    expect((await post({ ...body, snapshot: { ...body.snapshot, sources: [{ ...body.snapshot.sources[0], metadata: { usage: { upload: "-1", download: "2", total: "3" } } }] } })).status).toBe(400);
    expect((await post(body)).status).toBe(201);
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 403 }));
    try {
      const response = await exports.default.fetch("https://example.com/api/subscriptions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body.config, target: body.target }) });
      expect(response.status).toBe(502);
      expect(spy).toHaveBeenCalledOnce();
    } finally { spy.mockRestore(); }
  });
});
