export const outputTargets = [
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

export interface SubscriptionEnv extends Env {
  DATA_ENCRYPTION_KEY: string;
}

export function isOutputTarget(value: string): value is OutputTarget {
  return outputTargets.some((target) => target === value);
}
