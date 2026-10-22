import { exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearSourceCache } from "./helpers/source-cache";
import { parse } from "yaml";
import { isVersionInfo } from "../src/config/build-info";
import type { RulePreview } from "../src/config/rule-preview";
import { createRuleSet, matchUrl } from "../src/app/lib/rule-matcher";

beforeEach(clearSourceCache);

type CreatedSubscription = {
  nodeStats: {
    output: number | null;
    read: number | null;
    skipped: number | null;
  };
  profileName: string;
  sourceMode: string;
  target: string;
  usage: {
    combined: {
      upload: string;
      download: string;
      total: string;
      expire?: string;
    } | null;
    sources: Array<{
      name: string;
      status: "available" | "missing";
      usage?: {
        upload: string;
        download: string;
        total: string;
        expire?: string;
      };
    }>;
  };
  url: string;
  universalUrl: string;
  nodeUrl?: string;
};

function nodeUri(name: string, host: string, password: string): string {
  const userInfo = btoa(`aes-128-gcm:${password}`);
  return `ss://${userInfo}@${host}:8388#${name}`;
}

function requestBody(overrides: Record<string, unknown> = {}) {
  return {
    name: "Flacier",
    nodeSettings: {
      includePattern: "",
      excludePattern: "",
      renameRules: [],
      sortMode: "source",
    },
    sources: [{
      name: "节点 1",
      type: "node",
      value: nodeUri("US-01", "us.example.com", "private-node-password"),
    }],
    target: "mihomo-config",
    ...overrides,
  };
}

async function createSubscription(
  overrides: Record<string, unknown> = {},
): Promise<{ data: CreatedSubscription; response: Response }> {
  const response = await exports.default.fetch("https://example.com/api/subscriptions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody(overrides)),
  });
  const data = await response.json<CreatedSubscription>();
  return { data, response };
}

