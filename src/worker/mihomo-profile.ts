import { stringify as stringifyYaml } from "yaml";

import {
  countryFlagRules,
  mihomoProxyGroups,
  mihomoRuleProviders,
  mihomoRules,
} from "../config/mihomo-policy";
import type { NodeSettings } from "./node-transforms";
import { readYamlProxyResource } from "./yaml-proxy-resource";

export type MihomoRulePreset = "flacier" | "global" | "direct";

type MihomoProviderProfile = {
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

const dns = {
  enable: true,
  ipv6: true,
  "enhanced-mode": "fake-ip",
  "fake-ip-range": "198.18.0.1/16",
  "fake-ip-filter": ["*.lan", "*.local", "localhost"],
  "default-nameserver": ["1.1.1.1", "8.8.8.8"],
  nameserver: [
    "https://1.1.1.1/dns-query",
    "https://8.8.8.8/dns-query",
  ],
  "proxy-server-nameserver": [
    "https://1.1.1.1/dns-query",
    "https://8.8.8.8/dns-query",
  ],
  "direct-nameserver": [
    "https://1.1.1.1/dns-query",
    "https://8.8.8.8/dns-query",
  ],
} as const;

function profileBody(
  proxies: Array<Record<string, unknown>>,
  rulePreset: MihomoRulePreset,
  providers?: Record<string, Record<string, unknown>>,
  updateIntervalHours = 6,
) {
  const flacierRules = rulePreset === "flacier";
  const directRules = rulePreset === "direct";
  const groups = directRules ? [] : flacierRules ? mihomoProxyGroups : globalProxyGroups;
  const providerNames = providers ? Object.keys(providers) : [];
  const proxyGroups = groups.map((group) => (
    providerNames.length > 0 && "include-all" in group && group["include-all"]
      ? {
          ...group,
          use: providerNames,
          "include-all-providers": true,
        }
      : group
  ));
  return {
    "mixed-port": 7890,
    "allow-lan": false,
    mode: "rule",
    "log-level": "info",
    ipv6: true,
    "unified-delay": true,
    "tcp-concurrent": true,
    dns,
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
): string {
  return stringifyYaml(profileBody(
    readYamlProxyResource(nodeResource, "Mihomo"),
    rulePreset,
    undefined,
    updateIntervalHours,
  ));
}

export function createMihomoProviderProfile(input: MihomoProviderProfile): string {
  const override = providerOverride(input.nodeSettings);
  const providers = Object.fromEntries(input.providers.map((provider, index) => [
    provider.name,
    {
      type: "http",
      url: provider.url,
      path: `./proxy-providers/flacier-${index + 1}.yaml`,
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
  ));
}
