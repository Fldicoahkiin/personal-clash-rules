export const displayedPolicyGroups = [
  {
    name: "AI",
    initial: "GLOBAL",
    options: ["GLOBAL", "US", "JP", "SG", "TW"],
  },
  {
    name: "APPLE",
    initial: "GLOBAL",
    options: ["GLOBAL", "DIRECT", "US", "JP", "SG"],
  },
  {
    name: "STEAM",
    initial: "GLOBAL",
    options: ["GLOBAL", "DIRECT", "JP", "US", "SG"],
  },
  {
    name: "STEAM-DOWNLOAD",
    initial: "GLOBAL",
    options: ["GLOBAL", "DIRECT", "JP", "US", "SG", "HK", "TW"],
  },
  {
    name: "STEAM-ONLINE",
    initial: "GLOBAL",
    options: ["GLOBAL", "DIRECT", "JP", "US", "SG", "HK", "TW"],
  },
  {
    name: "BILIBILI",
    initial: "GLOBAL",
    options: ["GLOBAL", "DIRECT", "HK", "TW", "SG"],
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

  return {
    mode: "代理",
    route: `${group.name} → ${group.initial}`,
    target: "PROXY",
  };
}
