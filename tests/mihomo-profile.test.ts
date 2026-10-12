import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import {
  createMihomoProfile,
  createMihomoProviderProfile,
} from "../src/worker/mihomo-profile";

describe("createMihomoProfile", () => {
  it("labels country groups with flags and updates all group references", () => {
    const profile = parse(createMihomoProfile("proxies: [{name: JP-01, type: ss}]"));
    const names = new Set(profile["proxy-groups"].map((group: { name: string }) => group.name));
    for (const name of ["🇺🇸 美国", "🇯🇵 日本", "🇸🇬 新加坡", "🇭🇰 香港", "🇹🇼 台湾", "🇰🇷 韩国", "🇪🇺 欧洲"]) {
      expect(names.has(name)).toBe(true);
    }
    for (const group of profile["proxy-groups"]) {
      for (const member of group.proxies ?? []) {
        expect(names.has(member) || ["DIRECT", "REJECT"].includes(member)).toBe(true);
        expect(["US", "JP", "SG", "HK", "TW", "KR", "EU"]).not.toContain(member);
      }
    }
  });

  it("rejects inherited DNS whose original policy group is removed", () => {
    expect(() => createMihomoProfile("proxies: [{name: US, type: ss}]", "flacier", 6, "upstream", {
      dns: { enable: true, nameserver: ["https://1.1.1.1/dns-query#OriginalProxy"] },
    })).toThrow("DNS dependency");
  });

  it("keeps empty groups closed and makes built-in service groups proxy-first", () => {
    const profile = parse(createMihomoProfile("proxies: [{name: US, type: ss}]"));
    for (const group of profile["proxy-groups"]) {
      expect(group["empty-fallback"]).toBe("REJECT");
      expect(group.proxies?.[0]).not.toBe("DIRECT");
    }
    expect(profile.rules).not.toContain("RULE-SET,apple-system,DIRECT");
  });
  it("turns a Mihomo node resource into an installable rule profile", () => {
    const output = createMihomoProfile(`
proxies:
  - name: US-01
    type: ss
    server: us.example.com
    port: 443
    cipher: aes-128-gcm
    password: test
  - name: TW-01
    type: ss
    server: tw.example.com
    port: 443
    cipher: aes-128-gcm
    password: test
`);
    const config = parse(output) as Record<string, unknown>;

    expect(config.mode).toBe("rule");
    expect(config.dns).toMatchObject({
      enable: true,
      "enhanced-mode": "fake-ip",
      "fake-ip-range": "198.18.0.1/16",
      nameserver: [
        "https://1.1.1.1/dns-query#DNS-PROXY",
        "https://8.8.8.8/dns-query#DNS-PROXY",
      ],
      "proxy-server-nameserver": [
        "system",
      ],
    });
    expect(config.proxies).toHaveLength(2);
    expect(config["proxy-groups"]).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "AI", proxies: ["GLOBAL", "🇺🇸 美国", "🇯🇵 日本", "🇸🇬 新加坡", "🇹🇼 台湾"] }),
      expect.objectContaining({ name: "STEAM-DOWNLOAD", proxies: expect.arrayContaining(["DIRECT"]) }),
      expect.objectContaining({ name: "ANIGAMER", proxies: expect.arrayContaining(["🇹🇼 台湾"]) }),
    ]));
    expect((config["proxy-groups"] as Array<Record<string, unknown>>).every(
      (group) => typeof group.icon === "string",
    )).toBe(true);
    expect(config["rule-providers"]).toMatchObject({
      "ai-openai": {
        behavior: "classical",
        url: "https://rules.flacier.com/rules/ai/openai.list",
      },
      "apple-services": {
        behavior: "classical",
        url: "https://rules.flacier.com/rules/apple/services.list",
      },
    });
    expect(config.rules).toEqual(expect.arrayContaining([
      "RULE-SET,ai-openai,AI",
      "RULE-SET,apple-services,APPLE",
      "RULE-SET,steam-download,STEAM-DOWNLOAD",
      "MATCH,DEFAULT",
    ]));
    expect(config).not.toHaveProperty("+proxy-groups");
    expect(config).not.toHaveProperty("+rules");
  });

  it("rejects text that is not a Mihomo node resource", () => {
    expect(() => createMihomoProfile("Surge generated output")).toThrow(
      "Mihomo node resource is invalid",
    );
  });

  it("retains the source DNS without adding a second resolver policy", () => {
    const upstream = { ipv6: false, dns: { enable: true, nameserver: ["https://dns.example/dns-query"], "proxy-server-nameserver": ["https://bootstrap.example/dns-query"], "nameserver-policy": { "+.private.example": "system" } } };
    const output = parse(createMihomoProfile("proxies: [{name: US, type: ss, server: proxy.example, port: 443, password: test, cipher: aes-128-gcm}]", "flacier", 6, "upstream", upstream));
    expect(output.dns).toEqual({ ...upstream.dns, ipv6: false });
    expect(output.ipv6).toBe(false);
    expect(output.tun).toBeUndefined();
  });

  it("does not silently invent upstream DNS for client-direct mode", () => {
    expect(() => createMihomoProfile("proxies: [{name: US, type: ss}]", "flacier", 6, "upstream")).toThrow("single upstream");
  });

  it("can leave DNS resolution to the operating system", () => {
    const output = createMihomoProfile(`
proxies:
  - name: US-01
    type: ss
    server: us.example.com
    port: 443
    cipher: aes-128-gcm
    password: test
`, "flacier", 6, "system");
    const config = parse(output) as Record<string, unknown>;

    expect(config.dns).toEqual({ enable: false });
  });

  it("builds a client-fetched provider profile when a Worker fetch is blocked", () => {
    const output = createMihomoProviderProfile({
      dnsMode: "doh",
      nodeResource: "proxies: []",
      providers: [{ name: "订阅 1", url: "https://provider.example/sub" }],
      nodeSettings: {
        addCountryFlag: true,
        excludePattern: "过期|官网",
        includePattern: "US|JP",
        renameRules: [{ pattern: "USA", replacement: "US" }],
        showNodeType: false,
        skipCertVerify: true,
        sortMode: "source",
        tfo: true,
        udp: true,
        xudp: false,
      },
      sourceUserAgent: "ClashParty/2.0",
      rulePreset: "flacier",
      updateIntervalHours: 12,
    });
    const config = parse(output) as {
      proxies: unknown[];
      "profile-update-interval": number;
      "proxy-groups": Array<Record<string, unknown>>;
      "proxy-providers": Record<string, Record<string, unknown>>;
    };

    expect(config.proxies).toEqual([]);
    expect(config["profile-update-interval"]).toBe(12);
    const provider = config["proxy-providers"]["订阅 1"];
    expect(provider.path).toMatch(/^\.\/proxy-providers\/flacier-[a-f0-9]{16}-1\.yaml$/u);
    const differentSource = parse(createMihomoProviderProfile({
      dnsMode: "doh", nodeResource: "proxies: []", providers: [{ name: "订阅 1", url: "https://other.example/sub" }],
      nodeSettings: { addCountryFlag: false, excludePattern: "", includePattern: "", renameRules: [], showNodeType: false, skipCertVerify: false, sortMode: "source", tfo: false, udp: true, xudp: false },
      sourceUserAgent: "clash.meta", rulePreset: "flacier", updateIntervalHours: 6,
    }));
    expect(differentSource["proxy-providers"]["订阅 1"].path).not.toBe(provider.path);
    expect(provider).toMatchObject({
      type: "http",
      url: "https://provider.example/sub",
      interval: 43_200,
      header: { "User-Agent": ["ClashParty/2.0"] },
      filter: "US|JP",
      "exclude-filter": "过期|官网",
      override: {
        udp: true,
        tfo: true,
        "skip-cert-verify": true,
      },
    });
    expect((provider.override as { "proxy-name": unknown[] })["proxy-name"]).toEqual(
      expect.arrayContaining([{ pattern: "USA", target: "US" }]),
    );
    expect(config["proxy-groups"]).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "AUTO",
        "include-all-providers": true,
        use: ["订阅 1"],
      }),
      expect.objectContaining({
        name: "🇺🇸 美国",
        "include-all-providers": true,
        use: ["订阅 1"],
      }),
      expect.objectContaining({ name: "AI", proxies: expect.arrayContaining(["GLOBAL"]) }),
    ]));
    expect(config["proxy-groups"].find((group) => group.name === "🇺🇸 美国")).toHaveProperty(
      "empty-fallback", "REJECT",
    );
  });

  it("can generate a global proxy preset without Flacier rule providers", () => {
    const output = createMihomoProfile(`
proxies:
  - name: US-01
    type: ss
    server: us.example.com
    port: 443
    cipher: aes-128-gcm
    password: test
`, "global");
    const config = parse(output) as Record<string, unknown>;

    expect(config).not.toHaveProperty("rule-providers");
    expect(config.rules).toEqual([
      "GEOSITE,private,DIRECT",
      "GEOIP,private,DIRECT,no-resolve",
      "MATCH,GLOBAL",
    ]);
  });

  it("can generate a direct preset without proxy groups", () => {
    const output = createMihomoProfile(`
proxies:
  - name: US-01
    type: ss
    server: us.example.com
    port: 443
    cipher: aes-128-gcm
    password: test
`, "direct", 6, "system");
    const config = parse(output) as Record<string, unknown>;

    expect(config).not.toHaveProperty("rule-providers");
    expect(config["proxy-groups"]).toEqual([]);
    expect(config.rules).toEqual(["MATCH,DIRECT"]);
  });
});
