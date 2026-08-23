export type UserAgentTarget =
  | "egern"
  | "loon"
  | "mihomo"
  | "quantumult-x"
  | "shadowrocket"
  | "sing-box"
  | "stash"
  | "surfboard"
  | "surge"
  | "v2ray";

export function targetForUserAgent(userAgent: string): UserAgentTarget {
  const normalized = userAgent.toLowerCase();
  if (normalized.includes("stash")) {
    return "stash";
  }
  if (/\bsurge\b/u.test(normalized)) {
    return "surge";
  }
  if (normalized.includes("surfboard")) {
    return "surfboard";
  }
  if (/\bloon\b/u.test(normalized)) {
    return "loon";
  }
  if (normalized.includes("egern")) {
    return "egern";
  }
  if (normalized.includes("shadowrocket")) {
    return "shadowrocket";
  }
  if (/quantumult(?:%20|\s)*x/u.test(normalized)) {
    return "quantumult-x";
  }
  if (/sing[-_ ]?box/u.test(normalized)) {
    return "sing-box";
  }
  if (/\bv2ray(?:n|ng)?\b/u.test(normalized)) {
    return "v2ray";
  }
  return "mihomo";
}
