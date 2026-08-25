import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { createEgernProfile } from "../src/worker/egern-profile";

describe("createEgernProfile", () => {
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
      { select: expect.objectContaining({ name: "AI", policies: ["GLOBAL", "US", "JP", "SG", "TW"] }) },
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
