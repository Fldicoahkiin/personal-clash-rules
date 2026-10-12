import { defaultDnsSettings, type DnsSettings } from "../config/dns-settings";
import { countryGroupNames, mihomoProxyGroups, mihomoRuleProviders, mihomoRules } from "../config/mihomo-policy";
import { ApiError } from "./api-error";
import { createProxyDns } from "./mihomo-dns";
import type { MihomoDnsMode, MihomoRulePreset } from "./mihomo-profile";

const labels: Record<string, string> = {
  AUTO: "♻️ 自动选择", GLOBAL: "🚀 节点选择", AI: "🤖 AI", DEFAULT: "🐟 未匹配流量",
  ...countryGroupNames,
  APPLE: "🍎 Apple", STEAM: "🎮 Steam", "STEAM-DOWNLOAD": "📥 Steam 下载", "STEAM-ONLINE": "🎮 Steam 联机",
  DISCORD: "💬 Discord", DEV: "🛠 开发服务", MEDIA: "🎬 流媒体", BILIBILI: "📺 Bilibili", ANIGAMER: "📺 巴哈姆特", SOCIAL: "💬 社交",
};

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
  providers: Record<string, { url: string }>;
  dnsNode: string;
  bootstrap: string[];
};

function iniName(name: string): boolean {
  return Boolean(name) && !/[\r\n,=#;"']/u.test(name);
}

function ruleLine(rule: string, providers: ShadowrocketRouting["providers"]): string[] {
  if (rule.startsWith("PROCESS-NAME")) return [];
  const udp = /^AND,\(\((DOMAIN(?:-SUFFIX)?),([a-z0-9.-]+)\),\(NETWORK,UDP\)\),REJECT$/iu.exec(rule);
  if (udp) return [`AND,((${udp[1]},${udp[2]}),(PROTOCOL,UDP)),REJECT`];
  const [type, value, policy, ...options] = rule.split(",");
  if (type === "MATCH") return [`FINAL,${labels[value] ?? value}`];
  if (type === "RULE-SET") {
    const resource = providers[value];
    if (!resource || !/^https:\/\//u.test(resource.url) || /[\r\n,]/u.test(resource.url)) {
      throw new ApiError(422, "shadowrocket_rule_provider", "Shadowrocket needs an HTTPS text rule provider");
    }
    return [[type, resource.url, labels[policy] ?? policy, ...options].join(",")];
  }
  if (!["DOMAIN", "DOMAIN-SUFFIX", "DOMAIN-KEYWORD", "IP-CIDR", "IP-CIDR6", "IP-ASN", "GEOIP"].includes(type) || !policy || /[\r\n]/u.test(rule)) {
    throw new ApiError(422, "shadowrocket_rule_unsupported", "The base profile contains a rule that cannot be preserved in Shadowrocket");
  }
  return [[type, value, labels[policy] ?? policy, ...options].join(",")];
}

function matches(name: string, filter: string): boolean {
  return new RegExp(filter.replace(/^\(\?i\)/u, ""), "iu").test(name);
}

function groupLine(group: Group, names: string[]): string {
  const included = group["include-all"] ? names.filter(name => (
    (!group.filter || matches(name, group.filter))
    && (!group["exclude-filter"] || !matches(name, group["exclude-filter"]))
  )) : [];
  const members = [...new Set([...(group.proxies ?? []).map(name => labels[name] ?? name), ...included])];
  if (!members.length) return `${labels[group.name] ?? group.name} = select, REJECT`;
  const options = group.type === "url-test"
    ? [`url=${group.url}`, `interval=${group.interval ?? 300}`, `tolerance=${group.tolerance ?? 80}`, "timeout=5"] : [];
  return `${labels[group.name] ?? group.name} = ${[group.type, ...members, ...options].join(", ")}`;
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
  // INI members are comma-delimited; never turn a node name into a policy or parameter.
  if (nodeNames.some(name => !iniName(name) || Object.values(labels).includes(name))) {
    throw new ApiError(422, "shadowrocket_node_name", "Rename node names containing INI separators before generating a Shadowrocket configuration");
  }
  if (dnsMode === "upstream" || (dnsMode === "doh" && settings.bootstrapMode === "upstream")) {
    throw new ApiError(422, "shadowrocket_dns_mode", "Mihomo upstream DNS cannot be copied into Shadowrocket; choose system or custom bootstrap DNS");
  }
  const groups = routing?.groups ?? mihomoProxyGroups;
  if (groups.some(group => !iniName(group.name) || !["select", "url-test"].includes(group.type) || group.proxies?.some(name => !iniName(name)))) {
    throw new ApiError(422, "shadowrocket_group_unsupported", "The base profile contains an unsupported policy group");
  }
  if (routing && !nodeNames.includes(routing.dnsNode)) throw new ApiError(422, "shadowrocket_dns_node_missing", "The paired residential DNS node is missing");
  const suffix = routing ? `#proxy=${encodeURIComponent(routing.dnsNode)}` : "#proxy";
  const proxied = settings.nameservers.map(url => `${url}${suffix}`).join(", ");
  const dns = dnsMode === "doh" ? proxied : "system";
  const bootstrap = routing ? routing.bootstrap.join(", ") : dnsMode === "doh" ? createProxyDns(settings)["proxy-server-nameserver"].join(", ") : "system";
  const rules = (routing?.rules ?? mihomoRules).flatMap(rule => ruleLine(rule, routing?.providers ?? mihomoRuleProviders));
  return [
    "# Flacier · Shadowrocket",
    "# Import the paired node subscription first; this file contains routing and DNS, not node credentials.",
    "# Update both resources after changing subscription sources or node names.",
    ...(routing ? ["# Business DNS uses the named residential node independently of policy selections."] : []),
    "[General]",
    `ipv6 = ${settings.ipv6}`,
    "prefer-ipv6 = false",
    `dns-server = ${dns}`,
    `direct-dns-server = ${dns}`,
    `fallback-dns-server = ${dns}`,
    `proxy-dns-server = ${bootstrap}`,
    "dns-direct-system = false",
    ...(routing ? ["always-ip-address = true", "use-local-host-item-for-proxy = true"] : []),
    "udp-policy-not-supported-behaviour = REJECT",
    "close-if-proxy-chain-missing = true",
    "",
    "[Proxy Group]",
    ...groups.map(group => groupLine(group, nodeNames)),
    "",
    "[Rule]",
    ...rules,
    "",
  ].join("\n");
}
