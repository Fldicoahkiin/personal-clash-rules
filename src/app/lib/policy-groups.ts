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
} {
  if (policy === "DIRECT") {
    return { mode: "直连", route: "DIRECT" };
  }

  const group = displayedPolicyGroups.find((item) => item.name === policy);
  if (!group) {
    return { mode: "策略组", route: policy };
  }

  return {
    mode: group.initial === "DIRECT" ? "默认直连" : "默认代理",
    route: `${group.name} → ${group.initial}`,
  };
}
