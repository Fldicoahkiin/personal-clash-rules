import { stringify as stringifyYaml } from "yaml";

import type { DnsSettings } from "../../config/dns-settings";
import { ApiError } from "../api-error";
import { createEgernProfile } from "../egern-profile";
import { createLoonProfile } from "../loon-profile";
import { createMihomoProfile, type MihomoDnsMode, type MihomoRulePreset } from "../mihomo-profile";
import type { SubscriptionNode } from "../node-transforms";
import { createShadowrocketProfile } from "../shadowrocket-profile";
import { createSingBoxProfile } from "../sing-box-profile";
import { createStashProfile } from "../stash-profile";
import { createSurfboardProfile, createSurgeProfile } from "../surge-profile";
import { isMihomoConfigTarget, type OutputTarget, type SubscriptionEnv } from "../types";
import { base64Utf8 } from "./codec";
import { renderSingBoxJson, renderSingBoxNodeResource } from "./produce-sing-box";
import { renderEgernYaml, renderLoonProxies, renderQxProxies, renderSurfboardProxies, renderSurgeProxies } from "./produce-text";
import { renderProxyUris } from "./produce-uri";
import type { ProxyNode } from "./types";

// Adapted from realchendahuang/sub-store-cloudflare under AGPL-3.0.
function isTargetCompatible(proxy: ProxyNode, target: OutputTarget): boolean {
  if (isMihomoConfigTarget(target)) return true;
  if (["clash-party-config", "mihomo-config", "stash-config", "mihomo", "clash", "stash", "json"].includes(target)) return true;
  if (["uri", "v2ray", "shadowrocket", "shadowrocket-config"].includes(target)) return ["ss", "ssr", "vmess", "vless", "trojan", "hysteria", "hysteria2", "tuic", "anytls", "http", "socks5", "wireguard"].includes(proxy.type);
  if (["sing-box", "sing-box-config"].includes(target)) return ["ss", "vmess", "vless", "trojan", "hysteria", "hysteria2", "tuic", "anytls", "http", "socks5", "wireguard"].includes(proxy.type);
  if (["surge", "surge-config"].includes(target)) return ["ss", "vmess", "trojan", "http", "socks5", "hysteria2", "tuic", "anytls", "snell"].includes(proxy.type);
  if (["surfboard", "surfboard-config"].includes(target)) return ["ss", "vmess", "trojan", "http", "socks5"].includes(proxy.type);
  if (["loon", "loon-config"].includes(target)) return ["ss", "ssr", "vmess", "vless", "trojan", "http", "socks5", "hysteria2", "anytls"].includes(proxy.type);
  if (target === "quantumult-x") return ["ss", "ssr", "vmess", "vless", "trojan", "http", "socks5", "anytls"].includes(proxy.type);
  if (["egern", "egern-config"].includes(target)) return ["ss", "vmess", "vless", "trojan", "http", "socks5", "hysteria2", "tuic", "anytls", "wireguard"].includes(proxy.type);
  return false;
}

export function countTargetCompatibleNodes(
  nodes: SubscriptionNode[],
  target: OutputTarget,
): number {
  return (nodes as ProxyNode[]).filter((node) => isTargetCompatible(node, target)).length;
}


// 自建节点的月度用量做成一个独立节点（不是组、也不是名字后缀）：手机端的节点列表里也能看到。
// 名字沿用家宽链时代的「VPS 本月」，不撞 metadataFilter（剩余|流量|到期…），所以桌面端在自动选择组里也能看到它；指向本地死端口，误选也连不上。
const usageQuota = 2 ** 30;

export type VpsUsage = { server: string; txBytes: number; quotaBytes: number; month: string };

// 用量记录是整个 Worker 共用一条；只有订阅里确实有那台机器的节点时，这条记录才和它有关。
// 否则任何人的订阅都会被贴上别人的 VPS 用量。
export function usesVps(nodes: readonly SubscriptionNode[], vps: VpsUsage | null): vps is VpsUsage {
  return vps !== null && nodes.some((node) => node.server === vps.server);
}

