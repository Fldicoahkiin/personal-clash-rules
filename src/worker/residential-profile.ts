import { isIP } from "node:net";
import { isMap, isScalar, isSeq, parseDocument, visit } from "yaml";

import { defaultDnsSettings } from "../config/dns-settings";
import { businessProxyGroupNames, countryGroupNames, metadataFilter, mihomoPolicyDisplayNames, mihomoProxyGroups, mihomoRuleProviders } from "../config/mihomo-policy";
import { dnsProxyGroupName } from "./mihomo-dns";
import claudeDomains from "../../public/rules/sing-box/ai-anthropic.json";

const nodeName = "ROLA-RESIDENTIAL";
const groupName = "ROLA";
// Uploaded snapshots of older Flacier profiles still carry the manual selector that GLOBAL replaced.
const legacyManualGroupName = "🖐 手动选择";
const residentialSelectableGroups = [
  legacyManualGroupName, "GLOBAL", ...businessProxyGroupNames,
  mihomoPolicyDisplayNames.GLOBAL, ...businessProxyGroupNames.map(name => mihomoPolicyDisplayNames[name]),
];

export const rolaRulePaths = ["ai-anthropic", "ai-openai"].map(
  name => new URL(mihomoRuleProviders[name].url).pathname.slice(1),
);

export function createRolaTemplate(ruleLists: string[]) {
  return {
    platform: "Rola",
    authMode: "dynamic",
    protocol: "socks5",
    server: "",
    port: 0,
    account: "",
    password: "",
    country: "us",
    sessionId: "main",
    sessionMinutes: 120,
    upstreamNode: "",
    rules: [...new Set([
      ...ruleLists.flatMap(text => text.split(/\r?\n/u).map(line => line.trim()).filter(line => line && !line.startsWith("#"))),
      "DOMAIN-SUFFIX,github.com",
      "DOMAIN-SUFFIX,githubusercontent.com",
      "DOMAIN-SUFFIX,githubassets.com",
    ])],
    dns: [...defaultDnsSettings.nameservers],
    apiToken: "",
  };
}

