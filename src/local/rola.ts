import { isIP } from "node:net";
import { isMap, isScalar, isSeq, parseDocument } from "yaml";

import { defaultDnsSettings } from "../config/dns-settings";
import { businessProxyGroupNames, countryGroupNames, manualProxyGroupName, metadataFilter, mihomoPolicyDisplayNames, mihomoProxyGroups, mihomoRuleProviders } from "../config/mihomo-policy";
import { dnsProxyGroupName } from "../worker/mihomo-dns";

const nodeName = "ROLA-RESIDENTIAL";
const groupName = "ROLA";
const residentialSelectableGroups = [
  manualProxyGroupName, "GLOBAL", ...businessProxyGroupNames,
  mihomoPolicyDisplayNames.GLOBAL, ...businessProxyGroupNames.map(name => mihomoPolicyDisplayNames[name]),
];

export const rolaRulePaths = ["ai-anthropic", "ai-openai"].map(
  name => new URL(mihomoRuleProviders[name].url).pathname.slice(1),
);

export function createRolaTemplate(ruleLists: string[]) {
  return {
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
    name: exitIp && exitRegion ? `${exitIp} · ${exitRegion}` : input.name === undefined || input.name === "" ? nodeName : text(input.name, "Rola node name", 64),
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
  return { ...settings, additionalExits };
}

function encryptedUpstream(node: Record<string, unknown>): boolean {
  if (node["skip-cert-verify"] === true || node["dialer-proxy"]) return false;
  if (["vless", "http", "socks5"].includes(String(node.type))) return node.tls === true;
  if (["ss", "vmess"].includes(String(node.type))) return typeof node.cipher === "string" && !["none", "zero", "dummy", ""].includes(node.cipher);
  return ["trojan", "hysteria2", "tuic", "anytls", "snell", "wireguard", "ssh"].includes(String(node.type));
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

function residentialCountryGroups(settings: ReturnType<typeof parseRolaExitSettings>): string[] {
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
  const residentialNames = exits.map(exit => exit.name);
  if (residentialNames.some(name => ["DIRECT", "REJECT", "COMPATIBLE", groupName].includes(name))) throw new Error("Rola node name is reserved");
  const exitPatterns = exits.map(exit => `^${exit.name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}$`);
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
  const aiGroup = ["AI", mihomoPolicyDisplayNames.AI].find(name => groups.items.some(group => isMap(group) && group.get("name") === name && group.get("type") === "select"));
  // Old records did not store a policy choice. Follow the visible AI selector so changing
  // its exit also changes protected DNS; an explicit empty choice still pins the house.
  const policyGroup = settings.policyGroup === undefined ? aiGroup ?? groupName
    : settings.policyGroup === "AI" ? aiGroup ?? "AI" : settings.policyGroup;
  if (policyGroup !== groupName && !groups.items.some(group => isMap(group) && group.get("name") === policyGroup && group.get("type") === "select")) {
    throw new Error("Selected policy group is missing from the base profile");
  }
  const names = new Set<string>();
  for (const item of [...proxies.items, ...groups.items]) {
    if (!isMap(item) || typeof item.get("name") !== "string") throw new Error("Unsupported proxy/group structure in base profile");
    const name = String(item.get("name"));
    if (names.has(name) || [...residentialNames, groupName].includes(name)) throw new Error("Duplicate or reserved Rola name in base profile; regenerate from the original base");
    names.add(name);
  }
  const node = Array.isArray(base.proxies) ? base.proxies.find(item => item?.name === settings.upstreamNode) : undefined;
  if (settings.connectionMode === "chain" && (!node || ["DIRECT", "REJECT", "COMPATIBLE", nodeName, groupName].includes(settings.upstreamNode) || !encryptedUpstream(node))) {
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
  const policy = dns.get("nameserver-policy", true);
  if (policy && (!isMap(policy) || policy.items.length)) throw new Error("Base DNS already has nameserver-policy; review overlaps before adding Rola rules");

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
  // Region membership follows geography; other include-all pools must not start testing the metered exit.
  for (const group of groups.items) {
    if (!isMap(group)) continue;
    if (group.get("name") === dnsProxyGroupName && dnsDefault) {
      group.set("default-selected", dnsDefault);
      continue;
    }
    const countryExits = exits.map((exit, index) => ({ exit, pattern: exitPatterns[index] }))
      .filter(({ exit }) => residentialCountryGroups(exit).includes(String(group.get("name"))));
    if (countryExits.length) {
      if (!group.get("include-all") && !group.get("include-all-proxies")) {
        const members = group.get("proxies", true);
        if (members !== undefined && !isSeq(members)) throw new Error("Invalid country policy group");
        if (isSeq(members)) for (const { exit } of countryExits) members.add(exit.name);
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
    if (!group.get("include-all") && !group.get("include-all-proxies")) continue;
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
  groups.items.splice(Math.min(2, groups.items.length), 0, residentialGroup);
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
    `${rule},${policyGroup}`,
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
    return [kind === "DOMAIN-SUFFIX" ? `+.${host}` : host, settings.dns.map(url => `${url}#${policyGroup}`)];
  }));
  dns.set("nameserver-policy", document.createNode(resolverPolicy));
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

export function createRolaOverride(source: string, value: unknown) {
  const prepared = prepareRolaProfile(source, value);
  const settings = parseRolaSettings(value);
  const output = parseDocument(prepared.profile).toJS({ maxAliasCount: 100 });
  const exits = [settings, ...settings.additionalExits];
  const gatewayRules = [...new Set(exits.flatMap(exit => rolaDirectGatewayRule(exit) ?? []))];
  const patch = {
    connectionMode: settings.connectionMode,
    upstream: settings.upstreamNode, nodes: output.proxies.slice(-exits.length), group: output["proxy-groups"].find((group: { name: string }) => group.name === settings.groupName),
    rules: output.rules.slice(0, settings.rules.length * 2 + gatewayRules.length), domains: settings.rules, gatewayRules,
    policy: output.dns["nameserver-policy"], bootstrap: output.dns["proxy-server-nameserver"],
    bootstrapDefaults: output.dns["default-nameserver"], respectRules: output.dns["respect-rules"],
    exits: exits.map(exit => ({ name: exit.name, pattern: `^${exit.name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}$`, countryGroups: residentialCountryGroups(exit) })),
    dnsGroupName: dnsProxyGroupName,
    dnsGroupChoices: [...Object.keys(countryGroupNames), ...Object.values(countryGroupNames), settings.groupName], metadataFilter,
    selectableGroups: residentialSelectableGroups, policyGroup: prepared.summary.policyGroup,
  };
  // This artifact contains credentials. It is downloaded only from the loopback server.
  return `// PRIVATE: import locally and bind to one subscription. Never upload or sync this file.
const privateRola = ${JSON.stringify(patch)};
function main(config) {
  const data = privateRola;
  const safe = ${encryptedUpstream.toString()};
  const overlaps = ${protectedHost.toString()};
  const dnsDefault = ${residentialDnsDefault.toString()};
  const dnsGroupChoices = ${residentialDnsGroupChoices.toString()};
  if (config.mode !== 'rule' || !Array.isArray(config.proxies) || !Array.isArray(config['proxy-groups']) || !Array.isArray(config.rules) || !config.dns?.enable) throw new Error('Rola: complete rule-mode base required');
  const nodes = config.proxies.filter(node => node.name === data.upstream);
  if (data.connectionMode === 'chain' && (nodes.length !== 1 || !safe(nodes[0]) || overlaps(String(nodes[0].server).toLowerCase(), data.domains))) throw new Error('Rola: selected first hop is missing or unsafe');
  const names = config.proxies.concat(config['proxy-groups']).map(item => item.name);
  if (new Set(names).size !== names.length || data.nodes.some(node => names.includes(node.name)) || names.includes(data.group.name)) throw new Error('Rola: duplicate names or overlay already applied');
  if (data.policyGroup !== data.group.name && !config['proxy-groups'].some(group => group.name === data.policyGroup && group.type === 'select')) throw new Error('Rola: selected policy group is missing');
  if (JSON.stringify(config.dns['proxy-server-nameserver']) !== JSON.stringify(data.bootstrap) || JSON.stringify(config.dns['default-nameserver']) !== JSON.stringify(data.bootstrapDefaults) || config.dns['respect-rules'] !== data.respectRules || config.dns['proxy-server-nameserver-policy'] || Object.keys(config.dns['nameserver-policy'] || {}).length) throw new Error('Rola: base DNS changed; regenerate and verify the overlay');
  const next = JSON.parse(JSON.stringify(config));
  const excludedNodePattern = data.exits.map(exit => exit.pattern).join('|');
  let preservedDnsDefault;
  for (const group of next['proxy-groups']) {
    if (group.name === data.dnsGroupName) {
      const selections = data.nodes.map(node => dnsDefault(group, next.proxies, node));
      if (selections[0] && selections.every(selected => selected === selections[0])) { group['default-selected'] = preservedDnsDefault = selections[0]; continue; }
    }
    const countryExits = data.exits.filter(exit => exit.countryGroups.includes(group.name));
    if (countryExits.length) {
      if (!group['include-all'] && !group['include-all-proxies']) {
        if (group.proxies !== undefined && !Array.isArray(group.proxies)) throw new Error('Rola: invalid country policy group');
        group.proxies = [...(group.proxies || []), ...countryExits.map(exit => exit.name)];
      }
      if (group.filter !== undefined && typeof group.filter !== 'string') throw new Error('Rola: invalid country group filter');
      if (group.filter) group.filter += '|' + countryExits.map(exit => exit.pattern).join('|');
      const otherCountries = data.exits.filter(exit => !countryExits.includes(exit)).map(exit => exit.pattern);
      if (otherCountries.length) {
        if (group['exclude-filter'] !== undefined && typeof group['exclude-filter'] !== 'string') throw new Error('Rola: invalid country group filter');
        group['exclude-filter'] = [group['exclude-filter'], ...otherCountries].filter(Boolean).join('|');
      }
      continue;
    }
    if (!group['include-all'] && !group['include-all-proxies']) continue;
    if (group['exclude-filter'] !== undefined && typeof group['exclude-filter'] !== 'string') throw new Error('Rola: invalid group filter');
    group['exclude-filter'] = group['exclude-filter'] ? group['exclude-filter'] + '|' + excludedNodePattern : excludedNodePattern;
  }
  next.proxies.push(...data.nodes);
  next['proxy-groups'].splice(Math.min(2, next['proxy-groups'].length), 0, data.group);
  for (const group of next['proxy-groups']) {
    if (!data.selectableGroups.includes(group.name)) continue;
    if (!Array.isArray(group.proxies)) throw new Error('Rola: invalid selectable policy group');
    if (group.name === data.policyGroup) group.proxies.unshift(data.group.name);
    else group.proxies.push(data.group.name);
  }
  if (preservedDnsDefault) {
    const choices = dnsGroupChoices(next, data.dnsGroupChoices, data.metadataFilter, preservedDnsDefault);
    const group = next['proxy-groups'].find(group => group.name === data.dnsGroupName);
    if (choices.length) group.proxies = [...new Set([...(group.proxies || []), ...choices])];
  }
  if (data.gatewayRules.length) next.rules = next.rules.filter(rule => !data.gatewayRules.includes(rule));
  next.rules.unshift(...data.rules);
  next.dns['nameserver-policy'] = data.policy;
  next.dns.ipv6 = false;
  next.ipv6 = false;
  return next;
}
`;
}
