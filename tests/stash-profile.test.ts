import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { createStashProfile } from "../src/worker/stash-profile";

describe("createStashProfile", () => {
  it("turns a Stash node resource into a complete configuration", () => {
    const output = createStashProfile(`
proxies:
  - name: TW-01
    type: ss
    server: tw.example.com
    port: 443
    cipher: aes-128-gcm
    password: test
`, 12);
    const config = parse(output) as Record<string, unknown>;

    expect(config.mode).toBe("rule");
    expect(config["profile-update-interval"]).toBe(12);
    expect((config["rule-providers"] as Record<string, { interval: number }>)["ai-openai"].interval)
      .toBe(43_200);
    expect(config.proxies).toHaveLength(1);
    expect(config["proxy-groups"]).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "AUTO", "include-all": true }),
      expect.objectContaining({ name: "ANIGAMER", proxies: ["TW", "GLOBAL", "DIRECT", "AUTO"] }),
    ]));
    expect(config["rule-providers"]).toMatchObject({
      "ai-openai": {
        behavior: "classical",
        format: "text",
      },
    });
    expect(config.rules).toEqual(expect.arrayContaining([
      "RULE-SET,ai-openai,AI",
      "MATCH,DEFAULT",
    ]));
  });
});
