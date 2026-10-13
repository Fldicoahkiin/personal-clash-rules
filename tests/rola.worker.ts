import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearSourceCache } from "./helpers/source-cache";
import { parse, stringify } from "yaml";

let testClient = 0;
beforeEach(async () => {
  testClient += 1;
  await clearSourceCache();
});

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
  return fetchClient(`${origin}${path}`, { method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": `192.0.2.${testClient}`, ...headers }, body: JSON.stringify(body) });
}
function fetchClient(url: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("CF-Connecting-IP", `192.0.2.${testClient}`);
  return exports.default.fetch(url, { ...init, headers });
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
  it("persists explicit encrypted residential references and retains them in cloud and mobile refreshes", async () => {
    const sourceNames = ["[Rola] 美国 · 203.0.113.10", "[Rola] 美国 Las Vegas · 203.0.113.11"];
    const relays = sourceNames.map((name, index) => ({ name, type: "vless", server: "203.0.113.20", port: 443,
      uuid: `00000000-0000-4000-8000-00000000000${index + 1}`, tls: true, "skip-cert-verify": false,
      network: "tcp", flow: "xtls-rprx-vision", servername: "example.com", "client-fingerprint": "chrome",
      "reality-opts": { "public-key": "example", "short-id": "12345678", "support-x25519mlkem768": true } }));
    const p = await preview({ sources: [{ type: "node", name: "Airport", value: uri },
      { type: "node", name: "Residential VPS", value: stringify({ proxies: relays }) }] });
    const residentialNodeNames = p.nodes.filter(node => node.name !== "Airport").map(node => node.name);
    expect(residentialNodeNames).toEqual(sourceNames);
    const input = { baseId: p.baseId, exit, connectionMode: "direct", groupName: "Homes", residentialNodeNames, rules, dns };
    const response = await post("/api/rola/chains", input);
    expect(response.status).toBe(201);
    const created = await response.json<{ url: string; universalUrl: string; shadowrocketConfigUrl: string }>();
    const chainId = new URL(created.universalUrl).pathname.split("/").at(-1);
    const saved = await env.SUBSCRIPTIONS.get<{ settings: { residentialNodeNames: string[] } }>(`rola:chain:${chainId}`, "json");
    expect(saved?.settings.residentialNodeNames).toEqual(residentialNodeNames);
    for (let attempt = 0; attempt < 2; attempt++) {
      const refreshed = await fetchClient(created.url);
      expect(refreshed.status).toBe(200);
      const profile = parse(await refreshed.text());
      expect(profile.proxies.find((node: { name: string }) => node.name === "Airport")["reality-opts"]).toBeUndefined();
      for (const relay of relays) expect(profile.proxies.find((node: { name: string }) => node.name === relay.name)).toMatchObject(relay);
      expect(profile["proxy-groups"].find((group: { name: string }) => group.name === "Homes").proxies).toEqual(["ROLA-RESIDENTIAL", ...residentialNodeNames]);
      const auto = profile["proxy-groups"].find((group: { name: string }) => group.name === "♻️ 自动选择");
      for (const name of residentialNodeNames) {
        expect(profile.proxies.filter((node: { name: string }) => node.name === name)).toHaveLength(1);
        expect(new RegExp(auto["exclude-filter"].replace(/^\(\?i\)/u, ""), "iu").test(name)).toBe(true);
      }
      const phone = await fetchClient(created.universalUrl, { headers: { "User-Agent": "Shadowrocket/2100" } });
      expect(phone.status).toBe(200);
      const nodes = await phone.text();
      for (const name of residentialNodeNames) expect(nodes).toContain(`#${encodeURIComponent(name)}`);
      expect(nodes).toContain("vless://");
      expect(nodes).not.toMatch(/support-x25519mlkem768|allowInsecure=1/);
    }
    const paired = await fetchClient(created.shadowrocketConfigUrl);
    const config = await paired.text();
    expect(paired.status).toBe(200);
    expect(config).not.toContain("[Proxy Group]");
    expect(config).toContain("FINAL,PROXY");
    expect((await post("/api/rola/chains", { ...input, residentialNodeNames: null })).status).toBe(400);
    expect((await post("/api/rola/chains", { ...input, residentialNodeNames: ["Missing"] })).status).toBe(422);
  });

  it("keeps two distinct homes in refreshes, country choices and paired mobile resources", async () => {
    const p = await preview();
    const first = { ...exit, name: "First US Home" };
    const second = { ...exit, name: "Second US Home", server: "198.51.100.2", port: 1081, account: "second-user", password: "second-pass" };
    const response = await post("/api/rola/chains", { baseId: p.baseId, exit: first, additionalExits: [second],
      connectionMode: "direct", groupName: "Homes", rules, dns });
    expect(response.status).toBe(201);
    const created = await response.json<{ url: string; universalUrl: string; shadowrocketConfigUrl: string }>();
    expect(JSON.stringify(created)).not.toMatch(/second-pass|test-password/);
    for (let attempt = 0; attempt < 2; attempt++) {
      const profile = parse(await (await fetchClient(created.url)).text());
      expect(profile.proxies.slice(-2)).toMatchObject([{ name: first.name, password: first.password }, { name: second.name, password: second.password }]);
      expect(profile["proxy-groups"].find((group: { name: string }) => group.name === "Homes").proxies).toEqual([first.name, second.name]);
      expect(profile.rules.slice(0, 2)).toEqual(["AND,((DOMAIN,residential.example),(DST-PORT,9004)),DIRECT", "AND,((IP-CIDR,198.51.100.2/32,no-resolve),(DST-PORT,1081)),DIRECT"]);
      const country = profile["proxy-groups"].find((group: { name: string }) => group.name === "🇺🇸 美国");
      for (const name of [first.name, second.name]) expect(new RegExp(country.filter.replace(/^\(\?i\)/u, ""), "iu").test(name)).toBe(true);
    }
    const phone = await fetchClient(created.universalUrl, { headers: { "User-Agent": "Shadowrocket/2100" } });
    const nodes = await phone.text();
    expect(nodes).toContain("#First%20US%20Home");
    expect(nodes).toContain("#Second%20US%20Home");
    const paired = await fetchClient(created.shadowrocketConfigUrl);
    expect(paired.status).toBe(200);
    const config = await paired.text();
    expect(config).not.toContain("[Proxy Group]");
    expect(config).toContain("FINAL,PROXY");
    expect(config).not.toMatch(/DST-PORT|second-pass|test-password/);
  });

  it("rejects malformed, repeated or unsupported additional exits instead of publishing partial output", async () => {
    const p = await preview();
    const first = { ...exit, name: "First US Home" };
    const second = { ...exit, name: "Second US Home", server: "198.51.100.2", account: "second-user", password: "second-pass" };
    const input = { baseId: p.baseId, exit: first, connectionMode: "direct", rules, dns };
    for (const additionalExits of [null, {}, [null], Array(8).fill(second), [{ ...first, name: "Duplicate access" }], [{ ...second, name: first.name }], [{ ...second, additionalExits: [] }]]) {
      const rejected = await post("/api/rola/chains", { ...input, additionalExits });
      expect(rejected.status).toBe(400);
      expect(await rejected.text()).not.toMatch(/second-pass|test-password/);
    }
    expect((await post("/api/rola/chains", { ...input, connectionMode: "chain", upstreamNode: "Airport", additionalExits: [second] })).status).toBe(400);
  });

  it.each([undefined, "Example ISP"])("preserves platform %s, region and IP names in cloud refreshes and the paired phone config", async platform => {
    const p = await preview();
    const metadata = { exitIp: "203.0.113.24", region: "美国 Las Vegas", platform };
    const input = { baseId: p.baseId, exit: { ...exit, ...metadata }, connectionMode: "direct", rules, dns };
    const response = await post("/api/rola/chains", input);
    expect(response.status).toBe(201);
    const created = await response.json<{ url: string; universalUrl: string; shadowrocketConfigUrl: string }>();
    const profile = parse(await (await fetchClient(created.url)).text());
    const name = `[${platform ?? "Rola"}] 美国 Las Vegas · 203.0.113.24`;
    expect(profile.proxies.at(-1)).toMatchObject({ name, server: exit.server, port: exit.port });
    const phone = await fetchClient(created.universalUrl, { headers: { "User-Agent": "Shadowrocket/2100" } });
    expect(await phone.text()).toContain(`#${encodeURIComponent(name)}`);
    const paired = await fetchClient(created.shadowrocketConfigUrl);
    expect(paired.status).toBe(200);
    const pairedConfig = await paired.text();
    expect(pairedConfig).not.toContain(name);
    expect(pairedConfig).not.toContain("[Proxy Group]");
    expect(pairedConfig).toContain("FINAL,PROXY");
    const invalid = await post("/api/rola/chains", { ...input, exit: { ...exit, exitIp: metadata.exitIp } });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: "invalid_rola_exit_metadata", message: "出口 IP 和区域需同时填写；都留空时保留原备注。" });
    const unsafe = await post("/api/rola/chains", { ...input, exit: { ...exit, ...metadata, platform: "Bad[Rule]" } });
    expect(unsafe.status).toBe(400);
    expect(await unsafe.json()).toMatchObject({ error: "invalid_rola_exit_metadata" });
  });

  // Twelve sequential Worker requests exercise KV-backed rendering, recovery and revocation in one lifecycle.
  it.each(["socks5", "http"])("adapts one direct %s link for Mihomo and Shadowrocket without dropping residential nodes or quota", { timeout: 15_000 }, async protocol => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(uri, { headers: { "Subscription-Userinfo": "upload=10; download=20; total=100; expire=0" } }));
    try {
      const p = await preview({ sources: [{ type: "subscription", name: "Airport", value: "https://provider.example/sub" }] });
      const response = await post("/api/rola/chains", { baseId: p.baseId, exit: { ...exit, protocol, name: "US Home" }, rules, dns,
        connectionMode: "direct", groupName: "🇺🇸 美国家宽", policyGroup: "AI" });
      expect(response.status).toBe(201);
      const created = await response.json<{ url: string; universalUrl: string; shadowrocketConfigUrl: string; revokeToken: string }>();
      expect(created.universalUrl).toMatch(/\/r\/[\w-]{32}$/u);
      for (const ua of ["ClashParty/2.0", "ClashVerge/2.0", "FlClash/0.8"]) {
        const mihomo = await fetchClient(created.universalUrl, { headers: { "User-Agent": ua } });
        expect(mihomo.headers.get("x-subscription-target")).toBe("mihomo-config");
        const profile = parse(await mihomo.text());
        expect(profile.proxies.at(-1)).toMatchObject({ type: protocol, "dialer-proxy": "DIRECT" });
        expect(profile.rules[0]).toBe("AND,((DOMAIN,residential.example),(DST-PORT,9004)),DIRECT");
        const us = profile["proxy-groups"].find((group: { name: string }) => group.name === "🇺🇸 美国");
        expect(us.proxies ?? []).not.toContain("US Home");
        expect(new RegExp(us.filter.replace(/^\(\?i\)/u, ""), "iu").test("US Home")).toBe(true);
      }
      const phone = await fetchClient(created.universalUrl, { headers: { "User-Agent": "Shadowrocket/2100" } });
      expect(phone.status).toBe(200);
      expect(phone.headers.get("content-type")).toContain("text/plain");
      expect(phone.headers.get("vary")).toBe("User-Agent");
      expect(phone.headers.get("subscription-userinfo")).toBe("upload=10; download=20; total=100; expire=0");
      expect(await phone.text()).toContain(`${protocol}://test-account:test-password@residential.example:9004#US%20Home`);
      const config = await fetchClient(created.shadowrocketConfigUrl);
      expect(config.status).toBe(200);
      const conf = await config.text();
      expect(conf).not.toContain("[Proxy Group]");
      expect(conf).not.toContain("US Home");
      expect(conf).toContain("DOMAIN-SUFFIX,claude.ai,PROXY");
      expect(conf).toContain("FINAL,PROXY");
      expect(conf).toContain("AND,((DOMAIN-SUFFIX,claude.ai),(PROTOCOL,UDP)),REJECT");
      for (const key of ["dns-server", "direct-dns-server", "fallback-dns-server"]) {
        expect(conf.split("\n").find(line => line.startsWith(`${key} =`)))
          .toBe(`${key} = https://1.1.1.1/dns-query#proxy`);
      }
      expect(conf).not.toContain("#proxy=");
      expect(conf).not.toMatch(/test-password|airport-secret|NETWORK,UDP/);
      expect(conf).not.toContain("DST-PORT");
      const head = await fetchClient(created.universalUrl, { method: "HEAD", headers: { "User-Agent": "Shadowrocket/2100" } });
      expect(head.headers.get("x-subscription-target")).toBe("shadowrocket");
      expect(await head.text()).toBe("");
      await clearSourceCache();
      spy.mockRejectedValue(new Error("offline"));
      const recovered = await fetchClient(created.universalUrl, { headers: { "User-Agent": "Shadowrocket/2100" } });
      expect(recovered.headers.get("x-subscription-refresh-status")).toBe("last-good");
      expect(await recovered.text()).toContain(`${protocol}://`);
      expect((await fetchClient(`${created.universalUrl}?target=surge`)).status).toBe(422);
      expect((await post("/api/rola/revoke", { url: created.universalUrl, revokeToken: created.revokeToken })).status).toBe(200);
      expect((await fetchClient(created.url)).status).toBe(404);
    } finally { spy.mockRestore(); }
  });

  it("does not flatten an airport-first-hop chain into a direct mobile subscription", async () => {
    const created = await create();
    const universal = created.url.replace(/\.yaml$/u, "");
    const phone = await fetchClient(universal, { headers: { "User-Agent": "Shadowrocket/2100" } });
    expect(phone.status).toBe(422);
    expect((await phone.json<{ error: string }>()).error).toBe("rola_mobile_chain_unsupported");
    expect((await fetchClient(universal)).status).toBe(200);
  });

  it("requires explicit direct mode and retains a separate named residential group", async () => {
    const p = await preview();
    const input = { baseId: p.baseId, exit, rules, dns, connectionMode: "direct", groupName: "🇺🇸 美国家宽", policyGroup: "AI" };
    const created = await post("/api/rola/chains", input);
    expect(created.status).toBe(201);
    const data = await created.json<{ url: string; summary: { connectionMode: string } }>();
    expect(data.summary.connectionMode).toBe("direct");
    const response = await fetchClient(data.url);
    expect(response.status).toBe(200);
    const profile = parse(await response.text());
    for (const name of ["🖐 手动选择", "🌐 全局", "🤖 AI"]) {
      expect(profile["proxy-groups"].find((group: { name: string }) => group.name === name).proxies).toContain(input.groupName);
    }
    expect(profile.rules[2]).toBe("DOMAIN-SUFFIX,claude.ai,🧠 Claude");
    expect(profile.proxies.at(-1)["dialer-proxy"]).toBe("DIRECT");
    expect(profile["proxy-groups"][2]).toMatchObject({ name: input.groupName, "empty-fallback": "REJECT", proxies: ["ROLA-RESIDENTIAL"] });
    expect((await post("/api/rola/chains", { ...input, connectionMode: "automatic" })).status).toBe(422);
    expect((await post("/api/rola/chains", { ...input, connectionMode: undefined })).status).toBe(422);
  });

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
      const refreshed = await fetchClient(url);
      expect(refreshed.status).toBe(200);
      expect(refreshed.headers.get("subscription-userinfo")).toBe("upload=10; download=20; total=100");
      expect(decodeURIComponent(refreshed.headers.get("content-disposition") || "")).toContain("Test.yaml");
      expect(refreshed.headers.get("x-subscription-synced-at")).toBe(syncedAt);
      expect(refreshed.headers.get("x-subscription-refresh-status")).toBe("sync-overdue");
      expect(parse(await refreshed.text()).proxies.at(-1)).toMatchObject({ "dialer-proxy": "Airport", type: "socks5" });
      const cachedOverdue = await fetchClient(url);
      expect(cachedOverdue.headers.get("x-subscription-render-cache")).toBe("hit");
      expect(cachedOverdue.headers.get("x-subscription-refresh-status")).toBe("sync-overdue");
      expect(cachedOverdue.headers.get("x-subscription-last-success")).toBe(syncedAt);
      const update = {
        id: syncId, managementToken: "test-token-".padEnd(32, "0"), target: "clash-party-config",
        config: { sources: [{ type: "subscription", value: "https://airport.example/private-source" }] },
        snapshot: { readAt: new Date(Date.now() - 120_000).toISOString(), sources: [{ content: uri.replace("airport-secret", "updated-secret"), metadata: { profileName: "Airport", usage: { upload: "10", download: "40", total: "100" } } }] },
      };
      expect((await post("/api/subscriptions/sync", update)).status).toBe(200);
      const updated = await fetchClient(url);
      expect(updated.headers.get("subscription-userinfo")).toContain("download=40");
      expect(parse(await updated.text()).proxies[0].password).toBe("updated-secret");
      const cached = await fetchClient(url, { method: "HEAD" });
      expect(cached.headers.get("x-subscription-refresh-status")).toBe("cached");
      expect(cached.headers.get("subscription-userinfo")).toContain("download=40");
      expect(await cached.text()).toBe("");
      const sourceKey = `subscription:${syncId}`;
      const sourceRecord = await env.SUBSCRIPTIONS.get(sourceKey);
      expect(sourceRecord).not.toBeNull();
      await env.SUBSCRIPTIONS.delete(sourceKey);
      expect((await fetchClient(url)).status).toBe(404);
      await env.SUBSCRIPTIONS.put(sourceKey, sourceRecord!);
      update.snapshot.readAt = new Date().toISOString();
      update.snapshot.sources[0].content = uri.replace("#Airport", "#Withdrawn");
      expect((await post("/api/subscriptions/sync", update)).status).toBe(200);
      expect((await fetchClient(url)).status).toBe(422);
      expect(spy).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });

  it("refreshes the same cached synchronized URL when residential settings change", async () => {
    const relayName = "Relay";
    const syncedAt = new Date(Date.now() - 120_000).toISOString();
    const synchronized = await post("/api/subscriptions/sync", {
      id: crypto.randomUUID().replaceAll("-", "").slice(0, 16), managementToken: "test-token-".padEnd(32, "0"), target: "clash-party-config",
      config: { sources: [{ type: "subscription", value: "https://airport.example/private-source" }] },
      snapshot: { readAt: syncedAt, sources: [{ content: `${uri}\ntrojan://relay-secret@relay.example:443#${encodeURIComponent(relayName)}`, metadata: {} }] },
    });
    expect(synchronized.status).toBe(201);
    const link = await synchronized.json<{ url: string }>();
    const p = await preview({ sources: [{ type: "subscription", value: link.url }] });
    const response = await post("/api/rola/chains", {
      baseId: p.baseId, exit, connectionMode: "direct", groupName: "Homes", residentialNodeNames: [], rules, dns,
    });
    expect(response.status).toBe(201);
    const { url } = await response.json<{ url: string }>();
    const first = await fetchClient(url);
    expect(first.status).toBe(200);
    expect(parse(await first.text())["proxy-groups"].find((group: { name: string }) => group.name === "Homes").proxies)
      .toEqual(["ROLA-RESIDENTIAL"]);
    expect((await fetchClient(url)).headers.get("x-subscription-render-cache")).toBe("hit");

    const chainId = new URL(url).pathname.split("/").at(-1)!.replace(/\.yaml$/u, "");
    const key = `rola:chain:${chainId}`;
    const chain = await env.SUBSCRIPTIONS.get<{ settings: Record<string, unknown> }>(key, "json");
    expect(chain).not.toBeNull();
    chain!.settings.residentialNodeNames = [relayName];
    await env.SUBSCRIPTIONS.put(key, JSON.stringify(chain));

    const updated = await fetchClient(url);
    expect(updated.status).toBe(200);
    expect(parse(await updated.text())["proxy-groups"].find((group: { name: string }) => group.name === "Homes").proxies)
      .toEqual(["ROLA-RESIDENTIAL", relayName]);
    expect(updated.headers.get("x-subscription-render-cache")).toBeNull();
    expect(updated.headers.get("x-subscription-synced-at")).toBe(syncedAt);
    const cached = await fetchClient(url);
    expect(cached.headers.get("x-subscription-render-cache")).toBe("hit");
    expect(parse(await cached.text())["proxy-groups"].find((group: { name: string }) => group.name === "Homes").proxies)
      .toEqual(["ROLA-RESIDENTIAL", relayName]);

    chain!.settings.residentialNodeNames = ["Missing"];
    await env.SUBSCRIPTIONS.put(key, JSON.stringify(chain));
    expect((await fetchClient(url)).status).toBe(422);
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
      const refreshed = await fetchClient(created.url);
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
    const response = await fetchClient(created.url);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const profile = parse(await response.text());
    expect(profile.proxies.at(-1)).toMatchObject({ type: "socks5", username: exit.account, password: exit.password, "dialer-proxy": "Airport", udp: false });
    expect(profile.rules[0]).toBe("AND,((DOMAIN-SUFFIX,claude.ai),(NETWORK,UDP)),REJECT");
    expect(profile.dns["nameserver-policy"]["+.claude.ai"]).toEqual(["https://1.1.1.1/dns-query#🧠 Claude"]);
    const head = await fetchClient(created.url, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect((await post("/api/rola/revoke", { url: created.url, revokeToken: "bad" })).status).toBe(403);
    expect((await post("/api/rola/revoke", { url: created.url, revokeToken: created.revokeToken })).status).toBe(200);
    expect((await fetchClient(created.url)).status).toBe(404);
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
      const refreshed = await fetchClient(created.url);
      expect(refreshed.headers.get("subscription-userinfo")).toBe("upload=15; download=20; total=100; expire=0");
      content = uri.replace("#Airport", "#Changed");
      await clearSourceCache();
      expect((await fetchClient(created.url)).status).toBe(422);
      status = 403;
      await clearSourceCache();
      const failed = await fetchClient(created.url);
      expect(failed.status).toBe(200);
      expect(failed.headers.get("x-subscription-refresh-status")).toBe("last-good");
      expect(parse(await failed.text()).proxies.at(-1)["dialer-proxy"]).toBe("Airport");
    } finally { spy.mockRestore(); }
  });

  it("supports explicit uploaded snapshots without falsely advertising refreshed quota", async () => {
    const created = await create({ snapshot: base, sources: undefined });
    expect(created.sourceMode).toBe("snapshot");
    const response = await fetchClient(created.url);
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
