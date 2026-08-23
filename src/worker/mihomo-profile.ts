import { stringify as stringifyYaml } from "yaml";

import {
  countryFlagRules,
  mihomoProxyGroups,
  mihomoRuleProviders,
  mihomoRules,
} from "../config/mihomo-policy";
import type { NodeSettings } from "./node-transforms";
import { readYamlProxyResource } from "./yaml-proxy-resource";

export type MihomoRulePreset = "flacier" | "global";

type MihomoProviderProfile = {
  nodeResource: string;
  nodeSettings: NodeSettings;
  providers: Array<{ name: string; url: string }>;
  rulePreset: MihomoRulePreset;
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
) {
  const flacierRules = rulePreset === "flacier";
  return {
    "mixed-port": 7890,
    "allow-lan": false,
    mode: "rule",
    "log-level": "info",
    ipv6: true,
    "unified-delay": true,
    "tcp-concurrent": true,
    profile: {
      "store-selected": true,
    },
    proxies,
    ...(providers ? { "proxy-providers": providers } : {}),
    "proxy-groups": flacierRules ? mihomoProxyGroups : globalProxyGroups,
    ...(flacierRules ? { "rule-providers": mihomoRuleProviders } : {}),
    rules: flacierRules ? mihomoRules : globalRules,
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
): string {
  return stringifyYaml(profileBody(
    readYamlProxyResource(nodeResource, "Mihomo"),
    rulePreset,
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
      interval: 3600,
      header: { "User-Agent": ["mihomo/1.19"] },
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
  ));
}
