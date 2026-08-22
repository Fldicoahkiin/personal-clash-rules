export const displayedPolicyGroups = [
  {
    name: "AI",
    initial: "GLOBAL",
    options: ["GLOBAL", "US", "JP", "SG", "TW"],
  },
  {
    name: "APPLE",
    initial: "DIRECT",
    options: ["DIRECT", "GLOBAL", "US", "JP", "SG"],
  },
  {
    name: "STEAM",
    initial: "DIRECT",
    options: ["DIRECT", "GLOBAL", "JP", "US", "SG"],
  },
  {
    name: "STEAM-DOWNLOAD",
    initial: "DIRECT",
    options: ["DIRECT", "GLOBAL", "JP", "US", "SG", "HK", "TW"],
  },
  {
    name: "STEAM-ONLINE",
    initial: "DIRECT",
    options: ["DIRECT", "GLOBAL", "JP", "US", "SG", "HK", "TW"],
  },
  {
    name: "BILIBILI",
    initial: "DIRECT",
    options: ["DIRECT", "GLOBAL", "HK", "TW", "SG"],
  },
  {
    name: "ANIGAMER",
    initial: "TW",
    options: ["TW", "GLOBAL", "DIRECT", "AUTO"],
  },
  {
    name: "DISCORD",
    initial: "GLOBAL",
    options: ["GLOBAL", "US", "JP", "SG", "DIRECT"],
  },
  {
    name: "DEV",
    initial: "GLOBAL",
    options: ["GLOBAL", "DIRECT", "US", "JP", "SG"],
  },
  {
    name: "MEDIA",
    initial: "GLOBAL",
    options: ["GLOBAL", "US", "JP", "SG", "DIRECT"],
  },
  {
    name: "SOCIAL",
    initial: "GLOBAL",
    options: ["GLOBAL", "US", "JP", "SG", "DIRECT"],
  },
  {
    name: "DEFAULT",
    initial: "GLOBAL",
    options: ["GLOBAL", "DIRECT", "AUTO"],
  },
] as const;

export function describePolicyRoute(policy: string): {
  mode: string;
  route: string;
  target: "DIRECT" | "PROXY";
} {
  if (policy === "DIRECT") {
    return { mode: "直连", route: "DIRECT", target: "DIRECT" };
  }

  const group = displayedPolicyGroups.find((item) => item.name === policy);
  if (!group) {
    return { mode: "代理", route: policy, target: "PROXY" };
  }

  const target = group.initial === "DIRECT" ? "DIRECT" : "PROXY";
  return {
    mode: target === "DIRECT" ? "直连" : "代理",
    route: `${group.name} → ${group.initial}`,
    target,
  };
}
