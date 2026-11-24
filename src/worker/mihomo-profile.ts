import { stringify as stringifyYaml } from "yaml";

import {
  FIXED_IP_GROUP,
  displayMihomoGroup,
  displayMihomoRule,
  mihomoProxyGroups,
  mihomoProfileRuleProviders,
  mihomoProfileRules,
  mihomoUdpFallbackRules,
} from "../config/mihomo-policy";
import { readYamlProxyResource } from "./yaml-proxy-resource";
import { ApiError } from "./api-error";
import type { RuleTemplateId } from "../config/rule-templates";
import { defaultDnsSettings, type DnsSettings } from "../config/dns-settings";
import { createProxyDns, dnsProxyGroup, readUpstreamDns, validateIndependentDns } from "./mihomo-dns";

export type MihomoRulePreset = RuleTemplateId | "global" | "direct";
export type MihomoDnsMode = "doh" | "system" | "upstream";

const globalProxyGroups = [
  {
    name: "AUTO",
    type: "url-test",
    "include-all": true,
    "exclude-type": "direct",
    url: "https://cp.cloudflare.com/generate_204",
    interval: 300,
    tolerance: 80,
  },
  {
    name: "GLOBAL",
    type: "select",
    proxies: ["AUTO", "DIRECT"],
    "include-all": true,
    "exclude-type": "direct",
  },
] as const;

const globalRules = [
  "GEOSITE,private,DIRECT",
  "GEOIP,private,DIRECT,no-resolve",
  "MATCH,GLOBAL",
  ...mihomoUdpFallbackRules,
] as const;

type PolicyGroup = Record<string, unknown> & { name: string; proxies?: string[] };

// 固定 IP 出口跟着订阅走：有自建节点就只收它们（显式成员，不靠名字正则），
// 没有就整组拿掉，并在所有引用它的组里摘干净——别人的订阅里不会出现一个永远为空的组。
function withSelfHostedExit(groups: PolicyGroup[], selfHosted: string[]): PolicyGroup[] {
  if (selfHosted.length > 0) {
    return groups.map((group) => (group.name !== FIXED_IP_GROUP ? group : {
      name: FIXED_IP_GROUP,
      type: "select",
      proxies: selfHosted,
      "empty-fallback": "REJECT" as const,
      icon: group.icon,
    }));
  }
  return groups
    .filter((group) => group.name !== FIXED_IP_GROUP)
    .map((group) => ({ ...group, proxies: (group.proxies ?? []).filter((name) => name !== FIXED_IP_GROUP) }));
}

function profileBody(
  proxies: Array<Record<string, unknown>>,
  rulePreset: MihomoRulePreset,
  updateIntervalHours = 6,
  dnsMode: MihomoDnsMode = "doh",
  upstreamConfig?: Record<string, unknown>,
  dnsSettings: DnsSettings = defaultDnsSettings,
  selfHosted?: string[],
) {
  const inheritedDns = dnsMode === "upstream" ? readUpstreamDns(upstreamConfig) : undefined;
  if (inheritedDns) validateIndependentDns(inheritedDns);
  const flacierRules = rulePreset !== "global" && rulePreset !== "direct";
  const directRules = rulePreset === "direct";
  const groups = directRules ? [] : flacierRules ? mihomoProxyGroups : globalProxyGroups;
  const scoped = flacierRules && selfHosted ? withSelfHostedExit(groups as PolicyGroup[], selfHosted) : groups;
  const proxyGroups: Array<Record<string, unknown>> = scoped.map((group) => ({ ...group, "empty-fallback": "REJECT" }));
  const dns = inheritedDns ? { ...inheritedDns, ipv6: dnsSettings.ipv6 }
    : dnsMode === "doh" ? createProxyDns(dnsSettings, upstreamConfig) : { enable: false };
  if (dnsMode === "doh" && !directRules) proxyGroups.push(dnsProxyGroup());
  if (dnsMode === "doh" && directRules) {
    throw new ApiError(422, "dns_requires_proxy", "Proxy DNS cannot be combined with the direct-only preset; choose system or upstream DNS explicitly");
  }
  return {
    "mixed-port": 7890,
    "allow-lan": false,
    mode: "rule",
    "log-level": "info",
    ipv6: dnsSettings.ipv6,
    "unified-delay": true,
    "tcp-concurrent": true,
    dns,
    ...(upstreamConfig?.hosts && (inheritedDns || dnsSettings.bootstrapMode === "upstream") ? { hosts: upstreamConfig.hosts } : {}),
    "profile-update-interval": updateIntervalHours,
    profile: {
      "store-selected": true,
    },
    proxies,
    "proxy-groups": proxyGroups.map(group => displayMihomoGroup(group as { name: string; proxies?: string[]; icon?: string })),
    ...(flacierRules ? { "rule-providers": mihomoProfileRuleProviders } : {}),
    rules: (directRules ? ["MATCH,DIRECT"] : flacierRules ? mihomoProfileRules : globalRules).map(displayMihomoRule),
  };
}

export function createMihomoProfile(
  nodeResource: string,
  rulePreset: MihomoRulePreset = "flacier",
  updateIntervalHours = 6,
  dnsMode: MihomoDnsMode = "doh",
  upstreamConfig?: Record<string, unknown>,
  dnsSettings: DnsSettings = defaultDnsSettings,
  selfHosted?: string[],
): string {
  return stringifyYaml(profileBody(
    readYamlProxyResource(nodeResource, "Mihomo"),
    rulePreset,
    updateIntervalHours,
    dnsMode,
    upstreamConfig,
    dnsSettings,
    selfHosted,
  ));
}
