import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import {
  businessProxyGroupNames,
  displayMihomoGroup,
  displayMihomoRule,
  mihomoProxyGroups,
  mihomoProfileRuleProviders,
  mihomoProfileRules,
  mihomoStunRules,
} from "../src/config/mihomo-policy";
import { policyDisplayName, policyOptions } from "../src/app/lib/policy-groups";

const overridePath = resolve(
  import.meta.dirname,
  "../public/overrides/clash-party.yaml",
);

describe("Clash Party override", () => {
  it("uses the same policies as generated Mihomo profiles", async () => {
    const config = parse(await readFile(overridePath, "utf8")) as {
      "rule-providers": unknown;
      "+proxy-groups": unknown;
      "+rules": unknown;
    };

    expect(config["rule-providers"]).toEqual(mihomoProfileRuleProviders);
    expect(config["+proxy-groups"]).toEqual(mihomoProxyGroups.map(displayMihomoGroup));
    expect(config["+rules"]).toEqual(mihomoProfileRules.map(displayMihomoRule));
  });

  it("publishes Apple rules as remote providers", async () => {
    const config = parse(await readFile(overridePath, "utf8")) as {
      "rule-providers": Record<
        string,
        {
          behavior: string;
          format: string;
          interval: number;
          url: string;
        }
      >;
    };

    expect(config["rule-providers"]["apple-system"]).toMatchObject({
      behavior: "classical",
      format: "text",
      interval: 86_400,
      url: "https://rules.flacier.com/rules/apple/system.list",
    });
    expect(config["rule-providers"]["apple-services"]).toMatchObject({
      behavior: "classical",
      format: "text",
      interval: 86_400,
      url: "https://rules.flacier.com/rules/apple/services.list",
    });
  });

  it("prepends process, service and local network rules in order", async () => {
    const config = parse(await readFile(overridePath, "utf8")) as {
      "+rules": string[];
    };

    expect(config["+rules"].slice(0, 50)).toEqual([
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
      ...mihomoStunRules.map(displayMihomoRule),
      "DOMAIN-SUFFIX,todesk.com,DIRECT",
      "DOMAIN-SUFFIX,todesk.cn,DIRECT",
      "DOMAIN-SUFFIX,alipay.com,DIRECT",
      "DOMAIN-SUFFIX,alipayobjects.com,DIRECT",
      "DOMAIN-SUFFIX,alicdn.com,DIRECT",
      "DOMAIN-SUFFIX,jinhefilm.com,DIRECT",
      "DOMAIN-SUFFIX,icbc.com.cn,DIRECT",
      "DOMAIN-SUFFIX,icbc.com,DIRECT",
      "DOMAIN-SUFFIX,95588.com,DIRECT",
      "IP-CIDR,117.131.49.0/24,DIRECT,no-resolve",
      "IP-CIDR,120.204.111.0/24,DIRECT,no-resolve",
      "RULE-SET,private-domain,DIRECT",
      "RULE-SET,private-ip,DIRECT,no-resolve",
      "RULE-SET,tencent-messaging,DIRECT",
      "RULE-SET,netease-music,DIRECT",
      "RULE-SET,apple-download,📥 Apple 下载",
      "RULE-SET,apple-system,⚙️ Apple 系统",
      "RULE-SET,apple-services,🍎 Apple",
      "RULE-SET,apple-icloud,☁️ iCloud",
      "RULE-SET,apple-media,🎧 Apple 媒体",
      "RULE-SET,apple-intelligence,✨ Apple 智能",
      "RULE-SET,steam-download,📥 Steam 下载",
      "RULE-SET,bilibili,📺 哔哩哔哩",
      "RULE-SET,china-ip-lookup,🐟 未匹配流量",
      "RULE-SET,china-exceptions,🐟 未匹配流量",
      "RULE-SET,china-domains,DIRECT",
      "PROCESS-NAME-REGEX,(?i)^claude(\\.exe)?$,🧠 Claude",
      "RULE-SET,ai-anthropic,🧠 Claude",
      "AND,((NETWORK,UDP),(RULE-SET,ai-anthropic)),REJECT",
      "PROCESS-NAME-REGEX,(?i)^codex(\\.exe)?$,🤖 AI",
      "RULE-SET,ai-openai,🤖 AI",
      "AND,((NETWORK,UDP),(RULE-SET,ai-openai)),REJECT",
    ]);
    expect(config["+rules"]).toContain("RULE-SET,ai-xai,🤖 AI");
    expect(config["+rules"]).toContain("RULE-SET,steam,🎮 Steam");
    expect(config["+rules"]).toContain(
      "RULE-SET,steam-download,📥 Steam 下载",
    );
    expect(config["+rules"]).toContain("RULE-SET,steam-online,🕹️ Steam 联机");
    expect(config["+rules"]).toContain("RULE-SET,bilibili,📺 哔哩哔哩");
    expect(config["+rules"]).toContain("RULE-SET,anigamer,📺 巴哈姆特");
    expect(config["+rules"]).toContain("RULE-SET,discord,💬 Discord");
    expect(config["+rules"]).toContain("RULE-SET,apple-system,⚙️ Apple 系统");
    expect(config["+rules"]).toContain("RULE-SET,apple-services,🍎 Apple");

    expect(config["+rules"].indexOf("RULE-SET,apple-system,⚙️ Apple 系统"))
      .toBeLessThan(config["+rules"].indexOf("RULE-SET,apple-services,🍎 Apple"));
    expect(config["+rules"].indexOf("RULE-SET,steam-download,📥 Steam 下载"))
      .toBeLessThan(config["+rules"].indexOf("RULE-SET,steam-online,🕹️ Steam 联机"));
    expect(config["+rules"].indexOf("RULE-SET,steam-online,🕹️ Steam 联机"))
      .toBeLessThan(config["+rules"].indexOf("RULE-SET,steam,🎮 Steam"));
    expect(config["+rules"].indexOf("RULE-SET,bilibili,📺 哔哩哔哩"))
      .toBeLessThan(config["+rules"].indexOf("RULE-SET,media,🎬 流媒体"));
  });

  it("offers explicit country selectors and service policies", async () => {
    const config = parse(await readFile(overridePath, "utf8")) as {
      "+proxy-groups": Array<{
        name: string;
        type: string;
        filter?: string;
        proxies?: string[];
        "empty-fallback"?: string;
        "exclude-type"?: string;
      }>;
    };
    const groups = new Map(
      config["+proxy-groups"].map((group) => [group.name, group]),
    );

    for (const country of ["🇺🇸 美国", "🇯🇵 日本", "🇸🇬 新加坡", "🇭🇰 香港", "🇨🇳 台湾", "🇰🇷 韩国", "🇪🇺 欧洲"]) {
      expect(groups.get(country)?.type, country).toBe("select");
      expect(groups.get(country)?.filter, country).toBeTruthy();
      expect(groups.get(country), country).toHaveProperty("empty-fallback", "REJECT");
      expect(groups.get(country)?.["exclude-type"], country).toBe("direct");
    }
    expect(groups.get("🤖 AI")?.proxies).toEqual([
      "GLOBAL",
      "♻️ 自动选择",
      "🇺🇸 美国",
      "🇯🇵 日本",
      "🇸🇬 新加坡",
      "🇭🇰 香港",
      "🇨🇳 台湾",
      "🇰🇷 韩国",
      "🇪🇺 欧洲",
      "DIRECT",
    ]);
    expect(groups.get("🎮 Steam")?.proxies).toContain("DIRECT");
    expect(groups.get("🎮 Steam")?.proxies?.[0]).toBe("GLOBAL");
    expect(groups.get("📥 Steam 下载")?.proxies?.[0]).toBe("GLOBAL");
    expect(groups.get("🕹️ Steam 联机")?.proxies?.[0]).toBe("GLOBAL");
    expect(groups.get("📺 哔哩哔哩")?.proxies?.[0]).toBe("DIRECT");
    expect(groups.get("📺 巴哈姆特")?.proxies?.[0]).toBe("🇨🇳 台湾");
    expect(groups.get("💬 Discord")?.proxies).toContain("GLOBAL");
    expect(groups.get("🍎 Apple")?.proxies).toEqual(groups.get("🤖 AI")?.proxies);
  });

  it("keeps the exits shown on the site aligned with the published override", async () => {
    const config = parse(await readFile(overridePath, "utf8")) as {
      "+proxy-groups": Array<{ name: string; proxies?: string[] }>;
    };
    const groups = new Map(
      config["+proxy-groups"].map((group) => [group.name, group]),
    );

    for (const policy of businessProxyGroupNames) {
      const name = policyDisplayName(policy);
      expect(groups.get(name)?.proxies, name).toEqual(policyOptions(policy));
    }
  });
});
