import { isIP } from "node:net";
import { isMap, isSeq, parseDocument } from "yaml";

import { defaultDnsSettings } from "../config/dns-settings";
import { mihomoRuleProviders } from "../config/mihomo-policy";

const nodeName = "ROLA-RESIDENTIAL";
const groupName = "ROLA";

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

export function parseRolaSettings(value: unknown) {
  const input = record(value, "Rola settings must be an object");
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
    authMode,
    name: input.name === undefined || input.name === "" ? nodeName : text(input.name, "Rola node name", 64),
    protocol: input.protocol,
    server,
    port: Number(input.port),
    password: text(input.password, "Rola password"),
    username: authMode === "literal" ? account : `${account}_${sessionId}-country-${country}-sessiontime-${input.sessionMinutes}`,
    upstreamNode: text(input.upstreamNode, "upstream node"),
    rules,
    dns: input.dns as string[],
    country,
    sessionMinutes: authMode === "literal" ? null : Number(input.sessionMinutes),
  };
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

export function prepareRolaProfile(source: string, value: unknown) {
  const settings = parseRolaSettings(value);
  const nodeName = settings.name;
  if (["DIRECT", "REJECT", "COMPATIBLE", groupName].includes(nodeName)) throw new Error("Rola node name is reserved");
  const nodePattern = `^${nodeName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}$`;
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
  const names = new Set<string>();
  for (const item of [...proxies.items, ...groups.items]) {
    if (!isMap(item) || typeof item.get("name") !== "string") throw new Error("Unsupported proxy/group structure in base profile");
    const name = String(item.get("name"));
    if (names.has(name) || [nodeName, groupName].includes(name)) throw new Error("Duplicate or reserved Rola name in base profile; regenerate from the original base");
    names.add(name);
  }
  const node = Array.isArray(base.proxies) ? base.proxies.find(item => item?.name === settings.upstreamNode) : undefined;
  if (!node || ["DIRECT", "REJECT", "COMPATIBLE", nodeName, groupName].includes(settings.upstreamNode) || !encryptedUpstream(node)) {
    throw new Error("Choose one concrete encrypted upstream node, with certificate verification enabled and no existing dialer-proxy; groups and DIRECT are not allowed");
  }
  if (protectedHost(settings.server.toLowerCase(), settings.rules) || protectedHost(String(node.server).toLowerCase(), settings.rules)) {
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

  const rola = {
    name: nodeName,
    type: settings.protocol,
    server: settings.server,
    port: settings.port,
    username: settings.username,
    password: settings.password,
    udp: false,
    "dialer-proxy": settings.upstreamNode,
  };
  proxies.add(document.createNode(rola));
  // Keep the metered exit out of every include-all group, including automatic health checks.
  for (const group of groups.items) {
    if (!isMap(group) || (!group.get("include-all") && !group.get("include-all-proxies"))) continue;
    const filter = group.get("exclude-filter");
    if (filter !== undefined && typeof filter !== "string") throw new Error("Invalid group exclude-filter");
    group.set("exclude-filter", filter ? `${filter}|${nodePattern}` : nodePattern);
  }
  const flag = String.fromCodePoint(...settings.country.toUpperCase().split("").map(char => 127397 + char.charCodeAt(0)));
  groups.add(document.createNode({
    name: groupName, type: "select", proxies: [nodeName],
    "empty-fallback": "REJECT", "disable-udp": true,
    icon: "https://rules.flacier.com/policy-icons/region.svg",
  }));
  const protectedRules = settings.rules.flatMap(rule => [
    `AND,((${rule}),(NETWORK,UDP)),REJECT`,
    `${rule},${groupName}`,
  ]);
  rules.items.unshift(...protectedRules.map(rule => document.createNode(rule)));
  const resolverPolicy = Object.fromEntries(settings.rules.map(rule => {
    const [kind, host] = rule.split(",");
    return [kind === "DOMAIN-SUFFIX" ? `+.${host}` : host, settings.dns.map(url => `${url}#${groupName}`)];
  }));
  dns.set("nameserver-policy", document.createNode(resolverPolicy));
  dns.set("ipv6", false);
  document.set("ipv6", false);
  const summary = {
    country: settings.country ? `${flag} ${settings.country.toUpperCase()}` : "地区未声明",
    sessionMinutes: settings.sessionMinutes,
    protectedRules: settings.rules.length,
    inlineNodes: proxies.items.length,
    chain: "device -> selected airport node -> Rola -> target",
    quota: "Rola and airport quotas are separate, not additive",
    activation: "not activated; client overrides and device DNS still require review",
  };
  return { profile: document.toString({ lineWidth: 0 }), summary };
}

export function createRolaOverride(source: string, value: unknown) {
  const prepared = prepareRolaProfile(source, value);
  const settings = parseRolaSettings(value);
  const output = parseDocument(prepared.profile).toJS({ maxAliasCount: 100 });
  const patch = {
    upstream: settings.upstreamNode, node: output.proxies.at(-1), group: output["proxy-groups"].at(-1),
    rules: output.rules.slice(0, settings.rules.length * 2), domains: settings.rules,
    policy: output.dns["nameserver-policy"], bootstrap: output.dns["proxy-server-nameserver"],
    bootstrapDefaults: output.dns["default-nameserver"], respectRules: output.dns["respect-rules"],
    excludedNodePattern: `^${settings.name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}$`,
  };
  // This artifact contains credentials. It is downloaded only from the loopback server.
  return `// PRIVATE: import locally and bind to one subscription. Never upload or sync this file.
const privateRola = ${JSON.stringify(patch)};
function main(config) {
  const data = privateRola;
  const safe = ${encryptedUpstream.toString()};
  const overlaps = ${protectedHost.toString()};
  if (config.mode !== 'rule' || !Array.isArray(config.proxies) || !Array.isArray(config['proxy-groups']) || !Array.isArray(config.rules) || !config.dns?.enable) throw new Error('Rola: complete rule-mode base required');
  const nodes = config.proxies.filter(node => node.name === data.upstream);
  if (nodes.length !== 1 || !safe(nodes[0]) || overlaps(String(nodes[0].server).toLowerCase(), data.domains)) throw new Error('Rola: selected first hop is missing or unsafe');
  const names = config.proxies.concat(config['proxy-groups']).map(item => item.name);
  if (new Set(names).size !== names.length || names.includes(data.node.name) || names.includes(data.group.name)) throw new Error('Rola: duplicate names or overlay already applied');
  if (JSON.stringify(config.dns['proxy-server-nameserver']) !== JSON.stringify(data.bootstrap) || JSON.stringify(config.dns['default-nameserver']) !== JSON.stringify(data.bootstrapDefaults) || config.dns['respect-rules'] !== data.respectRules || config.dns['proxy-server-nameserver-policy'] || Object.keys(config.dns['nameserver-policy'] || {}).length) throw new Error('Rola: base DNS changed; regenerate and verify the overlay');
  const next = JSON.parse(JSON.stringify(config));
  for (const group of next['proxy-groups']) {
    if (!group['include-all'] && !group['include-all-proxies']) continue;
    if (group['exclude-filter'] !== undefined && typeof group['exclude-filter'] !== 'string') throw new Error('Rola: invalid group filter');
    group['exclude-filter'] = group['exclude-filter'] ? group['exclude-filter'] + '|' + data.excludedNodePattern : data.excludedNodePattern;
  }
  next.proxies.push(data.node);
  next['proxy-groups'].push(data.group);
  next.rules.unshift(...data.rules);
  next.dns['nameserver-policy'] = data.policy;
  next.dns.ipv6 = false;
  next.ipv6 = false;
  return next;
}
`;
}
