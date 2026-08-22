import { describe, expect, it } from "vitest";

import { convertRules } from "../src/app/lib/convert-rules";

describe("convertRules", () => {
  it("converts v2fly data and reports unresolved includes", () => {
    const result = convertRules({
      input: [
        "# OpenAI",
        "openai.com",
        "full:chat.openai.com",
        "regexp:^chatgpt-[0-9]+\\.example\\.com$",
        "tracker.example.com @ads",
        "include:shared-ai",
        "openai.com",
      ].join("\n"),
      inputFormat: "v2fly",
      outputFormat: "classical-text",
      policy: "AI",
      providerName: "ai-openai",
      providerUrl: "https://rules.example.com/rules/ai/openai.list",
    });

    expect(result.output).toBe(
      [
        "DOMAIN-SUFFIX,openai.com",
        "DOMAIN,chat.openai.com",
        "DOMAIN-REGEX,^chatgpt-[0-9]+\\.example\\.com$",
      ].join("\n"),
    );
    expect(result.count).toBe(3);
    expect(result.warnings).toEqual([
      "第 5 行带有属性 @ads，已跳过。",
      "第 6 行是 include 指令，浏览器无法展开外部文件，已跳过。",
      "第 7 行与已有规则重复，已跳过。",
    ]);
  });

  it("strips policies from classical rules and emits provider YAML", () => {
    const result = convertRules({
      input: [
        "DOMAIN-SUFFIX,claude.ai,AI",
        "DOMAIN,api.anthropic.com,AI",
      ].join("\n"),
      inputFormat: "classical",
      outputFormat: "classical-yaml",
      policy: "AI",
      providerName: "ai-anthropic",
      providerUrl: "https://rules.example.com/rules/ai/anthropic.list",
    });

    expect(result.output).toContain("payload:");
    expect(result.output).toContain("DOMAIN-SUFFIX,claude.ai");
    expect(result.output).not.toContain(",AI");
  });

  it("reads a YAML payload and generates a rule provider snippet", () => {
    const result = convertRules({
      input: [
        "payload:",
        "  - DOMAIN-SUFFIX,perplexity.ai",
        "  - DOMAIN,pplx-res.cloudinary.com",
      ].join("\n"),
      inputFormat: "yaml",
      outputFormat: "provider-snippet",
      policy: "AI",
      providerName: "ai-search",
      providerUrl: "https://rules.example.com/rules/ai/search.list",
    });

    expect(result.output).toContain("ai-search:");
    expect(result.output).toContain("behavior: classical");
    expect(result.output).toContain("RULE-SET,ai-search,AI");
    expect(result.count).toBe(2);
  });

  it("rejects regular expressions in Mihomo domain output", () => {
    expect(() =>
      convertRules({
        input: "DOMAIN-REGEX,^chat-[0-9]+\\.example\\.com$",
        inputFormat: "classical",
        outputFormat: "domain-text",
        policy: "AI",
        providerName: "ai",
        providerUrl: "https://rules.example.com/ai.list",
      }),
    ).toThrow("domain 文本不支持 DOMAIN-REGEX");
  });
});
