import { describe, expect, it } from "vitest";

import { createMihomoProfile } from "../src/worker/mihomo-profile";
import { createRulePreview } from "../src/worker/rule-preview";
import { expandProfileRules } from "../src/worker/rule-template";

// Static assets use the single-page-application fallback: a missing file answers HTTP 200 with index.html.
const missingRuleFile: Pick<Env["ASSETS"], "fetch"> = {
  fetch: async () => new Response("<!doctype html><html lang=\"zh-CN\"></html>", { headers: { "Content-Type": "text/html; charset=utf-8" } }),
};

describe("published rule assets", () => {
  it("refuses the app page as rule preview content", async () => {
    await expect(createRulePreview("flacier", "", missingRuleFile)).rejects.toMatchObject({ status: 502, code: "rule_preview_failed" });
  });

  it("refuses the app page when expanding rules on /sub", async () => {
    const profile = createMihomoProfile("proxies: [{name: JP-01, type: ss, server: jp.example.com, port: 443, cipher: aes-128-gcm, password: test}]");
    await expect(expandProfileRules(profile, missingRuleFile)).rejects.toMatchObject({ status: 502, code: "source_failed" });
  });
});
