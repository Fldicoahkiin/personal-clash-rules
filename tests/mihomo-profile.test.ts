import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { createMihomoProfile } from "../src/worker/mihomo-profile";

describe("createMihomoProfile", () => {
  it("uses one visible built-in GLOBAL as the first group without business-group cycles", () => {
    const profile = parse(createMihomoProfile("proxies: [{name: JP-01, type: ss}]"));
    const groups = profile["proxy-groups"];
    expect(groups.filter((group: { name: string }) => group.name === "GLOBAL")).toHaveLength(1);
    expect(groups.find((group: { name: string }) => group.name === "GLOBAL")).toMatchObject({
      type: "select", "include-all": true,
      proxies: expect.arrayContaining(["♻️ 自动选择", "DIRECT"]),
    });
    expect(groups[0].name).toBe("GLOBAL");
    expect(groups[0].hidden).not.toBe(true);
    expect(groups[0].proxies).not.toContain("GLOBAL");
    expect(groups[0].proxies).not.toContain("🧠 Claude");
    expect(JSON.stringify(groups)).not.toContain("🖐 手动选择");
    expect(JSON.stringify(groups)).not.toContain("🌐 全局");
    expect(groups.find((group: { name: string }) => group.name === "🧠 Claude").hidden).not.toBe(true);
  });
  it("sends browser STUN out of the default exit and refuses it there instead of switching exits", () => {
    const profile = parse(createMihomoProfile("proxies: [{name: JP-01, type: ss}]"));
    const stun = profile.rules.filter((rule: string) => rule.includes("(DST-PORT,3478/5349/19302-19309)"));
    expect(stun.map((rule: string) => rule.slice(rule.lastIndexOf(",") + 1))).toEqual(["🐟 未匹配流量", "REJECT", "REJECT"]);
    expect(stun[0].slice(0, stun[0].lastIndexOf(","))).toBe(stun[1].slice(0, stun[1].lastIndexOf(",")));
    expect(stun.join("\n")).not.toContain("自动选择");
  });
  it("sends domestic domains direct before the AI process rules and keeps the China IP fallback before MATCH", () => {
    const profile = parse(createMihomoProfile("proxies: [{name: JP-01, type: ss}]"));
    const match = profile.rules.indexOf("MATCH,🐟 未匹配流量");
    expect(profile.rules[match - 1]).toBe("GEOIP,CN,DIRECT");
    expect(profile.rules.slice(match + 1)).toEqual([
      "NETWORK,UDP,♻️ 自动选择",
      "NETWORK,UDP,REJECT",
    ]);
    // UDP an AI exit cannot carry is refused right after its rule set, before later rules or MATCH could take it.
    for (const [rule, refusal] of [
      ["RULE-SET,ai-anthropic,🧠 Claude", "AND,((NETWORK,UDP),(RULE-SET,ai-anthropic)),REJECT"],
      ["RULE-SET,ai-openai,🤖 AI", "AND,((NETWORK,UDP),(RULE-SET,ai-openai)),REJECT"],
      ["RULE-SET,ai-xai,🤖 AI", "AND,((NETWORK,UDP),(RULE-SET,ai-xai)),REJECT"],
      ["RULE-SET,ai-google,🤖 AI", "AND,((NETWORK,UDP),(RULE-SET,ai-google)),REJECT"],
      ["RULE-SET,ai-coding,🤖 AI", "AND,((NETWORK,UDP),(RULE-SET,ai-coding)),REJECT"],
      ["RULE-SET,ai-general,🤖 AI", "AND,((NETWORK,UDP),(RULE-SET,ai-general)),REJECT"],
      ["RULE-SET,ai-anthropic-ip,🧠 Claude,no-resolve", "AND,((NETWORK,UDP),(RULE-SET,ai-anthropic-ip,no-resolve)),REJECT"],
    ]) {
      expect(profile.rules[profile.rules.indexOf(rule) + 1]).toBe(refusal);
    }
    const domestic = profile.rules.indexOf("RULE-SET,china-domains,DIRECT");
    expect(profile.rules[domestic - 1]).toBe("RULE-SET,china-exceptions,🐟 未匹配流量");
    expect(domestic).toBeLessThan(profile.rules.findIndex((rule: string) => rule.startsWith("PROCESS-NAME-REGEX,(?i)^claude")));
    expect(domestic).toBeLessThan(profile.rules.findIndex((rule: string) => rule.startsWith("PROCESS-NAME-REGEX,(?i)^codex")));
    expect(profile.dns).toMatchObject({
      "enhanced-mode": "fake-ip",
      nameserver: ["https://1.1.1.1/dns-query#DNS-PROXY", "https://8.8.8.8/dns-query#DNS-PROXY"],
      "direct-nameserver": ["https://223.5.5.5/dns-query", "https://1.12.12.12/dns-query"],
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
      "PROCESS-NAME,WeChatAppEx Helper,DIRECT",
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
  it("lets GLOBAL pick nodes directly and excludes quota notices from DNS choices", () => {
    const profile = parse(createMihomoProfile("proxies: [{name: JP-01, type: ss}, {name: '剩余流量：1 TB', type: ss}]"));
    expect(profile["proxy-groups"][0]).toMatchObject({ name: "GLOBAL", type: "select", "include-all": true, proxies: expect.arrayContaining(["♻️ 自动选择", "🇺🇸 美国"]) });
    expect(profile["proxy-groups"][0].proxies[0]).toBe("♻️ 自动选择");
    const dns = profile["proxy-groups"].find((group: { name: string }) => group.name === "DNS-PROXY");
    expect(dns["exclude-filter"]).toContain("剩余");
  });
  it("labels country groups with flags and updates all group references", () => {
    const profile = parse(createMihomoProfile("proxies: [{name: JP-01, type: ss}]"));
    const names = new Set(profile["proxy-groups"].map((group: { name: string }) => group.name));
    for (const name of ["🇺🇸 美国", "🇯🇵 日本", "🇸🇬 新加坡", "🇭🇰 香港", "🇨🇳 台湾", "🇰🇷 韩国", "🇪🇺 欧洲"]) {
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

  it("keeps empty groups closed and makes only domestic media, Apple downloads and Apple system direct-first", () => {
    const profile = parse(createMihomoProfile("proxies: [{name: US, type: ss}]"));
    for (const group of profile["proxy-groups"]) {
      expect(group["empty-fallback"]).toBe("REJECT");
      if (["📺 哔哩哔哩", "📥 Apple 下载", "⚙️ Apple 系统"].includes(group.name)) expect(group.proxies?.[0]).toBe("DIRECT");
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
      expect.objectContaining({ name: "🤖 AI", proxies: expect.arrayContaining(["GLOBAL", "♻️ 自动选择", "🇺🇸 美国", "🇯🇵 日本", "🇸🇬 新加坡", "🇨🇳 台湾", "DIRECT"]), "include-all": true }),
      expect.objectContaining({ name: "📥 Steam 下载", proxies: expect.arrayContaining(["DIRECT"]) }),
      expect.objectContaining({ name: "📺 巴哈姆特", proxies: expect.arrayContaining(["🇨🇳 台湾"]) }),
    ]));
    const groups = config["proxy-groups"] as Array<Record<string, unknown>>;
    expect(groups.filter((group) => group.icon !== undefined)).toEqual([
      expect.objectContaining({ name: "GLOBAL", icon: "https://rules.flacier.com/policy-icons/globe.svg" }),
    ]);
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

  it("does not invent upstream DNS when the source provides none", () => {
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
      "NETWORK,UDP,♻️ 自动选择",
      "NETWORK,UDP,REJECT",
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
