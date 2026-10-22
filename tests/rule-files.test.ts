import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { exampleHosts, findOverlaps, parseRuleFile, readCapped } from "../src/app/lib/rule-files";

function published(path: string) {
  return parseRuleFile(path, readFileSync(new URL(`../public${path}`, import.meta.url), "utf8"));
}

describe("parseRuleFile", () => {
  it("separates the header from commented sections and counts rule types", () => {
    const file = published("/rules/apple/services.list");
    expect(file.header[0]).toBe("Apple Account and App Store");
    expect(file.sections.map(section => section.title)).toEqual(["Apple Account authentication", "App Store and developer content"]);
    expect(file.sections[0].rules[0]).toBe("DOMAIN,account.apple.com");
    expect(file.count).toBe(file.sections.flatMap(section => section.rules).length);
    expect(Object.fromEntries(file.types)).toEqual({ DOMAIN: 4, "DOMAIN-SUFFIX": 9 });
    expect(file.complete).toBe(true);
  });

  it("keeps rules that follow the header directly in an untitled section", () => {
    const file = published("/rules/ai/anthropic.list");
    expect(file.sections[0]).toMatchObject({ title: "", rules: expect.arrayContaining(["DOMAIN-SUFFIX,claude.ai"]) });
    expect(file.sections.length).toBeGreaterThan(1);
  });

  it("offers domain rules as examples and skips IP ranges", () => {
    expect(exampleHosts(published("/rules/apple/download.list"), 2)).toEqual(["osxapps.itunes.apple.com", "iosapps.itunes.apple.com"]);
    expect(exampleHosts(published("/rules/ai/anthropic-ip.list"))).toEqual([]);
  });
});

describe("findOverlaps", () => {
  it("explains why the Apple download list comes before the store and iCloud lists", () => {
    const later = ["system", "services", "icloud", "media", "intelligence"].map(name => published(`/rules/apple/${name}.list`));
    const overlaps = findOverlaps(published("/rules/apple/download.list"), later);
    expect(overlaps[0]).toEqual({
      rule: "DOMAIN,osxapps.itunes.apple.com",
      coveredBy: "DOMAIN-SUFFIX,itunes.apple.com",
      path: "/rules/apple/services.list",
    });
  });

  it("reports nothing when no later list matches the same hosts", () => {
    expect(findOverlaps(published("/rules/apple/intelligence.list"), [published("/rules/apple/download.list")])).toEqual([]);
  });
});

describe("readCapped", () => {
  it("stops at the byte limit and drops the partial last line", async () => {
    const body = Array.from({ length: 2000 }, (_, index) => `DOMAIN-SUFFIX,example-${index}.com`).join("\n");
    const { text, complete } = await readCapped(new Response(body), 1024);
    expect(complete).toBe(false);
    expect(text.split("\n").every(line => /^DOMAIN-SUFFIX,example-\d+\.com$/u.test(line))).toBe(true);
  });

  it("returns a short file in full", async () => {
    expect(await readCapped(new Response("DOMAIN,a.com\n"), 1024)).toEqual({ text: "DOMAIN,a.com\n", complete: true });
  });
});
