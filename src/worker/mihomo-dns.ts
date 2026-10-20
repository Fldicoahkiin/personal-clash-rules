import { isIP } from "node:net";
import { defaultDnsSettings, type DnsSettings } from "../config/dns-settings";
import { metadataFilter } from "../config/mihomo-policy";
import { ApiError } from "./api-error";

export const dnsProxyGroupName = "DNS-PROXY";
// AliDNS and DNSPod, dialed without a proxy. CDN answers then match the direct route instead of the proxy's location.
export const domesticDoh = ["https://223.5.5.5/dns-query", "https://1.12.12.12/dns-query"];
// WeChat and QQ fetch media by the address they receive; fake IPs or overseas CDN answers stall them.
const tencentMediaDomains = ["qq.com", "qpic.cn", "qlogo.cn", "gtimg.cn", "gtimg.com", "wechat.com"].map(domain => `+.${domain}`);

export function dnsProxyGroup(providerNames: string[] = []) {
  return {
    name: dnsProxyGroupName,
    type: "select",
    "include-all": true,
    "exclude-type": "direct|reject",
    "exclude-filter": metadataFilter,
    "empty-fallback": "REJECT",
    ...(providerNames.length ? { use: providerNames } : {}),
    icon: "https://rules.flacier.com/policy-icons/globe.svg",
  };
}

function dependencyError(): never {
  throw new ApiError(422, "upstream_dns_dependency", "DNS dependency cannot be preserved after replacing upstream routing");
}

export function readUpstreamDns(upstream?: Record<string, unknown>): Record<string, unknown> {
  const value = upstream?.dns;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(422, "upstream_dns_unavailable", "A single upstream Clash configuration with DNS is required");
  }
  return structuredClone(value) as Record<string, unknown>;
}

// Upstream group/interface routing and rule-set references are not portable to a new profile.
export function validateIndependentDns(value: unknown): void {
  if (typeof value === "string") {
    const fragment = value.split("#").slice(1).join("#");
    for (const option of fragment.split("&").filter(Boolean)) {
      if (option !== "DIRECT" && option !== "h3" && !/^(?:h3|ecs|ecs-override|disable-ipv[46]|disable-qtype-\d+)=/u.test(option)) dependencyError();
    }
  } else if (Array.isArray(value)) {
    value.forEach(validateIndependentDns);
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (key.startsWith("rule-set:") || (key === "respect-rules" && child === true)) dependencyError();
      validateIndependentDns(child);
    }
  }
}

export function createProxyDns(settings: DnsSettings = defaultDnsSettings, upstream?: Record<string, unknown>) {
  let bootstrap: string[];
  let resolverBootstrap: string[];
  if (settings.bootstrapMode === "upstream") {
    const dns = readUpstreamDns(upstream);
    validateIndependentDns(dns);
    const nodes = dns["proxy-server-nameserver"];
    const defaults = dns["default-nameserver"];
    if (!Array.isArray(nodes) || !nodes.length || !nodes.every(item => typeof item === "string")
      || !Array.isArray(defaults) || !defaults.length || !defaults.every(item => typeof item === "string")) {
      throw new ApiError(422, "upstream_bootstrap_unavailable", "Upstream must provide independent default-nameserver and proxy-server-nameserver");
    }
    bootstrap = nodes;
    resolverBootstrap = defaults;
  } else if (settings.bootstrapMode === "custom") {
    bootstrap = settings.bootstrap;
    if (!bootstrap.length || bootstrap.some(url => !isIP(new URL(url).hostname.replace(/^\[|\]$/gu, "")))) {
      throw new ApiError(400, "invalid_dns_bootstrap", "Bootstrap DoH must use IP addresses to avoid circular DNS resolution");
    }
    resolverBootstrap = bootstrap;
  } else {
    bootstrap = ["system"];
    resolverBootstrap = bootstrap;
  }
  const proxied = settings.nameservers.map(url => `${url}#${dnsProxyGroupName}`);
  return {
    enable: true,
    ipv6: settings.ipv6,
    "enhanced-mode": "fake-ip",
    "fake-ip-range": "198.18.0.1/16",
    "fake-ip-filter": ["*.lan", "*.local", "localhost", ...tencentMediaDomains],
    "default-nameserver": resolverBootstrap,
    "proxy-server-nameserver": bootstrap,
    nameserver: proxied,
    "nameserver-policy": Object.fromEntries(tencentMediaDomains.map(domain => [domain, [...domesticDoh]])),
    // Only connections already routed DIRECT resolve here; rule matching and proxied traffic keep the proxied resolvers.
    "direct-nameserver": [...domesticDoh],
    "use-system-hosts": false,
  };
}
