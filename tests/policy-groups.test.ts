import { describe, expect, it } from "vitest";

import { describePolicyRoute } from "../src/app/lib/policy-groups";

describe("describePolicyRoute", () => {
  it("labels fixed direct rules as direct", () => {
    expect(describePolicyRoute("DIRECT")).toEqual({
      mode: "直连",
      route: "DIRECT",
      target: "DIRECT",
    });
  });

  it("labels proxy-first groups with their initial route", () => {
    expect(describePolicyRoute("AI")).toEqual({
      mode: "代理",
      route: "AI → GLOBAL",
      target: "PROXY",
    });
  });

  it("does not call direct-first groups proxy routes", () => {
    expect(describePolicyRoute("STEAM")).toEqual({
      mode: "直连",
      route: "STEAM → DIRECT",
      target: "DIRECT",
    });
  });
});
