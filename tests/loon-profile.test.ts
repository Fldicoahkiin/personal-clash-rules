import { describe, expect, it } from "vitest";

import { createLoonProfile } from "../src/worker/loon-profile";

const nodes = [
  "US-01=shadowsocks,us.example.com,8388,aes-128-gcm,\"test\",udp=true",
  "TW-01=shadowsocks,tw.example.com,8388,aes-128-gcm,\"test\",udp=true",
].join("\n");

describe("createLoonProfile", () => {
  it("builds a remote configuration with explicit node groups and rules", () => {
    const output = createLoonProfile(nodes);

    expect(output).toContain("[Proxy]\nUS-01=shadowsocks");
    expect(output).toContain("US = select, US-01");
    expect(output).toContain("TW = select, TW-01");
    expect(output).toContain("AI = select, GLOBAL, US, JP, SG, TW");
    expect(output).toContain("[Remote Rule]");
    expect(output).toContain(
      "https://rules.flacier.com/rules/ai/openai.list, policy=AI, tag=ai-openai, enabled=true",
    );
    expect(output).toContain("FINAL,DEFAULT");
  });

  it("rejects text without Loon proxy lines", () => {
    expect(() => createLoonProfile("not a node")).toThrow(
      "Loon node resource is invalid",
    );
  });
});
