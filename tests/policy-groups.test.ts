import { describe, expect, it } from "vitest";

import { describePolicyRoute } from "../src/app/lib/policy-groups";
import { businessProxyGroupNames, mihomoProxyGroups } from "../src/config/mihomo-policy";
import { createMihomoProfile } from "../src/worker/mihomo-profile";
import { parse } from "yaml";

describe("business policy choices", () => {
  it("offers the same complete exits for every business policy without selector cycles", () => {
    const business = businessProxyGroupNames;
    const eligible = ["GLOBAL", "AUTO", "🇺🇸 美国固定 IP", "🇺🇸 美国", "🇯🇵 日本", "🇸🇬 新加坡", "🇭🇰 香港", "🇨🇳 台湾", "🇰🇷 韩国", "🇪🇺 欧洲", "DIRECT"];
    for (const name of business) {
      const group = mihomoProxyGroups.find(group => group.name === name);
      expect(group, name).toMatchObject({ "include-all": true });
      expect(group, name).not.toHaveProperty("exclude-type");
      expect(new Set(group?.proxies), name).toEqual(new Set(name === "CLAUDE" ? ["AI", ...eligible] : eligible));
      expect(group?.["exclude-filter"], name).toContain("剩余");
      const initial: Record<string, string> = { CLAUDE: "AI", ANIGAMER: "🇨🇳 台湾", BILIBILI: "DIRECT", "APPLE-DOWNLOAD": "DIRECT", "APPLE-SYSTEM": "DIRECT" };
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

  it("keeps the fixed-IP selector free of any vendor-specific pattern", () => {
    const group = mihomoProxyGroups.find(candidate => candidate.name === "🇺🇸 美国固定 IP");
    expect(group).toMatchObject({ type: "select", "include-all": true });
    expect(group).not.toHaveProperty("filter");
    expect(JSON.stringify(group)).not.toMatch(/digitalocean|vultr|linode|aws/iu);
  });

  it("limits the fixed-IP selector to the self-hosted nodes of the subscription", () => {
    const nodes = [
      { name: "🇺🇸 美国 01", type: "ss", server: "airport.example", port: 443, cipher: "aes-128-gcm", password: "p" },
      { name: "自建 A", type: "ss", server: "203.0.113.10", port: 443, cipher: "aes-128-gcm", password: "p" },
      { name: "自建 B", type: "ss", server: "203.0.113.10", port: 8443, cipher: "aes-128-gcm", password: "p" },
    ];
    const profile = parse(createMihomoProfile(JSON.stringify({ proxies: nodes }), "flacier", 6, "doh", undefined, undefined, ["自建 A", "自建 B"]));
    const groups = profile["proxy-groups"] as Array<{ name: string; proxies?: string[]; "include-all"?: boolean }>;
    const fixed = groups.find(group => group.name === "🇺🇸 美国固定 IP");
    // 显式成员，不靠名字正则；机场节点进不来。
    expect(fixed).toMatchObject({ type: "select", proxies: ["自建 A", "自建 B"], "empty-fallback": "REJECT" });
    expect(fixed).not.toHaveProperty("include-all");
    expect(fixed).not.toHaveProperty("filter");
    for (const name of ["GLOBAL", "🧠 Claude", "🤖 AI"]) {
      expect(groups.find(group => group.name === name)?.proxies, name).toContain("🇺🇸 美国固定 IP");
    }
  });

  it("omits the fixed-IP selector entirely for a subscription without self-hosted nodes", () => {
    const nodes = [{ name: "🇺🇸 美国 01", type: "ss", server: "airport.example", port: 443, cipher: "aes-128-gcm", password: "p" }];
    const profile = parse(createMihomoProfile(JSON.stringify({ proxies: nodes }), "flacier", 6, "doh", undefined, undefined, []));
    const groups = profile["proxy-groups"] as Array<{ name: string; proxies?: string[] }>;
    expect(groups.some(group => group.name === "🇺🇸 美国固定 IP")).toBe(false);
    for (const group of groups) expect(group.proxies ?? []).not.toContain("🇺🇸 美国固定 IP");
    // 其他出口不受影响。
    expect(groups.find(group => group.name === "GLOBAL")?.proxies).toContain("♻️ 自动选择");
  });

  it("keeps explicit DIRECT selectable without adding direct nodes to automatic or country pools", () => {
    for (const name of ["GLOBAL"]) {
      const group = mihomoProxyGroups.find(group => group.name === name);
      expect(group?.proxies, name).toContain("DIRECT");
      expect(group, name).not.toHaveProperty("exclude-type");
      expect(group?.["exclude-filter"], name).toContain("剩余");
    }
    for (const name of ["AUTO", "🇺🇸 美国", "🇯🇵 日本", "🇸🇬 新加坡", "🇭🇰 香港", "🇨🇳 台湾", "🇰🇷 韩国", "🇪🇺 欧洲"]) {
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
