import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { parse, stringify } from "yaml";

import { createRolaTemplate, parseRolaSettings, prepareRolaProfile, rolaRulePaths } from "../src/local/rola";
import { parseRolaUsage, readRolaUsage } from "../src/local/rola-usage";

const settings = {
  ...createRolaTemplate(["DOMAIN-SUFFIX,claude.ai\nDOMAIN,anthropic.auth0.com"]),
  protocol: "socks5", server: "residential.example", port: 1080,
  account: "demo", password: "demo:p@ss", upstreamNode: "Airport",
};
const source = `# Keep the user's comment
mode: rule
mixed-port: 7890
ipv6: false
custom-field: keep-me
tun: {enable: false, strict-route: false}
sniffer: {enable: false}
dns:
  enable: true
  nameserver: [https://1.1.1.1/dns-query#Airport]
  proxy-server-nameserver: [system] # Bootstrap must not depend on Rola
  use-system-hosts: false
proxies:
  - name: Airport
    type: vless
    server: airport.example
    port: 443
    uuid: 00000000-0000-4000-8000-000000000000
    tls: true
    network: ws
    ws-opts: {path: /route, headers: {Host: transport.example}}
    custom-field: preserve-node-field
proxy-groups:
  - name: AUTO
    type: url-test
    include-all: true
    exclude-filter: '(?i)expired'
    url: https://cp.cloudflare.com/generate_204
    interval: 300
  - name: MANUAL
    type: select
    include-all-proxies: true
  - name: OTHER
    type: select
    proxies: [DIRECT]
rules:
  # Preserve original rule order
  - DOMAIN-SUFFIX,example.org,DIRECT
  - MATCH,AUTO
`;

describe("local Rola preparation", () => {
  it("reuses the published domain rules and stable, documented session syntax", () => {
    const template = createRolaTemplate(rolaRulePaths.map(path => readFileSync(new URL(`../public/${path}`, import.meta.url), "utf8")));
    expect(template.rules).toContain("DOMAIN,anthropic.auth0.com");
    expect(template.rules).toContain("DOMAIN-SUFFIX,oaistatic.com");
    expect(parseRolaSettings({ ...settings, rules: template.rules }).username).toBe("demo_main-country-us-sessiontime-120");
    expect(parseRolaSettings(settings).username).toBe(parseRolaSettings(settings).username);
  });

  it.each(["socks5", "http"])("builds a fixed %s chain, preserves fields/comments and excludes metered nodes from include-all groups", protocol => {
    const { profile, summary } = prepareRolaProfile(source, { ...settings, protocol });
    const original = parse(source);
    const output = parse(profile);
    expect(output.proxies[0]).toEqual(original.proxies[0]);
    expect(output.proxies[1]).toMatchObject({ type: protocol, password: settings.password, udp: false, "dialer-proxy": "Airport" });
    expect(output["proxy-groups"][0]["exclude-filter"]).toBe("(?i)expired|^ROLA-RESIDENTIAL$");
    expect(output["proxy-groups"][1]["exclude-filter"]).toBe("^ROLA-RESIDENTIAL$");
    expect(output["proxy-groups"][2]).toEqual(original["proxy-groups"][2]);
    expect(output["proxy-groups"].at(-1)).toMatchObject({ name: "ROLA", type: "select", proxies: ["ROLA-RESIDENTIAL"], "empty-fallback": "REJECT", "disable-udp": true });
    expect(output.rules.slice(0, 2)).toEqual(["AND,((DOMAIN-SUFFIX,claude.ai),(NETWORK,UDP)),REJECT", "DOMAIN-SUFFIX,claude.ai,ROLA"]);
    expect(output.rules.slice(-2)).toEqual(original.rules);
    expect(output.dns["nameserver-policy"]["+.claude.ai"]).toEqual(settings.dns.map(url => `${url}#ROLA`));
    expect(output.dns["nameserver-policy"]["anthropic.auth0.com"]).toBeDefined();
    expect(output.dns.nameserver).toEqual(original.dns.nameserver);
    expect(output.dns["proxy-server-nameserver"]).toEqual(["system"]);
    expect(output.ipv6).toBe(false);
    expect(output.dns.ipv6).toBe(false);
    expect(output["custom-field"]).toBe("keep-me");
    expect(output.tun).toEqual(original.tun);
    expect(output.sniffer).toEqual(original.sniffer);
    expect(profile).toContain("# Keep the user's comment");
    expect(profile).toContain("# Preserve original rule order");
    expect(profile).toContain("# Bootstrap must not depend on Rola");
    expect(JSON.stringify(summary)).not.toContain(settings.password);
    expect(JSON.stringify(summary)).not.toContain("demo_main");
  });

  it.each(["AUTO", "DIRECT", "COMPATIBLE", "missing"])("rejects non-concrete upstream %s", upstreamNode => {
    expect(() => prepareRolaProfile(source, { ...settings, upstreamNode })).toThrow("concrete encrypted upstream");
  });

  it.each([
    { tls: false }, { "skip-cert-verify": true }, { "dialer-proxy": "AUTO" }, { type: "direct" },
    { type: "ss", cipher: "none" }, { type: "vmess", cipher: "zero" },
  ])("rejects unsafe or already chained first hops: %j", changes => {
    const base = parse(source);
    Object.assign(base.proxies[0], changes);
    expect(() => prepareRolaProfile(stringify(base), settings)).toThrow("concrete encrypted upstream");
  });

  it("rejects empty/provider-only bases, conflicting DNS and recursive bootstrap", () => {
    const empty = parse(source);
    empty.proxies = [];
    expect(() => prepareRolaProfile(stringify(empty), settings)).toThrow("concrete encrypted upstream");
    expect(() => prepareRolaProfile("proxies: []", settings)).toThrow();
    const dns = parse(source);
    dns.dns["proxy-server-nameserver"] = ["https://1.1.1.1/dns-query#ROLA"];
    expect(() => prepareRolaProfile(stringify(dns), settings)).toThrow("independent");
    dns.dns["proxy-server-nameserver"] = ["system"];
    dns.dns["nameserver-policy"] = { "+.claude.ai": "system" };
    expect(() => prepareRolaProfile(stringify(dns), settings)).toThrow("overlaps");
    expect(() => prepareRolaProfile(source, { ...settings, server: "proxy.claude.ai" })).toThrow("overlap");
    const candidate = prepareRolaProfile(source, settings).profile;
    expect(() => prepareRolaProfile(candidate, settings)).toThrow("reserved Rola name");
  });

  it.each([
    { sessionMinutes: 0 }, { sessionMinutes: 121 }, { sessionMinutes: 1.5 },
    { sessionId: "f-1" }, { account: "demo-country-us-f-1" }, { protocol: "https" },
    { rules: ["MATCH,DIRECT"] }, { rules: ["DOMAIN,claude.ai,DIRECT"] },
    { dns: ["https://dns.example/dns-query"] }, { server: "https://residential.example" },
  ])("rejects ambiguous parameters without logging credentials: %j", changes => {
    expect(() => prepareRolaProfile(source, { ...settings, ...changes })).toThrow();
    try { prepareRolaProfile(source, { ...settings, ...changes }); }
    catch (error) { expect(String(error)).not.toContain(settings.password); }
  });
});

