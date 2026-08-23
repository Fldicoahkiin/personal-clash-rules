import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { createMihomoProfile } from "../src/worker/mihomo-profile";

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
});
