import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

import { businessProxyGroupNames, countryGroupNames, mihomoPolicyDisplayNames as names, mihomoProfileRules } from "../src/config/mihomo-policy";
import { groupNotes } from "../src/app/lib/group-notes";
import { exitPath, policyOptions } from "../src/app/lib/policy-groups";
import { routeStations, stationAt, stationFamily } from "../src/app/lib/route-stations";

const manifest = parse(readFileSync(new URL("../public/rules/manifest.yaml", import.meta.url), "utf8")) as {
  ruleSets: Array<{ id: string; label: string; path: string }>;
};

describe("route stations", () => {
  it("cover every web rule up to MATCH once, in order, merging runs that share a policy", () => {
    const positions = routeStations.flatMap(station => station.rules.map(rule => rule.position));
    const matchPosition = mihomoProfileRules.findIndex(rule => rule.startsWith("MATCH,")) + 1;
    // UDP-only rules such as browser STUN do not route web requests and keep their real positions out of the map.
    expect(positions).toEqual(mihomoProfileRules.slice(0, matchPosition)
      .flatMap((rule, index) => rule.includes("(NETWORK,UDP)") ? [] : [index + 1]));
    for (const [index, station] of routeStations.entries()) {
      expect(station.first).toBe(station.rules[0].position);
      expect(station.last).toBe(station.rules.at(-1)!.position);
      if (index > 0) expect(station.policy, station.id).not.toBe(routeStations[index - 1].policy);
    }
    expect(routeStations.at(-1)).toMatchObject({ policy: "DEFAULT", rules: [{ type: "MATCH" }] });
  });

  it("keeps the Apple lists in their documented order", () => {
    const apple = routeStations.filter(station => station.rules.some(rule => rule.provider?.path.startsWith("/rules/apple/")));
    expect(apple.map(station => station.policy)).toEqual([
      "APPLE-DOWNLOAD", "APPLE-SYSTEM", "APPLE", "ICLOUD", "APPLE-MEDIA", "APPLE-INTELLIGENCE",
    ]);
    expect(apple.map(station => station.first)).toEqual(apple.map((_, index) => apple[0].first + index));
    expect(stationFamily(apple[0])).toEqual(apple);
  });

  it("finds the station for a rule position", () => {
    const download = routeStations.find(station => station.policy === "APPLE-DOWNLOAD")!;
    expect(stationAt(download.first)).toBe(download);
    expect(stationAt(1)?.policy).toBe("DIRECT");
    expect(stationAt(0)).toBeUndefined();
  });

  it("names every rule set it links to in the published manifest", () => {
    const published = new Map(manifest.ruleSets.map(entry => [entry.id, `/${entry.path}`]));
    for (const rule of routeStations.flatMap(station => station.rules)) {
      if (rule.provider) expect(published.get(rule.provider.id), rule.text).toBe(rule.provider.path);
    }
  });
});

describe("group notes", () => {
  it("explain exactly the policies the rules use", () => {
    const policies = new Set(routeStations.map(station => station.policy));
    expect(new Set(Object.keys(groupNotes))).toEqual(policies);
    expect(policies).toEqual(new Set(["DIRECT", ...businessProxyGroupNames]));
  });

  it("give a reason for every group that does not start on GLOBAL", () => {
    for (const [policy, note] of Object.entries(groupNotes)) {
      const { names } = exitPath(policy);
      if (names.length !== 2 || names[1] !== "GLOBAL") expect(note.defaultReason, policy).toBeTruthy();
    }
  });
});

describe("exitPath", () => {
  it("follows initial choices through business groups and stops at GLOBAL or a region", () => {
    expect(exitPath("CLAUDE")).toEqual({ names: [names.CLAUDE, names.AI, "GLOBAL"], direct: false });
    expect(exitPath("APPLE-DOWNLOAD")).toEqual({ names: [names["APPLE-DOWNLOAD"], "DIRECT"], direct: true });
    expect(exitPath("ANIGAMER")).toEqual({ names: [names.ANIGAMER, countryGroupNames.TW], direct: false });
    expect(exitPath("DIRECT")).toEqual({ names: ["DIRECT"], direct: true });
  });

  it("lists a group's selectable exits by display name", () => {
    expect(policyOptions("CLAUDE").slice(0, 2)).toEqual([names.AI, "GLOBAL"]);
    expect(policyOptions("APPLE-DOWNLOAD")).toContain(countryGroupNames.TW);
    expect(policyOptions("DIRECT")).toEqual([]);
  });
});
