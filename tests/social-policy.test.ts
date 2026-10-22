import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { createRuleSet, matchUrl, type RuleSetDefinition } from "../src/app/lib/rule-matcher";
import { mihomoPolicyDisplayNames, mihomoRules } from "../src/config/mihomo-policy";
import { createRolaTemplate, prepareRolaProfile } from "../src/worker/residential-profile";
import { createMihomoProfile } from "../src/worker/mihomo-profile";
import { createShadowrocketProfile } from "../src/worker/shadowrocket-profile";

const apps = ["telegram", "x", "reddit", "instagram", "facebook", "linkedin", "tiktok"];
const read = (path: string) => readFileSync(new URL(`../public/${path}`, import.meta.url), "utf8");
const definitions = (parse(read("rules/manifest.yaml")) as { ruleSets: RuleSetDefinition[] }).ruleSets;
const sets = definitions.filter(definition => [...apps, "social", "discord", "tencent-messaging", "china-domains"].includes(definition.id))
  .map(definition => createRuleSet(definition, read(definition.path)));
const lines = (id: string) => read(`rules/social/${id}.list`).split(/\r?\n/).filter(line => line && !line.startsWith("#"));

describe("per-app social policies", () => {
  it("partitions the existing aggregate without losing or duplicating a domain", () => {
    const split = apps.flatMap(lines);
    expect(split.length).toBe(new Set(split).size);
    expect(new Set(split)).toEqual(new Set(lines("social")));
  });

  it.each([
    ["t.me", "TELEGRAM"], ["pbs.twimg.com", "X"], ["i.redd.it", "REDDIT"],
    ["threads.net", "INSTAGRAM"], ["cdninstagram.com", "INSTAGRAM"], ["scontent.fbcdn.net", "FACEBOOK"],
    ["media.licdn.com", "LINKEDIN"], ["v.tiktokcdn.com", "TIKTOK"],
    ["discord.com", "DISCORD"], ["wx.qq.com", "DIRECT"], ["douyin.com", "DIRECT"],
  ])("matches %s to %s in the app and domestic domain lists", (host, policy) => {
    expect(matchUrl(host, sets)).toMatchObject({ matched: true, policy });
  });

  it("routes every app by its own group and leaves the fully covered aggregate out of generated rules", () => {
    for (const id of apps) {
      expect(mihomoRules, id).toContain(`RULE-SET,${id},${id.toUpperCase()}`);
    }
    expect(mihomoRules.some(rule => rule.startsWith("RULE-SET,social,"))).toBe(false);
    expect(matchUrl("twitter.com.example.invalid", sets).matched).toBe(false);
  });

  it("gives each app the same residential, country and node choices without changing its global default", () => {
    const source = createMihomoProfile("proxies: [{name: Airport, type: trojan, server: airport.example, port: 443, password: demo}]");
    const settings = {
      ...createRolaTemplate([]), authMode: "literal", connectionMode: "direct", upstreamNode: "",
      protocol: "socks5", server: "198.51.100.1", port: 1080, account: "demo", password: "demo",
      name: "Test home", country: "us",
    };
    const profile = parse(prepareRolaProfile(source, settings).profile);
    for (const id of apps) {
      const name = mihomoPolicyDisplayNames[id.toUpperCase()];
      const group = profile["proxy-groups"].find((group: { name: string }) => group.name === name);
      expect(group.proxies[0]).toBe("GLOBAL");
      expect(group.proxies).toEqual(expect.arrayContaining(["ROLA", "🇺🇸 美国", "🖐 手动选择", "DIRECT"]));
      expect(group["include-all"]).toBe(true);
    }
  });

  it("keeps app rule coverage while letting Shadowrocket use its homepage node", () => {
    const output = createShadowrocketProfile(["US-01", "JP-01"]);
    for (const id of apps) {
      expect(output).toContain(`RULE-SET,https://rules.flacier.com/rules/social/${id}.list,PROXY`);
    }
    expect(output).not.toContain("[Proxy Group]");
    expect(output).toContain("RULE-SET,https://rules.flacier.com/rules/direct/tencent-messaging.list,DIRECT");
  });
});
