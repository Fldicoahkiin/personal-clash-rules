import { exports } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { parse, stringify } from "yaml";

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
const post = (body: unknown, clientIp?: string) => exports.default.fetch("https://example.com/api/subscriptions/sync", {
  method: "POST", headers: { "Content-Type": "application/json", ...(clientIp ? { "CF-Connecting-IP": clientIp } : {}) }, body: JSON.stringify(body),
});

describe("locally read, cloud distributed subscriptions", () => {
  it("persists inline Reality YAML fields across managed refreshes without changing airport nodes", async () => {
    const body = input();
    const relays = ["203.0.113.10", "203.0.113.11"].map((ip, index) => ({
      name: `[Rola] 美国 · ${ip} · VPS`, type: "vless", server: "203.0.113.20", port: 443,
      uuid: `00000000-0000-4000-8000-00000000000${index + 1}`, tls: true, "skip-cert-verify": false,
      network: "tcp", flow: "xtls-rprx-vision", udp: false, servername: "tls.example", "client-fingerprint": "chrome",
      "reality-opts": { "public-key": "example", "short-id": "12345678", "support-x25519mlkem768": true },
    }));
    body.config.sources.push({ type: "node", value: stringify({ proxies: relays }) });
    const sync = () => post(body, "192.0.2.200");
    const created = await sync();
    expect(created.status).toBe(201);
    const { url } = await created.json<{ url: string }>();
    for (let attempt = 0; attempt < 2; attempt++) {
      body.snapshot.readAt = new Date(Date.now() - (1 - attempt) * 61_000).toISOString();
      expect((await sync()).status).toBe(200);
      const profile = parse(await (await exports.default.fetch(url)).text());
      expect(profile.proxies).toHaveLength(4);
      for (const relay of relays) expect(profile.proxies.find((node: { name: string }) => node.name === relay.name)).toMatchObject(relay);
      expect(profile.proxies.find((node: { type: string }) => node.type === "trojan").udp).toBe(true);
      expect(profile.proxies.find((node: { type: string }) => node.type === "trojan")["reality-opts"]).toBeUndefined();
    }
    body.config.sources.at(-1)!.value = "proxies: []";
    expect((await sync()).status).toBe(422);
    expect(parse(await (await exports.default.fetch(url)).text()).proxies).toHaveLength(4);
  });

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
