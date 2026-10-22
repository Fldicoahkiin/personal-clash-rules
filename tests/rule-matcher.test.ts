import { describe, expect, it } from "vitest";

import {
  createRuleSet,
  matchUrl,
  type RuleSetDefinition,
} from "../src/app/lib/rule-matcher";

const definitions: RuleSetDefinition[] = [
  {
    id: "private-domain",
    label: "本地网络",
    path: "rules/local/private-domain.list",
    policy: "DIRECT",
  },
  {
    id: "private-ip",
    label: "本地地址",
    path: "rules/local/private-ip.list",
    policy: "DIRECT",
  },
  {
    id: "ai-openai",
    label: "OpenAI",
    path: "rules/ai/openai.list",
    policy: "AI",
  },
  {
    id: "steam-download",
    label: "Steam 下载",
    path: "rules/gaming/steam-download.list",
    policy: "STEAM-DOWNLOAD",
  },
  {
    id: "steam",
    label: "Steam",
    path: "rules/gaming/steam.list",
    policy: "STEAM",
  },
  {
    id: "anigamer",
    label: "AniGamer",
    path: "rules/media/anigamer.list",
    policy: "ANIGAMER",
  },
  {
    id: "apple-system",
    label: "Apple 系统",
    path: "rules/apple/system.list",
    policy: "DIRECT",
  },
  {
    id: "apple-services",
    label: "Apple 服务",
    path: "rules/apple/services.list",
    policy: "APPLE",
  },
];

const ruleSets = [
  createRuleSet(definitions[0], "DOMAIN-SUFFIX,local\n"),
  createRuleSet(definitions[1], "IP-CIDR,192.168.0.0/16,no-resolve\n"),
  createRuleSet(definitions[2], "DOMAIN-SUFFIX,openai.com\n"),
  createRuleSet(definitions[3], "DOMAIN-SUFFIX,steamcontent.com\n"),
  createRuleSet(
    definitions[4],
    "DOMAIN-SUFFIX,steampowered.com\nDOMAIN-SUFFIX,steamcontent.com\n",
  ),
  createRuleSet(definitions[5], "DOMAIN-SUFFIX,gamer.com.tw\n"),
  createRuleSet(definitions[6], "DOMAIN,captive.apple.com\n"),
  createRuleSet(definitions[7], "DOMAIN,gsa.apple.com\n"),
];