describe("Worker entrypoint", () => {
  it("serves third-party /sub Clash requests as YAML and expands rules without returning the SPA", async () => {
    const template = "[custom]\nruleset=Select,https://rules.example/list\nruleset=Select,[]FINAL\ncustom_proxy_group=Select`select`.*\nenable_rule_generator=true\noverwrite_original_rules=true";
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async value => new Response(String(value).includes(".ini") ? template : "DOMAIN-SUFFIX,example.net\nIP-CIDR,203.0.113.0/24,no-resolve"));
    try {
      const query = new URLSearchParams({ target: "clash", url: "socks5://user:secret@home.example:9004#Home", config: "https://rules.example/custom.ini", insert: "False", list: "False", new_name: "True", expand: "True", fdn: "False", udp: "True" });
      const response = await exports.default.fetch(`https://example.com/sub?${query}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("yaml");
      const profile = parse(await response.text());
      expect(profile.proxies[0]).toMatchObject({ type: "socks5", username: "user", password: "secret" });
      expect(profile.rules).toEqual(["DOMAIN-SUFFIX,example.net,Select", "IP-CIDR,203.0.113.0/24,Select,no-resolve", "MATCH,Select"]);
      expect(profile["rule-providers"]).toBeUndefined();
      expect((await exports.default.fetch(`https://example.com/sub?${query}&script=true`)).status).toBe(400);
    } finally { spy.mockRestore(); }
  });

  it("expands the Flacier preset on /sub while keeping the large domestic list as a provider", async () => {
    const query = new URLSearchParams({ target: "clash", url: "socks5://user:secret@home.example:9004#Home", expand: "True" });
    const response = await exports.default.fetch(`https://example.com/sub?${query}`);
    expect(response.status).toBe(200);
    const profile = parse(await response.text());
    expect(Object.keys(profile["rule-providers"])).toEqual(["china-domains"]);
    expect(profile["rule-providers"]["china-domains"]).toMatchObject({ behavior: "domain", url: "https://rules.flacier.com/rules/mihomo/china-domains.txt" });
    expect(profile.rules).toContain("RULE-SET,china-domains,DIRECT");
    expect(profile.rules.filter((rule: string) => rule.startsWith("RULE-SET,"))).toEqual(["RULE-SET,china-domains,DIRECT"]);
  });

  it("does not erase a failed source from a merged subscription or retain legitimately removed nodes", async () => {
    let content = nodeUri("First", "a.example", "one") + "\n" + nodeUri("Second", "b.example", "two");
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(content, { headers: { "Profile-Title": "Airport A" } }));
    try {
      const { data } = await createSubscription({ sources: [
        { type: "subscription", value: "https://provider.example/sub" },
        { type: "node", value: "socks5://user:password@home.example:9004#Home" },
      ] });
      expect(data.usage.sources[0].name).toBe("Airport A");
      content = "proxies: []";
      await clearSourceCache();
      const failed = await exports.default.fetch(data.url);
      expect(failed.headers.get("x-subscription-refresh-status")).toBe("last-good");
      expect(parse(await failed.text()).proxies).toHaveLength(3);
      content = nodeUri("First", "a.example", "one");
      const success = await exports.default.fetch(data.url);
      expect(success.headers.get("x-subscription-refresh-status")).toBe("fresh");
      expect(parse(await success.text()).proxies).toHaveLength(2);
    } finally { spy.mockRestore(); }
  });
  it("reports deduplication separately from filtering and incompatible nodes", async () => {
    const { data } = await createSubscription({
      nodeSettings: { includePattern: "US", excludePattern: "", renameRules: [], sortMode: "source" },
      sources: [
        { type: "node", name: "one", value: nodeUri("US-01", "us.example", "secret") },
        { type: "node", name: "duplicate", value: nodeUri("US-02", "us.example", "secret") },
        { type: "node", name: "filtered", value: nodeUri("JP-01", "jp.example", "secret") },
      ],
    });
    expect(data.nodeStats).toEqual({ read: 3, output: 1, skipped: 0, deduplicated: 1 });
  });
  it("publishes a paired Shadowrocket configuration and node subscription with real quota headers", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => (
      new Response(nodeUri("US-01", "us.example.com", "secret"), {
        headers: { "Subscription-Userinfo": "upload=10; download=20; total=100; expire=0" },
      })
    ));
    try {
      const { data, response } = await createSubscription({
        target: "shadowrocket-config",
        sources: [{ type: "subscription", name: "机场", value: "https://provider.example/sub" }],
      });
      expect(response.status).toBe(201);
      expect(data.nodeStats.output).toBe(1);
      expect(data.nodeUrl).toBe(`${data.universalUrl}/shadowrocket`);
      const config = await exports.default.fetch(data.url);
      expect(config.headers.get("content-disposition")).toContain(".conf");
      const pairedConfig = await config.text();
      expect(pairedConfig).toContain("FINAL,PROXY");
      expect(pairedConfig).not.toContain("[Proxy Group]");
      const nodes = await exports.default.fetch(data.nodeUrl!);
      expect(nodes.headers.get("subscription-userinfo")).toBe("upload=10; download=20; total=100; expire=0");
      expect(nodes.headers.get("content-disposition")).toContain(".txt");
      expect(await nodes.text()).toMatch(/^ss:\/\//u);
    } finally { fetchSpy.mockRestore(); }
  });

  it("counts repeated subscription URLs once and refreshes quota even when nodes do not change", async () => {
    let upload = 10;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => (
      new Response(nodeUri("US-01", "us.example.com", "secret"), {
        headers: { "Subscription-Userinfo": `upload=${upload}; download=20; total=100` },
      })
    ));
    try {
      const { data, response } = await createSubscription({ sources: [
        { type: "subscription", name: "机场", value: "https://provider.example/sub" },
        { type: "subscription", name: "同一机场", value: "https://provider.example/sub" },
        { type: "node", name: "家宽", value: "socks5://home:pass@home.example:1080#home" },
      ] });
      expect(response.status).toBe(201);
      expect(data.usage.combined?.total).toBe("100");
      expect(data.nodeStats.output).toBe(2);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const first = await exports.default.fetch(data.url);
      upload = 15;
      await clearSourceCache();
      const next = await exports.default.fetch(data.url, { headers: { "If-None-Match": first.headers.get("etag")! } });
      expect(next.status).toBe(200);
      expect(next.headers.get("subscription-userinfo")).toBe("upload=15; download=20; total=100");
      expect(next.headers.get("etag")).not.toBe(first.headers.get("etag"));
    } finally { fetchSpy.mockRestore(); }
  });
  it("previews the same ordered Flacier rules without a subscription or KV write", async () => {
    const response = await exports.default.fetch("https://example.com/api/rules/preview", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rulePreset: "flacier" }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const preview = await response.json<RulePreview>();
    expect(preview.fingerprint).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(preview.ruleSets.slice(-3).map(({ content, policy }) => ({ content, policy }))).toEqual([
      { content: "MATCH", policy: "DEFAULT" },
      { content: "NETWORK,UDP", policy: "AUTO" },
      { content: "NETWORK,UDP", policy: "REJECT" },
    ]);
    expect(preview.ruleSets.some(item => item.content.startsWith("PROCESS-NAME-REGEX"))).toBe(true);
    expect(preview.ruleSets.slice(0, 15).map(({ content, policy }) => ({ content, policy }))).toEqual([
      { content: "PROCESS-NAME,ToDesk", policy: "DIRECT" },
      { content: "PROCESS-NAME,ToDesk_Service", policy: "DIRECT" },
      { content: "PROCESS-NAME,ToDesk_Session", policy: "DIRECT" },
      { content: "PROCESS-NAME,ToDesk_Session_Proxy", policy: "DIRECT" },
      { content: "PROCESS-NAME,ToDesk_Screenwall_Helper", policy: "DIRECT" },
      { content: "PROCESS-NAME,ToDesk_XPCHelper", policy: "DIRECT" },
      { content: "PROCESS-NAME,ToDesk.exe", policy: "DIRECT" },
      { content: "PROCESS-NAME,ToDesk_Service.exe", policy: "DIRECT" },
      { content: "PROCESS-NAME,WeChat", policy: "DIRECT" },
      { content: "PROCESS-NAME,WeChatAppEx", policy: "DIRECT" },
      { content: "PROCESS-NAME,WeChatAppEx Helper", policy: "DIRECT" },
      { content: "PROCESS-NAME,QQ", policy: "DIRECT" },
      { content: "PROCESS-NAME,QQ Helper", policy: "DIRECT" },
      { content: "PROCESS-NAME,NeteaseMusic", policy: "DIRECT" },
      { content: "PROCESS-NAME,NeteaseMusic Helper", policy: "DIRECT" },
    ]);
    const privateIpRules = preview.ruleSets.find(item => item.label === "private-ip");
    expect(privateIpRules).toMatchObject({ policy: "DIRECT" });
    expect(privateIpRules?.content).toContain("IP-CIDR,192.168.0.0/16,no-resolve");
    for (const label of ["tencent-messaging", "netease-music", "china-domains"]) {
      expect(preview.ruleSets.find(item => item.label === label)).toMatchObject({ policy: "DIRECT" });
    }
    expect(preview.ruleSets.find(item => item.label === "apple-system")).toMatchObject({ policy: "APPLE-SYSTEM" });
    expect(preview.ruleSets.find(item => item.label === "apple-download")).toMatchObject({ policy: "APPLE-DOWNLOAD" });
    const rules = preview.ruleSets.map(item => createRuleSet(item, item.content));
    expect(matchUrl("203.0.113.1", rules, { processName: "WeChat" })).toMatchObject({
      matched: true, policy: "DIRECT", rule: "PROCESS-NAME,WeChat",
    });
    expect(matchUrl("203.0.113.1", rules, { processName: "Firefox" })).toMatchObject({
      matched: false, policy: "DIRECT", rule: "GEOIP,CN", uncertain: expect.stringContaining("GEOIP"),
    });
    for (const host of ["www.douyin.com", "v3.douyinvod.com", "sns-webpic.xhscdn.com"]) {
      expect(matchUrl(host, rules, { processName: "Mobile" }), host).toMatchObject({ matched: true, policy: "DIRECT" });
    }
    for (const [host, policy] of [
      ["osxapps.itunes.apple.com", "APPLE-DOWNLOAD"], ["updates.cdn-apple.com", "APPLE-DOWNLOAD"],
      ["p17-buy.itunes.apple.com", "APPLE"], ["appleid.cdn-apple.com", "APPLE"], ["gateway.icloud.com", "APPLE-SYSTEM"],
      ["www.icloud.com", "ICLOUD"], ["music.apple.com", "APPLE-MEDIA"], ["guzzoni.apple.com", "APPLE-INTELLIGENCE"],
    ]) {
      expect(matchUrl(host, rules, { processName: "Mobile" }), host).toMatchObject({ matched: true, policy });
    }
  });

  it("uses Anthropic inbound IPs only as a no-resolve fallback after domain policies", async () => {
    const response = await exports.default.fetch("https://example.com/api/rules/preview", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rulePreset: "flacier" }),
    });
    expect(response.status).toBe(200);
    const preview = await response.json<RulePreview>();
    const rules = preview.ruleSets.map(item => createRuleSet(item, item.content));
    const context = { processName: "Firefox", groups: preview.groups };

    for (const host of ["claude.ai", "api.anthropic.com", "anthropic.auth0.com"]) {
      expect(matchUrl(host, rules, { ...context, processName: "codex" }), host).toMatchObject({ matched: true, policy: "CLAUDE" });
    }
    expect(matchUrl("api.openai.com", rules, { ...context, processName: "codex" })).toMatchObject({ matched: true, policy: "AI" });

    for (const ip of ["160.79.104.0", "160.79.105.255"]) {
      expect(matchUrl(`https://${ip}`, rules, context), ip).toMatchObject({
        matched: true, policy: "CLAUDE", rule: "IP-CIDR,160.79.104.0/23,no-resolve",
      });
    }
    for (const ip of ["160.79.103.255", "160.79.106.0", "160.79.111.255"]) {
      expect(matchUrl(`https://${ip}`, rules, context), ip).toMatchObject({
        matched: false, policy: "DIRECT", rule: "GEOIP,CN", uncertain: expect.stringContaining("GEOIP"),
      });
    }
    expect(matchUrl("unclassified.example", rules, context)).toMatchObject({
      matched: false, rule: "GEOIP,CN", policy: "DIRECT", uncertain: expect.stringContaining("GEOIP"),
    });
    expect(matchUrl("github.com", rules, { ...context, ip: "223.5.5.5" })).toMatchObject({
      matched: true, policy: "DEV",
    });
    expect(matchUrl("account.apple.com", rules, { ...context, ip: "160.79.104.1" })).toMatchObject({
      matched: true, policy: "APPLE", rule: "DOMAIN,account.apple.com",
    });
    const anthropicIp = preview.ruleSets.findIndex(set => set.label === "ai-anthropic-ip");
    expect(preview.ruleSets[anthropicIp]).toMatchObject({
      policy: "CLAUDE", content: expect.stringContaining("IP-CIDR6,2607:6bc0::/48,no-resolve"),
    });
    expect(preview.ruleSets.slice(anthropicIp + 1).map(set => set.label)).toEqual(["模板内规则", "默认规则", "模板内规则", "模板内规则"]);
  });

  it("rejects a private custom preview URL and unsupported HTTP methods", async () => {
    const request = await exports.default.fetch("https://example.com/api/rules/preview", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rulePreset: "custom", ruleTemplateUrl: "https://127.0.0.1/private" }),
    });
    expect(request.status).toBe(400);
    expect((await exports.default.fetch("https://example.com/api/rules/preview")).status).toBe(405);
  });
  it("allows the first-party UI to use another Flacier backend but rejects unrelated origins", async () => {
    const allowed = await exports.default.fetch("https://example.com/api/subscriptions", { method: "OPTIONS", headers: { Origin: "https://rules.flacier.com" } });
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://rules.flacier.com");
    const denied = await exports.default.fetch("https://example.com/api/subscriptions", { method: "POST", headers: { Origin: "https://unrelated.example" } });
    expect(denied.status).toBe(403);
  });
  it("allows loopback pages to create cloud bases without opening other APIs or unrelated origins", async () => {
    for (const origin of ["http://127.0.0.1:25500", "http://localhost:52879"]) {
      const allowed = await exports.default.fetch("https://example.com/api/subscriptions", { method: "OPTIONS", headers: { Origin: origin } });
      expect(allowed.status).toBe(204);
      expect(allowed.headers.get("access-control-allow-origin")).toBe(origin);
      const invalid = await exports.default.fetch("https://example.com/api/subscriptions", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: "{}" });
      expect(invalid.status).toBe(400);
      expect(invalid.headers.get("access-control-allow-origin")).toBe(origin);
      expect((await exports.default.fetch("https://example.com/api/version", { headers: { Origin: origin } })).status).toBe(403);
    }
    for (const origin of ["null", "http://127.0.0.1.evil.example:25500", "http://user@127.0.0.1:25500", "http://127.0.0.1:25500/path", "http://localhost", "http://192.168.1.2:25500"]) {
      expect((await exports.default.fetch("https://example.com/api/subscriptions", { method: "OPTIONS", headers: { Origin: origin } })).status).toBe(403);
    }
  });

  it.each(["clash-verge-config", "flclash-config"])("serves complete %s profiles with actual inline nodes", async (target) => {
    const { response, data } = await createSubscription({ target });
    expect(response.status).toBe(201);
    expect(data.nodeStats).toEqual({ read: 1, output: 1, skipped: 0 });
    const config = await exports.default.fetch(data.url);
    expect(config.headers.get("content-type")).toContain("yaml");
    const profile = parse(await config.text());
    expect(profile.proxies).toHaveLength(1);
    expect(profile["proxy-providers"]).toBeUndefined();
    expect(profile.dns.nameserver[0]).toContain("#DNS-PROXY");
  });

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

  it("serves this build's version metadata without caching and supports HEAD", async () => {
    const response = await exports.default.fetch("https://example.com/api/version");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const version: unknown = await response.json();
    expect(isVersionInfo(version)).toBe(true);
    if (!isVersionInfo(version)) throw new Error("Invalid version metadata");
    const asset = await exports.default.fetch("https://example.com/build-info.json");
    expect(version.build).toEqual(await asset.json());
    expect(version.deployment?.id).toEqual(expect.any(String));
    const head = await exports.default.fetch("https://example.com/api/version", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    const post = await exports.default.fetch("https://example.com/api/version", { method: "POST" });
    expect(post.status).toBe(405);
  });

  it("removes the management page and management API", async () => {
    const page = await exports.default.fetch("https://example.com/manage", {
      redirect: "manual",
    });
    const api = await exports.default.fetch("https://example.com/api/manage/session");

    expect(page.status).toBe(308);
    expect(page.headers.get("location")).toBe("https://example.com/#subscription");
    expect(api.status).toBe(404);
    await expect(api.json()).resolves.toMatchObject({ error: "api_not_found" });
  });

  it("prevents Cloudflare from injecting scripts into HTML", async () => {
    const response = await exports.default.fetch("https://example.com/");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-cache, no-transform");
    expect(response.headers.get("content-security-policy")).toContain("script-src 'self'");
  });

  it("rejects unsupported methods at the site boundary", async () => {
    const response = await exports.default.fetch("https://example.com/", {
      method: "POST",
    });

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD");
  });

  it("stops reading an API request after the body limit", async () => {
    let pulls = 0;
    const response = await exports.default.fetch("https://example.com/api/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: new ReadableStream({
        pull(controller) {
          pulls += 1;
          controller.enqueue(new Uint8Array(1024));
          if (pulls === 40) controller.close();
        },
      }),
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ error: "request_too_large" });
    expect(pulls).toBeLessThan(40);
  });
});

