import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const overridePath = resolve(
  import.meta.dirname,
  "../public/overrides/clash-party.yaml",
);

describe("Clash Party override", () => {
  it("prepends process, service and local network rules in order", async () => {
    const config = parse(await readFile(overridePath, "utf8")) as {
      "+rules": string[];
    };

    expect(config["+rules"].slice(0, 4)).toEqual([
      "RULE-SET,private-domain,DIRECT",
      "RULE-SET,private-ip,DIRECT,no-resolve",
      "PROCESS-NAME-REGEX,(?i)^codex(\\.exe)?$,AI",
      "PROCESS-NAME-REGEX,(?i)^claude(\\.exe)?$,AI",
    ]);
    expect(config["+rules"]).toContain("RULE-SET,ai-xai,AI");
    expect(config["+rules"]).toContain("RULE-SET,steam,STEAM");
    expect(config["+rules"]).toContain("RULE-SET,discord,DISCORD");
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
    expect(groups.get("DISCORD")?.proxies).toContain("GLOBAL");
  });
});
