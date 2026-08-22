export const outputTargets = [
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
  DB: D1Database;
  DATA_ENCRYPTION_KEY?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ACCESS_ADMIN_EMAIL?: string;
  CONTROL_API_TOKEN?: string;
  SUB_STORE_URL?: string;
  SUB_STORE_TOKEN?: string;
  SUB_STORE_ACCESS_CLIENT_ID?: string;
  SUB_STORE_ACCESS_CLIENT_SECRET?: string;
}

export function isOutputTarget(value: string): value is OutputTarget {
  return outputTargets.some((target) => target === value);
}
