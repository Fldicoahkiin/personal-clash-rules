import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { createEgernProfile } from "../src/worker/egern-profile";

describe("createEgernProfile", () => {
  it("hides unavailable countries and quota notices instead of creating direct fallback exits", () => {
    const source = "proxies: [{shadowsocks: {name: US-01}}, {shadowsocks: {name: 日本剩余流量}}]";
    const config = parse(createEgernProfile(source));
    const groups: Array<{ name: string; policies: string[] }> = config.policy_groups.map((group: Record<string, { name: string; policies: string[] }>) => Object.values(group)[0]);
    for (const group of groups) {
      expect(group.policies).not.toContain("日本剩余流量");
      expect(group.policies).not.toContain("🇯🇵 日本");
      expect(group.policies).not.toContain("🇭🇰 香港");
      expect(group.policies.length).toBeGreaterThan(0);
    }
    expect(groups.map(group => group.name)).not.toContain("🇯🇵 日本");
    expect(groups.map(group => group.name)).not.toContain("🇭🇰 香港");
    expect(groups.find(group => group.name === "ANIGAMER")?.policies[0]).toBe("GLOBAL");
    expect(() => createEgernProfile("proxies: [{shadowsocks: {name: 日本剩余流量}}]")).toThrow("no selectable nodes");
  });

  it("builds an Egern profile with policies and remote rule sets", () => {
    const output = createEgernProfile(`
proxies:
  - shadowsocks:
      name: US-01
      method: aes-128-gcm
      server: us.example.com
      port: 8388
      password: test
      udp_relay: true
`, 12);
    const config = parse(output) as Record<string, unknown>;

    expect(config.proxies).toHaveLength(1);
    expect(config.policy_groups).toEqual(expect.arrayContaining([
      { auto_test: expect.objectContaining({ name: "AUTO", policies: ["US-01"] }) },
      { select: expect.objectContaining({ name: "🇺🇸 美国", policies: ["US-01"] }) },
      { select: expect.objectContaining({ name: "AI", policies: expect.arrayContaining(["GLOBAL", "AUTO", "🇺🇸 美国", "DIRECT", "US-01"]) }) },
      { select: expect.objectContaining({ name: "APPLE", policies: expect.arrayContaining(["GLOBAL", "AUTO", "🇺🇸 美国", "DIRECT", "US-01"]) }) },
    ]));
    expect(config.rules).toEqual(expect.arrayContaining([
      {
        rule_set: expect.objectContaining({
          match: "https://rules.flacier.com/rules/egern/ai-openai.yaml",
          policy: "AI",
          update_interval: 43_200,
        }),
      },
      { default: { policy: "DEFAULT" } },
    ]));
  });
});
