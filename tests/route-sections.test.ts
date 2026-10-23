import { describe, expect, it } from "vitest";

import { mihomoProfileRules } from "../src/config/mihomo-policy";
import { routeSections, sectionAt, sectionExit } from "../src/app/lib/route-sections";

describe("route sections", () => {
  it("cover every rule once, in order, without gaps", () => {
    expect(routeSections[0].first).toBe(1);
    expect(routeSections.at(-1)!.last).toBe(mihomoProfileRules.length);
    routeSections.slice(1).forEach((section, i) => expect(section.first).toBe(routeSections[i].last + 1));
    for (const section of routeSections) expect(section.last).toBeGreaterThanOrEqual(section.first);
  });

  it("start each section at its anchor rule", () => {
    expect(mihomoProfileRules[sectionAt(1)!.first - 1]).toMatch(/^PROCESS-NAME,/u);
    expect(routeSections.find(section => section.id === "stun")!.modes).toEqual(["代理"]);
    expect(routeSections.find(section => section.id === "rest")!.first).toBe(mihomoProfileRules.findIndex(rule => rule.startsWith("MATCH,")) + 1);
  });

  it("describe how each section leaves and where proxied traffic goes", () => {
    const byId = Object.fromEntries(routeSections.map(section => [section.id, section]));
    expect(byId.process.modes).toEqual(["直连"]);
    expect(byId.process.exits).toEqual([]);
    expect(byId.apple.modes).toEqual(["直连", "代理"]);
    expect(byId.ai.modes).toEqual(["代理"]);
    expect(sectionExit(byId.ai)).toBe("Claude、AI");
    expect(sectionExit(byId["anthropic-ip"])).toBe("Claude");
    expect(sectionExit(byId.rest)).toBe("未匹配流量、自动选择");
  });
});
