import { parse, stringify } from "yaml";
import { ApiError } from "./api-error";
import { parseRemoteSubscriptionUrl } from "./sub-store";

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
      groups.push({ name, type, ...(proxies.length ? { proxies } : {}),
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
  if (dns?.nameserver) dns.nameserver = dns.nameserver.map(url => url.replace("#GLOBAL", `#${groups[0].name}`));
  return stringify({ ...config, "proxy-groups": groups, "rule-providers": providers, rules });
}
