import { defaultDnsSettings } from "../config/dns-settings";
import { parseRolaSettings, rolaDirectGatewayRule, type prepareRolaProfile } from "../local/rola";
import { ApiError } from "./api-error";
import type { SubscriptionNode } from "./node-transforms";
import { createShadowrocketProfile, type ShadowrocketRouting } from "./shadowrocket-profile";
import { countTargetCompatibleNodes, produceTarget } from "./sub-store";
import { targetForUserAgent } from "./subscription-target";
import { isMihomoConfigTarget, type SubscriptionEnv } from "./types";

export type RolaTarget = "mihomo-config" | "shadowrocket" | "shadowrocket-config";
export const rolaMobileFiles = { shadowrocket: "Flacier-Mobile-Nodes.txt", "shadowrocket-config": "Flacier-Mobile.conf" } as const;

export function rolaRequestTarget(request: Request, url: URL): RolaTarget {
  const selected = url.searchParams.get("target")
    ?? Object.entries(rolaMobileFiles).find(([, filename]) => url.pathname.endsWith(`/${filename}`))?.[0]
    ?? (url.pathname.endsWith(".yaml") ? "mihomo-config" : targetForUserAgent(request.headers.get("User-Agent") || ""));
  if (selected === "mihomo" || isMihomoConfigTarget(selected)) return "mihomo-config";
  if (selected === "shadowrocket" || selected === "shadowrocket-config") return selected;
  throw new ApiError(422, "rola_target_unsupported", "家宽订阅支持 Mihomo 完整配置、Shadowrocket 节点及配套规则；不会静默丢失家宽或代理链。");
}

export function requireRolaTarget(settings: Record<string, unknown>, target: RolaTarget) {
  if (target !== "mihomo-config" && settings.connectionMode !== "direct") {
    throw new ApiError(422, "rola_mobile_chain_unsupported", "机场前置串联暂不能转换为 Shadowrocket；请使用 Mihomo，不能把代理链当成直接家宽节点导入。");
  }
}

export async function renderRolaTarget(env: SubscriptionEnv, prepared: ReturnType<typeof prepareRolaProfile>, value: Record<string, unknown>, target: RolaTarget) {
  requireRolaTarget(value, target);
  if (target === "mihomo-config") return prepared.profile;
  const settings = parseRolaSettings(value);
  // The input is already validated by prepareRolaProfile. Keep its exact names so the
  // paired node subscription and policy file cannot diverge through renaming/deduplication.
  const base = prepared.toJS() as {
    proxies: SubscriptionNode[];
    "proxy-groups": ShadowrocketRouting["groups"];
    "rule-providers"?: ShadowrocketRouting["providers"];
    "proxy-providers"?: Record<string, unknown>;
    rules: string[];
    dns: { "proxy-server-nameserver": string[] };
  };
  if (Object.keys(base["proxy-providers"] ?? {}).length
    || base.proxies.some(node => node["dialer-proxy"] && node["dialer-proxy"] !== "DIRECT")
    || countTargetCompatibleNodes(base.proxies, "shadowrocket") !== base.proxies.length) {
    throw new ApiError(422, "rola_mobile_nodes_unsupported", "来源含 Shadowrocket 无法保留的节点或代理链，未输出缺少节点的订阅。");
  }
  const nodes = await produceTarget(env, base.proxies, "shadowrocket");
  if (nodes.split("\n").filter(Boolean).length !== base.proxies.length) {
    throw new ApiError(422, "rola_mobile_nodes_unsupported", "Shadowrocket 节点输出不完整，已停止生成。");
  }
  if (target === "shadowrocket") return nodes;
  // This exact generated exception serves external desktop clients entering through Mihomo.
  // Do not pass Mihomo-only DST-PORT syntax into the paired iOS configuration.
  const gatewayRules = new Set([settings, ...settings.additionalExits].flatMap(exit => rolaDirectGatewayRule(exit) ?? []));
  return createShadowrocketProfile(base.proxies.map(node => node.name), "flacier", "doh", {
    ...defaultDnsSettings, nameservers: settings.dns, ipv6: false,
  }, {
    groups: base["proxy-groups"], rules: base.rules.filter(rule => !gatewayRules.has(rule)), providers: base["rule-providers"] ?? {},
    bootstrap: base.dns["proxy-server-nameserver"],
  });
}
