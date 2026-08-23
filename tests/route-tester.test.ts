import { describe, expect, it } from "vitest";

import { createRouteSteps } from "../src/app/lib/route-steps";

describe("createRouteSteps", () => {
  it("shows the concrete matching rule and proxy destination", () => {
    const result = {
      hostname: "api.openai.com",
      matched: true,
      rule: "DOMAIN-SUFFIX,openai.com",
      ruleSetId: "ai-openai",
      ruleSetLabel: "OpenAI",
      policy: "AI",
    };

    expect(createRouteSteps(result)).toEqual([
      expect.objectContaining({ label: "网址", value: "api.openai.com" }),
      expect.objectContaining({
        label: "命中规则",
        value: "DOMAIN-SUFFIX,openai.com",
        detail: "OpenAI",
        state: "pass",
        status: "通过",
      }),
      expect.objectContaining({
        label: "策略组",
        value: "AI → GLOBAL",
        detail: "",
      }),
      expect.objectContaining({
        label: "去向",
        value: "PROXY",
        detail: "代理",
      }),
    ]);
  });

  it("labels fallback routing as an unmatched rule before the final route", () => {
    const result = {
      hostname: "baidu.com",
      matched: false,
      rule: "MATCH",
      ruleSetId: "default",
      ruleSetLabel: "默认规则",
      policy: "DEFAULT",
    };

    expect(createRouteSteps(result)).toEqual([
      expect.objectContaining({ label: "网址", value: "baidu.com" }),
      expect.objectContaining({
        label: "命中规则",
        value: "MATCH",
        detail: "默认规则",
        state: "stop",
        status: "未通过",
      }),
      expect.objectContaining({
        label: "策略组",
        value: "DEFAULT → GLOBAL",
        detail: "",
      }),
      expect.objectContaining({
        label: "去向",
        value: "PROXY",
        detail: "代理",
      }),
    ]);
  });

  it("shows direct routing without making the policy name the final result", () => {
    const result = {
      hostname: "gsa.apple.com",
      matched: true,
      rule: "DOMAIN,gsa.apple.com",
      ruleSetId: "apple",
      ruleSetLabel: "Apple",
      policy: "APPLE",
    };

    expect(createRouteSteps(result)).toEqual([
      expect.objectContaining({ label: "网址", value: "gsa.apple.com" }),
      expect.objectContaining({
        label: "命中规则",
        value: "DOMAIN,gsa.apple.com",
        detail: "Apple",
        state: "pass",
        status: "通过",
      }),
      expect.objectContaining({
        label: "策略组",
        value: "APPLE → DIRECT",
        detail: "",
      }),
      expect.objectContaining({
        label: "去向",
        value: "DIRECT",
        detail: "直连",
      }),
    ]);
  });
});
