import { exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearSourceCache } from "./helpers/source-cache";
import { parse } from "yaml";

beforeEach(clearSourceCache);

const origin = "https://example.com";
const uri = "trojan://airport-secret@airport.example:443#Airport";
const exit = { authMode: "literal", protocol: "socks5", server: "residential.example", port: 9004, account: "test-account", password: "test-password", country: "us" };
const rules = ["DOMAIN-SUFFIX,claude.ai"];
const dns = ["https://1.1.1.1/dns-query"];
const base = `mode: rule
dns: {enable: true, proxy-server-nameserver: [system], nameserver: [https://1.1.1.1/dns-query]}
proxies: [{name: Airport, type: trojan, server: airport.example, port: 443, password: airport-secret}]
proxy-groups: [{name: PROXY, type: select, proxies: [Airport]}]
rules: [MATCH,PROXY]
`;
function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return exports.default.fetch(`${origin}${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
}
async function preview(input: Record<string, unknown> = {}) {
  const response = await post("/api/rola/preview", { sources: [{ type: "node", name: "Airport", value: uri }], target: "clash-party-config", name: "Test", ...input });
  expect(response.status).toBe(200);
  return response.json<{ baseId: string; nodes: Array<{ name: string; selectable: boolean }>; result: { usage: { combined: unknown } } }>();
}
async function create(input: Record<string, unknown> = {}) {
  const p = await preview(input);
  const response = await post("/api/rola/chains", { baseId: p.baseId, exit, upstreamNode: p.nodes[0].name, rules, dns });
  expect(response.status).toBe(201);
  return response.json<{ url: string; revokeToken: string; expiresAt: string; sourceMode: string }>();
}

describe("cloud Rola subscriptions", () => {
  it("reads a synchronized base internally and propagates its quota and overdue status to the chain", async () => {
    const syncId = crypto.randomUUID().replaceAll("-", "").slice(0, 16);
    const syncedAt = new Date(Date.now() - 8 * 3_600_000).toISOString();
    const synchronized = await post("/api/subscriptions/sync", {
      id: syncId, managementToken: "test-token-".padEnd(32, "0"), target: "clash-party-config",
      config: { sources: [{ type: "subscription", value: "https://airport.example/private-source" }] },
      snapshot: { readAt: syncedAt, sources: [{ content: uri, metadata: { profileName: "Airport", usage: { upload: "10", download: "20", total: "100" } } }] },
    });
    expect(synchronized.status).toBe(201);
    const link = await synchronized.json<{ url: string }>();
    const spy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Must not fetch the same Worker or the airport"));
    try {
      const p = await preview({ sources: [{ type: "subscription", value: link.url }] });
      expect(p.result.usage.combined).toMatchObject({ total: "100" });
      const response = await post("/api/rola/chains", { baseId: p.baseId, exit, upstreamNode: p.nodes[0].name, rules, dns });
      expect(response.status).toBe(201);
      const { url } = await response.json<{ url: string }>();
      const refreshed = await exports.default.fetch(url);
      expect(refreshed.status).toBe(200);
      expect(refreshed.headers.get("subscription-userinfo")).toBe("upload=10; download=20; total=100");
      expect(refreshed.headers.get("x-subscription-synced-at")).toBe(syncedAt);
      expect(refreshed.headers.get("x-subscription-refresh-status")).toBe("sync-overdue");
      expect(parse(await refreshed.text()).proxies.at(-1)).toMatchObject({ "dialer-proxy": "Airport", type: "socks5" });
      const update = {
        id: syncId, managementToken: "test-token-".padEnd(32, "0"), target: "clash-party-config",
        config: { sources: [{ type: "subscription", value: "https://airport.example/private-source" }] },
        snapshot: { readAt: new Date(Date.now() - 120_000).toISOString(), sources: [{ content: uri.replace("airport-secret", "updated-secret"), metadata: { profileName: "Airport", usage: { upload: "10", download: "40", total: "100" } } }] },
      };
      expect((await post("/api/subscriptions/sync", update)).status).toBe(200);
      const updated = await exports.default.fetch(url);
      expect(updated.headers.get("subscription-userinfo")).toContain("download=40");
      expect(parse(await updated.text()).proxies[0].password).toBe("updated-secret");
      update.snapshot.readAt = new Date().toISOString();
      update.snapshot.sources[0].content = uri.replace("#Airport", "#Withdrawn");
      expect((await post("/api/subscriptions/sync", update)).status).toBe(200);
      expect((await exports.default.fetch(url)).status).toBe(422);
      expect(spy).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });

  it("returns safe upstream diagnostics through the preview API", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("private upstream body", {
      status: 403, headers: { "CF-Mitigated": "challenge", "CF-Ray": "a4942df21d672617-NRT" },
    }));
    try {
      const response = await post("/api/rola/preview", { sources: [{ type: "subscription", name: "Airport", value: "https://provider.example/private-token" }], target: "clash-party-config" });
      expect(response.status).toBe(502);
      const data = await response.json();
      expect(data).toMatchObject({ error: "source_failed", upstream: { status: 403, challenge: true, rayId: "a4942df21d672617-NRT" } });
      expect(JSON.stringify(data)).not.toMatch(/private-token|private upstream body/);
    } finally { spy.mockRestore(); }
  });

  it("accepts a bounded full airport source larger than 256 KiB and still limits the compact profile", async () => {
    const airport = `proxies: [{name: Airport, type: trojan, server: airport.example, port: 443, password: airport-secret}]\n# ${"comment".repeat(75_000)}\n`;
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(airport));
    try {
      const created = await create({ sources: [{ type: "subscription", name: "Airport", value: "https://provider.example/sub" }] });
      const refreshed = await exports.default.fetch(created.url);
      expect(refreshed.status).toBe(200);
      expect(parse(await refreshed.text()).proxies).toHaveLength(2);
      spy.mockImplementation(async () => new Response("x".repeat(1_048_577)));
      await clearSourceCache();
      const tooLarge = await post("/api/rola/preview", { sources: [{ type: "subscription", name: "Airport", value: "https://provider.example/sub" }], target: "clash-party-config" });
      expect(tooLarge.status).toBe(413);
    } finally { spy.mockRestore(); }
  });

  it("generates an actual credentialed chain without echoing secrets in the creation response, and can revoke it", async () => {
    const created = await create();
    expect(JSON.stringify(created)).not.toMatch(/test-password|test-account|airport-secret/);
    expect(new URL(created.url).pathname).toMatch(/^\/r\/[\w-]{32}\.yaml$/u);
    const response = await exports.default.fetch(created.url);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const profile = parse(await response.text());
    expect(profile.proxies.at(-1)).toMatchObject({ type: "socks5", username: exit.account, password: exit.password, "dialer-proxy": "Airport", udp: false });
    expect(profile.rules[0]).toBe("AND,((DOMAIN-SUFFIX,claude.ai),(NETWORK,UDP)),REJECT");
    expect(profile.dns["nameserver-policy"]["+.claude.ai"]).toEqual(["https://1.1.1.1/dns-query#ROLA"]);
    const head = await exports.default.fetch(created.url, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect((await post("/api/rola/revoke", { url: created.url, revokeToken: "bad" })).status).toBe(403);
    expect((await post("/api/rola/revoke", { url: created.url, revokeToken: created.revokeToken })).status).toBe(200);
    expect((await exports.default.fetch(created.url)).status).toBe(404);
  });

  it("refreshes airport quota and rejects a missing first hop or denied source without returning an empty profile", async () => {
    let content = uri;
    let status = 200;
    let upload = 10;
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(content, { status, headers: { "Subscription-Userinfo": `upload=${upload}; download=20; total=100; expire=0` } }));
    try {
      const created = await create({ sources: [{ type: "subscription", name: "Airport", value: "https://provider.example/sub" }] });
      upload = 15;
      await clearSourceCache();
      const refreshed = await exports.default.fetch(created.url);
      expect(refreshed.headers.get("subscription-userinfo")).toBe("upload=15; download=20; total=100; expire=0");
      content = uri.replace("#Airport", "#Changed");
      await clearSourceCache();
      expect((await exports.default.fetch(created.url)).status).toBe(422);
      status = 403;
      await clearSourceCache();
      const failed = await exports.default.fetch(created.url);
      expect(failed.status).toBe(200);
      expect(failed.headers.get("x-subscription-refresh-status")).toBe("last-good");
      expect(parse(await failed.text()).proxies.at(-1)["dialer-proxy"]).toBe("Airport");
    } finally { spy.mockRestore(); }
  });

  it("supports explicit uploaded snapshots without falsely advertising refreshed quota", async () => {
    const created = await create({ snapshot: base, sources: undefined });
    expect(created.sourceMode).toBe("snapshot");
    const response = await exports.default.fetch(created.url);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-subscription-source-mode")).toBe("snapshot");
    expect(response.headers.has("subscription-userinfo")).toBe(false);
  });

  it("bounds input, snapshot bytes and node counts, and rejects untrusted origins and credential-bearing errors", async () => {
    expect((await post("/api/rola/preview", { snapshot: "x".repeat(600_000) })).status).toBe(413);
    expect((await post("/api/rola/preview", { snapshot: "x".repeat(270_000), target: "mihomo-config" })).status).toBe(413);
    const tooMany = base.replace(/proxies:.*\n/u, `proxies: ${JSON.stringify(Array.from({ length: 501 }, (_, i) => ({ name: `node${i}`, type: "trojan", server: "airport.example", port: 443, password: "secret" })))}\n`);
    expect((await post("/api/rola/preview", { snapshot: tooMany, target: "mihomo-config" })).status).toBe(413);
    expect((await post("/api/rola/preview", {}, { Origin: "https://evil.example" })).status).toBe(403);
    const p = await preview();
    const bad = await post("/api/rola/chains", { baseId: p.baseId, exit, upstreamNode: "DIRECT", rules, dns });
    expect(bad.status).toBe(422);
    expect(await bad.text()).not.toContain(exit.password);
  });
});
