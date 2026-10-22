import { describe, expect, it } from "vitest";

import { createLoonProfile } from "../src/worker/loon-profile";
import { countTargetCompatibleNodes, produceTarget } from "../src/worker/sub-store/produce";
import type { SubscriptionEnv } from "../src/worker/types";

const nodes = [
  "US-01=shadowsocks,us.example.com,8388,aes-128-gcm,\"test\",udp=true",
  "TW-01=shadowsocks,tw.example.com,8388,aes-128-gcm,\"test\",udp=true",
].join("\n");

describe("createLoonProfile", () => {
  it("hides unavailable countries and quota notices instead of creating direct fallback exits", () => {
    const quota = "日本剩余流量=shadowsocks,example.com,443,aes-128-gcm,\"test\",udp=true";
    const output = createLoonProfile(`${nodes}\n${quota}`);
    const groups = output.split("[Proxy Group]\n")[1].split("\n[Rule]")[0];
    expect(groups).not.toContain("日本剩余流量");
    expect(groups).not.toContain("🇯🇵 日本");
    expect(groups).not.toContain("🇭🇰 香港");
    expect(groups).toContain("🇨🇳 台湾 = select, TW-01");
    expect(() => createLoonProfile(quota)).toThrow("no selectable nodes");
  });

  it("builds a remote configuration with explicit node groups and rules", () => {
    const output = createLoonProfile(nodes, 12);

    expect(output).toContain("[Proxy]\nUS-01=shadowsocks");
    expect(output).toContain("🇺🇸 美国 = select, US-01");
    expect(output).toContain("🇨🇳 台湾 = select, TW-01");
    expect(output).toContain("AI = select, GLOBAL, AUTO, 🇺🇸 美国, 🇨🇳 台湾, DIRECT, US-01, TW-01");
    expect(output).toContain("[Remote Rule]");
    expect(output).toContain(
      "https://rules.flacier.com/rules/ai/openai.list, policy=AI, tag=ai-openai, enabled=true, update-interval=43200",
    );
    expect(output).toContain("FINAL,DEFAULT");
  });

  it("rejects text without Loon proxy lines", () => {
    expect(() => createLoonProfile("not a node")).toThrow(
      "Loon node resource is invalid",
    );
  });
});

describe("Loon node output", () => {
  it("counts and renders only node types the Loon renderer supports", async () => {
    const nodes = [
      { name: "SS", type: "ss", server: "ss.example.com", port: 8388, cipher: "aes-128-gcm", password: "test" },
      { name: "TUIC", type: "tuic", server: "tuic.example.com", port: 443, uuid: "00000000-0000-4000-8000-000000000001", password: "test" },
      { name: "WG", type: "wireguard", server: "wg.example.com", port: 51820, "private-key": "test", "public-key": "test" },
    ];
    expect(countTargetCompatibleNodes(nodes, "loon")).toBe(1);
    const output = await produceTarget({} as SubscriptionEnv, nodes, "loon");
    expect(output.split("\n")).toHaveLength(1);
    expect(output).toContain("SS=shadowsocks");
    await expect(produceTarget({} as SubscriptionEnv, nodes.slice(1), "loon")).rejects.toMatchObject({ code: "target_unsupported" });
  });
});

describe("full client configurations", () => {
  it.each(["loon-config", "surge-config", "sing-box-config"] as const)("rejects presets the %s renderer cannot express", async (target) => {
    const nodes = [{ name: "US-01", type: "ss", server: "ss.example.com", port: 8388, cipher: "aes-128-gcm", password: "test" }];
    await expect(produceTarget({} as SubscriptionEnv, nodes, target, "global")).rejects.toMatchObject({ code: "rule_preset_requires_mihomo" });
    await expect(produceTarget({} as SubscriptionEnv, nodes, target, "flacier")).resolves.toContain("US-01");
  });
});
