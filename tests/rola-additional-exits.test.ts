import { describe, expect, it } from "vitest";
import { additionalRolaExitError } from "../src/app/features/subscriptions/rola-api";

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
