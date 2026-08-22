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
];

const ruleSets = [
  createRuleSet(definitions[0], "DOMAIN-SUFFIX,local\n"),
  createRuleSet(definitions[1], "IP-CIDR,192.168.0.0/16\n"),
  createRuleSet(definitions[2], "DOMAIN-SUFFIX,openai.com\n"),
  createRuleSet(definitions[3], "DOMAIN-SUFFIX,steamcontent.com\n"),
  createRuleSet(
    definitions[4],
    "DOMAIN-SUFFIX,steampowered.com\nDOMAIN-SUFFIX,steamcontent.com\n",
  ),
  createRuleSet(definitions[5], "DOMAIN-SUFFIX,gamer.com.tw\n"),
];

describe("matchUrl", () => {
  it("matches a scheme-less OpenAI URL", () => {
    expect(matchUrl("api.openai.com/v1/models", ruleSets)).toMatchObject({
      hostname: "api.openai.com",
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

  it("matches private IPv4 CIDR rules", () => {
    expect(matchUrl("http://192.168.1.20", ruleSets)).toMatchObject({
      ruleSetId: "private-ip",
      policy: "DIRECT",
    });
  });

  it("does not treat a partial suffix as a domain match", () => {
    expect(matchUrl("https://notopenai.com", ruleSets)).toMatchObject({
      rule: "MATCH",
      policy: "DEFAULT",
    });
  });
});
