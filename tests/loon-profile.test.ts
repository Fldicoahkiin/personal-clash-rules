import { describe, expect, it } from "vitest";

import { createLoonProfile } from "../src/worker/loon-profile";

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
    expect(groups).toContain("🇹🇼 台湾 = select, TW-01");
    expect(() => createLoonProfile(quota)).toThrow("no selectable nodes");
  });

  it("builds a remote configuration with explicit node groups and rules", () => {
    const output = createLoonProfile(nodes, 12);

    expect(output).toContain("[Proxy]\nUS-01=shadowsocks");
    expect(output).toContain("🇺🇸 美国 = select, US-01");
    expect(output).toContain("🇹🇼 台湾 = select, TW-01");
    expect(output).toContain("AI = select, GLOBAL, 🖐 手动选择, AUTO, 🇺🇸 美国, 🇹🇼 台湾, DIRECT, US-01, TW-01");
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