describe("KV-backed subscription links", () => {
  it("round-trips explicit DNS and IPv6 settings through creation, rendering and loading", async () => {
    const dnsSettings = { bootstrapMode: "custom", bootstrap: ["https://9.9.9.9/dns-query"], nameservers: ["https://1.1.1.1/dns-query"], ipv6: false };
    const { data, response } = await createSubscription({ dnsSettings });
    expect(response.status).toBe(201);
    const profile = parse(await (await exports.default.fetch(data.url)).text());
    expect(profile.dns["proxy-server-nameserver"]).toEqual(dnsSettings.bootstrap);
    expect(profile.dns.nameserver).toEqual(["https://1.1.1.1/dns-query#DNS-PROXY"]);
    expect(profile.dns.ipv6).toBe(false);
    const resolved = await exports.default.fetch("https://example.com/api/subscriptions/resolve", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: data.url }),
    });
    expect(await resolved.json()).toMatchObject({ config: { dnsSettings } });
  });
  it("stores the configuration behind a short link and renders it on demand", async () => {
    const { data, response } = await createSubscription();
    const responseText = JSON.stringify(data);

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(data.profileName).toBe("Flacier");
    expect(data.nodeStats).toEqual({ read: 1, output: 1, skipped: 0 });
    expect(data.url).toMatch(/^https:\/\/example\.com\/s\/[A-Za-z0-9_-]{16}\/mihomo-config$/u);
    expect(data.universalUrl).toMatch(/^https:\/\/example\.com\/s\/[A-Za-z0-9_-]{16}$/u);
    expect(responseText).not.toContain("private-node-password");
    expect(responseText).not.toContain("us.example.com");

    const published = await exports.default.fetch(data.url);
    const profile = parse(await published.text()) as {
      proxies: Array<{ name: string; password: string }>;
    };

    expect(published.status).toBe(200);
    expect(published.headers.get("cache-control")).toBe(
      "no-store",
    );
    expect(published.headers.get("x-subscription-profile")).toBe("Flacier");
    expect(published.headers.get("x-subscription-target")).toBe("mihomo-config");
    expect(profile.proxies).toEqual([
      expect.objectContaining({
        name: "🇺🇸 US-01",
        password: "private-node-password",
        udp: true,
      }),
    ]);
  });

  it("loads a short link back into the conversion form", async () => {
    const { data } = await createSubscription({ name: "个人订阅" });
    const response = await exports.default.fetch("https://example.com/api/subscriptions/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: data.url }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      config: {
        name: "个人订阅",
        sources: [expect.objectContaining({ type: "node" })],
      },
      target: "mihomo-config",
    });
  });

  it("does not read retired links that embedded the whole configuration", async () => {
    const config = btoa(JSON.stringify({ version: 1, sourceMode: "convert", sources: [{ type: "node", value: "ss://retired" }] }));
    const response = await exports.default.fetch(`https://example.com/s/v1.${config.replace(/=+$/u, "")}/mihomo-config`);

    expect(response.status).toBe(404);
  });

  it("does not accept a malformed encoded link", async () => {
    const { data } = await createSubscription();
    const url = new URL(data.url);
    const parts = url.pathname.split("/");
    const token = parts[2];
    parts[2] = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
    url.pathname = parts.join("/");

    const response = await exports.default.fetch(url.toString());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: "subscription_not_found",
    });
  });

  it("applies node filters before generating the link", async () => {
    const { data } = await createSubscription({
      nodeSettings: {
        includePattern: "US",
        excludePattern: "backup",
        renameRules: [{ pattern: "US-", replacement: "United States " }],
        sortMode: "name-asc",
      },
      sources: [
        { name: "节点 1", type: "node", value: nodeUri("JP-01", "jp.example.com", "jp") },
        { name: "节点 2", type: "node", value: nodeUri("US-backup", "backup.example.com", "backup") },
        { name: "节点 3", type: "node", value: nodeUri("US-02", "us.example.com", "us") },
      ],
    });

    const published = await exports.default.fetch(data.url);
    const profile = parse(await published.text()) as { proxies: Array<{ name: string }> };

    expect(profile.proxies.map((proxy) => proxy.name)).toEqual(["🇺🇸 United States 02"]);
    expect(data.nodeStats).toEqual({ read: 3, output: 1, skipped: 0 });
  });

  it("inherits the upstream profile name when the custom name is blank", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => (
      new Response(nodeUri("US-01", "us.example.com", "secret"), {
        headers: {
          "Content-Disposition": "attachment; filename*=UTF-8''%E6%9C%BA%E5%9C%BA%E8%AE%A2%E9%98%85.yaml",
        },
      })
    ));
    try {
      const { data } = await createSubscription({
        name: "",
        sources: [{ name: "订阅 1", type: "subscription", value: "https://provider.example/sub" }],
      });

      expect(data.profileName).toBe("机场订阅");
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://provider.example/sub",
        expect.objectContaining({ headers: { "User-Agent": "clash.meta" } }),
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("selects a format from the universal link user agent", async () => {
    const { data } = await createSubscription();
    const response = await exports.default.fetch(data.universalUrl, {
      headers: { "User-Agent": "Shadowrocket/2.2" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("vary")).toBe("User-Agent");
    expect(response.headers.get("x-subscription-target")).toBe("shadowrocket");
  });

  it("returns 304 for an unchanged generated response", async () => {
    const { data } = await createSubscription();
    const first = await exports.default.fetch(data.url);
    const etag = first.headers.get("etag");
    const second = await exports.default.fetch(data.url, {
      headers: { "If-None-Match": etag ?? "" },
    });

    expect(etag).toBeTruthy();
    expect(second.status).toBe(304);
  });

  it("passes through traffic usage from one upstream subscription", async () => {
    const sourceUrl = "https://provider.example/subscription";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => (
      new Response(nodeUri("US-01", "us.example.com", "secret"), {
        headers: {
          "Subscription-Userinfo": "upload=1024;download=2048; total=107374182400; expire=1805938734",
        },
      })
    ));

    try {
      const { data } = await createSubscription({
        sources: [{ name: "订阅 1", type: "subscription", value: sourceUrl }],
      });
      const published = await exports.default.fetch(data.url);

      expect(published.headers.get("subscription-userinfo")).toBe(
        "upload=1024; download=2048; total=107374182400; expire=1805938734",
      );
      expect(data.usage).toEqual({
        combined: {
          upload: "1024",
          download: "2048",
          total: "107374182400",
          expire: "1805938734",
        },
        sources: [{
          name: "订阅 1",
          status: "available",
          usage: {
            upload: "1024",
            download: "2048",
            total: "107374182400",
            expire: "1805938734",
          },
        }],
      });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("publishes a synthetic total for multiple complete subscriptions", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const host = new URL(String(input)).hostname;
      return new Response(nodeUri(host, host, "secret"), {
        headers: {
          "Subscription-Userinfo": host === "first.example"
            ? "upload=1024; download=2048; total=107374182400; expire=1805938734"
            : "upload=4096; download=8192; total=214748364800; expire=1837474734",
        },
      });
    });

    try {
      const { data } = await createSubscription({
        sources: [
          { name: "机场 A", type: "subscription", value: "https://first.example/sub" },
          { name: "机场 B", type: "subscription", value: "https://second.example/sub" },
        ],
      });
      const published = await exports.default.fetch(data.url);

      expect(published.headers.get("subscription-userinfo")).toBe(
        "upload=5120; download=10240; total=322122547200; expire=1805938734",
      );
      expect(data.usage.combined).toEqual({
        upload: "5120",
        download: "10240",
        total: "322122547200",
        expire: "1805938734",
      });
      expect(data.usage.sources.map((source) => source.status)).toEqual([
        "available",
        "available",
      ]);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("omits a synthetic total when one subscription has no usage", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const host = new URL(String(input)).hostname;
      return new Response(nodeUri(host, host, "secret"), {
        headers: host === "first.example"
          ? { "Subscription-Userinfo": "upload=1024; download=2048; total=107374182400" }
          : {},
      });
    });

    try {
      const { data } = await createSubscription({
        sources: [
          { name: "机场 A", type: "subscription", value: "https://first.example/sub" },
          { name: "机场 B", type: "subscription", value: "https://second.example/sub" },
        ],
      });
      const published = await exports.default.fetch(data.url);

      expect(published.headers.get("subscription-userinfo")).toBeNull();
      expect(data.usage.combined).toBeNull();
      expect(data.usage.sources.map((source) => source.status)).toEqual([
        "available",
        "missing",
      ]);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("requires remote subscriptions and redirects to stay on public HTTPS", async () => {
    const insecure = await exports.default.fetch("https://example.com/api/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody({
        sources: [{ name: "订阅 1", type: "subscription", value: "http://provider.example/sub" }],
      })),
    });
    expect(insecure.status).toBe(400);
    await expect(insecure.json()).resolves.toMatchObject({
      error: "invalid_subscription_url",
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { Location: "https://127.0.0.1/private" },
      }),
    );
    try {
      const redirected = await exports.default.fetch("https://example.com/api/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody({
          sources: [{ name: "订阅 1", type: "subscription", value: "https://provider.example/sub" }],
        })),
      });
      expect(redirected.status).toBe(400);
      await expect(redirected.json()).resolves.toMatchObject({
        error: "invalid_subscription_url",
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("reports an upstream refusal instead of publishing a client-direct provider shell", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 403 }));
    try {
      const { data, response } = await createSubscription({
        fallbackMode: "mihomo-provider",
        sources: [{ name: "订阅 1", type: "subscription", value: "https://provider.example/subscription" }],
        target: "clash-party-config",
      });
      expect(response.status).toBe(502);
      expect(data).toMatchObject({ error: "source_failed" });

      const retired = await exports.default.fetch("https://example.com/api/subscriptions", {
        method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": "192.0.2.200" },
        body: JSON.stringify({ ...requestBody(), sourceMode: "mihomo-provider" }),
      });
      expect(retired.status).toBe(400);
      expect(await retired.json()).toMatchObject({ error: "client_direct_removed" });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("does not silently replace Worker conversion with client fetching", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 403 }),
    );

    try {
      const { data, response } = await createSubscription({
        sources: [{ name: "订阅 1", type: "subscription", value: "https://provider.example/sub" }],
        target: "clash-party-config",
      });

      expect(response.status).toBe(502);
      expect(data).toMatchObject({ error: "source_failed" });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("never replaces a verified subscription with an empty provider profile on refresh", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => (
      new Response(nodeUri("US-01", "us.example.com", "secret"), {
        headers: { "Subscription-Userinfo": "upload=10; download=20; total=100; expire=0" },
      })
    ));
    try {
      const { data, response } = await createSubscription({
        fallbackMode: "mihomo-provider",
        sources: [{ name: "机场", type: "subscription", value: "https://provider.example/sub" }],
        target: "clash-party-config",
      });
      expect(response.status).toBe(201);
      expect(data.nodeStats.output).toBe(1);
      fetchSpy.mockImplementation(async () => new Response(null, { status: 403 }));
      await clearSourceCache();
      const refreshed = await exports.default.fetch(data.url);
      expect(refreshed.status).toBe(200);
      expect(refreshed.headers.get("cache-control")).toBe("no-store");
      expect(refreshed.headers.get("x-subscription-refresh-status")).toBe("last-good");
      expect(refreshed.headers.get("x-subscription-refresh-error")).toBe("source_failed");
      expect(parse(await refreshed.text()).proxies).toHaveLength(1);
    } finally { fetchSpy.mockRestore(); }
  });

});