// VPS 每 30 分钟把本月接口计数推到 /api/vps-usage；读不到、格式不对都当没有，不影响订阅输出。
export async function readVpsUsage(env: SubscriptionEnv): Promise<VpsUsage | null> {
  try {
    const raw = await env.SUBSCRIPTIONS.get("vps-usage");
    if (!raw) return null;
    const usage = JSON.parse(raw) as { server?: unknown; txBytes?: unknown; quotaBytes?: unknown; month?: unknown };
    if (typeof usage.server !== "string" || !/^[\w.:-]{1,253}$/u.test(usage.server)
      || typeof usage.txBytes !== "number" || typeof usage.quotaBytes !== "number" || usage.quotaBytes <= 0
      || typeof usage.month !== "string" || !/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(usage.month)) return null;
    return { server: usage.server, txBytes: usage.txBytes, quotaBytes: usage.quotaBytes, month: usage.month };
  } catch {
    return null;
  }
}

async function usageNodeFor(env: SubscriptionEnv, nodes: SubscriptionNode[]): Promise<SubscriptionNode | null> {
  const usage = await readVpsUsage(env);
  if (!usesVps(nodes, usage)) return null;
  const used = (usage.txBytes / usageQuota).toFixed(1);
  const total = Math.round(usage.quotaBytes / usageQuota);
  return { name: `📊 VPS 本月 ${used} / ${total} GiB`, type: "socks5", server: "127.0.0.1", port: 1, udp: false } as SubscriptionNode;
}

export async function produceTarget(
  _env: SubscriptionEnv,
  nodes: SubscriptionNode[],
  target: OutputTarget,
  rulePreset: MihomoRulePreset = "flacier",
  updateIntervalHours = 6,
  dnsMode: MihomoDnsMode = "doh",
  upstreamConfig?: Record<string, unknown>,
  dnsSettings?: DnsSettings,
  includeUsageNode = true,
  selfHosted?: string[],
): Promise<string> {
  // 规则型输出（.conf）只用节点名，不需要这条展示节点。
  const usageNode = includeUsageNode && target !== "shadowrocket-config" ? await usageNodeFor(_env, nodes) : null;
  const withUsage = usageNode ? [usageNode, ...nodes] : nodes;
  const supported = (withUsage as ProxyNode[]).filter((node) => isTargetCompatible(node, target));
  if (supported.length === 0) {
    throw new ApiError(422, "target_unsupported", `${target} could not represent the normalized nodes`);
  }
  // These renderers only translate the Flacier policy set; other presets would silently become Flacier rules.
  if (rulePreset !== "flacier" && ["stash-config", "surge-config", "surfboard-config", "loon-config", "egern-config", "sing-box-config"].includes(target)) {
    throw new ApiError(422, "rule_preset_requires_mihomo", `${target} only supports the Flacier rule preset`);
  }
  if (isMihomoConfigTarget(target)) {
    return createMihomoProfile(stringifyYaml({ proxies: supported }), rulePreset, updateIntervalHours, dnsMode, upstreamConfig, dnsSettings, selfHosted);
  }
  if (target === "shadowrocket-config") return createShadowrocketProfile(supported.map(node => node.name), rulePreset, dnsMode, dnsSettings);
  if (target === "stash-config") return createStashProfile(stringifyYaml({ proxies: supported }), updateIntervalHours);
  if (target === "surge-config") return createSurgeProfile(renderSurgeProxies(supported), updateIntervalHours);
  if (target === "surfboard-config") return createSurfboardProfile(renderSurfboardProxies(supported), updateIntervalHours);
  if (target === "loon-config") return createLoonProfile(renderLoonProxies(supported), updateIntervalHours);
  if (target === "egern-config") return createEgernProfile(renderEgernYaml(supported), updateIntervalHours);
  if (target === "sing-box-config") return createSingBoxProfile(renderSingBoxNodeResource(supported), updateIntervalHours);
  if (target === "mihomo" || target === "clash" || target === "stash") return stringifyYaml({ proxies: supported });
  if (target === "surge") return renderSurgeProxies(supported);
  if (target === "surfboard") return renderSurfboardProxies(supported);
  if (target === "loon") return renderLoonProxies(supported);
  if (target === "egern") return renderEgernYaml(supported);
  if (target === "quantumult-x") return renderQxProxies(supported);
  if (target === "sing-box") return renderSingBoxJson(supported);
  if (target === "v2ray") return base64Utf8(renderProxyUris(supported));
  if (target === "uri" || target === "shadowrocket") return renderProxyUris(supported);
  return JSON.stringify({ proxies: supported }, null, 2);
}
