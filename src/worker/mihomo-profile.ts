import { stringify as stringifyYaml } from "yaml";

import {
  displayMihomoGroup,
  displayMihomoRule,
  mihomoProxyGroups,
  mihomoProfileRuleProviders,
  mihomoProfileRules,
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
] as const;

function profileBody(
  proxies: Array<Record<string, unknown>>,
  rulePreset: MihomoRulePreset,
  updateIntervalHours = 6,
  dnsMode: MihomoDnsMode = "doh",
  upstreamConfig?: Record<string, unknown>,
  dnsSettings: DnsSettings = defaultDnsSettings,
) {
  const inheritedDns = dnsMode === "upstream" ? readUpstreamDns(upstreamConfig) : undefined;
  if (inheritedDns) validateIndependentDns(inheritedDns);
  const flacierRules = rulePreset !== "global" && rulePreset !== "direct";
  const directRules = rulePreset === "direct";
  const groups = directRules ? [] : flacierRules ? mihomoProxyGroups : globalProxyGroups;
  const proxyGroups: Array<Record<string, unknown>> = groups.map((group) => ({ ...group, "empty-fallback": "REJECT" }));
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
): string {
  return stringifyYaml(profileBody(
    readYamlProxyResource(nodeResource, "Mihomo"),
    rulePreset,
    updateIntervalHours,
    dnsMode,
    upstreamConfig,
    dnsSettings,
  ));
}
