import { mihomoProfileRules, mihomoRuleProviders } from "../../config/mihomo-policy";
import { groupNotes } from "./group-notes";
import { policyDisplayName } from "./policy-groups";

export interface StationRule {
  /** 1-based position in the Mihomo rule list. */
  position: number;
  text: string;
  type: string;
  value: string;
  /** Published rule file for RULE-SET rules, as a same-origin path such as /rules/apple/download.list. */
  provider?: { id: string; path: string };
}

/** The rule a URL test stopped at, by its 1-based position. */
export interface StationMatch {
  position: number;
  uncertain: boolean;
}

export interface RouteStation {
  id: string;
  first: number;
  last: number;
  policy: string;
  rules: StationRule[];
}

function parseRule(text: string, position: number): StationRule & { policy: string } {
  const parts = text.split(",");
  const end = parts.at(-1) === "no-resolve" ? -2 : -1;
  const [type] = parts;
  const value = parts.slice(1, end).join(",");
  const rule: StationRule & { policy: string } = { position, text, type, value, policy: parts.at(end)! };
  if (type === "RULE-SET") {
    const provider = mihomoRuleProviders[value];
    if (!provider) throw new Error(`Rule ${position} references an unknown rule set: ${value}`);
    rule.provider = { id: value, path: new URL(provider.url).pathname };
  }
  return rule;
}

// The rules after MATCH only carry UDP that a chosen exit cannot send; ordinary traffic never reaches them.
const matchPosition = mihomoProfileRules.findIndex(rule => rule.startsWith("MATCH,")) + 1;

/** Consecutive rules that send traffic to the same policy, in the order Mihomo evaluates them. */
export const routeStations: RouteStation[] = mihomoProfileRules
  .slice(0, matchPosition)
  .map((text, index) => parseRule(text, index + 1))
  // Rules limited to UDP, such as browser STUN, do not decide where a web request goes.
  .filter(rule => !rule.text.includes("(NETWORK,UDP)"))
  .reduce<RouteStation[]>((stations, { policy, ...rule }) => {
    const last = stations.at(-1);
    if (last?.policy === policy) {
      last.rules.push(rule);
      last.last = rule.position;
    } else {
      stations.push({ id: `route-${rule.position}`, first: rule.position, last: rule.position, policy, rules: [rule] });
    }
    return stations;
  }, []);

export function stationAt(position: number): RouteStation | undefined {
  return routeStations.find(station => station.first <= position && position <= station.last);
}

function directoryOf(path: string): string {
  return path.slice(0, path.lastIndexOf("/") + 1);
}

/** Stations whose rule files share a directory with this one, such as the six Apple lists, in rule order. */
export function stationFamily(station: RouteStation): RouteStation[] {
  const directories = new Set(station.rules.flatMap(rule => rule.provider ? [directoryOf(rule.provider.path)] : []));
  return routeStations.filter(candidate => candidate.rules.some(rule => rule.provider && directories.has(directoryOf(rule.provider.path))));
}

export function stationTitle(station: RouteStation): string {
  return groupNotes[station.policy]?.title ?? policyDisplayName(station.policy);
}

export function stationPositions(station: RouteStation): string {
  return station.first === station.last ? `第 ${station.first} 条` : `第 ${station.first}–${station.last} 条`;
}
