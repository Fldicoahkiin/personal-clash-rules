import { describe, expect, it } from "vitest";
import { additionalRolaExitError, rolaExitLabel, rolaPlatformError } from "../src/app/features/subscriptions/rola-api";

describe("residential platform labels", () => {
  it("uses platform, region, and exit IP with Rola as the empty-platform default", () => {
    const exit = { name: "legacy", exitIp: "203.0.113.10", region: " 美国 Las Vegas " };
    expect(rolaExitLabel(exit)).toBe("[Rola] 美国 Las Vegas · 203.0.113.10");
    expect(rolaExitLabel({ ...exit, platform: "  Provider-One  " })).toBe("[Provider-One] 美国 Las Vegas · 203.0.113.10");
    expect(rolaExitLabel({ ...exit, platform: " " })).toBe("[Rola] 美国 Las Vegas · 203.0.113.10");
  });

  it("preserves existing names when display metadata is absent or incomplete", () => {
    expect(rolaExitLabel({ name: "已有家宽", platform: "Rola" })).toBe("已有家宽");
    expect(rolaExitLabel({ name: "已有家宽", region: "美国", platform: "Other" })).toBe("已有家宽");
    expect(rolaExitLabel({ name: "已有家宽", exitIp: "203.0.113.10" })).toBe("已有家宽");
  });

  it("allows bounded platform labels and rejects config delimiters and control characters", () => {
    for (const platform of [undefined, "", " ", "Rola", "平台 A-1_test.io", "a".repeat(24)]) {
      expect(rolaPlatformError(platform)).toBe("");
    }
    for (const platform of ["a".repeat(25), "[Rola]", "Rola,Other", "Rola;Other", "Rola=Other", "Rola\n", "Rola\r", "Rola\t", "Rola\\Other", "Rola|Other"]) {
      expect(rolaPlatformError(platform)).not.toBe("");
    }
  });
});

describe("additional residential exit form guard", () => {
  it("allows the existing single-exit chain and up to seven additional direct exits", () => {
    expect(additionalRolaExitError("chain", 0)).toBe("");
    expect(additionalRolaExitError("direct", 7)).toBe("");
    expect(additionalRolaExitError("direct", 8)).toContain("最多");
  });

  it("blocks changing a multi-exit draft to a chain instead of silently dropping exits", () => {
    expect(additionalRolaExitError("chain", 1)).toContain("只支持直接接入");
    expect(additionalRolaExitError("chain", 7)).toContain("当前填写内容仍保留");
  });
});
