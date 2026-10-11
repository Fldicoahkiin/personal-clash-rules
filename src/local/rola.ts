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
  const account = text(input.account, "Rola base account", 64);
  if (!/^[a-z0-9][a-z0-9._-]*$/iu.test(account) || /-(country|state|city|sessiontime|f)-|_(dc|mobile)(_|$)/iu.test(account)) {
    throw new Error("Use the base dynamic-residential account, without session or country parameters");
  }
  const country = text(input.country, "Rola country", 2).toLowerCase();
  if (!/^[a-z]{2}$/u.test(country)) throw new Error("Use a two-letter Rola country code");
  const sessionId = text(input.sessionId, "Rola sessionId", 32);
  if (!/^[a-z0-9]+$/iu.test(sessionId)) throw new Error("Use an alphanumeric Rola sessionId (1–32 characters)");
  if (!Number.isInteger(input.sessionMinutes) || Number(input.sessionMinutes) < 1 || Number(input.sessionMinutes) > 120) {
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
    protocol: input.protocol,
    server,
    port: Number(input.port),
    password: text(input.password, "Rola password"),
    username: `${account}_${sessionId}-country-${country}-sessiontime-${input.sessionMinutes}`,
    upstreamNode: text(input.upstreamNode, "upstream node"),
    rules,
    dns: input.dns as string[],
    country,
    sessionMinutes: Number(input.sessionMinutes),
  };
}

function encryptedUpstream(node: Record<string, unknown>): boolean {
  if (node["skip-cert-verify"] === true || node["dialer-proxy"]) return false;
  if (["vless", "http", "socks5"].includes(String(node.type))) return node.tls === true;
  if (["ss", "vmess"].includes(String(node.type))) return typeof node.cipher === "string" && !["none", "zero", "dummy", ""].includes(node.cipher);
  return ["trojan", "hysteria2", "tuic", "anytls", "snell", "wireguard", "ssh"].includes(String(node.type));
}

function protectedHost(host: string, rules: string[]) {
  return rules.some(rule => {
    const [kind, target] = rule.split(",");
    return host === target || (kind === "DOMAIN-SUFFIX" && host.endsWith(`.${target}`));
  });
}

export function prepareRolaProfile(source: string, value: unknown) {
  const settings = parseRolaSettings(value);
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
  const bootstrapNode = dns.get("proxy-server-nameserver", true);
  const bootstrap = isSeq(bootstrapNode) ? bootstrapNode.toJSON() : undefined;
  if (!Array.isArray(bootstrap) || !bootstrap.length || !bootstrap.every(item => item === "system" || ipDoh(item) || (typeof item === "string" && Boolean(isIP(item))))) {
    throw new Error("Base DNS needs independent proxy-server-nameserver entries (system, IP or IP-address DoH); repair bootstrap before adding a chain");
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
    group.set("exclude-filter", filter ? `${filter}|^${nodeName}$` : `^${nodeName}$`);
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
    country: `${flag} ${settings.country.toUpperCase()}`,
    sessionMinutes: settings.sessionMinutes,
    protectedRules: settings.rules.length,
    inlineNodes: proxies.items.length,
    chain: "device -> selected airport node -> Rola -> target",
    quota: "Rola and airport quotas are separate, not additive",
    activation: "not activated; client overrides and device DNS still require review",
  };
  return { profile: document.toString({ lineWidth: 0 }), summary };
}
