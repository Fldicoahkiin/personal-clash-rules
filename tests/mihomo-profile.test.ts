import { describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { get } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { setTimeout } from "node:timers/promises";

import {
  createMihomoProfile,
  createMihomoProviderProfile,
} from "../src/worker/mihomo-profile";
import { defaultNodeSettings } from "../src/worker/node-transforms";

describe("createMihomoProfile", () => {
  it("uses one visible built-in GLOBAL in the original global position without business-group cycles", () => {
    const profile = parse(createMihomoProfile("proxies: [{name: JP-01, type: ss}]"));
    const groups = profile["proxy-groups"];
    expect(groups.filter((group: { name: string }) => group.name === "GLOBAL")).toHaveLength(1);
    expect(groups.find((group: { name: string }) => group.name === "GLOBAL")).toMatchObject({
      type: "select", "include-all": true,
      proxies: expect.arrayContaining(["🖐 手动选择", "DIRECT"]),
    });
    expect(groups[1].name).toBe("GLOBAL");
    expect(groups[1].hidden).not.toBe(true);
    expect(groups[1].proxies).not.toContain("GLOBAL");
    expect(groups[1].proxies).not.toContain("🧠 Claude");
    expect(JSON.stringify(groups)).not.toContain("🌐 全局");
    expect(groups.find((group: { name: string }) => group.name === "🧠 Claude").hidden).not.toBe(true);
  });
  it("resolves unlisted domains at the China IP fallback while keeping explicit services and proxy DNS first", () => {
    const profile = parse(createMihomoProfile("proxies: [{name: JP-01, type: ss}]"));
    expect(profile.rules.slice(-3)).toEqual([
      "RULE-SET,china-domains,DIRECT",
      "GEOIP,CN,DIRECT",
      "MATCH,🐟 未匹配流量",
    ]);
    const domestic = profile.rules.indexOf("RULE-SET,china-domains,DIRECT");
    for (const rule of ["RULE-SET,ai-openai,🤖 AI", "RULE-SET,developer,🛠️ 开发服务", "RULE-SET,social,💬 社交"]) {
      expect(profile.rules.indexOf(rule)).toBeGreaterThanOrEqual(0);
      expect(profile.rules.indexOf(rule)).toBeLessThan(domestic);
    }
    expect(profile.dns).toMatchObject({
      "enhanced-mode": "fake-ip",
      nameserver: ["https://1.1.1.1/dns-query#DNS-PROXY", "https://8.8.8.8/dns-query#DNS-PROXY"],
      "direct-nameserver": ["https://1.1.1.1/dns-query#DNS-PROXY", "https://8.8.8.8/dns-query#DNS-PROXY"],
    });
  });

  it("prepends exact domestic-app rules for IP-only connections without exempting other processes", () => {
    const profile = parse(createMihomoProfile("proxies: [{name: JP-01, type: ss}]"));
    expect(profile.rules.filter((rule: string) => rule.startsWith("PROCESS-NAME,"))).toEqual([
      "PROCESS-NAME,ToDesk,DIRECT",
      "PROCESS-NAME,ToDesk_Service,DIRECT",
      "PROCESS-NAME,ToDesk_Session,DIRECT",
      "PROCESS-NAME,ToDesk_Session_Proxy,DIRECT",
      "PROCESS-NAME,ToDesk_Screenwall_Helper,DIRECT",
      "PROCESS-NAME,ToDesk_XPCHelper,DIRECT",
      "PROCESS-NAME,ToDesk.exe,DIRECT",
      "PROCESS-NAME,ToDesk_Service.exe,DIRECT",
      "PROCESS-NAME,WeChat,DIRECT",
      "PROCESS-NAME,WeChatAppEx,DIRECT",
      "PROCESS-NAME,QQ,DIRECT",
      "PROCESS-NAME,QQ Helper,DIRECT",
      "PROCESS-NAME,NeteaseMusic,DIRECT",
      "PROCESS-NAME,NeteaseMusic Helper,DIRECT",
    ]);
    expect(profile.rules.indexOf("PROCESS-NAME,WeChat,DIRECT"))
      .toBeLessThan(profile.rules.indexOf("RULE-SET,ai-openai,🤖 AI"));
    expect(profile.rules).not.toContain("PROCESS-NAME,Google Chrome,DIRECT");
    expect(profile.rules).toContain("PROCESS-NAME-REGEX,(?i)^codex(\\.exe)?$,🤖 AI");
  });
  it("puts manual selection before global and excludes quota notices from DNS choices", () => {
    const profile = parse(createMihomoProfile("proxies: [{name: JP-01, type: ss}, {name: '剩余流量：1 TB', type: ss}]"));
    expect(profile["proxy-groups"].slice(0, 2).map((group: { name: string }) => group.name)).toEqual(["🖐 手动选择", "GLOBAL"]);
    expect(profile["proxy-groups"][0]).toMatchObject({ type: "select", "include-all": true, proxies: expect.arrayContaining(["♻️ 自动选择", "🇺🇸 美国"]) });
    expect(profile["proxy-groups"][1].proxies[0]).toBe("🖐 手动选择");
    const dns = profile["proxy-groups"].find((group: { name: string }) => group.name === "DNS-PROXY");
    expect(dns["exclude-filter"]).toContain("剩余");
  });
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

  it("keeps empty groups closed and makes only the domestic media group direct-first", () => {
    const profile = parse(createMihomoProfile("proxies: [{name: US, type: ss}]"));
    for (const group of profile["proxy-groups"]) {
      expect(group["empty-fallback"]).toBe("REJECT");
      if (group.name === "📺 哔哩哔哩") expect(group.proxies?.[0]).toBe("DIRECT");
      else expect(group.proxies?.[0]).not.toBe("DIRECT");
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
      expect.objectContaining({ name: "🤖 AI", proxies: expect.arrayContaining(["GLOBAL", "🖐 手动选择", "♻️ 自动选择", "🇺🇸 美国", "🇯🇵 日本", "🇸🇬 新加坡", "🇹🇼 台湾", "DIRECT"]), "include-all": true }),
      expect.objectContaining({ name: "📥 Steam 下载", proxies: expect.arrayContaining(["DIRECT"]) }),
      expect.objectContaining({ name: "📺 巴哈姆特", proxies: expect.arrayContaining(["🇹🇼 台湾"]) }),
    ]));
    expect((config["proxy-groups"] as Array<Record<string, unknown>>).every(
      (group) => group.icon === undefined,
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
      "china-domains": {
        behavior: "domain",
        url: "https://rules.flacier.com/rules/mihomo/china-domains.txt",
      },
    });
    expect(config.rules).toEqual(expect.arrayContaining([
      "RULE-SET,ai-openai,🤖 AI",
      "RULE-SET,apple-services,🍎 Apple",
      "RULE-SET,steam-download,📥 Steam 下载",
      "MATCH,🐟 未匹配流量",
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
        "override-expr": [".udp = (.udp != false)"],
        tfo: true,
        "skip-cert-verify": true,
      },
    });
    expect(provider.override).not.toHaveProperty("udp");
    expect((provider.override as { "proxy-name": unknown[] })["proxy-name"]).toEqual(
      expect.arrayContaining([{ pattern: "USA", target: "US" }]),
    );
    expect(config["proxy-groups"]).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "♻️ 自动选择",
        "include-all-providers": true,
        use: ["订阅 1"],
      }),
      expect.objectContaining({
        name: "🇺🇸 美国",
        "include-all-providers": true,
        use: ["订阅 1"],
      }),
      expect.objectContaining({ name: "🤖 AI", proxies: expect.arrayContaining(["GLOBAL"]) }),
    ]));
    expect(config["proxy-groups"].find((group) => group.name === "🇺🇸 美国")).toHaveProperty(
      "empty-fallback", "REJECT",
    );
  });

  it("combines source-aware provider UDP defaults with existing name overrides", () => {
    const input = { dnsMode: "system" as const, nodeResource: "proxies: []", providers: [{ name: "Fixture", url: "https://provider.example/sub" }],
      nodeSettings: { ...defaultNodeSettings, addCountryFlag: false, showNodeType: true }, sourceUserAgent: "clash.meta", rulePreset: "global" as const, updateIntervalHours: 6 };
    const override = parse(createMihomoProviderProfile(input))["proxy-providers"].Fixture.override;
    expect(override).toEqual({ "override-expr": [".udp = (.udp != false)", '.name = "[\\(.type | upcase)] \\(.name)"'] });
    const disabled = parse(createMihomoProviderProfile({ ...input, nodeSettings: { ...input.nodeSettings, udp: false } }))["proxy-providers"].Fixture.override;
    expect(disabled).toEqual({ "override-expr": ['.name = "[\\(.type | upcase)] \\(.name)"'] });
  });

  it.runIf(process.env.MIHOMO_TEST_BINARY)("keeps provider UDP false, omitted and true values correct in Mihomo", { timeout: 20_000 }, async () => {
    const profile = parse(createMihomoProviderProfile({ dnsMode: "system", nodeResource: "proxies: []",
      providers: [{ name: "Fixture", url: "https://provider.example/sub" }],
      nodeSettings: { ...defaultNodeSettings, addCountryFlag: false }, sourceUserAgent: "clash.meta", rulePreset: "global", updateIntervalHours: 6 }));
    const directory = await mkdtemp(resolve(process.platform === "darwin" ? "/private/tmp" : tmpdir(), "mihomo-provider-udp-"));
    const socketPath = resolve(directory, "controller.sock");
    const path = resolve(directory, "config.yaml");
    await writeFile(path, stringify({ mode: "rule", "log-level": "silent", "external-controller-unix": socketPath,
      "proxy-providers": { Fixture: { type: "inline", override: profile["proxy-providers"].Fixture.override,
        payload: [
          { name: "TCP only", type: "socks5", server: "127.0.0.1", port: 9, udp: false },
          { name: "Default", type: "socks5", server: "127.0.0.1", port: 9 },
          { name: "UDP enabled", type: "socks5", server: "127.0.0.1", port: 9, udp: true },
        ] } }, "proxy-groups": [{ name: "Fixture choices", type: "select", use: ["Fixture"] }], rules: ["MATCH,REJECT"] }), { mode: 0o600 });
    const core = spawn(process.env.MIHOMO_TEST_BINARY!, ["-d", directory, "-f", path], { stdio: "ignore", timeout: 15_000 });
    const closed = new Promise<void>(resolve => core.once("close", () => resolve()));
    let startupError: Error | undefined;
    core.on("error", error => { startupError = error; });
    try {
      let data: { proxies: Array<{ name: string; udp: boolean }> } | undefined;
      for (let attempt = 0; attempt < 30; attempt++) {
        if (startupError) throw startupError;
        try {
          data = await new Promise((resolve, reject) => {
            const request = get({ socketPath, path: "/providers/proxies/Fixture", timeout: 1000 }, response => {
              let body = "";
              response.on("data", chunk => { body += chunk; });
              response.on("end", () => {
                try { expect(response.statusCode).toBe(200); resolve(JSON.parse(body)); } catch (error) { reject(error); }
              });
            });
            request.on("error", reject);
            request.on("timeout", () => request.destroy(new Error("Provider controller timed out")));
          });
          break;
        } catch (error) {
          if (attempt === 29 || core.exitCode !== null) throw error;
          await setTimeout(50);
        }
      }
      expect(data?.proxies.map(node => ({ name: node.name, udp: node.udp }))).toEqual([
        { name: "TCP only", udp: false }, { name: "Default", udp: true }, { name: "UDP enabled", udp: true },
      ]);
    } finally { core.kill(); await closed; }
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
