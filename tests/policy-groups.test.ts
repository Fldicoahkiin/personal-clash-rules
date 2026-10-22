import { describe, expect, it } from "vitest";

import { describePolicyRoute } from "../src/app/lib/policy-groups";
import { businessProxyGroupNames, mihomoProxyGroups } from "../src/config/mihomo-policy";

describe("business policy choices", () => {
  it("offers the same complete exits for every business policy without selector cycles", () => {
    const business = businessProxyGroupNames;
    const eligible = ["GLOBAL", "🖐 手动选择", "AUTO", "🇺🇸 美国", "🇯🇵 日本", "🇸🇬 新加坡", "🇭🇰 香港", "🇹🇼 台湾", "🇰🇷 韩国", "🇪🇺 欧洲", "DIRECT"];
    for (const name of business) {
      const group = mihomoProxyGroups.find(group => group.name === name);
      expect(group, name).toMatchObject({ "include-all": true });
      expect(group, name).not.toHaveProperty("exclude-type");
      expect(new Set(group?.proxies), name).toEqual(new Set(name === "CLAUDE" ? ["AI", ...eligible] : eligible));
      expect(group?.["exclude-filter"], name).toContain("剩余");
      const initial: Record<string, string> = { CLAUDE: "AI", ANIGAMER: "🇹🇼 台湾", BILIBILI: "DIRECT", "APPLE-DOWNLOAD": "DIRECT", "APPLE-SYSTEM": "DIRECT" };
      expect(group?.proxies?.[0], name).toBe(initial[name] ?? "GLOBAL");
    }
    const byName = new Map(mihomoProxyGroups.map(group => [group.name, group]));
    const visit = (name: string, path: string[] = []) => {
      expect(path, `circular policy path: ${[...path, name].join(" → ")}`).not.toContain(name);
      for (const member of byName.get(name)?.proxies ?? []) {
        if (byName.has(member)) visit(member, [...path, name]);
      }
    };
    for (const name of byName.keys()) visit(name);
  });

  it("keeps explicit DIRECT selectable without adding direct nodes to automatic or country pools", () => {
    for (const name of ["🖐 手动选择", "GLOBAL"]) {
      const group = mihomoProxyGroups.find(group => group.name === name);
      expect(group?.proxies, name).toContain("DIRECT");
      expect(group, name).not.toHaveProperty("exclude-type");
      expect(group?.["exclude-filter"], name).toContain("剩余");
    }
    for (const name of ["AUTO", "🇺🇸 美国", "🇯🇵 日本", "🇸🇬 新加坡", "🇭🇰 香港", "🇹🇼 台湾", "🇰🇷 韩国", "🇪🇺 欧洲"]) {
      expect(mihomoProxyGroups.find(group => group.name === name), name).toHaveProperty("exclude-type", "direct");
    }
  });
});

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
      route: "🤖 AI → GLOBAL",
      target: "PROXY",
    });
  });

  it("keeps Steam proxy-first while allowing manual direct selection", () => {
    expect(describePolicyRoute("STEAM")).toEqual({
      mode: "代理",
      route: "🎮 Steam → GLOBAL",
      target: "PROXY",
    });
  });

  it("shows the domestic media group's direct default without hiding its selectable policy", () => {
    expect(describePolicyRoute("BILIBILI")).toEqual({
      mode: "直连",
      route: "📺 哔哩哔哩 → DIRECT",
      target: "DIRECT",
    });
  });
});
