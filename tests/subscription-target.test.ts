import { describe, expect, it } from "vitest";

import { targetForUserAgent } from "../src/worker/subscription-target";

describe("targetForUserAgent", () => {
  it.each([
    ["Stash/3.1", "stash"],
    ["Surge iOS/3004", "surge"],
    ["Surfboard/2.24", "surfboard"],
    ["Loon/3.2", "loon"],
    ["Egern/1.16", "egern"],
    ["Shadowrocket/2.2", "shadowrocket"],
    ["Quantumult%20X/1.5", "quantumult-x"],
    ["sing-box/1.12", "sing-box"],
    ["v2rayN/7.0", "v2ray"],
    ["clash-verge/v2.0", "mihomo"],
    ["unknown-client/1.0", "mihomo"],
  ])("maps %s to %s", (userAgent, target) => {
    expect(targetForUserAgent(userAgent)).toBe(target);
  });
});
