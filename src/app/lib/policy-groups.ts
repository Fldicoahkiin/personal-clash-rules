import { businessProxyGroupNames, displayMihomoGroup, mihomoPolicyDisplayNames, mihomoProxyGroups } from "../../config/mihomo-policy";

export const displayedPolicyGroups = mihomoProxyGroups
  .filter(group => businessProxyGroupNames.some(name => name === group.name))
  .map(group => {
    const displayed = displayMihomoGroup(group);
    const options = displayed.proxies ?? [];
    return { name: displayed.name, initial: options[0], options };
  });

export function describePolicyRoute(policy: string): {
  mode: string;
  route: string;
  target: "DIRECT" | "PROXY";
} {
  if (policy === "DIRECT") {
    return { mode: "直连", route: "DIRECT", target: "DIRECT" };
  }

  const group = displayedPolicyGroups.find((item) => item.name === (mihomoPolicyDisplayNames[policy] ?? policy));
  if (!group) {
    return { mode: "代理", route: policy, target: "PROXY" };
  }

  return {
    mode: group.initial === "DIRECT" ? "直连" : "代理",
    route: `${group.name} → ${group.initial}`,
    target: group.initial === "DIRECT" ? "DIRECT" : "PROXY",
  };
}
