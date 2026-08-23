import { describe, expect, it } from "vitest";

import { createSingBoxProfile } from "../src/worker/sing-box-profile";

describe("createSingBoxProfile", () => {
  it("builds a sing-box configuration with selectors and remote rule sets", () => {
    const output = createSingBoxProfile(JSON.stringify({
      outbounds: [
        {
          type: "shadowsocks",
          tag: "US-01",
          server: "us.example.com",
          server_port: 8388,
          method: "aes-128-gcm",
          password: "test",
        },
        {
          type: "vless",
          tag: "JP-01",
          server: "jp.example.com",
          server_port: 443,
          uuid: "00000000-0000-4000-8000-000000000000",
        },
      ],
      endpoints: [{ type: "wireguard", tag: "private-endpoint" }],
    }));
    const config = JSON.parse(output) as Record<string, unknown>;

    expect(config.inbounds).toEqual([
      expect.objectContaining({
        type: "tun",
        tag: "tun-in",
        auto_route: true,
        strict_route: true,
      }),
    ]);
    expect(config.endpoints).toEqual([
      { type: "wireguard", tag: "private-endpoint" },
    ]);
    expect(config.outbounds).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "shadowsocks", tag: "US-01" }),
      expect.objectContaining({ type: "urltest", tag: "AUTO", outbounds: ["US-01", "JP-01"] }),
      expect.objectContaining({ type: "selector", tag: "US", outbounds: ["US-01"] }),
      expect.objectContaining({ type: "selector", tag: "JP", outbounds: ["JP-01"] }),
      expect.objectContaining({
        type: "selector",
        tag: "AI",
        outbounds: ["GLOBAL", "US", "JP", "SG", "TW"],
      }),
    ]));
    expect(config.http_clients).toEqual([
      { tag: "rule-download" },
    ]);
    expect(config.route).toEqual(expect.objectContaining({
      final: "DEFAULT",
      auto_detect_interface: true,
      default_http_client: "rule-download",
      default_domain_resolver: "local",
      rules: expect.arrayContaining([
        {
          process_name: ["codex", "codex.exe", "claude", "claude.exe"],
          action: "route",
          outbound: "AI",
        },
        { rule_set: ["ai-openai"], action: "route", outbound: "AI" },
      ]),
      rule_set: expect.arrayContaining([
        {
          type: "remote",
          tag: "ai-openai",
          format: "source",
          url: "https://rules.flacier.com/rules/sing-box/ai-openai.json",
          update_interval: "1d",
        },
      ]),
    }));
  });

  it("rejects a node resource without usable outbounds", () => {
    expect(() => createSingBoxProfile('{"outbounds":[]}')).toThrow(
      "sing-box node resource is invalid",
    );
  });
});
