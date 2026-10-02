import { stringify as stringifyYaml } from "yaml";
import { createHash } from "node:crypto";

import {
  countryFlagRules,
  mihomoProxyGroups,
  mihomoRuleProviders,
  mihomoRules,
} from "../config/mihomo-policy";
import type { NodeSettings } from "./node-transforms";
import { readYamlProxyResource } from "./yaml-proxy-resource";
import { ApiError } from "./api-error";
import type { RuleTemplateId } from "../config/rule-templates";
import { defaultDnsSettings, type DnsSettings } from "../config/dns-settings";
import { createProxyDns, dnsProxyGroup, readUpstreamDns, validateIndependentDns } from "./mihomo-dns";

export type MihomoRulePreset = RuleTemplateId | "global" | "direct";
export type MihomoDnsMode = "doh" | "system" | "upstream";

type MihomoProviderProfile = {
  dnsSettings?: DnsSettings;
  dnsMode: MihomoDnsMode;
  nodeResource: string;
  nodeSettings: NodeSettings;
  providers: Array<{ name: string; url: string }>;
  rulePreset: MihomoRulePreset;
  sourceUserAgent: string;
  updateIntervalHours: number;
};

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
  providers?: Record<string, Record<string, unknown>>,
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
  const providerNames = providers ? Object.keys(providers) : [];
  const proxyGroups: Array<Record<string, unknown>> = groups.map((group) => ({ ...(
    providerNames.length > 0 && "include-all" in group && group["include-all"]
      ? {
          ...group,
          use: providerNames,
          "include-all-providers": true,
        }
      : group
  ), "empty-fallback": "REJECT" }));
  const dns = inheritedDns ? { ...inheritedDns, ipv6: dnsSettings.ipv6 }
    : dnsMode === "doh" ? createProxyDns(dnsSettings, upstreamConfig) : { enable: false };
  if (dnsMode === "doh" && !directRules) proxyGroups.push(dnsProxyGroup(providerNames));
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
    ...(providers ? { "proxy-providers": providers } : {}),
    "proxy-groups": proxyGroups,
    ...(flacierRules ? { "rule-providers": mihomoRuleProviders } : {}),
    rules: directRules ? ["MATCH,DIRECT"] : flacierRules ? mihomoRules : globalRules,
  };
}

function providerOverride(settings: NodeSettings): Record<string, unknown> | undefined {
  const proxyName = [
    ...settings.renameRules.map((rule) => ({
      pattern: rule.pattern,
      target: rule.replacement,
    })),
    ...(settings.addCountryFlag ? countryFlagRules.map((rule) => ({
      pattern: `(?i)^(?:${rule.flag}\\s*)?((?:.*(?:${rule.filter}).*))$`,
      target: `${rule.flag} $1`,
    })) : []),
  ];
  const overrideExpression = settings.showNodeType
    ? ['.name = "[\\(.type | upcase)] \\(.name)"']
    : undefined;
  const override = {
    ...(settings.udp ? { udp: true } : {}),
    ...(settings.skipCertVerify ? { "skip-cert-verify": true } : {}),
    ...(settings.tfo ? { tfo: true } : {}),
    ...(proxyName.length > 0 ? { "proxy-name": proxyName } : {}),
    ...(overrideExpression ? { "override-expr": overrideExpression } : {}),
  };
  return Object.keys(override).length > 0 ? override : undefined;
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
    undefined,
    updateIntervalHours,
    dnsMode,
    upstreamConfig,
    dnsSettings,
  ));
}

export function createMihomoProviderProfile(input: MihomoProviderProfile): string {
  const override = providerOverride(input.nodeSettings);
  const providers = Object.fromEntries(input.providers.map((provider, index) => [
    provider.name,
    {
      type: "http",
      url: provider.url,
      path: `./proxy-providers/flacier-${createHash("sha256").update(provider.url).digest("hex").slice(0, 16)}-${index + 1}.yaml`,
      interval: input.updateIntervalHours * 3600,
      header: { "User-Agent": [input.sourceUserAgent] },
      "health-check": {
        enable: true,
        url: "https://cp.cloudflare.com/generate_204",
        interval: 600,
        lazy: true,
      },
      ...(input.nodeSettings.includePattern
        ? { filter: input.nodeSettings.includePattern }
        : {}),
      ...(input.nodeSettings.excludePattern
        ? { "exclude-filter": input.nodeSettings.excludePattern }
        : {}),
      ...(override ? { override } : {}),
    },
  ]));
  return stringifyYaml(profileBody(
    readYamlProxyResource(input.nodeResource, "Mihomo", true),
    input.rulePreset,
    providers,
    input.updateIntervalHours,
    input.dnsMode,
    undefined,
    input.dnsSettings,
  ));
}
