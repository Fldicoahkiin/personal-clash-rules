import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import {
  displayMihomoGroup,
  displayMihomoRule,
  mihomoProxyGroups,
  mihomoRuleProviders,
  mihomoProfileRules,
} from "../src/config/mihomo-policy";
import { displayedPolicyGroups } from "../src/app/lib/policy-groups";

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

    expect(config["rule-providers"]).toEqual(mihomoRuleProviders);
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

    expect(config["+rules"].slice(0, 14)).toEqual([
      "PROCESS-NAME,WeChat,DIRECT",
      "PROCESS-NAME,WeChatAppEx,DIRECT",
      "PROCESS-NAME,QQ,DIRECT",
      "PROCESS-NAME,QQ Helper,DIRECT",
      "PROCESS-NAME,NeteaseMusic,DIRECT",
      "PROCESS-NAME,NeteaseMusic Helper,DIRECT",
      "RULE-SET,private-domain,DIRECT",
      "RULE-SET,private-ip,DIRECT,no-resolve",
      "RULE-SET,tencent-messaging,DIRECT",
      "RULE-SET,netease-music,DIRECT",
      "RULE-SET,apple-system,🍎 Apple",
      "RULE-SET,apple-services,🍎 Apple",
      "PROCESS-NAME-REGEX,(?i)^codex(\\.exe)?$,🤖 AI",
      "PROCESS-NAME-REGEX,(?i)^claude(\\.exe)?$,🤖 AI",
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
    expect(config["+rules"]).toContain("RULE-SET,apple-system,🍎 Apple");
    expect(config["+rules"]).toContain("RULE-SET,apple-services,🍎 Apple");

    expect(config["+rules"].indexOf("RULE-SET,apple-system,🍎 Apple"))
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

    for (const country of ["🇺🇸 美国", "🇯🇵 日本", "🇸🇬 新加坡", "🇭🇰 香港", "🇹🇼 台湾", "🇰🇷 韩国", "🇪🇺 欧洲"]) {
      expect(groups.get(country)?.type, country).toBe("select");
      expect(groups.get(country)?.filter, country).toBeTruthy();
      expect(groups.get(country), country).toHaveProperty("empty-fallback", "REJECT");
      expect(groups.get(country)?.["exclude-type"], country).toBe("direct");
    }
    expect(groups.get("🤖 AI")?.proxies).toEqual([
      "🌐 全局",
      "🖐 手动选择",
      "♻️ 自动选择",
      "🇺🇸 美国",
      "🇯🇵 日本",
      "🇸🇬 新加坡",
      "🇭🇰 香港",
      "🇹🇼 台湾",
      "🇰🇷 韩国",
      "🇪🇺 欧洲",
      "DIRECT",
    ]);
    expect(groups.get("🎮 Steam")?.proxies).toContain("DIRECT");
    expect(groups.get("🎮 Steam")?.proxies?.[0]).toBe("🌐 全局");
    expect(groups.get("📥 Steam 下载")?.proxies?.[0]).toBe("🌐 全局");
    expect(groups.get("🕹️ Steam 联机")?.proxies?.[0]).toBe("🌐 全局");
    expect(groups.get("📺 哔哩哔哩")?.proxies?.[0]).toBe("🌐 全局");
    expect(groups.get("📺 巴哈姆特")?.proxies?.[0]).toBe("🇹🇼 台湾");
    expect(groups.get("💬 Discord")?.proxies).toContain("🌐 全局");
    expect(groups.get("🍎 Apple")?.proxies).toEqual(groups.get("🤖 AI")?.proxies);
  });

  it("keeps the policy table aligned with the published override", async () => {
    const config = parse(await readFile(overridePath, "utf8")) as {
      "+proxy-groups": Array<{ name: string; proxies?: string[] }>;
    };
    const groups = new Map(
      config["+proxy-groups"].map((group) => [group.name, group]),
    );

    for (const policy of displayedPolicyGroups) {
      expect(groups.get(policy.name)?.proxies, policy.name).toEqual(
        policy.options,
      );
      expect(policy.options[0], policy.name).toBe(policy.initial);
    }
  });
});
