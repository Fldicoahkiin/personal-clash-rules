import { businessProxyGroupNames, displayMihomoGroup, mihomoPolicyDisplayNames, mihomoProxyGroups } from "../../config/mihomo-policy";

const groupsByName = new Map(mihomoProxyGroups.map(group => [group.name, group]));
const businessGroups = new Set<string>(businessProxyGroupNames);

export function policyDisplayName(policy: string): string {
  return mihomoPolicyDisplayNames[policy] ?? policy;
}

// Follows each business group's initial choice until it reaches GLOBAL, DIRECT or a region group;
// what GLOBAL itself selects is the client's live choice, which the page cannot know.
export function exitPath(policy: string): { names: string[]; direct: boolean } {
  const path = [policy];
  let current = policy;
  while (businessGroups.has(current)) {
    const next = groupsByName.get(current)?.proxies?.[0];
    if (!next || path.includes(next)) break;
    path.push(next);
    current = next;
  }
  return { names: path.map(policyDisplayName), direct: current === "DIRECT" };
}

export function policyOptions(policy: string): readonly string[] {
  const group = groupsByName.get(policy);
  return group ? displayMihomoGroup(group).proxies ?? [] : [];
}

export function describePolicyRoute(policy: string): {
  mode: string;
  route: string;
  target: "DIRECT" | "PROXY";
} {
  const { names, direct } = exitPath(policy);
  return { mode: direct ? "直连" : "代理", route: names.join(" → "), target: direct ? "DIRECT" : "PROXY" };
}
