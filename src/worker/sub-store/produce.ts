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

export async function produceTarget(
  _env: SubscriptionEnv,
  nodes: SubscriptionNode[],
  target: OutputTarget,
  rulePreset: MihomoRulePreset = "flacier",
  updateIntervalHours = 6,
  dnsMode: MihomoDnsMode = "doh",
  upstreamConfig?: Record<string, unknown>,
  dnsSettings?: DnsSettings,
): Promise<string> {
  const supported = (nodes as ProxyNode[]).filter((node) => isTargetCompatible(node, target));
  if (supported.length === 0) {
    throw new ApiError(422, "target_unsupported", `${target} could not represent the normalized nodes`);
  }
  // These renderers only translate the Flacier policy set; other presets would silently become Flacier rules.
  if (rulePreset !== "flacier" && ["stash-config", "surge-config", "surfboard-config", "loon-config", "egern-config", "sing-box-config"].includes(target)) {
    throw new ApiError(422, "rule_preset_requires_mihomo", `${target} only supports the Flacier rule preset`);
  }
  if (isMihomoConfigTarget(target)) {
    return createMihomoProfile(stringifyYaml({ proxies: supported }), rulePreset, updateIntervalHours, dnsMode, upstreamConfig, dnsSettings);
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