describe("Rola quota is a separate read-only account view", () => {
  const payload = { code: 0, data: { residential: { total_traffic: 1024, cost_traffic: 100, status: "active", expire_time: "2026-11-01 08:00:00" } } };
  it("keeps byte units, expiry text and each product separate", () => {
    const result = parseRolaUsage({ ...payload, data: { ...payload.data, mobile: { total_traffic: 512, cost_traffic: 600, expire_time: null } } });
    expect(result).toEqual([
      { product: "residential", totalBytes: 1024, usedBytes: 100, remainingBytes: 924, status: "active", expiresAtProviderText: "2026-11-01 08:00:00" },
      { product: "mobile", totalBytes: 512, usedBytes: 600, remainingBytes: 0, status: "unknown", expiresAtProviderText: null },
    ]);
    expect(parseRolaUsage({ code: 0, data: {} })).toEqual([]);
    expect(parseRolaUsage({ code: 0, data: { residential: {} } })[0]).toMatchObject({ totalBytes: null, usedBytes: null, remainingBytes: null });
    expect(() => parseRolaUsage({ code: 0, data: { residential: { total_traffic: -1 } } })).toThrow("byte counter");
    expect(() => parseRolaUsage({ code: 0, data: { residential: { total_traffic: Number.MAX_SAFE_INTEGER + 1 } } })).toThrow("byte counter");
  });

  it("sends the token only to the fixed package endpoint, rejects redirects and bounds the request", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload));
    const result = await readRolaUsage("private-test-token", request);
    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith("https://api2.rola-ip.co/api/users/traffic/packages/current", {
      method: "GET", headers: { "Api-Token": "private-test-token", Accept: "application/json" },
      redirect: "error", signal: expect.any(AbortSignal),
    });
    expect(result.packages[0].remainingBytes).toBe(924);
    expect(JSON.stringify(result)).not.toContain("private-test-token");
    expect(result).not.toHaveProperty("Subscription-Userinfo");
  });

  it("does not retry denial or log untrusted error bodies", async () => {
    const denied = vi.fn<typeof fetch>().mockResolvedValue(new Response("private-test-token", { status: 403 }));
    await expect(readRolaUsage("private-test-token", denied)).rejects.toThrow("HTTP 403");
    expect(denied).toHaveBeenCalledOnce();
    await expect(readRolaUsage("private-test-token", vi.fn<typeof fetch>().mockRejectedValue(new Error("private-test-token")))).rejects.toThrow("request failed");
    await expect(readRolaUsage("private-test-token", vi.fn<typeof fetch>().mockResolvedValue(new Response("x".repeat(1024 * 1024 + 1))))).rejects.toThrow("exceeds");
    await expect(readRolaUsage("private-test-token", vi.fn<typeof fetch>().mockResolvedValue(Response.json({ code: 1, message: "private-test-token" })))).rejects.toThrow("check the account console");
  });
});
