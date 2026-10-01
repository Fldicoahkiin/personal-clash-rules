export const outputTargets = [
  "clash-party-config",
  "clash-verge-config",
  "flclash-config",
  "mihomo-config",
  "stash-config",
  "surge-config",
  "surfboard-config",
  "loon-config",
  "egern-config",
  "sing-box-config",
  "mihomo",
  "clash",
  "stash",
  "surge",
  "loon",
  "shadowrocket",
  "quantumult-x",
  "sing-box",
  "egern",
  "surfboard",
  "v2ray",
  "uri",
  "json",
] as const;

export type OutputTarget = (typeof outputTargets)[number];

export type SubscriptionEnv = {
  SUBSCRIPTIONS: {
    get(key: string): Promise<string | null>;
    put(key: string, value: string): Promise<void>;
  };
  SUBSCRIPTION_RATE_LIMITER: Pick<Env["SUBSCRIPTION_RATE_LIMITER"], "limit">;
};

export function isMihomoConfigTarget(target: string): boolean {
  return ["clash-party-config", "clash-verge-config", "flclash-config", "mihomo-config"].includes(target);
}

export function isOutputTarget(value: string): value is OutputTarget {
  return outputTargets.some((target) => target === value);
}
