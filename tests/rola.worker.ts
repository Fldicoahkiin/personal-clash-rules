import { exports } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { parse } from "yaml";

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
      const refreshed = await exports.default.fetch(created.url);
      expect(refreshed.headers.get("subscription-userinfo")).toBe("upload=15; download=20; total=100; expire=0");
      content = uri.replace("#Airport", "#Changed");
      expect((await exports.default.fetch(created.url)).status).toBe(422);
      status = 403;
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
