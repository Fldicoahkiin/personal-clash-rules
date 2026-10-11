import { defaultDnsSettings, type DnsSettings } from "../config/dns-settings";
import { mihomoProxyGroups, mihomoRuleProviders, mihomoRules } from "../config/mihomo-policy";
import { ApiError } from "./api-error";
import { createProxyDns } from "./mihomo-dns";
import type { MihomoDnsMode, MihomoRulePreset } from "./mihomo-profile";

const labels: Record<string, string> = {
  AUTO: "♻️ 自动选择", GLOBAL: "🚀 节点选择", AI: "🤖 AI", DEFAULT: "🐟 未匹配流量",
  US: "🇺🇸 美国", JP: "🇯🇵 日本", SG: "🇸🇬 新加坡", HK: "🇭🇰 香港", TW: "🇹🇼 台湾", KR: "🇰🇷 韩国", EU: "🇪🇺 欧洲",
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

function matches(name: string, filter: string): boolean {
  return new RegExp(filter.replace(/^\(\?i\)/u, ""), "iu").test(name);
}

function groupLine(group: Group, names: string[]): string {
  const included = group["include-all"] ? names.filter(name => (
    (!group.filter || matches(name, group.filter))
    && (!group["exclude-filter"] || !matches(name, group["exclude-filter"]))
  )) : [];
  const members = [...(group.proxies ?? []).map(name => labels[name] ?? name), ...included];
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
): string {
  if (preset !== "flacier") throw new ApiError(422, "unsupported_rule_template", "Shadowrocket configuration currently supports the Flacier template");
  if (!nodeNames.length) throw new ApiError(422, "no_nodes_found", "Importable nodes are required");
  // INI members are comma-delimited; never turn a node name into a policy or parameter.
  if (nodeNames.some(name => /[\r\n,=#;"']/u.test(name) || Object.values(labels).includes(name))) {
    throw new ApiError(422, "shadowrocket_node_name", "Rename node names containing INI separators before generating a Shadowrocket configuration");
  }
  if (dnsMode === "upstream" || (dnsMode === "doh" && settings.bootstrapMode === "upstream")) {
    throw new ApiError(422, "shadowrocket_dns_mode", "Mihomo upstream DNS cannot be copied into Shadowrocket; choose system or custom bootstrap DNS");
  }
  const proxied = settings.nameservers.map(url => `${url}#proxy`).join(", ");
  const dns = dnsMode === "doh" ? proxied : "system";
  const bootstrap = dnsMode === "doh" ? createProxyDns(settings)["proxy-server-nameserver"].join(", ") : "system";
  const rules = mihomoRules.flatMap(rule => {
    if (rule.startsWith("PROCESS-NAME")) return [];
    if (rule.startsWith("MATCH,")) return [`FINAL,${labels.DEFAULT}`];
    const [type, provider, policy, ...options] = rule.split(",");
    const resource = mihomoRuleProviders[provider];
    if (!resource) throw new Error(`Unknown rule provider: ${provider}`);
    return [[type, resource.url, labels[policy] ?? policy, ...options].join(",")];
  });
  return [
    "# Flacier · Shadowrocket",
    "# Import the paired node subscription first; this file contains routing and DNS, not node credentials.",
    "# Update both resources after changing subscription sources or node names.",
    "[General]",
    `ipv6 = ${settings.ipv6}`,
    "prefer-ipv6 = false",
    `dns-server = ${dns}`,
    `direct-dns-server = ${dns}`,
    `fallback-dns-server = ${dns}`,
    `proxy-dns-server = ${bootstrap}`,
    "dns-direct-system = false",
    "udp-policy-not-supported-behaviour = REJECT",
    "close-if-proxy-chain-missing = true",
    "",
    "[Proxy Group]",
    ...mihomoProxyGroups.map(group => groupLine(group, nodeNames)),
    "",
    "[Rule]",
    ...rules,
    "",
  ].join("\n");
}