function record(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function needsGlobalMigration(base: Record<string, unknown>): boolean {
  const providers = base["rule-providers"] as Record<string, { url?: string }> | undefined;
  if (providers?.["ai-anthropic"]?.url !== mihomoRuleProviders["ai-anthropic"].url) return false;
  const groups = base["proxy-groups"] as Array<Record<string, unknown>>;
  if (!groups.some(group => group.name === "🌐 全局" && group.type === "select")) return false;
  if (groups.some(group => group.name === "GLOBAL") || (base.proxies as Array<Record<string, unknown>>).some(node => node.name === "GLOBAL")) {
    throw new Error("GLOBAL already exists; resolve the legacy global group conflict before migration");
  }
  return true;
}

function globalPolicyValue(value: unknown): unknown {
  return typeof value === "string" ? value.replace(/(^|[,#])🌐 全局(?=,no-resolve$|$)/u, "$1GLOBAL") : value;
}

function claudePolicyMigration(base: Record<string, unknown>) {
  const providers = base["rule-providers"] as Record<string, { url?: string }> | undefined;
  if (providers?.["ai-anthropic"]?.url !== mihomoRuleProviders["ai-anthropic"].url) return null;
  const groups = base["proxy-groups"] as Array<Record<string, unknown>>;
  const ai = groups.find(group => ["AI", mihomoPolicyDisplayNames.AI].includes(String(group.name)) && group.type === "select");
  if (!ai || !Array.isArray(ai.proxies)) return null;
  const name = ai.name === "AI" ? "CLAUDE" : mihomoPolicyDisplayNames.CLAUDE;
  const existing = groups.find(group => group.name === name);
  if (existing && existing.type !== "select") throw new Error("Claude policy must be a selectable group");
  const newGroup = existing ? null : { ...ai, name, proxies: [...new Set([ai.name, ...ai.proxies])], "default-selected": ai.name };
  const ruleChanges = (base.rules as string[]).flatMap(rule => {
    if (!/^(?:RULE-SET,ai-anthropic(?:-ip)?,|PROCESS-NAME-REGEX,\(\?i\)\^claude)/u.test(rule)) return [];
    const parts = rule.split(",");
    const index = parts.at(-1) === "no-resolve" ? parts.length - 2 : parts.length - 1;
    if (parts[index] !== ai.name) return [];
    parts[index] = name;
    return [[rule, parts.join(",")]];
  });
  // The UDP refusal that follows the Anthropic rule set moves with it, so it never lands ahead of the rule it guards.
  const priorityRules = [...(base.rules as string[]).map(rule => ruleChanges.find(([before]) => before === rule)?.[1] ?? rule)]
    .filter(rule => (/^(?:RULE-SET,ai-anthropic,|PROCESS-NAME-REGEX,\(\?i\)\^claude)/u.test(rule) && rule.endsWith(`,${name}`))
      || rule === "AND,((NETWORK,UDP),(RULE-SET,ai-anthropic)),REJECT");
  return { name, newGroup, ruleChanges, priorityRules };
}

function isClaudeProtectedRule(rule: string): boolean {
  const [kind, host] = rule.toLowerCase().split(",");
  return claudeDomains.rules.some(domains => domains.domain_suffix.some(suffix => host === suffix || host.endsWith(`.${suffix}`))
    || (kind === "domain" && domains.domain.includes(host)));
}

function text(value: unknown, label: string, max = 255): string {
  if (typeof value !== "string" || !value || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function domain(value: string): boolean {
  return value.length <= 253 && value.split(".").length > 1 && value.split(".").every(
    label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu.test(label),
  ) && !isIP(value);
}

function ipDoh(value: unknown): value is string {
  if (typeof value !== "string" || /\s/u.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(isIP(url.hostname.replace(/^\[|\]$/gu, "")))
      && !url.username && !url.password && !url.hash && !url.search;
  } catch { return false; }
}

function parseRolaExitSettings(value: unknown) {
  const input = record(value, "Rola settings must be an object");
  const platformInput = input.platform === undefined ? "Rola" : input.platform;
  if (typeof platformInput !== "string" || /[\u0000-\u001f\u007f]/u.test(platformInput)) {
    throw new RolaExitMetadataError("平台名称需为文字、数字、空格、点、下划线或连字符，不能包含控制字符。");
  }
  const platform = platformInput.trim() || "Rola";
  if (platform.length > 24 || !/^[\p{L}\p{N} ._-]+$/u.test(platform)) {
    throw new RolaExitMetadataError("平台名称最多 24 字，仅支持文字、数字、空格、点、下划线和连字符。");
  }
  const exitIp = input.exitIp === undefined || input.exitIp === "" ? undefined : input.exitIp;
  const region = input.region === undefined || input.region === "" ? undefined : input.region;
  if ((exitIp === undefined) !== (region === undefined)) throw new RolaExitMetadataError("出口 IP 和区域需同时填写；都留空时保留原备注。");
  if (exitIp !== undefined && (typeof exitIp !== "string" || !isIP(exitIp) || exitIp.includes("%"))) {
    throw new RolaExitMetadataError("出口 IP 必须是完整 IPv4 或 IPv6 地址，不带端口、协议或网卡标识；不会替代接入网关。");
  }
  if (region !== undefined && (typeof region !== "string" || !region.trim() || region.length > 32 || /[\u0000-\u001f\u007f,=#;"'&]/u.test(region))) {
    throw new RolaExitMetadataError("区域需为 1–32 字的地区名称，不能包含换行或逗号、等号等配置分隔符。");
  }
  const exitRegion = typeof region === "string" ? region.trim() : undefined;
  const connectionMode = input.connectionMode ?? "chain";
  if (connectionMode !== "chain" && connectionMode !== "direct") throw new Error("Choose chain or direct Rola access explicitly");
  if (connectionMode === "direct" && input.upstreamNode) throw new Error("Direct Rola access must not select an airport first hop");
  const selectedGroup = input.groupName === undefined || input.groupName === "" ? groupName : text(input.groupName, "Rola group name", 64);
  if (["DIRECT", "REJECT", "COMPATIBLE"].includes(selectedGroup) || /[,#&]/u.test(selectedGroup)) throw new Error("Invalid Rola group name");
  if (input.policyGroup !== undefined && input.policyGroup !== "" && input.policyGroup !== "AI") throw new Error("Invalid protected policy group");
  if (input.protocol !== "http" && input.protocol !== "socks5") throw new Error("Rola protocol must be http or socks5; TLS/UDP support has not been verified");
  const server = text(input.server, "Rola server");
  if (!domain(server) && isIP(server) !== 4) throw new Error("Rola server must be a hostname or IPv4 address, not a URL");
  if (!Number.isInteger(input.port) || Number(input.port) < 1 || Number(input.port) > 65535) throw new Error("Invalid Rola port");
  const authMode = input.authMode ?? "dynamic";
  if (authMode !== "literal" && authMode !== "dynamic") throw new Error("Invalid Rola authentication mode");
  const account = text(input.account, "Rola account", authMode === "literal" ? 255 : 64);
  if (authMode === "dynamic" && (!/^[a-z0-9][a-z0-9._-]*$/iu.test(account) || /-(country|state|city|sessiontime|f)-|_(dc|mobile)(_|$)/iu.test(account))) {
    throw new Error("Use the base dynamic-residential account, without session or country parameters");
  }
  const country = authMode === "literal" && !input.country ? "" : text(input.country, "Rola country", 2).toLowerCase();
  if (country && !/^[a-z]{2}$/u.test(country)) throw new Error("Use a two-letter Rola country code");
  const sessionId = authMode === "literal" ? "" : text(input.sessionId, "Rola sessionId", 32);
  if (authMode === "dynamic" && !/^[a-z0-9]+$/iu.test(sessionId)) throw new Error("Use an alphanumeric Rola sessionId (1–32 characters)");
  if (authMode === "dynamic" && (!Number.isInteger(input.sessionMinutes) || Number(input.sessionMinutes) < 1 || Number(input.sessionMinutes) > 120)) {
    throw new Error("Rola sessionMinutes must be 1–120; dynamic sessions are not static IPs");
  }
  if (!Array.isArray(input.rules) || !input.rules.length || input.rules.length > 500) throw new Error("Add 1–500 protected domain rules");
  const rules = [...new Set(input.rules.map(value => {
    const rule = text(value, "protected rule", 280);
    const [kind, host, extra] = rule.split(",");
    if (!["DOMAIN", "DOMAIN-SUFFIX"].includes(kind) || !host || !domain(host) || extra !== undefined) {
      throw new Error("Protected rules accept only DOMAIN,host or DOMAIN-SUFFIX,host");
    }
    return `${kind},${host.toLowerCase()}`;
  }))];
  if (!Array.isArray(input.dns) || !input.dns.length || input.dns.length > 4 || !input.dns.every(ipDoh)) {
    throw new Error("Rola DNS must contain 1–4 IP-address HTTPS resolvers without routing parameters");
  }
  return {
    connectionMode,
    groupName: selectedGroup,
    policyGroup: input.policyGroup === undefined ? undefined : input.policyGroup === "AI" ? "AI" : selectedGroup,
    authMode,
    name: exitIp && exitRegion ? `[${platform}] ${exitRegion} · ${exitIp}` : input.name === undefined || input.name === "" ? nodeName : text(input.name, "Rola node name", 64),
    platform,
    exitIp: typeof exitIp === "string" ? exitIp : undefined,
    region: exitRegion,
    protocol: input.protocol,
    server,
    port: Number(input.port),
    password: text(input.password, "Rola password"),
    username: authMode === "literal" ? account : `${account}_${sessionId}-country-${country}-sessiontime-${input.sessionMinutes}`,
    upstreamNode: connectionMode === "direct" ? "" : text(input.upstreamNode, "upstream node"),
    rules,
    dns: input.dns as string[],
    country,
    sessionMinutes: authMode === "literal" ? null : Number(input.sessionMinutes),
  };
}

export class RolaExitMetadataError extends Error {}

export function parseRolaSettings(value: unknown) {
  const input = record(value, "Rola settings must be an object");
  const settings = parseRolaExitSettings(input);
  const additions = input.additionalExits === undefined ? [] : input.additionalExits;
  if (!Array.isArray(additions) || additions.length > 7) throw new RolaExitMetadataError("最多可添加 7 个其他家宽出口。");
  if (additions.length && settings.connectionMode !== "direct") throw new RolaExitMetadataError("多个家宽出口目前仅支持直接接入，不能与机场前置串联混用。");
  const additionalExits = additions.map(value => {
    const exit = record(value, "Additional Rola exit must be an object");
    if (exit.authMode !== "literal" || exit.additionalExits !== undefined || (exit.connectionMode !== undefined && exit.connectionMode !== "direct")) {
      throw new RolaExitMetadataError("其他家宽出口仅支持原样账号及直接接入，不能嵌套出口。");
    }
    return parseRolaExitSettings({ ...exit, connectionMode: "direct", upstreamNode: "", groupName: input.groupName,
      policyGroup: input.policyGroup, rules: settings.rules, dns: settings.dns });
  });
  const names = new Set<string>();
  const credentials = new Set<string>();
  for (const exit of [settings, ...additionalExits]) {
    const identity = JSON.stringify([exit.server.toLowerCase(), exit.port, exit.username, exit.password]);
    if (names.has(exit.name)) throw new RolaExitMetadataError("家宽出口名称重复，请使用各自的出口 IP 和区域。");
    if (credentials.has(identity)) throw new RolaExitMetadataError("家宽接入网关和凭据重复，未添加重复节点。");
    names.add(exit.name);
    credentials.add(identity);
  }
  const references = input.residentialNodeNames === undefined ? [] : input.residentialNodeNames;
  if (!Array.isArray(references) || references.length > 8) throw new RolaExitMetadataError("Residential node references must be a list of at most 8 names");
  const residentialNodeNames = references.map(value => {
    const name = text(value, "residential node name");
    if (!name.trim() || names.has(name) || ["DIRECT", "REJECT", "COMPATIBLE", settings.groupName].includes(name)) {
      throw new RolaExitMetadataError("Duplicate or reserved residential node reference");
    }
    names.add(name);
    return name;
  });
  return { ...settings, additionalExits, residentialNodeNames };
}

function encryptedUpstream(node: Record<string, unknown>): boolean {
  if (node["skip-cert-verify"] === true || node["dialer-proxy"]) return false;
  if (["vless", "http", "socks5"].includes(String(node.type))) return node.tls === true;
  if (["ss", "vmess"].includes(String(node.type))) return typeof node.cipher === "string" && !["none", "zero", "dummy", ""].includes(node.cipher);
  return ["trojan", "hysteria2", "tuic", "anytls", "snell", "wireguard", "ssh"].includes(String(node.type));
}

function validateResidentialReferences(nodes: Array<Record<string, unknown>>, names: string[], encrypted: (node: Record<string, unknown>) => boolean) {
  for (const name of names) {
    const matches = nodes.filter(node => node.name === name);
    const node = matches[0];
    if (matches.length !== 1 || typeof node.server !== "string" || !Number.isInteger(node.port) || !encrypted(node)) {
      throw new Error("Residential node reference must match one existing independent encrypted node");
    }
  }
}

export function rolaUpstreamChoices(source: string) {
  const document = parseDocument(source, { prettyErrors: false, uniqueKeys: true });
  if (document.errors.length) throw new Error("Base profile is not valid YAML");
  const base = record(document.toJS({ maxAliasCount: 100 }), "Invalid base profile");
  if (!Array.isArray(base.proxies) || !base.proxies.length) throw new Error("Base profile has no inline nodes");
  return base.proxies.map(value => {
    const node = record(value, "Invalid proxy");
    const name = text(node.name, "proxy name");
    return { name, type: String(node.type), selectable: !["DIRECT", "REJECT", "COMPATIBLE", nodeName, groupName].includes(name) && encryptedUpstream(node) };
  });
}

function protectedHost(host: string, rules: string[]) {
  return rules.some(rule => {
    const [kind, target] = rule.split(",");
    return host === target || (kind === "DOMAIN-SUFFIX" && host.endsWith(`.${target}`));
  });
}

export function rolaDirectGatewayRule(settings: ReturnType<typeof parseRolaExitSettings>): string | undefined {
  if (settings.connectionMode !== "direct") return undefined;
  const endpoint = isIP(settings.server) === 4
    ? `IP-CIDR,${settings.server}/32,no-resolve`
    : `DOMAIN,${settings.server.toLowerCase()}`;
  return `AND,((${endpoint}),(DST-PORT,${settings.port})),DIRECT`;
}

function residentialCountryGroups(settings: { country: string; name: string }): string[] {
  return Object.entries(countryGroupNames).flatMap(([code, name]) => {
    const group = mihomoProxyGroups.find(group => group.name === name);
    if (!group || !("filter" in group) || !group.filter) return [];
    const pattern = new RegExp(group.filter.replace(/^\(\?i\)/u, ""), "iu");
    return pattern.test(settings.country || settings.name) ? [code, name] : [];
  });
}

function residentialDnsDefault(group: Record<string, unknown>, nodes: Array<Record<string, unknown>>, residential: Record<string, unknown>): string | undefined {
  if (group.type !== "select" || (!group["include-all"] && !group["include-all-proxies"])) return undefined;
  if ([group.filter, group["exclude-filter"]].some(value => value !== undefined && (typeof value !== "string" || value.includes("`")))) return undefined;
  if (group.proxies !== undefined && !Array.isArray(group.proxies)) return undefined;
  // Unknown provider choices and non-JavaScript filters cannot establish a safe original default here.
  try {
    const pattern = (value: unknown) => typeof value === "string" && value
      ? new RegExp(value.replace(/^\(\?i\)/u, ""), value.startsWith("(?i)") ? "iu" : "u") : undefined;
    const include = pattern(group.filter);
    const exclude = pattern(group["exclude-filter"]);
    const types = String(group["exclude-type"] ?? "").toLowerCase().split("|").filter(Boolean);
    if (types.some(type => !["direct", "reject"].includes(type))) return undefined;
    const accepted = (node: Record<string, unknown>, included: boolean) => typeof node.name === "string"
      && !types.includes(String(node.type).toLowerCase()) && !exclude?.test(node.name)
      && (!included || !include || include.test(node.name));
    if (!accepted(residential, true)) return undefined;
    const explicit: unknown[] = Array.isArray(group.proxies) ? group.proxies : [];
    if (explicit.some(name => !nodes.some(node => node.name === name))) return undefined;
    const original = nodes.filter(node => accepted(node, true)).map(node => String(node.name)).sort((left, right) => {
      // Go sorts UTF-8 strings by code point, not JavaScript's UTF-16 code units.
      const a = [...left], b = [...right];
      for (let i = 0; i < Math.min(a.length, b.length); i++) {
        const difference = a[i].codePointAt(0)! - b[i].codePointAt(0)!;
        if (difference) return difference;
      }
      return a.length - b.length;
    });
    const candidates = [...explicit.filter(name => nodes.some(node => node.name === name && accepted(node, false))).map(String), ...original];
    const selected = group["default-selected"];
    if (selected) return typeof selected === "string" && candidates.includes(selected) ? selected : undefined;
    return candidates[0];
  } catch { return undefined; }
}

function residentialDnsGroupChoices(profile: Record<string, unknown>, names: string[], metadataPattern: string, originalDefault: string): string[] {
  const nodes = profile.proxies as Array<Record<string, unknown>>;
  const groups = profile["proxy-groups"] as Array<Record<string, unknown>>;
  const pattern = (value: unknown) => {
    if (value === undefined || value === "") return undefined;
    if (typeof value !== "string" || value.includes("`")) throw new Error("Unknown proxy filter");
    return new RegExp(value.replace(/^\(\?i\)/u, ""), value.startsWith("(?i)") ? "iu" : "u");
  };
  const metadata = pattern(metadataPattern);
  const independent = (name: unknown, seen = new Set<string>()): boolean => {
    if (name === "REJECT") return true;
    if (typeof name !== "string" || name === "DIRECT" || metadata?.test(name) || seen.has(name)) return false;
    const node = nodes.find(node => node.name === name);
    if (!node || typeof node.type !== "string" || node.type === "direct" || node.type === "reject" || typeof node.server !== "string" || !Number.isInteger(node.port)) return false;
    // A concrete node may dial another concrete node, but never a selectable group that could depend on DNS.
    const dialer = node["dialer-proxy"];
    return dialer === undefined || dialer === "DIRECT" || independent(dialer, new Set([...seen, name]));
  };
  if (!independent(originalDefault)) return [];
  return [...new Set(names)].filter(name => {
    const group = groups.find(group => group.name === name);
    if (!group || group.type !== "select" || group["empty-fallback"] !== "REJECT") return false;
    if (group.use !== undefined && (!Array.isArray(group.use) || group.use.length)) return false;
    if (group["include-all-providers"] || (group["include-all"] && profile["proxy-providers"]
      && Object.keys(profile["proxy-providers"] as object).length)) return false;
    if (group.proxies !== undefined && !Array.isArray(group.proxies)) return false;
    try {
      const include = pattern(group.filter), exclude = pattern(group["exclude-filter"]);
      if (group["exclude-type"] !== undefined && typeof group["exclude-type"] !== "string") return false;
      const excludedTypes = String(group["exclude-type"] ?? "").toLowerCase().split("|");
      const included = group["include-all"] || group["include-all-proxies"] ? nodes.filter(node =>
        typeof node.name === "string" && !excludedTypes.includes(String(node.type).toLowerCase())
        && (!include || include.test(node.name)) && !exclude?.test(node.name)).map(node => node.name) : [];
      const members = [...(Array.isArray(group.proxies) ? group.proxies : []), ...included];
      if (group["default-selected"] !== undefined && !members.includes(group["default-selected"])) return false;
      // Nested policy groups are not admitted, including country cycles and business selectors.
      return members.every(member => independent(member));
    } catch { return false; }
  });
}

export function prepareRolaProfile(source: string, value: unknown) {
  const settings = parseRolaSettings(value);
  const nodeName = settings.name;
  const groupName = settings.groupName;
  const exits = [settings, ...settings.additionalExits];
  const residentialExits = [...exits, ...settings.residentialNodeNames.map(name => ({ name, country: "" }))];
  const residentialNames = residentialExits.map(exit => exit.name);
  if (residentialNames.some(name => ["DIRECT", "REJECT", "COMPATIBLE", groupName].includes(name))) throw new Error("Rola node name is reserved");
  const exitPatterns = residentialExits.map(exit => `^${exit.name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}$`);
  const nodePattern = exitPatterns.join("|");
  const document = parseDocument(source, { prettyErrors: false, uniqueKeys: true });
  if (document.errors.length || !isMap(document.contents)) throw new Error("Base profile is not valid YAML");
  let base: Record<string, unknown>;
  try { base = record(document.toJS({ maxAliasCount: 100 }), "Invalid base profile"); }
  catch { throw new Error("Base profile contains unsupported YAML aliases"); }
  if (base.mode !== "rule") throw new Error("Base profile must use rule mode");
  const proxies = document.get("proxies", true);
  const groups = document.get("proxy-groups", true);
  const rules = document.get("rules", true);
  const dns = document.get("dns", true);
  if (!isSeq(proxies) || !isSeq(groups) || !isSeq(rules) || !isMap(dns) || dns.get("enable") !== true) {
    throw new Error("Use a complete Mihomo profile with inline nodes, groups, rules and working DNS; a provider-only or empty profile is insufficient");
  }
  if (needsGlobalMigration(base)) {
    for (const section of [groups, rules, dns]) visit(section, {
      Scalar(_key, node) { node.value = globalPolicyValue(node.value); },
    });
    base = record(document.toJS({ maxAliasCount: 100 }), "Invalid migrated base profile");
  }
  const claudePolicy = claudePolicyMigration(base);
  if (claudePolicy?.newGroup) {
    const aiIndex = groups.items.findIndex(group => isMap(group) && group.get("name") === claudePolicy.newGroup?.["default-selected"]);
    groups.items.splice(aiIndex + 1, 0, document.createNode(claudePolicy.newGroup));
  }
  if (claudePolicy) for (const item of rules.items) {
    if (!isScalar(item)) continue;
    const replacement = claudePolicy.ruleChanges.find(([before]) => before === item.value);
    if (replacement) item.value = replacement[1];
  }
  if (claudePolicy && rules.items.some(item => isScalar(item) && /^PROCESS-NAME-REGEX,\(\?i\)\^codex/u.test(String(item.value)))) {
    const priority = rules.items.filter(item => isScalar(item) && claudePolicy.priorityRules.includes(String(item.value)));
    rules.items = rules.items.filter(item => !priority.includes(item));
    const codexIndex = rules.items.findIndex(item => isScalar(item) && /^PROCESS-NAME-REGEX,\(\?i\)\^codex/u.test(String(item.value)));
    rules.items.splice(codexIndex, 0, ...priority);
  }
  const aiGroup = ["AI", mihomoPolicyDisplayNames.AI].find(name => groups.items.some(group => isMap(group) && group.get("name") === name && group.get("type") === "select"));
  // Old records follow the visible service selectors; an explicit empty choice pins the house.
  const policyGroup = settings.policyGroup === undefined ? aiGroup ?? groupName
    : settings.policyGroup === "AI" ? aiGroup ?? "AI" : settings.policyGroup;
  if (policyGroup !== groupName && !groups.items.some(group => isMap(group) && group.get("name") === policyGroup && group.get("type") === "select")) {
    throw new Error("Selected policy group is missing from the base profile");
  }
  const protectedPolicy = (rule: string) => claudePolicy && policyGroup === aiGroup && isClaudeProtectedRule(rule) ? claudePolicy.name : policyGroup;
  const names = new Set<string>();
  for (const item of [...proxies.items, ...groups.items]) {
    if (!isMap(item) || typeof item.get("name") !== "string") throw new Error("Unsupported proxy/group structure in base profile");
    const name = String(item.get("name"));
    if (names.has(name) || exits.some(exit => exit.name === name) || name === groupName) throw new Error("Duplicate or reserved Rola name in base profile; regenerate from the original base");
    names.add(name);
  }
  validateResidentialReferences(base.proxies as Array<Record<string, unknown>>, settings.residentialNodeNames, encryptedUpstream);
  const node = Array.isArray(base.proxies) ? base.proxies.find(item => item?.name === settings.upstreamNode) : undefined;
  if (settings.connectionMode === "chain" && (!node || ["DIRECT", "REJECT", "COMPATIBLE", nodeName, groupName, ...settings.residentialNodeNames].includes(settings.upstreamNode) || !encryptedUpstream(node))) {
    throw new Error("Choose one concrete encrypted upstream node, with certificate verification enabled and no existing dialer-proxy; groups and DIRECT are not allowed");
  }
  if (exits.some(exit => protectedHost(exit.server.toLowerCase(), settings.rules)) || (node && protectedHost(String(node.server).toLowerCase(), settings.rules))) {
    throw new Error("Proxy gateway names must not overlap protected domains");
  }
  // The converter shares bootstrap arrays; YAML may encode the second list as an alias.
  // Validate the bounded, resolved value while retaining the original document and comments.
  const baseDns = record(base.dns, "Invalid base DNS");
  const bootstrap = baseDns["proxy-server-nameserver"];
  const addressResolver = (item: unknown) => ipDoh(item) || (typeof item === "string" && Boolean(isIP(item)));
  const defaults = baseDns["default-nameserver"];
  const independent = (item: unknown) => {
    if (item === "system" || addressResolver(item)) return true;
    if (typeof item !== "string" || baseDns["respect-rules"] === true || !Array.isArray(defaults) || !defaults.length || !defaults.every(addressResolver)) return false;
    try {
      const url = new URL(item);
      return url.protocol === "https:" && domain(url.hostname) && !url.username && !url.password && !url.hash && !url.search && !protectedHost(url.hostname, settings.rules);
    } catch { return false; }
  };
  if (!Array.isArray(bootstrap) || !bootstrap.length || !bootstrap.every(independent)) {
    throw new Error("Base DNS needs independent proxy-server-nameserver entries (system, IP or independently bootstrapped HTTPS); review bootstrap before adding a chain");
  }
  if (dns.has("proxy-server-nameserver-policy")) throw new Error("Review the existing proxy-server-nameserver-policy before adding a chain");
  // Base resolver policies stay beside the Rola entries only when no domain can match both.
  const basePolicy = baseDns["nameserver-policy"] === undefined ? {} : record(baseDns["nameserver-policy"], "Invalid base nameserver-policy");
  for (const key of Object.keys(basePolicy)) {
    // Rola rules are stored lowercase; Mihomo matches domains case-insensitively.
    const host = (key.startsWith("+.") ? key.slice(2) : key).toLowerCase();
    const covers = (target: string) => key.startsWith("+.") && (target === host || target.endsWith(`.${host}`));
    if (!domain(host) || protectedHost(host, settings.rules) || settings.rules.some(rule => covers(rule.split(",")[1]))) {
      throw new Error("Base DNS nameserver-policy overlaps Rola rules or uses an unsupported key; review it before adding a chain");
    }
  }

  const residentialNodes = exits.map(exit => ({
    name: exit.name,
    type: exit.protocol,
    server: exit.server,
    port: exit.port,
    username: exit.username,
    password: exit.password,
    udp: false,
    "dialer-proxy": settings.connectionMode === "direct" ? "DIRECT" : settings.upstreamNode,
  }));
  const dnsGroup = Array.isArray(base["proxy-groups"])
    ? base["proxy-groups"].find(group => group?.name === dnsProxyGroupName) : undefined;
  const dnsDefaults = dnsGroup ? residentialNodes.map(node => residentialDnsDefault(dnsGroup, base.proxies as Array<Record<string, unknown>>, node)) : [];
  const dnsDefault = dnsDefaults[0] && dnsDefaults.every(value => value === dnsDefaults[0]) ? dnsDefaults[0] : undefined;
  for (const node of residentialNodes) proxies.add(document.createNode(node));
  // Region membership follows geography; exclude residential exits from other include-all selection pools.
  for (const group of groups.items) {
    if (!isMap(group)) continue;
    if (group.get("name") === dnsProxyGroupName && dnsDefault) {
      group.set("default-selected", dnsDefault);
      continue;
    }
    const countryExits = residentialExits.map((exit, index) => ({ exit, pattern: exitPatterns[index] }))
      .filter(({ exit }) => residentialCountryGroups(exit).includes(String(group.get("name"))));
    if (countryExits.length) {
      if (!group.get("include-all") && !group.get("include-all-proxies")) {
        const members = group.get("proxies", true);
        if (members !== undefined && !isSeq(members)) throw new Error("Invalid country policy group");
        if (isSeq(members)) for (const { exit } of countryExits) {
          if (!members.items.some(member => isScalar(member) && member.value === exit.name)) members.add(exit.name);
        }
        else group.set("proxies", document.createNode(countryExits.map(({ exit }) => exit.name)));
      }
      const filter = group.get("filter");
      if (filter !== undefined && typeof filter !== "string") throw new Error("Invalid country group filter");
      if (filter) group.set("filter", `${filter}|${countryExits.map(({ pattern }) => pattern).join("|")}`);
      const otherCountries = exitPatterns.filter(pattern => !countryExits.some(exit => exit.pattern === pattern));
      if (otherCountries.length) {
        const excluded = group.get("exclude-filter");
        if (excluded !== undefined && typeof excluded !== "string") throw new Error("Invalid group exclude-filter");
        group.set("exclude-filter", [excluded, ...otherCountries].filter(Boolean).join("|"));
      }
      continue;
    }
    if (!group.get("include-all") && !group.get("include-all-proxies")
      && !(settings.residentialNodeNames.length && ["url-test", "fallback", "load-balance"].includes(String(group.get("type"))))) continue;
    const filter = group.get("exclude-filter");
    if (filter !== undefined && typeof filter !== "string") throw new Error("Invalid group exclude-filter");
    group.set("exclude-filter", filter ? `${filter}|${nodePattern}` : nodePattern);
  }
  const flag = String.fromCodePoint(...settings.country.toUpperCase().split("").map(char => 127397 + char.charCodeAt(0)));
  groups.add(document.createNode({
    name: groupName, type: "select", proxies: residentialNames,
    "empty-fallback": "REJECT", "disable-udp": true,
  }));
  const residentialGroup = groups.items.pop();
  // Directly after GLOBAL; bases without it keep the legacy third position.
  const globalIndex = groups.items.findIndex(group => isMap(group) && group.get("name") === "GLOBAL");
  groups.items.splice(globalIndex >= 0 ? globalIndex + 1 : Math.min(2, groups.items.length), 0, residentialGroup);
  for (const group of groups.items) {
    if (!isMap(group) || !residentialSelectableGroups.includes(String(group.get("name")))) continue;
    const members = group.get("proxies", true);
    if (!isSeq(members)) throw new Error("Invalid selectable policy group");
    if (group.get("name") === policyGroup) members.items.unshift(document.createNode(groupName));
    else members.add(groupName);
  }
  if (dnsDefault) {
    const current = record(document.toJS({ maxAliasCount: 100 }), "Invalid prepared profile");
    const choices = residentialDnsGroupChoices(current, [...Object.keys(countryGroupNames), ...Object.values(countryGroupNames), groupName], metadataFilter, dnsDefault);
    const group = groups.items.find(group => isMap(group) && group.get("name") === dnsProxyGroupName);
    if (isMap(group) && choices.length) {
      const members = group.get("proxies", true);
      if (isSeq(members)) for (const choice of choices) {
        if (!members.items.some(member => isScalar(member) && member.value === choice)) members.add(choice);
      }
      else group.set("proxies", document.createNode(choices));
    }
  }
  const protectedRules = settings.rules.flatMap(rule => [
    `AND,((${rule}),(NETWORK,UDP)),REJECT`,
    `${rule},${protectedPolicy(rule)}`,
  ]);
  const gatewayRules = [...new Set(exits.flatMap(exit => rolaDirectGatewayRule(exit) ?? []))];
  if (gatewayRules.length) {
    // dialer-proxy affects Mihomo's own socket, not external clients entering through a proxy port or TUN.
    rules.items = rules.items.filter(rule => !isScalar(rule) || !gatewayRules.includes(String(rule.value)));
    protectedRules.unshift(...gatewayRules);
  }
  rules.items.unshift(...protectedRules.map(rule => document.createNode(rule)));
  const resolverPolicy = Object.fromEntries(settings.rules.map(rule => {
    const [kind, host] = rule.split(",");
    return [kind === "DOMAIN-SUFFIX" ? `+.${host}` : host, settings.dns.map(url => `${url}#${protectedPolicy(rule)}`)];
  }));
  dns.set("nameserver-policy", document.createNode({ ...resolverPolicy, ...basePolicy }));
  dns.set("ipv6", false);
  document.set("ipv6", false);
  const summary = {
    connectionMode: settings.connectionMode,
    groupName,
    policyGroup,
    country: settings.country ? `${flag} ${settings.country.toUpperCase()}` : "地区未声明",
    sessionMinutes: settings.sessionMinutes,
    protectedRules: settings.rules.length,
    inlineNodes: proxies.items.length,
    chain: settings.connectionMode === "direct" ? "device -> Rola -> target" : "device -> selected airport node -> Rola -> target",
    quota: "Rola and airport quotas are separate, not additive",
    dnsSelection: dnsDefault ? "DNS-PROXY 已加入家宽选项，默认保持原机场节点。"
      : dnsGroup ? "DNS-PROXY 尚未加入家宽：无法从当前内联节点及过滤条件确认原默认出口，已保留现有 DNS 选择行为。"
      : "基础配置没有 DNS-PROXY 组，未增加 DNS 选择项。",
    activation: "not activated; client overrides and device DNS still require review",
  };
  return {
    profile: document.toString({ lineWidth: 0 }), summary,
    // Keep the validated AST internal; mobile renderers read its current values without reparsing YAML.
    toJS() { return record(document.toJS({ maxAliasCount: 100 }), "Invalid prepared profile"); },
  };
}
