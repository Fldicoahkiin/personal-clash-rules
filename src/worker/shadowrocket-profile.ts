import { defaultDnsSettings, type DnsSettings } from "../config/dns-settings";
import { displayMihomoGroup, mihomoProxyGroups, mihomoRuleProviders, mihomoRules } from "../config/mihomo-policy";
import { ApiError } from "./api-error";
import { createProxyDns, domesticDoh } from "./mihomo-dns";
import type { MihomoDnsMode, MihomoRulePreset } from "./mihomo-profile";

type Group = {
  name: string;
  type: string;
  proxies?: readonly string[];
  "include-all"?: boolean;
  filter?: string;
  "exclude-filter"?: string;
  interval?: number;
  tolerance?: number;
  url?: string;
};

export type ShadowrocketRouting = {
  groups: Group[];
  rules: string[];
  providers: Record<string, { url: string; behavior?: string }>;
  bootstrap: string[];
};

function iniName(name: string): boolean {
  return Boolean(name) && !/[\r\n,=#;"']/u.test(name);
}

const domesticPolicies = new Set(mihomoProxyGroups
  .filter(group => group.proxies?.[0] === "DIRECT")
  .flatMap(group => [group.name, displayMihomoGroup(group).name]));

function homepagePolicy(policy: string): string {
  if (policy === "DIRECT" || domesticPolicies.has(policy)) return "DIRECT";
  return policy === "REJECT" ? "REJECT" : "PROXY";
}

function ruleLine(rule: string, providers: ShadowrocketRouting["providers"]): string[] {
  if (rule.startsWith("PROCESS-NAME")) return [];
  const udp = /^AND,\(\((DOMAIN(?:-SUFFIX)?),([a-z0-9.-]+)\),\(NETWORK,UDP\)\),REJECT$/iu.exec(rule);
  if (udp) return [`AND,((${udp[1]},${udp[2]}),(PROTOCOL,UDP)),REJECT`];
  const [type, value, policy, ...options] = rule.split(",");
  if (type === "MATCH") return [`FINAL,${homepagePolicy(value)}`];
  if (type === "RULE-SET") {
    // Shadowrocket reads classical lists; Mihomo's domain-behavior copy of a published set maps back to the classical file.
    const resource = providers[value]?.behavior === "domain" ? mihomoRuleProviders[value] : providers[value];
    if (!resource || !/^https:\/\//u.test(resource.url) || /[\r\n,]/u.test(resource.url)) {
      throw new ApiError(422, "shadowrocket_rule_provider", "Shadowrocket needs an HTTPS text rule provider");
    }
    return [[type, resource.url, homepagePolicy(policy), ...options].join(",")];
  }
  if (!["DOMAIN", "DOMAIN-SUFFIX", "DOMAIN-KEYWORD", "IP-CIDR", "IP-CIDR6", "IP-ASN", "GEOIP"].includes(type) || !policy || /[\r\n]/u.test(rule)) {
    throw new ApiError(422, "shadowrocket_rule_unsupported", "The base profile contains a rule that cannot be preserved in Shadowrocket");
  }
  return [[type, value, homepagePolicy(policy), ...options].join(",")];
}

export function createShadowrocketProfile(
  nodeNames: string[],
  preset: MihomoRulePreset = "flacier",
  dnsMode: MihomoDnsMode = "doh",
  settings: DnsSettings = defaultDnsSettings,
  routing?: ShadowrocketRouting,
): string {
  if (preset !== "flacier") throw new ApiError(422, "unsupported_rule_template", "Shadowrocket configuration currently supports the Flacier template");
  if (!nodeNames.length) throw new ApiError(422, "no_nodes_found", "Importable nodes are required");
  if (nodeNames.some(name => !iniName(name))) {
    throw new ApiError(422, "shadowrocket_node_name", "Rename node names containing INI separators before generating a Shadowrocket configuration");
  }
  if (dnsMode === "upstream" || (dnsMode === "doh" && settings.bootstrapMode === "upstream")) {
    throw new ApiError(422, "shadowrocket_dns_mode", "Mihomo upstream DNS cannot be copied into Shadowrocket; choose system or custom bootstrap DNS");
  }
  const groups = routing?.groups ?? mihomoProxyGroups;
  if (groups.some(group => !iniName(group.name) || !["select", "url-test"].includes(group.type) || group.proxies?.some(name => !iniName(name)))) {
    throw new ApiError(422, "shadowrocket_group_unsupported", "The base profile contains an unsupported policy group");
  }
  // Shadowrocket documents #proxy as its default node, not a named routing policy group.
  const proxied = settings.nameservers.map(url => `${url}#proxy`).join(", ");
  const dns = dnsMode === "doh" ? proxied : "system";
  const bootstrap = routing ? routing.bootstrap.join(", ") : dnsMode === "doh" ? createProxyDns(settings)["proxy-server-nameserver"].join(", ") : "system";
  const rules = (routing?.rules ?? mihomoRules).flatMap(rule => ruleLine(rule, routing?.providers ?? mihomoRuleProviders));
  return [
    "# Flacier · 手机分流",
    "# 配套节点订阅在首页更新；此配置负责分流与 DNS，不包含节点账号密码。",
    "# 代理流量和加密 DNS 跟随首页所选节点，国内应用按 DIRECT 规则直连。",
    "# 更新规则或 DNS 时，长按此配置选择 Update，并保持该配置为已选中状态。",
    "[General]",
    `ipv6 = ${settings.ipv6}`,
    "prefer-ipv6 = false",
    `dns-server = ${dns}`,
    // Domains matched by DIRECT rules resolve through domestic DoH; a failure falls back to the proxied resolvers.
    `direct-dns-server = ${dnsMode === "doh" ? domesticDoh.join(", ") : dns}`,
    `fallback-dns-server = ${dns}`,
    `proxy-dns-server = ${bootstrap}`,
    "dns-direct-system = false",
    ...(routing ? ["always-ip-address = true", "use-local-host-item-for-proxy = true"] : []),
    "udp-policy-not-supported-behaviour = REJECT",
    "close-if-proxy-chain-missing = true",
    "",
    "[Rule]",
    ...rules,
    "",
  ].join("\n");
}
