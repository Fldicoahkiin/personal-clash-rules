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
        label: "规则",
        value: "DOMAIN-SUFFIX,openai.com",
        detail: "OpenAI",
        state: "pass",
        status: "通过",
      }),
      expect.objectContaining({
        label: "策略",
        value: "AI → GLOBAL",
        detail: "AI",
      }),
      expect.objectContaining({
        label: "结果",
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
        label: "规则",
        value: "未命中具体规则",
        detail: "转入 MATCH",
        state: "stop",
        status: "未通过",
      }),
      expect.objectContaining({
        label: "策略",
        value: "DEFAULT → GLOBAL",
        detail: "DEFAULT",
      }),
      expect.objectContaining({
        label: "结果",
        value: "PROXY",
        detail: "代理",
      }),
    ]);
  });
});
