import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import {
  createMihomoProfile,
  createMihomoProviderProfile,
} from "../src/worker/mihomo-profile";

describe("createMihomoProfile", () => {
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
    expect(config.proxies).toHaveLength(2);
    expect(config["proxy-groups"]).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "AI", proxies: ["GLOBAL", "US", "JP", "SG", "TW"] }),
      expect.objectContaining({ name: "STEAM-DOWNLOAD", proxies: expect.arrayContaining(["DIRECT"]) }),
      expect.objectContaining({ name: "ANIGAMER", proxies: expect.arrayContaining(["TW"]) }),
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

  it("builds a client-fetched provider profile when a Worker fetch is blocked", () => {
    const output = createMihomoProviderProfile({
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
        name: "US",
        "include-all-providers": true,
        use: ["订阅 1"],
      }),
      expect.objectContaining({ name: "AI", proxies: expect.arrayContaining(["GLOBAL"]) }),
    ]));
    expect(config["proxy-groups"].find((group) => group.name === "US")).not.toHaveProperty(
      "empty-fallback",
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
});
