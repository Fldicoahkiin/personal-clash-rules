import { describe, expect, it } from "vitest";

import { createLoonProfile } from "../src/worker/loon-profile";

const nodes = [
  "US-01=shadowsocks,us.example.com,8388,aes-128-gcm,\"test\",udp=true",
  "TW-01=shadowsocks,tw.example.com,8388,aes-128-gcm,\"test\",udp=true",
].join("\n");

describe("createLoonProfile", () => {
  it("builds a remote configuration with explicit node groups and rules", () => {
    const output = createLoonProfile(nodes, 12);

    expect(output).toContain("[Proxy]\nUS-01=shadowsocks");
    expect(output).toContain("🇺🇸 美国 = select, US-01");
    expect(output).toContain("🇹🇼 台湾 = select, TW-01");
    expect(output).toContain("AI = select, GLOBAL, 🇺🇸 美国, 🇯🇵 日本, 🇸🇬 新加坡, 🇹🇼 台湾");
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
