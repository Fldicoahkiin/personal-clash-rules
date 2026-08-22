import { describe, expect, it } from "vitest";

import { describePolicyRoute } from "../src/app/lib/policy-groups";

describe("describePolicyRoute", () => {
  it("labels fixed direct rules as direct", () => {
    expect(describePolicyRoute("DIRECT")).toEqual({
      mode: "直连",
      route: "DIRECT",
    });
  });

  it("labels proxy-first groups with their initial route", () => {
    expect(describePolicyRoute("AI")).toEqual({
      mode: "默认代理",
      route: "AI → GLOBAL",
    });
  });

  it("does not call direct-first groups proxy routes", () => {
    expect(describePolicyRoute("STEAM")).toEqual({
      mode: "默认直连",
      route: "STEAM → DIRECT",
    });
  });
});
