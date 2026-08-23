import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import {
  mihomoProxyGroups,
  mihomoRuleProviders,
  mihomoRules,
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
    expect(config["+proxy-groups"]).toEqual(mihomoProxyGroups);
    expect(config["+rules"]).toEqual(mihomoRules);
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

    expect(config["+rules"].slice(0, 6)).toEqual([
      "RULE-SET,private-domain,DIRECT",
      "RULE-SET,private-ip,DIRECT,no-resolve",
      "RULE-SET,apple-system,DIRECT",
      "RULE-SET,apple-services,APPLE",
      "PROCESS-NAME-REGEX,(?i)^codex(\\.exe)?$,AI",
      "PROCESS-NAME-REGEX,(?i)^claude(\\.exe)?$,AI",
    ]);
    expect(config["+rules"]).toContain("RULE-SET,ai-xai,AI");
    expect(config["+rules"]).toContain("RULE-SET,steam,STEAM");
    expect(config["+rules"]).toContain(
      "RULE-SET,steam-download,STEAM-DOWNLOAD",
    );
    expect(config["+rules"]).toContain("RULE-SET,steam-online,STEAM-ONLINE");
    expect(config["+rules"]).toContain("RULE-SET,bilibili,BILIBILI");
    expect(config["+rules"]).toContain("RULE-SET,anigamer,ANIGAMER");
    expect(config["+rules"]).toContain("RULE-SET,discord,DISCORD");
    expect(config["+rules"]).toContain("RULE-SET,apple-system,DIRECT");
    expect(config["+rules"]).toContain("RULE-SET,apple-services,APPLE");

    expect(config["+rules"].indexOf("RULE-SET,apple-system,DIRECT"))
      .toBeLessThan(config["+rules"].indexOf("RULE-SET,apple-services,APPLE"));
    expect(config["+rules"].indexOf("RULE-SET,steam-download,STEAM-DOWNLOAD"))
      .toBeLessThan(config["+rules"].indexOf("RULE-SET,steam-online,STEAM-ONLINE"));
    expect(config["+rules"].indexOf("RULE-SET,steam-online,STEAM-ONLINE"))
      .toBeLessThan(config["+rules"].indexOf("RULE-SET,steam,STEAM"));
    expect(config["+rules"].indexOf("RULE-SET,bilibili,BILIBILI"))
      .toBeLessThan(config["+rules"].indexOf("RULE-SET,media,MEDIA"));
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

    for (const country of ["US", "JP", "SG", "HK", "TW", "KR", "EU"]) {
      expect(groups.get(country)?.type, country).toBe("select");
      expect(groups.get(country)?.filter, country).toBeTruthy();
      expect(groups.get(country)?.["empty-fallback"], country).toBe("DIRECT");
      expect(groups.get(country)?.["exclude-type"], country).toBe("direct");
    }
    expect(groups.get("AI")?.proxies).toEqual([
      "GLOBAL",
      "US",
      "JP",
      "SG",
      "TW",
    ]);
    expect(groups.get("STEAM")?.proxies).toContain("DIRECT");
    expect(groups.get("STEAM")?.proxies?.[0]).toBe("DIRECT");
    expect(groups.get("STEAM-DOWNLOAD")?.proxies?.[0]).toBe("DIRECT");
    expect(groups.get("STEAM-ONLINE")?.proxies?.[0]).toBe("DIRECT");
    expect(groups.get("BILIBILI")?.proxies?.[0]).toBe("DIRECT");
    expect(groups.get("ANIGAMER")?.proxies?.[0]).toBe("TW");
    expect(groups.get("DISCORD")?.proxies).toContain("GLOBAL");
    expect(groups.get("APPLE")?.proxies).toEqual([
      "DIRECT",
      "GLOBAL",
      "US",
      "JP",
      "SG",
    ]);
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
