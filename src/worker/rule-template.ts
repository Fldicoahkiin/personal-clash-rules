import { parse, stringify } from "yaml";
import { ApiError } from "./api-error";
import { parseRemoteSubscriptionUrl, readRemoteSource } from "./sub-store/remote";
import { dnsProxyGroup, dnsProxyGroupName } from "./mihomo-dns";

function invalid(): never {
  throw new ApiError(422, "unsupported_rule_template", "Template requires supported ruleset and custom_proxy_group directives");
}

// ACL4SSR's INI format is data only: never execute scripts or load local paths.
export function applyRuleTemplate(profile: string, ini: string): string {
  const config = parse(profile) as Record<string, unknown>;
  const groups: Array<Record<string, unknown>> = [];
  const rules: string[] = [];
  const providers: Record<string, unknown> = {};
  const providerNames = Object.keys((config["proxy-providers"] || {}) as object);
  const directives = new Set(["ruleset", "custom_proxy_group", "enable_rule_generator", "overwrite_original_rules"]);
  for (const line of ini.split(/\r?\n/u).map(line => line.trim())) {
    if (!line || /^(?:;|#|\[)/u.test(line)) continue;
    const separator = line.indexOf("=");
    if (separator < 0) invalid();
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!directives.has(key)) invalid();
    if (key === "ruleset") {
      const comma = value.indexOf(",");
      if (comma < 1) invalid();
      const policy = value.slice(0, comma);
      const source = value.slice(comma + 1);
      if (source.startsWith("[]")) {
        const parts = source.slice(2).split(",");
        if (["FINAL", "MATCH"].includes(parts[0])) rules.push(`MATCH,${policy}`);
        else if (["GEOIP", "GEOSITE", "DOMAIN", "DOMAIN-SUFFIX", "DOMAIN-KEYWORD", "IP-CIDR", "IP-CIDR6"].includes(parts[0]) && parts[1]) {
          rules.push(`${parts.slice(0, 2).join(",")},${policy}${parts[2] === "no-resolve" ? ",no-resolve" : ""}`);
        } else invalid();
      } else {
        let url: URL;
        try { url = parseRemoteSubscriptionUrl(source); } catch { invalid(); }
        if (url.protocol !== "https:" || url.username || url.password || url.hash) invalid();
        const name = `template-${Object.keys(providers).length + 1}`;
        providers[name] = { type: "http", behavior: "classical", format: "text", url: url.href, interval: 86400 };
        rules.push(`RULE-SET,${name},${policy}`);
      }
    } else if (key === "custom_proxy_group") {
      const [name, type, ...selectors] = value.split("`");
      if (!name || !["select", "url-test", "fallback", "load-balance"].includes(type) || groups.some(g => g.name === name)) invalid();
      if (name === dnsProxyGroupName) invalid();
      let testUrl: string | undefined;
      let interval = 300;
      let tolerance = 50;
      if (type !== "select") {
        const timing = selectors.pop()?.split(",") || [];
        testUrl = selectors.pop();
        if (!testUrl || !/^https?:\/\//u.test(testUrl) || !/^\d+$/u.test(timing[0] || "")) invalid();
        interval = Math.max(60, Number(timing[0]));
        tolerance = Number(timing[2] || 50);
      }
      const proxies = selectors.filter(s => s.startsWith("[]")).map(s => s.slice(2));
      const patterns = selectors.filter(s => !s.startsWith("[]"));
      if (patterns.some(p => p.startsWith("!!"))) invalid();
      const filter = patterns.map(p => `(${p})`).join("|");
      groups.push({ name, type, "empty-fallback": "REJECT", ...(proxies.length ? { proxies } : {}),
        ...(filter ? { "include-all": true, filter, ...(providerNames.length ? { use: providerNames } : {}) } : {}),
        ...(testUrl ? { url: testUrl, interval, ...(type === "url-test" ? { tolerance } : {}) } : {}),
        icon: `https://rules.flacier.com/policy-icons/${type === "url-test" ? "auto" : "globe"}.svg`,
      });
    } else if (value !== "true") invalid();
    if (groups.length > 100 || rules.length > 300) invalid();
  }
  if (!groups.length || !rules.length || !rules.some(rule => rule.startsWith("MATCH,"))) invalid();
  const names = new Set(["DIRECT", "REJECT", "REJECT-DROP", ...groups.map(g => g.name)]);
  for (const group of groups) if ((group.proxies as string[] | undefined)?.some(name => !names.has(name))) invalid();
  for (const rule of rules) {
    const parts = rule.split(",");
    const policy = parts.at(-1) === "no-resolve" ? parts.at(-2) : parts.at(-1);
    if (!names.has(policy)) invalid();
  }
  const dns = config.dns as { nameserver?: string[] } | undefined;
  if (dns?.nameserver?.some(url => url.endsWith("#GLOBAL") || url.endsWith(`#${dnsProxyGroupName}`))) {
    dns.nameserver = dns.nameserver.map(url => url.replace(/#GLOBAL$/u, `#${dnsProxyGroupName}`));
    groups.push(dnsProxyGroup(providerNames));
  }
  return stringify({ ...config, "proxy-groups": groups, "rule-providers": providers, rules });
}

export async function expandProfileRules(profile: string, assets?: Pick<Env["ASSETS"], "fetch">): Promise<string> {
  const config = parse(profile) as { rules: string[]; "rule-providers"?: Record<string, { url: string; format: string; behavior: string }> };
  const providers = Object.entries(config["rule-providers"] || {});
  // Flacier publishes 35 lists; 40 plus the template fetch stays under the free plan's 50 subrequests.
  if (providers.length > 40) throw new ApiError(413, "output_too_large", "Rule expansion supports at most 40 sources");
  const expanded = new Map<string, string[]>();
  let bytes = 0;
  // Domain-behavior sets (the large domestic list) stay as rule providers; classical sets are inlined.
  const kept = Object.fromEntries(providers.filter(([, provider]) => provider.behavior === "domain" && provider.format === "text"));
  for (const [name, provider] of providers) {
    if (name in kept) continue;
    if (provider.format !== "text" || provider.behavior !== "classical") invalid();
    const url = parseRemoteSubscriptionUrl(provider.url);
    let content: string;
    if (assets && url.origin === "https://rules.flacier.com" && url.pathname.startsWith("/rules/")) {
      const response = await assets.fetch(new Request(url));
      if (!response.ok) throw new ApiError(502, "source_failed", "Published rules could not be read");
      content = await response.text();
    } else content = (await readRemoteSource(url.href, "Flacier-Rules/1.0")).content;
    bytes += new TextEncoder().encode(content).length;
    if (bytes > 1_000_000) throw new ApiError(413, "output_too_large", "Expanded rule sources exceed 1 MB; use expand=false");
    expanded.set(name, content.split(/\r?\n/u).map(line => line.trim()).filter(line => line && !/^[#;]/u.test(line)));
  }
  config.rules = config.rules.flatMap(rule => {
    const [kind, name, policy, flag] = rule.split(",");
    if (kind !== "RULE-SET" || name in kept) return [rule];
    const entries = expanded.get(name);
    if (!entries) invalid();
    return entries.map(entry => {
      const parts = entry.split(",");
      const noResolve = parts.at(-1) === "no-resolve";
      if (noResolve) parts.pop();
      if (parts.length !== 2 || !/^(?:DOMAIN(?:-SUFFIX|-KEYWORD|-REGEX)?|IP-CIDR6?|IP-ASN|GEOIP|GEOSITE|PROCESS-NAME|PROCESS-PATH)$/u.test(parts[0])) invalid();
      return `${parts.join(",")},${policy}${noResolve || flag === "no-resolve" ? ",no-resolve" : ""}`;
    });
  });
  if (Object.keys(kept).length) config["rule-providers"] = kept;
  else delete config["rule-providers"];
  const result = stringify(config);
  if (new TextEncoder().encode(result).length > 1_800_000) throw new ApiError(413, "output_too_large", "Expanded output exceeds 1.8 MB; use expand=false");
  return result;
}