describe("matchUrl", () => {
  it("skips a no-resolve GEOIP rule without an address but does not guess an address's country", () => {
    const rules = [createRuleSet(definitions[0], "GEOIP,CN,no-resolve\nDOMAIN-SUFFIX,example.com")];
    expect(matchUrl("www.example.com", rules)).toMatchObject({ matched: true, rule: "DOMAIN-SUFFIX,example.com" });
    expect(matchUrl("www.example.com", rules, { ip: "203.0.113.1" })).toMatchObject({
      matched: false, rule: "GEOIP,CN,no-resolve", uncertain: expect.stringContaining("GEOIP"),
    });
    for (const address of ["203.0.113.1", "[2001:db8::1]"]) {
      expect(matchUrl(address, rules)).toMatchObject({
        matched: false, rule: "GEOIP,CN,no-resolve", uncertain: expect.stringContaining("GEOIP"),
      });
    }
  });

  it("does not silently skip an earlier rule that needs client data", () => {
    const rules = [createRuleSet(definitions[0], "GEOIP,CN\nDOMAIN-SUFFIX,openai.com")];
    expect(matchUrl("api.openai.com", rules)).toMatchObject({ rule: "GEOIP,CN", matched: false, uncertain: expect.stringContaining("GEOIP") });
  });
  it("passes over UDP-only rules because the tester models a web request over TCP", () => {
    const rules = [
      createRuleSet({ id: "stun", label: "模板内规则", path: "", policy: "AUTO" },
        "AND,((NETWORK,UDP),(DST-PORT,3478/5349/19302-19309),(PROCESS-NAME-REGEX,^firefox$))"),
      createRuleSet({ id: "example", label: "模板内规则", path: "", policy: "DIRECT" }, "DOMAIN-SUFFIX,example.cn"),
    ];
    expect(matchUrl("www.example.cn", rules, { processName: "firefox" })).toMatchObject({ matched: true, policy: "DIRECT", ruleSetId: "example" });
  });

  it("uses supplied target IP without performing DNS resolution", () => {
    const rules = [createRuleSet(definitions[1], "IP-CIDR,192.168.0.0/16")];
    expect(matchUrl("nas.example", rules).uncertain).toContain("目标 IP");
    expect(matchUrl("nas.example", rules, { ip: "192.168.1.2" })).toMatchObject({ matched: true, policy: "DIRECT" });
  });
  it("respects the built-in process rule before a domain match", () => {
    const rules = [createRuleSet(definitions[2], "PROCESS-NAME-REGEX,(?i)^codex(\\.exe)?$\nDOMAIN-SUFFIX,openai.com")];
    expect(matchUrl("api.openai.com", rules)).toMatchObject({ rule: "DOMAIN-SUFFIX,openai.com", matched: true, skippedProcessRules: 1 });
    expect(matchUrl("api.openai.com", rules, { processName: "Codex.exe" }).rule).toContain("PROCESS-NAME-REGEX");
    expect(matchUrl("api.openai.com", rules, { processName: "Firefox" }).rule).toBe("DOMAIN-SUFFIX,openai.com");
  });
  it.each(["1..2.3", "1.2.3. 4", "1.2.3.-1", "1.2.3.256"])("rejects malformed supplied IPv4: %s", ip => {
    expect(() => matchUrl("example.com", ruleSets, { ip })).toThrow("目标 IPv4 格式有误");
  });
  it("evaluates the selected template's default, not Flacier's policy table", () => {
    const rules = [createRuleSet({ ...definitions[0], policy: "Custom" }, "MATCH")];
    expect(matchUrl("example.com", rules, { groups: [{ name: "Custom", type: "select", proxies: ["DIRECT"] }] })).toMatchObject({
      matched: false, destination: { mode: "直连", route: "Custom → DIRECT" },
    });
  });
  it("matches a scheme-less OpenAI URL", () => {
    expect(matchUrl("api.openai.com/v1/models", ruleSets)).toMatchObject({
      hostname: "api.openai.com",
      matched: true,
      rule: "DOMAIN-SUFFIX,openai.com",
      ruleSetId: "ai-openai",
      ruleSetLabel: "OpenAI",
      policy: "AI",
    });
  });

  it("keeps Steam download ahead of the broad Steam rule", () => {
    expect(matchUrl("https://cdn.steamcontent.com/file", ruleSets)).toMatchObject({
      ruleSetId: "steam-download",
      policy: "STEAM-DOWNLOAD",
    });
  });

  it("routes AniGamer to its policy", () => {
    expect(matchUrl("https://ani.gamer.com.tw/animeVideo.php", ruleSets)).toMatchObject({
      ruleSetId: "anigamer",
      policy: "ANIGAMER",
    });
  });

  it("routes Apple authentication separately from system endpoints", () => {
    expect(matchUrl("https://gsa.apple.com/auth", ruleSets)).toMatchObject({
      ruleSetId: "apple-services",
      policy: "APPLE",
    });
    expect(matchUrl("http://captive.apple.com", ruleSets)).toMatchObject({
      ruleSetId: "apple-system",
      policy: "DIRECT",
    });
  });

  it("matches private IPv4 CIDR rules", () => {
    expect(matchUrl("http://192.168.1.20", ruleSets)).toMatchObject({
      ruleSetId: "private-ip",
      policy: "DIRECT",
    });
  });

  it("does not treat a partial suffix as a domain match", () => {
    expect(matchUrl("https://notopenai.com", ruleSets)).toMatchObject({
      matched: false,
      rule: "MATCH",
      policy: "DEFAULT",
    });
  });
});
