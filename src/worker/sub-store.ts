import JSON5 from "json5";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { mihomoProxyGroups } from "../config/mihomo-policy";
import { ApiError } from "./api-error";
import { createEgernProfile } from "./egern-profile";
import { createLoonProfile } from "./loon-profile";
import {
  createMihomoProfile,
  type MihomoRulePreset,
} from "./mihomo-profile";
import type { SubscriptionNode } from "./node-transforms";
import { createSingBoxProfile } from "./sing-box-profile";
import { createStashProfile } from "./stash-profile";
import { createSurgeProfile, createSurfboardProfile } from "./surge-profile";
import type { OutputTarget, SubscriptionEnv } from "./types";

// Adapted from realchendahuang/sub-store-cloudflare under AGPL-3.0.
type ProxyNode = SubscriptionNode & { type: string; server?: string; port?: number };
type SingBoxOutbound = Record<string, unknown> & { type: string; tag: string };

const TEST_URL = "https://www.gstatic.com/generate_204";
const maximumRemoteBytes = 1024 * 1024;
const maximumRemoteSources = 10;
const maximumRedirects = 3;
const redirectStatuses = new Set([301, 302, 303, 307, 308]);

function stringSetting(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}
function numberSetting(value: unknown, fallback: number, min: number, max: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(Math.trunc(number), min), max);
}

function decodeMaybeBase64(raw: string) {
  const text = raw.trim();
  if (looksLikeStructuredSubscription(text)) return raw;

  try {
    const decoded = atob(text.replace(/\s+/g, ""));
    if (looksLikeStructuredSubscription(decoded.trim())) return decoded;
  } catch {
    // Non-base64 subscriptions are parsed as-is.
  }
  return raw;
}

function looksLikeStructuredSubscription(text: string) {
  return (
    /^[a-z][a-z0-9+.-]*:\/\//im.test(text)
    || /^\s*(proxies|proxy-groups|rules)\s*:/m.test(text)
    || /^\s*[\[{]/.test(text)
    || /^\s*(shadowsocks|vmess|vless|trojan|http|socks5|anytls)\s*=/im.test(text)
    || /^\s*[^=\n]{1,80}\s*=\s*(ss|shadowsocks|ssr|vmess|vless|trojan|http|https|socks5|socks5-tls|hysteria2|hysteria|anytls|tuic|tuic-v5)\s*,/im.test(text)
  );
}

function parseProxies(raw: string): ProxyNode[] {
  const text = raw.trim();
  if (!text) return [];
  if (/^\s*[\[{]/.test(text)) return parseJsonProxies(text);
  if (/^\s*proxies\s*:/m.test(text)) return parseYamlProxies(text);
  return parseProxyLines(text);
}

function addPreviewIds(proxies: ProxyNode[]) {
  return proxies.map((proxy, index) => ({
    id: stableProxyId(proxy, index),
    ...proxy,
  }));
}

function stableProxyId(proxy: ProxyNode, index: number) {
  return [proxy.name, proxy.type, proxy.server || "", proxy.port || "", index].join("|");
}

function parseJsonProxies(raw: string) {
  try {
    const payload = JSON5.parse(raw);
    const proxies = Array.isArray(payload) ? payload : Array.isArray(payload.proxies) ? payload.proxies : [];
    return proxies.map(normalizeProxy).filter(isProxyNode);
  } catch {
    return [];
  }
}

function parseYamlProxies(raw: string) {
  try {
    const payload = parseYaml(raw) as { proxies?: unknown };
    const proxies = Array.isArray(payload?.proxies) ? payload.proxies : [];
    return proxies.map(normalizeProxy).filter(isProxyNode);
  } catch {
    return [];
  }
}

function parseProxyLines(raw: string) {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith(";") && !/^\[[^\]]+\]$/.test(line))
    .map((line, index) => parseProxyUri(line, index) || parseClientProxyLine(line, index))
    .filter(isProxyNode);
}

function parseClientProxyLine(line: string, index: number): ProxyNode | undefined {
  try {
    if (/^\s*(shadowsocks|vmess|vless|trojan|http|socks5|anytls)\s*=/i.test(line)) return parseQxProxyLine(line, index);
    if (/^\s*[^=\n]{1,120}\s*=/.test(line)) return parseNamedClientProxyLine(line, index);
    return undefined;
  } catch {
    return undefined;
  }
}

function parseQxProxyLine(line: string, index: number): ProxyNode | undefined {
  const equalIndex = line.indexOf("=");
  if (equalIndex <= 0) return undefined;
  const kind = line.slice(0, equalIndex).trim().toLowerCase();
  const parts = splitClientCsv(line.slice(equalIndex + 1));
  const [server, rawPort] = splitHostPort(parts[0]);
  const options = parseClientOptions(parts.slice(1));
  const name = clientOption(options, "tag") || `${kind}-${index + 1}`;
  const port = Number(rawPort || clientOption(options, "port") || (kind === "http" || kind === "socks5" ? 80 : 443));
  const tls = qxTlsEnabled(options);
  const common = clientCommonOptions(options);

  if (kind === "shadowsocks") {
    return stripUndefined({
      name,
      type: "ss",
      server,
      port,
      cipher: clientOption(options, "method"),
      password: clientOption(options, "password"),
      plugin: qxPlugin(options),
      "plugin-opts": qxPluginOptions(options),
      udp: optionBoolean(clientOption(options, "udp-relay")),
      tfo: optionBoolean(clientOption(options, "fast-open")),
      ...common,
    });
  }

  if (kind === "vmess" || kind === "vless") {
    return stripUndefined({
      name,
      type: kind,
      server,
      port,
      uuid: clientOption(options, "password") || clientOption(options, "uuid") || clientOption(options, "username"),
      cipher: kind === "vmess" ? clientOption(options, "method") || "auto" : undefined,
      alterId: numberOrUndefined(clientOption(options, "alterId") || clientOption(options, "alterid")),
      encryption: kind === "vless" ? clientOption(options, "encryption") || "none" : undefined,
      network: qxNetwork(options),
      tls,
      servername: clientOption(options, "tls-host") || clientOption(options, "obfs-host"),
      "ws-opts": qxWsOptions(options),
      "reality-opts": parseRealityOptions(options),
      flow: clientOption(options, "flow"),
      udp: optionBoolean(clientOption(options, "udp-relay")),
      tfo: optionBoolean(clientOption(options, "fast-open")),
      ...common,
    });
  }

  if (kind === "trojan" || kind === "anytls") {
    return stripUndefined({
      name,
      type: kind,
      server,
      port,
      password: clientOption(options, "password"),
      sni: clientOption(options, "tls-host") || clientOption(options, "sni") || clientOption(options, "obfs-host"),
      "reality-opts": parseRealityOptions(options),
      udp: optionBoolean(clientOption(options, "udp-relay")),
      tfo: optionBoolean(clientOption(options, "fast-open")),
      ...common,
    });
  }

  if (kind === "http" || kind === "socks5") {
    return stripUndefined({
      name,
      type: kind === "socks5" ? "socks5" : "http",
      server,
      port,
      username: clientOption(options, "username"),
      password: clientOption(options, "password"),
      tls,
      udp: optionBoolean(clientOption(options, "udp-relay")),
      tfo: optionBoolean(clientOption(options, "fast-open")),
      ...common,
    });
  }

  return undefined;
}

function parseNamedClientProxyLine(line: string, index: number): ProxyNode | undefined {
  const equalIndex = line.indexOf("=");
  const name = line.slice(0, equalIndex).trim() || `proxy-${index + 1}`;
  const parts = splitClientCsv(line.slice(equalIndex + 1));
  const rawKind = String(parts[0] || "").trim().toLowerCase();
  const kind = normalizeClientProxyKind(parts[0]);
  const server = parts[1];
  const port = Number(parts[2] || 0);
  const positional = parts.slice(3);
  const positionalValues = positional.filter((part) => !part.includes("="));
  const options = parseClientOptions(positional);
  const common = clientCommonOptions(options);

  if (!kind || !server || !Number.isFinite(port)) return undefined;

  if (kind === "ss") {
    return stripUndefined({
      name,
      type: "ss",
      server,
      port,
      cipher: clientOption(options, "encrypt-method") || clientOption(options, "method") || positionalValues[0],
      password: clientOption(options, "password") || positionalValues[1],
      plugin: clientOption(options, "obfs") || clientOption(options, "obfs-name") ? "obfs" : undefined,
      "plugin-opts": clientOption(options, "obfs") || clientOption(options, "obfs-name") ? stripUndefined({
        mode: clientOption(options, "obfs") || clientOption(options, "obfs-name"),
        host: clientOption(options, "obfs-host"),
        path: clientOption(options, "obfs-uri"),
      }) : undefined,
      udp: optionBoolean(clientOption(options, "udp") || clientOption(options, "udp-relay")),
      tfo: optionBoolean(clientOption(options, "fast-open")),
      ...common,
    });
  }

  if (kind === "ssr") {
    return stripUndefined({
      name,
      type: "ssr",
      server,
      port,
      cipher: positionalValues[0] || clientOption(options, "encrypt-method") || clientOption(options, "method"),
      password: positionalValues[1] || clientOption(options, "password"),
      protocol: clientOption(options, "protocol") || "origin",
      obfs: clientOption(options, "obfs") || "plain",
      "protocol-param": clientOption(options, "protocol-param") || clientOption(options, "protoparam"),
      "obfs-param": clientOption(options, "obfs-param") || clientOption(options, "obfsparam"),
      udp: optionBoolean(clientOption(options, "udp") || clientOption(options, "udp-relay")),
      ...common,
    });
  }

  if (kind === "vmess" || kind === "vless") {
    const tls = optionBoolean(clientOption(options, "tls") || clientOption(options, "over-tls")) ?? false;
    return stripUndefined({
      name,
      type: kind,
      server,
      port,
      uuid: clientOption(options, "username") || clientOption(options, "password") || positionalValues[1] || positionalValues[0],
      cipher: kind === "vmess" ? positionalValues[0] || clientOption(options, "encrypt-method") || clientOption(options, "method") || "auto" : undefined,
      alterId: numberOrUndefined(clientOption(options, "alterId") || clientOption(options, "alterid")),
      encryption: kind === "vless" ? clientOption(options, "encryption") || "none" : undefined,
      network: namedClientNetwork(options),
      tls,
      servername: clientOption(options, "sni") || clientOption(options, "tls-name") || clientOption(options, "tls-host"),
      "ws-opts": namedClientWsOptions(options),
      "reality-opts": parseRealityOptions(options),
      flow: clientOption(options, "flow"),
      udp: optionBoolean(clientOption(options, "udp") || clientOption(options, "udp-relay")),
      tfo: optionBoolean(clientOption(options, "fast-open")),
      ...common,
    });
  }

  if (kind === "trojan" || kind === "anytls") {
    return stripUndefined({
      name,
      type: kind,
      server,
      port,
      password: clientOption(options, "password") || positionalValues[0],
      sni: clientOption(options, "sni") || clientOption(options, "tls-name") || clientOption(options, "tls-host"),
      "reality-opts": parseRealityOptions(options),
      udp: optionBoolean(clientOption(options, "udp") || clientOption(options, "udp-relay")),
      tfo: optionBoolean(clientOption(options, "fast-open")),
      ...common,
    });
  }

  if (kind === "http" || kind === "socks5") {
    return stripUndefined({
      name,
      type: kind === "socks5" ? "socks5" : "http",
      server,
      port,
      username: clientOption(options, "username"),
      password: clientOption(options, "password"),
      tls: rawKind === "https" || rawKind === "socks5-tls" || optionBoolean(clientOption(options, "tls") || clientOption(options, "over-tls")),
      udp: optionBoolean(clientOption(options, "udp") || clientOption(options, "udp-relay")),
      tfo: optionBoolean(clientOption(options, "fast-open")),
      ...common,
    });
  }

  if (kind === "hysteria2") {
    return stripUndefined({
      ...common,
      name,
      type: "hysteria2",
      server,
      port,
      password: clientOption(options, "password") || positionalValues[0],
      sni: clientOption(options, "sni") || clientOption(options, "tls-name"),
      obfs: clientOption(options, "obfs"),
      "obfs-password": clientOption(options, "obfs-password") || clientOption(options, "gecko-password"),
      "skip-cert-verify": optionBoolean(clientOption(options, "skip-cert-verify")) ?? common["skip-cert-verify"],
    });
  }

  if (kind === "tuic") {
    return stripUndefined({
      ...common,
      name,
      type: "tuic",
      server,
      port,
      uuid: clientOption(options, "uuid") || positionalValues[0],
      password: clientOption(options, "password") || positionalValues[1],
      sni: clientOption(options, "sni"),
      alpn: commaList(clientOption(options, "alpn") || null),
      "skip-cert-verify": optionBoolean(clientOption(options, "skip-cert-verify")) ?? common["skip-cert-verify"],
    });
  }

  if (kind === "snell") {
    return stripUndefined({
      ...common,
      name,
      type: "snell",
      server,
      port,
      psk: clientOption(options, "psk") || clientOption(options, "password") || positionalValues[0],
      version: numberOrUndefined(clientOption(options, "version")) || 3,
      obfs: clientOption(options, "obfs"),
      "obfs-host": clientOption(options, "obfs-host"),
    });
  }

  if (kind === "ssh") {
    return stripUndefined({
      ...common,
      name,
      type: "ssh",
      server,
      port,
      username: clientOption(options, "username") || positionalValues[0],
      password: clientOption(options, "password") || positionalValues[1],
      "private-key": clientOption(options, "private-key"),
      "host-key": clientOption(options, "host-key"),
    });
  }

  if (kind === "h2-connect") {
    return stripUndefined({
      ...common,
      name,
      type: "h2-connect",
      server,
      port,
      username: clientOption(options, "username"),
      password: clientOption(options, "password"),
      tls: optionBoolean(clientOption(options, "tls")) ?? true,
      sni: clientOption(options, "sni") || clientOption(options, "tls-name"),
    });
  }

  return undefined;
}

function normalizeClientProxyKind(input: string | undefined) {
  const value = String(input || "").trim().toLowerCase();
  if (value === "shadowsocks") return "ss";
  if (value === "socks5-tls") return "socks5";
  if (value === "https") return "http";
  if (value === "hysteria2" || value === "hysteria 2") return "hysteria2";
  if (value === "tuic-v5") return "tuic";
  if (["ss", "ssr", "vmess", "vless", "trojan", "http", "socks5", "hysteria2", "tuic", "anytls", "snell", "ssh", "h2-connect"].includes(value)) return value;
  return "";
}

function splitHostPort(input: string | undefined): [string, string] {
  const value = String(input || "").trim();
  const lastColon = value.lastIndexOf(":");
  if (lastColon <= 0) return [value, ""];
  return [value.slice(0, lastColon), value.slice(lastColon + 1)];
}

function splitClientCsv(input: string) {
  const parts: string[] = [];
  let current = "";
  let quote = "";
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quote) {
      if (char === quote) quote = "";
      else current += char;
    } else if (char === "\"" || char === "'") {
      quote = char;
    } else if (char === ",") {
      parts.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  parts.push(current.trim());
  return parts.filter((part) => part !== "");
}

function parseClientOptions(parts: string[]) {
  const options = new Map<string, string>();
  for (const part of parts) {
    const equalIndex = part.indexOf("=");
    if (equalIndex <= 0) continue;
    options.set(part.slice(0, equalIndex).trim().toLowerCase(), unquoteClientValue(part.slice(equalIndex + 1).trim()));
  }
  return options;
}

function unquoteClientValue(input: string) {
  const text = input.trim();
  const quote = text[0];
  if ((quote === "\"" || quote === "'") && text[text.length - 1] === quote) return text.slice(1, -1);
  return text;
}

function clientOption(options: Map<string, string>, key: string) {
  return options.get(key.toLowerCase());
}

function clientCommonOptions(options: Map<string, string>) {
  return stripUndefined({
    "skip-cert-verify": optionBoolean(clientOption(options, "skip-cert-verify")) ?? optionBoolean(clientOption(options, "tls-verification"), true),
    "client-fingerprint": clientOption(options, "client-fingerprint") || clientOption(options, "fingerprint"),
  });
}

function optionBoolean(value: unknown, inverted = false): boolean | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const normalized = String(value).trim().toLowerCase();
  const result = ["1", "true", "yes", "on", "enabled"].includes(normalized)
    ? true
    : ["0", "false", "no", "off", "disabled"].includes(normalized)
      ? false
      : undefined;
  return result === undefined ? undefined : inverted ? !result : result;
}

function qxTlsEnabled(options: Map<string, string>) {
  const obfs = clientOption(options, "obfs");
  return ["tls", "wss", "over-tls"].includes(String(obfs || "").toLowerCase())
    || optionBoolean(clientOption(options, "over-tls")) === true
    || optionBoolean(clientOption(options, "tls")) === true;
}

function qxNetwork(options: Map<string, string>) {
  const obfs = String(clientOption(options, "obfs") || "").toLowerCase();
  if (obfs === "ws" || obfs === "wss") return "ws";
  return "tcp";
}

function qxWsOptions(options: Map<string, string>) {
  const network = qxNetwork(options);
  if (network !== "ws") return undefined;
  return stripUndefined({
    path: clientOption(options, "obfs-uri") || "/",
    headers: stripUndefined({ Host: clientOption(options, "obfs-host") }),
  });
}

function qxPlugin(options: Map<string, string>) {
  const obfs = String(clientOption(options, "obfs") || "").toLowerCase();
  return ["http", "shadowsocks-http"].includes(obfs) ? "obfs" : undefined;
}

function qxPluginOptions(options: Map<string, string>) {
  if (!qxPlugin(options)) return undefined;
  return stripUndefined({
    mode: "http",
    host: clientOption(options, "obfs-host"),
    path: clientOption(options, "obfs-uri"),
  });
}

function namedClientNetwork(options: Map<string, string>) {
  if (optionBoolean(clientOption(options, "ws")) === true) return "ws";
  const transport = clientOption(options, "transport") || clientOption(options, "network");
  if (transport) return transport;
  return "tcp";
}

function namedClientWsOptions(options: Map<string, string>) {
  if (namedClientNetwork(options) !== "ws") return undefined;
  return stripUndefined({
    path: clientOption(options, "ws-path") || clientOption(options, "path") || "/",
    headers: stripUndefined({ Host: clientOption(options, "ws-headers")?.replace(/^Host:/i, "") || clientOption(options, "ws-host") || clientOption(options, "host") }),
  });
}

function parseRealityOptions(options: Map<string, string>) {
  const publicKey = clientOption(options, "reality-base64-pubkey") || clientOption(options, "public-key");
  const shortId = clientOption(options, "reality-hex-shortid") || clientOption(options, "short-id");
  return publicKey ? stripUndefined({ "public-key": publicKey, "short-id": shortId }) : undefined;
}

function parseProxyUri(line: string, index: number): ProxyNode | undefined {
  try {
    if (line.startsWith("vless://")) return parseVless(line, index);
    if (line.startsWith("anytls://")) return parseAnytls(line, index);
    if (line.startsWith("hysteria://") || line.startsWith("hy://")) return parseHysteria(line, index);
    if (line.startsWith("hysteria2://") || line.startsWith("hy2://")) return parseHysteria2(line, index);
    if (line.startsWith("trojan://")) return parseTrojan(line, index);
    if (line.startsWith("vmess://")) return parseVmess(line, index);
    if (line.startsWith("ss://")) return parseShadowsocks(line, index);
    if (line.startsWith("ssr://")) return parseShadowsocksR(line, index);
    if (line.startsWith("socks://") || line.startsWith("socks5://") || line.startsWith("socks5+tls://")) return parseSocks(line, index);
    if (line.startsWith("tuic://")) return parseTuic(line, index);
    if (line.startsWith("wireguard://") || line.startsWith("wg://")) return parseWireGuard(line, index);
    if (line.startsWith("http://") || line.startsWith("https://")) return parseHttpProxy(line, index);
    return undefined;
  } catch {
    return undefined;
  }
}

function parseVless(line: string, index: number): ProxyNode {
  const url = new URL(line);
  const params = url.searchParams;
  const publicKey = params.get("pbk") || params.get("public-key");
  const shortId = params.get("sid") || params.get("short-id");
  const security = params.get("security") || (publicKey ? "reality" : "tls");

  return stripUndefined({
    name: decodeURIComponent(url.hash.slice(1) || `vless-${index + 1}`),
    type: "vless",
    server: url.hostname,
    port: Number(url.port || 443),
    uuid: decodeURIComponent(url.username),
    udp: true,
    flow: params.get("flow") || undefined,
    network: params.get("type") || "tcp",
    tls: security !== "none",
    servername: params.get("sni") || undefined,
    encryption: params.get("encryption") || "none",
    "client-fingerprint": params.get("fp") || "chrome",
    "reality-opts": publicKey ? stripUndefined({ "public-key": publicKey, "short-id": shortId, "spider-x": params.get("spx") || "/" }) : undefined,
  });
}

function parseAnytls(line: string, index: number): ProxyNode {
  const url = new URL(line);
  const params = url.searchParams;
  return stripUndefined({
    name: decodeURIComponent(url.hash.slice(1) || `anytls-${index + 1}`),
    type: "anytls",
    server: url.hostname,
    port: Number(url.port || 443),
    password: decodeURIComponent(url.username),
    sni: params.get("sni") || params.get("peer") || undefined,
    "skip-cert-verify": boolParam(params.get("insecure") || params.get("allowInsecure")),
    "client-fingerprint": params.get("fp") || "chrome",
  });
}

function parseHysteria2(line: string, index: number): ProxyNode {
  const url = new URL(line.replace(/^hy2:\/\//, "hysteria2://"));
  const params = url.searchParams;
  return stripUndefined({
    name: decodeURIComponent(url.hash.slice(1) || `hysteria2-${index + 1}`),
    type: "hysteria2",
    server: url.hostname,
    port: Number(url.port || 443),
    password: decodeURIComponent(url.username),
    sni: params.get("sni") || params.get("peer") || undefined,
    "skip-cert-verify": boolParam(params.get("insecure") || params.get("allowInsecure")),
    obfs: params.get("obfs") || undefined,
    "obfs-password": params.get("obfs-password") || params.get("salamander-password") || undefined,
  });
}

function parseHysteria(line: string, index: number): ProxyNode {
  const url = new URL(line.replace(/^hy:\/\//, "hysteria://"));
  const params = url.searchParams;
  return stripUndefined({
    name: decodeURIComponent(url.hash.slice(1) || `hysteria-${index + 1}`),
    type: "hysteria",
    server: url.hostname,
    port: Number(url.port || 443),
    auth_str: decodeURIComponent(url.username || params.get("auth") || params.get("auth_str") || ""),
    protocol: params.get("protocol") || undefined,
    up: params.get("up") || params.get("upmbps") || undefined,
    down: params.get("down") || params.get("downmbps") || undefined,
    sni: params.get("sni") || params.get("peer") || undefined,
    alpn: commaList(params.get("alpn")),
    obfs: params.get("obfs") || undefined,
    "obfs-password": params.get("obfs-password") || undefined,
    "skip-cert-verify": boolParam(params.get("insecure") || params.get("allowInsecure")),
  });
}

function parseTrojan(line: string, index: number): ProxyNode {
  const url = new URL(line);
  return stripUndefined({
    name: decodeURIComponent(url.hash.slice(1) || `trojan-${index + 1}`),
    type: "trojan",
    server: url.hostname,
    port: Number(url.port || 443),
    password: decodeURIComponent(url.username),
    sni: url.searchParams.get("sni") || url.searchParams.get("peer") || undefined,
    "skip-cert-verify": boolParam(url.searchParams.get("allowInsecure")),
    udp: true,
  });
}

function parseVmess(line: string, index: number): ProxyNode | undefined {
  try {
    const payload = JSON.parse(atob(line.slice("vmess://".length)));
    return stripUndefined({
      name: payload.ps || `vmess-${index + 1}`,
      type: "vmess",
      server: payload.add,
      port: Number(payload.port),
      uuid: payload.id,
      alterId: Number(payload.aid || 0),
      cipher: payload.scy || "auto",
      tls: payload.tls === "tls",
      servername: payload.sni || payload.host || undefined,
      network: payload.net || "tcp",
      "ws-opts": payload.net === "ws" ? { path: payload.path || "/", headers: { Host: payload.host } } : undefined,
      udp: true,
    });
  } catch {
    return undefined;
  }
}

function parseShadowsocks(line: string, index: number): ProxyNode | undefined {
  try {
    const withoutScheme = line.slice("ss://".length);
    const [main, hash = ""] = withoutScheme.split("#");
    const decodedMain = main.includes("@") ? main : atob(main);
    const [userInfo, hostInfo] = decodedMain.split("@");
    const decodedUserInfo = userInfo.includes(":") ? userInfo : decodeBase64UrlText(userInfo);
    const [cipher, password] = decodedUserInfo.split(":");
    const lastColon = hostInfo.lastIndexOf(":");
    return stripUndefined({
      name: decodeURIComponent(hash || `ss-${index + 1}`),
      type: "ss",
      server: hostInfo.slice(0, lastColon),
      port: Number(hostInfo.slice(lastColon + 1).split("?")[0]),
      cipher,
      password,
      udp: true,
    });
  } catch {
    return undefined;
  }
}

function parseShadowsocksR(line: string, index: number): ProxyNode | undefined {
  try {
    const decoded = decodeBase64UrlText(line.slice("ssr://".length));
    const [main, rawQuery = ""] = decoded.split("/?");
    const [server, port, protocol, method, obfs, encodedPassword] = main.split(":");
    const query = new URLSearchParams(rawQuery);
    const remarks = query.get("remarks");
    return stripUndefined({
      name: remarks ? decodeBase64UrlText(remarks) : `ssr-${index + 1}`,
      type: "ssr",
      server,
      port: Number(port),
      cipher: method,
      password: decodeBase64UrlText(encodedPassword || ""),
      protocol,
      "protocol-param": query.get("protoparam") ? decodeBase64UrlText(query.get("protoparam") || "") : undefined,
      obfs,
      "obfs-param": query.get("obfsparam") ? decodeBase64UrlText(query.get("obfsparam") || "") : undefined,
      udp: true,
    });
  } catch {
    return undefined;
  }
}

function parseSocks(line: string, index: number): ProxyNode | undefined {
  const normalizedLine = line.replace(/^socks:\/\//, "socks5://").replace(/^socks5\+tls:\/\//, "socks5://");
  const url = new URL(normalizedLine);
  if (!url.port) return undefined;
  return stripUndefined({
    name: decodeURIComponent(url.hash.slice(1) || `socks5-${index + 1}`),
    type: "socks5",
    server: url.hostname,
    port: Number(url.port),
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    tls: line.startsWith("socks5+tls://") || boolParam(url.searchParams.get("tls")),
    udp: true,
  });
}

function parseHttpProxy(line: string, index: number): ProxyNode | undefined {
  const url = new URL(line);
  if (!url.port) return undefined;
  return stripUndefined({
    name: decodeURIComponent(url.hash.slice(1) || `${url.protocol === "https:" ? "https" : "http"}-${index + 1}`),
    type: "http",
    server: url.hostname,
    port: Number(url.port),
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    tls: url.protocol === "https:",
  });
}

function parseTuic(line: string, index: number): ProxyNode {
  const url = new URL(line);
  const params = url.searchParams;
  return stripUndefined({
    name: decodeURIComponent(url.hash.slice(1) || `tuic-${index + 1}`),
    type: "tuic",
    server: url.hostname,
    port: Number(url.port || 443),
    uuid: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    sni: params.get("sni") || undefined,
    alpn: commaList(params.get("alpn")),
    "skip-cert-verify": boolParam(params.get("allow_insecure") || params.get("insecure")),
    "disable-sni": boolParam(params.get("disable_sni") || params.get("disable-sni")),
    "reduce-rtt": boolParam(params.get("reduce_rtt") || params.get("reduce-rtt")),
    "udp-relay-mode": params.get("udp_relay_mode") || params.get("udp-relay-mode") || undefined,
    "congestion-controller": params.get("congestion_control") || params.get("congestion-controller") || undefined,
  });
}

function parseWireGuard(line: string, index: number): ProxyNode {
  const url = new URL(line.replace(/^wg:\/\//, "wireguard://"));
  const params = url.searchParams;
  return stripUndefined({
    name: decodeURIComponent(url.hash.slice(1) || `wireguard-${index + 1}`),
    type: "wireguard",
    server: url.hostname,
    port: Number(url.port || 51820),
    ip: params.get("ip") || params.get("address") || undefined,
    ipv6: params.get("ipv6") || undefined,
    "private-key": decodeURIComponent(url.username || params.get("private-key") || params.get("privatekey") || ""),
    "public-key": params.get("public-key") || params.get("publickey") || params.get("peer-public-key") || undefined,
    "pre-shared-key": params.get("pre-shared-key") || params.get("presharedkey") || params.get("psk") || undefined,
    reserved: params.get("reserved") || undefined,
    udp: true,
  });
}
function ensureUniqueProxyNames(proxies: ProxyNode[]) {
  const seen = new Map<string, number>();
  return proxies.map((proxy) => {
    const count = seen.get(proxy.name) || 0;
    seen.set(proxy.name, count + 1);
    return count === 0 ? proxy : { ...proxy, name: `${proxy.name}-${count + 1}` };
  });
}
function renderSurgeProxies(proxies: ProxyNode[]) {
  return renderTextProxyList(proxies, "surge", toSurgeProxyLine);
}

function renderSurgeMacProxies(proxies: ProxyNode[]) {
  return renderTextProxyList(proxies, "surge-mac", toSurgeMacProxyLine);
}

function renderSurfboardProxies(proxies: ProxyNode[]) {
  return renderTextProxyList(proxies, "surfboard", toSurfboardProxyLine);
}

function renderLoonProxies(proxies: ProxyNode[]) {
  return renderTextProxyList(proxies, "loon", toLoonProxyLine);
}

function renderQxProxies(proxies: ProxyNode[]) {
  return renderTextProxyList(proxies, "qx", toQxProxyLine);
}

function renderTextProxyList(proxies: ProxyNode[], target: string, producer: (proxy: ProxyNode) => string | undefined) {
  const lines = proxies.map(producer).filter((line): line is string => Boolean(line));
  if (lines.length === 0) throw new Error(`No supported nodes for ${target} output`);
  return lines.join("\n");
}

function renderEgernYaml(proxies: ProxyNode[]) {
  const list = proxies.map(toEgernProxy).filter((proxy) => Boolean(proxy));
  if (list.length === 0) throw new Error("No supported nodes for egern output");
  return stringifyYaml({ proxies: list });
}

function toSurgeProxyLine(proxy: ProxyNode) {
  const name = sanitizeTextProxyName(proxy.name);
  const base = `${name}=${surgeType(proxy)},${proxy.server},${proxy.port}`;
  const entries = commonTextOptions(proxy);

  if (proxy.type === "ss") {
    entries.unshift(["encrypt-method", proxy.cipher || "none"], ["password", proxy.password]);
    appendPluginOptions(entries, proxy, "surge");
    return joinTextProxy(base, entries);
  }
  if (proxy.type === "vmess") {
    entries.unshift(["username", proxy.uuid], ["encrypt-method", proxy.cipher || "auto"], ["tls", proxy.tls], ["sni", proxy.servername]);
    appendWsOptions(entries, proxy, "surge");
    return joinTextProxy(base, entries);
  }
  if (proxy.type === "trojan") {
    entries.unshift(["password", proxy.password], ["sni", proxy.sni || proxy.servername]);
    return joinTextProxy(base, entries);
  }
  if (proxy.type === "http" || proxy.type === "socks5") {
    entries.unshift(["username", proxy.username], ["password", proxy.password], ["tls", proxy.tls], ["sni", proxy.sni || proxy.servername]);
    return joinTextProxy(base, entries);
  }
  if (proxy.type === "hysteria2") {
    entries.unshift(["password", proxy.password], ["sni", proxy.sni]);
    if (proxy.obfs) entries.push(["obfs", proxy.obfs], ["obfs-password", proxy["obfs-password"]]);
    return joinTextProxy(base, entries);
  }
  if (proxy.type === "tuic") {
    entries.unshift(["uuid", proxy.uuid], ["password", proxy.password], ["sni", proxy.sni]);
    return joinTextProxy(`${name}=tuic-v5,${proxy.server},${proxy.port}`, entries);
  }
  if (proxy.type === "anytls") {
    entries.unshift(["password", proxy.password], ["sni", proxy.sni || proxy.servername]);
    return joinTextProxy(base, entries);
  }
  if (proxy.type === "snell") {
    entries.unshift(["psk", proxy.psk || proxy.password], ["version", proxy.version || 3]);
    return joinTextProxy(`${name}=snell,${proxy.server},${proxy.port}`, entries);
  }
  return undefined;
}

function toSurgeMacProxyLine(proxy: ProxyNode) {
  if (proxy.type === "ssh") {
    const entries = commonTextOptions(proxy);
    entries.unshift(["username", proxy.username], ["password", proxy.password], ["private-key", proxy["private-key"]]);
    return joinTextProxy(`${sanitizeTextProxyName(proxy.name)}=ssh,${proxy.server},${proxy.port}`, entries);
  }
  if (proxy.type === "snell") {
    const entries = commonTextOptions(proxy);
    entries.unshift(["psk", proxy.psk || proxy.password], ["version", proxy.version || 3]);
    return joinTextProxy(`${sanitizeTextProxyName(proxy.name)}=snell,${proxy.server},${proxy.port}`, entries);
  }
  if (proxy.type === "h2-connect") {
    const entries = commonTextOptions(proxy);
    entries.unshift(["username", proxy.username], ["password", proxy.password], ["tls", proxy.tls], ["sni", proxy.sni || proxy.servername]);
    return joinTextProxy(`${sanitizeTextProxyName(proxy.name)}=h2-connect,${proxy.server},${proxy.port}`, entries);
  }
  return toSurgeProxyLine(proxy);
}

function toSurfboardProxyLine(proxy: ProxyNode) {
  return ["ss", "vmess", "trojan", "http", "socks5"].includes(proxy.type)
    ? toSurgeProxyLine(proxy)
    : undefined;
}

function surgeType(proxy: ProxyNode) {
  if (proxy.type === "socks5") return proxy.tls ? "socks5-tls" : "socks5";
  if (proxy.type === "http") return proxy.tls ? "https" : "http";
  return proxy.type;
}

function toLoonProxyLine(proxy: ProxyNode) {
  const name = sanitizeTextProxyName(proxy.name);
  const entries = commonTextOptions(proxy);

  if (proxy.type === "ss") {
    appendPluginOptions(entries, proxy, "loon");
    return joinTextProxy(`${name}=shadowsocks,${proxy.server},${proxy.port},${proxy.cipher || "none"},${quoteTextValue(proxy.password)}`, entries);
  }
  if (proxy.type === "ssr") {
    return joinTextProxy(
      `${name}=shadowsocksr,${proxy.server},${proxy.port},${proxy.cipher || "aes-256-cfb"},${quoteTextValue(proxy.password)},${proxy.protocol || "origin"},${proxy.obfs || "plain"}`,
      entries,
    );
  }
  if (proxy.type === "vmess" || proxy.type === "vless") {
    entries.unshift(["transport", proxy.network || "tcp"], ["over-tls", proxy.tls], ["sni", proxy.servername], ["flow", proxy.flow]);
    appendWsOptions(entries, proxy, "loon");
    appendRealityOptions(entries, proxy);
    const method = proxy.type === "vmess" ? proxy.cipher || "auto" : "none";
    return joinTextProxy(`${name}=${proxy.type},${proxy.server},${proxy.port},${method},${quoteTextValue(proxy.uuid)}`, entries);
  }
  if (proxy.type === "trojan" || proxy.type === "anytls") {
    entries.unshift(["sni", proxy.sni || proxy.servername]);
    appendRealityOptions(entries, proxy);
    return joinTextProxy(`${name}=${proxy.type},${proxy.server},${proxy.port},${quoteTextValue(proxy.password)}`, entries);
  }
  if (proxy.type === "http" || proxy.type === "socks5") {
    entries.unshift(["username", proxy.username], ["password", proxy.password], ["over-tls", proxy.tls], ["sni", proxy.sni || proxy.servername]);
    return joinTextProxy(`${name}=${proxy.type === "socks5" ? "socks5" : "http"},${proxy.server},${proxy.port}`, entries);
  }
  if (proxy.type === "hysteria2") {
    entries.unshift(["tls-name", proxy.sni], ["obfs", proxy.obfs], ["obfs-password", proxy["obfs-password"]]);
    return joinTextProxy(`${name}=Hysteria2,${proxy.server},${proxy.port},${quoteTextValue(proxy.password)}`, entries);
  }
  return undefined;
}

function toQxProxyLine(proxy: ProxyNode) {
  const entries = commonTextOptions(proxy);
  entries.push(["tag", sanitizeQxTag(proxy.name)]);

  if (proxy.type === "ss") {
    entries.unshift(["method", proxy.cipher || "none"], ["password", proxy.password]);
    appendQxObfs(entries, proxy);
    return joinTextProxy(`shadowsocks=${proxy.server}:${proxy.port}`, entries);
  }
  if (proxy.type === "ssr") {
    entries.unshift(["method", proxy.cipher || "aes-256-cfb"], ["password", proxy.password], ["ssr-protocol", proxy.protocol || "origin"], ["obfs", proxy.obfs || "plain"]);
    return joinTextProxy(`shadowsocks=${proxy.server}:${proxy.port}`, entries);
  }
  if (proxy.type === "vmess" || proxy.type === "vless") {
    entries.unshift(["method", proxy.type === "vmess" ? proxy.cipher || "auto" : "none"], ["password", proxy.uuid], ["over-tls", proxy.tls], ["tls-host", proxy.servername], ["flow", proxy.flow]);
    appendQxTransport(entries, proxy);
    appendQxRealityOptions(entries, proxy);
    return joinTextProxy(`${proxy.type}=${proxy.server}:${proxy.port}`, entries);
  }
  if (proxy.type === "trojan" || proxy.type === "anytls") {
    entries.unshift(["password", proxy.password], ["over-tls", true], ["tls-host", proxy.sni || proxy.servername]);
    appendQxRealityOptions(entries, proxy);
    return joinTextProxy(`${proxy.type}=${proxy.server}:${proxy.port}`, entries);
  }
  if (proxy.type === "http" || proxy.type === "socks5") {
    entries.unshift(["username", proxy.username], ["password", proxy.password], ["over-tls", proxy.tls]);
    return joinTextProxy(`${proxy.type === "socks5" ? "socks5" : "http"}=${proxy.server}:${proxy.port}`, entries);
  }
  return undefined;
}

function toEgernProxy(proxy: ProxyNode) {
  const common = stripUndefined({
    name: proxy.name,
    server: proxy.server,
    port: proxy.port,
    tfo: proxy.tfo,
    udp_relay: proxy.udp,
  });

  if (proxy.type === "ss") {
    return stripUndefined({ ...common, type: "shadowsocks", method: proxy.cipher, password: proxy.password });
  }
  if (proxy.type === "vmess" || proxy.type === "vless") {
    return stripUndefined({
      ...common,
      type: proxy.type,
      uuid: proxy.uuid,
      alter_id: proxy.alterId,
      security: proxy.type === "vmess" ? proxy.cipher || "auto" : undefined,
      flow: proxy.flow,
      tls: proxy.tls,
      sni: proxy.servername,
      network: proxy.network,
      ws_opts: egernWsOptions(proxy),
      reality: egernRealityOptions(proxy),
    });
  }
  if (proxy.type === "trojan" || proxy.type === "anytls" || proxy.type === "hysteria2") {
    return stripUndefined({
      ...common,
      type: proxy.type,
      password: proxy.password,
      sni: proxy.sni || proxy.servername,
      skip_tls_verify: proxy["skip-cert-verify"],
      obfs: proxy.obfs,
      obfs_password: proxy["obfs-password"],
      reality: egernRealityOptions(proxy),
    });
  }
  if (proxy.type === "http" || proxy.type === "socks5") {
    return stripUndefined({
      ...common,
      type: proxy.type === "http" && proxy.tls ? "https" : proxy.tls ? "socks5_tls" : proxy.type,
      username: proxy.username,
      password: proxy.password,
      skip_tls_verify: proxy["skip-cert-verify"],
    });
  }
  if (proxy.type === "tuic") {
    return stripUndefined({
      ...common,
      type: "tuic",
      uuid: proxy.uuid,
      password: proxy.password,
      sni: proxy.sni,
      skip_tls_verify: proxy["skip-cert-verify"],
    });
  }
  if (proxy.type === "wireguard") {
    return stripUndefined({
      ...common,
      type: "wireguard",
      private_key: proxy["private-key"],
      public_key: proxy["public-key"],
      pre_shared_key: proxy["pre-shared-key"],
      address: proxy.ip,
      ipv6_address: proxy.ipv6,
    });
  }
  return undefined;
}

function egernWsOptions(proxy: ProxyNode) {
  const wsOpts = proxy["ws-opts"] as { path?: unknown; headers?: Record<string, unknown> } | undefined;
  if (proxy.network !== "ws") return undefined;
  return stripUndefined({ path: wsOpts?.path || "/", headers: wsOpts?.headers });
}

function egernRealityOptions(proxy: ProxyNode) {
  const realityOpts = proxy["reality-opts"] as Record<string, unknown> | undefined;
  return realityOpts?.["public-key"] ? stripUndefined({ public_key: realityOpts["public-key"], short_id: realityOpts["short-id"] }) : undefined;
}

function commonTextOptions(proxy: ProxyNode): Array<[string, unknown]> {
  return [
    ["skip-cert-verify", proxy["skip-cert-verify"]],
    ["udp-relay", proxy.udp],
    ["fast-open", proxy.tfo || proxy["fast-open"]],
    ["alpn", formatAlpn(proxy.alpn)],
  ];
}

function appendWsOptions(entries: Array<[string, unknown]>, proxy: ProxyNode, target: "surge" | "loon") {
  const wsOpts = proxy["ws-opts"] as { path?: unknown; headers?: Record<string, unknown> } | undefined;
  if (proxy.network !== "ws") return;
  if (target === "surge") {
    entries.push(["ws", true], ["ws-path", wsOpts?.path || "/"], ["ws-headers", wsHeaderHost(wsOpts)]);
  } else {
    entries.push(["path", wsOpts?.path || "/"], ["host", wsHeaderHost(wsOpts)]);
  }
}

function appendPluginOptions(entries: Array<[string, unknown]>, proxy: ProxyNode, target: "surge" | "loon") {
  const pluginOpts = proxy["plugin-opts"] as Record<string, unknown> | undefined;
  if (proxy.plugin !== "obfs" || !pluginOpts) return;
  if (target === "surge") {
    entries.push(["obfs", pluginOpts.mode], ["obfs-host", pluginOpts.host], ["obfs-uri", pluginOpts.path]);
  } else {
    entries.push(["obfs-name", pluginOpts.mode], ["obfs-host", pluginOpts.host], ["obfs-uri", pluginOpts.path]);
  }
}

function appendRealityOptions(entries: Array<[string, unknown]>, proxy: ProxyNode) {
  const realityOpts = proxy["reality-opts"] as Record<string, unknown> | undefined;
  entries.push(["public-key", realityOpts?.["public-key"]], ["short-id", realityOpts?.["short-id"]]);
}

function appendQxRealityOptions(entries: Array<[string, unknown]>, proxy: ProxyNode) {
  const realityOpts = proxy["reality-opts"] as Record<string, unknown> | undefined;
  entries.push(["reality-base64-pubkey", realityOpts?.["public-key"]], ["reality-hex-shortid", realityOpts?.["short-id"]]);
}

function appendQxObfs(entries: Array<[string, unknown]>, proxy: ProxyNode) {
  const pluginOpts = proxy["plugin-opts"] as Record<string, unknown> | undefined;
  if (proxy.plugin === "obfs" && pluginOpts) entries.push(["obfs", pluginOpts.mode], ["obfs-host", pluginOpts.host], ["obfs-uri", pluginOpts.path]);
}

function appendQxTransport(entries: Array<[string, unknown]>, proxy: ProxyNode) {
  if (proxy.network !== "ws") return;
  const wsOpts = proxy["ws-opts"] as { path?: unknown; headers?: Record<string, unknown> } | undefined;
  entries.push(["obfs", proxy.tls ? "wss" : "ws"], ["obfs-uri", wsOpts?.path || "/"], ["obfs-host", wsHeaderHost(wsOpts)]);
}

function joinTextProxy(base: string, entries: Array<[string, unknown]>) {
  const suffix = entries
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${key}=${formatTextOptionValue(value)}`)
    .join(",");
  return suffix ? `${base},${suffix}` : base;
}

function formatTextOptionValue(value: unknown) {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return quoteTextValue(value.join(","));
  const text = String(value);
  return /[,\s"]/.test(text) ? quoteTextValue(text) : text;
}

function quoteTextValue(value: unknown) {
  return `"${String(value || "").replace(/"/g, '\\"')}"`;
}

function sanitizeTextProxyName(name: string) {
  return name.replace(/[=,\r\n]/g, " ").trim() || "proxy";
}

function sanitizeQxTag(name: string) {
  return name.replace(/[,\r\n]/g, " ").trim() || "proxy";
}

function wsHeaderHost(wsOpts: { headers?: Record<string, unknown> } | undefined) {
  return wsOpts?.headers?.Host || wsOpts?.headers?.host;
}

function formatAlpn(value: unknown) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean).join(",");
  return stringSetting(value);
}

function renderSingBoxJson(proxies: ProxyNode[]) {
  const nodeOutbounds = proxies.map(toSingBoxOutbound).filter(isSingBoxOutbound);
  const tags = nodeOutbounds.map((outbound) => String(outbound.tag));
  if (tags.length === 0) throw new Error("No supported nodes for sing-box output");

  const outbounds = [
    {
      type: "selector",
      tag: "PROXY",
      outbounds: ["AUTO", ...tags],
      default: "AUTO",
      interrupt_exist_connections: false,
    },
    {
      type: "urltest",
      tag: "AUTO",
      outbounds: tags,
      url: TEST_URL,
      interval: "5m",
      tolerance: 50,
      interrupt_exist_connections: false,
    },
    ...nodeOutbounds,
    { type: "direct", tag: "DIRECT" },
    { type: "block", tag: "REJECT" },
  ];

  return JSON.stringify(
    {
      log: { level: "info" },
      inbounds: [{ type: "mixed", tag: "mixed-in", listen: "127.0.0.1", listen_port: 7890, sniff: true }],
      outbounds,
      route: { auto_detect_interface: true, final: "PROXY" },
    },
    null,
    2,
  );
}

function toSingBoxOutbound(proxy: ProxyNode): SingBoxOutbound | undefined {
  if (proxy.type === "vless") {
    const realityOpts = proxy["reality-opts"] as Record<string, unknown> | undefined;
    return stripUndefined({
      type: "vless",
      tag: proxy.name,
      server: proxy.server,
      server_port: proxy.port,
      uuid: proxy.uuid,
      flow: proxy.flow,
      network: proxy.network || "tcp",
      packet_encoding: "xudp",
      tls: proxy.tls
        ? stripUndefined({
            enabled: true,
            server_name: proxy.servername,
            utls: { enabled: true, fingerprint: proxy["client-fingerprint"] || "chrome" },
            reality: realityOpts
              ? stripUndefined({ enabled: true, public_key: realityOpts["public-key"], short_id: realityOpts["short-id"] })
              : undefined,
          })
        : undefined,
    });
  }

  if (proxy.type === "hysteria2") {
    return stripUndefined({
      type: "hysteria2",
      tag: proxy.name,
      server: proxy.server,
      server_port: proxy.port,
      password: proxy.password,
      obfs: proxy.obfs ? { type: proxy.obfs, password: proxy["obfs-password"] } : undefined,
      tls: { enabled: true, server_name: proxy.sni, insecure: Boolean(proxy["skip-cert-verify"]) },
    });
  }

  if (proxy.type === "hysteria") {
    return stripUndefined({
      type: "hysteria",
      tag: proxy.name,
      server: proxy.server,
      server_port: proxy.port,
      auth_str: proxy.auth_str,
      up_mbps: numberOrUndefined(proxy.up),
      down_mbps: numberOrUndefined(proxy.down),
      obfs: proxy.obfs ? String(proxy.obfs) : undefined,
      tls: { enabled: true, server_name: proxy.sni, insecure: Boolean(proxy["skip-cert-verify"]) },
    });
  }

  if (proxy.type === "anytls") {
    return stripUndefined({
      type: "anytls",
      tag: proxy.name,
      server: proxy.server,
      server_port: proxy.port,
      password: proxy.password,
      tls: {
        enabled: true,
        server_name: proxy.sni || proxy.servername,
        insecure: Boolean(proxy["skip-cert-verify"]),
        utls: { enabled: true, fingerprint: proxy["client-fingerprint"] || "chrome" },
      },
    });
  }

  if (proxy.type === "tuic") {
    return stripUndefined({
      type: "tuic",
      tag: proxy.name,
      server: proxy.server,
      server_port: proxy.port,
      uuid: proxy.uuid,
      password: proxy.password,
      congestion_control: proxy["congestion-controller"],
      udp_relay_mode: proxy["udp-relay-mode"],
      zero_rtt_handshake: proxy["reduce-rtt"],
      tls: { enabled: true, server_name: proxy.sni, insecure: Boolean(proxy["skip-cert-verify"]) },
    });
  }

  if (proxy.type === "trojan") {
    return stripUndefined({
      type: "trojan",
      tag: proxy.name,
      server: proxy.server,
      server_port: proxy.port,
      password: proxy.password,
      tls: { enabled: true, server_name: proxy.sni, insecure: Boolean(proxy["skip-cert-verify"]) },
    });
  }

  if (proxy.type === "socks5") {
    return stripUndefined({
      type: "socks",
      tag: proxy.name,
      server: proxy.server,
      server_port: proxy.port,
      version: "5",
      username: proxy.username,
      password: proxy.password,
      tls: proxy.tls ? { enabled: true } : undefined,
    });
  }

  if (proxy.type === "http") {
    return stripUndefined({
      type: "http",
      tag: proxy.name,
      server: proxy.server,
      server_port: proxy.port,
      username: proxy.username,
      password: proxy.password,
      tls: proxy.tls ? { enabled: true } : undefined,
    });
  }

  if (proxy.type === "ss") {
    return stripUndefined({
      type: "shadowsocks",
      tag: proxy.name,
      server: proxy.server,
      server_port: proxy.port,
      method: proxy.cipher,
      password: proxy.password,
    });
  }

  if (proxy.type === "wireguard") {
    const localAddress = [proxy.ip, proxy.ipv6].map((item) => String(item || "").trim()).filter(Boolean);
    return stripUndefined({
      type: "wireguard",
      tag: proxy.name,
      server: proxy.server,
      server_port: proxy.port,
      local_address: localAddress.length > 0 ? localAddress : undefined,
      private_key: proxy["private-key"],
      peer_public_key: proxy["public-key"],
      pre_shared_key: proxy["pre-shared-key"],
      reserved: parseWireGuardReserved(proxy.reserved),
    });
  }

  if (proxy.type === "vmess") {
    return stripUndefined({
      type: "vmess",
      tag: proxy.name,
      server: proxy.server,
      server_port: proxy.port,
      uuid: proxy.uuid,
      security: proxy.cipher || "auto",
      alter_id: proxy.alterId,
      tls: proxy.tls ? { enabled: true, server_name: proxy.servername } : undefined,
      transport:
        proxy.network === "ws"
          ? {
              type: "ws",
              path: (proxy["ws-opts"] as { path?: unknown } | undefined)?.path || "/",
              headers: (proxy["ws-opts"] as { headers?: unknown } | undefined)?.headers,
            }
          : undefined,
    });
  }

  return undefined;
}

function isSingBoxOutbound(input: SingBoxOutbound | undefined): input is SingBoxOutbound {
  return Boolean(input && typeof input.tag === "string");
}

function renderProxyUris(proxies: ProxyNode[]) {
  return proxies.map(toProxyUri).filter(Boolean).join("\n");
}

function toProxyUri(proxy: ProxyNode) {
  if (proxy.type === "vless") {
    const params = new URLSearchParams();
    const realityOpts = proxy["reality-opts"] as Record<string, unknown> | undefined;
    params.set("encryption", String(proxy.encryption || "none"));
    params.set("security", realityOpts ? "reality" : proxy.tls ? "tls" : "none");
    if (proxy.servername) params.set("sni", String(proxy.servername));
    if (proxy["client-fingerprint"]) params.set("fp", String(proxy["client-fingerprint"]));
    if (realityOpts?.["public-key"]) params.set("pbk", String(realityOpts["public-key"]));
    if (realityOpts?.["short-id"]) params.set("sid", String(realityOpts["short-id"]));
    if (realityOpts?.["public-key"]) params.set("spx", String(realityOpts["spider-x"] || "/"));
    params.set("type", String(proxy.network || "tcp"));
    if (proxy.flow) params.set("flow", String(proxy.flow));
    return `vless://${encodeURIComponent(String(proxy.uuid))}@${proxy.server}:${proxy.port}?${params.toString()}#${encodeURIComponent(proxy.name)}`;
  }

  if (proxy.type === "hysteria2") {
    const params = new URLSearchParams();
    if (proxy.sni) params.set("sni", String(proxy.sni));
    if (proxy["skip-cert-verify"]) params.set("insecure", "1");
    if (proxy.obfs) params.set("obfs", String(proxy.obfs));
    if (proxy["obfs-password"]) params.set("obfs-password", String(proxy["obfs-password"]));
    return `hysteria2://${encodeURIComponent(String(proxy.password))}@${proxy.server}:${proxy.port}?${params.toString()}#${encodeURIComponent(proxy.name)}`;
  }

  if (proxy.type === "hysteria") {
    const params = new URLSearchParams();
    if (proxy.sni) params.set("sni", String(proxy.sni));
    if (proxy["skip-cert-verify"]) params.set("insecure", "1");
    if (proxy.protocol) params.set("protocol", String(proxy.protocol));
    if (proxy.up) params.set("up", String(proxy.up));
    if (proxy.down) params.set("down", String(proxy.down));
    if (proxy.obfs) params.set("obfs", String(proxy.obfs));
    if (proxy["obfs-password"]) params.set("obfs-password", String(proxy["obfs-password"]));
    return `hysteria://${encodeURIComponent(String(proxy.auth_str || ""))}@${proxy.server}:${proxy.port}?${params.toString()}#${encodeURIComponent(proxy.name)}`;
  }

  if (proxy.type === "anytls") {
    const params = new URLSearchParams();
    if (proxy.sni || proxy.servername) params.set("sni", String(proxy.sni || proxy.servername));
    if (proxy["skip-cert-verify"]) params.set("insecure", "1");
    if (proxy["client-fingerprint"]) params.set("fp", String(proxy["client-fingerprint"]));
    return `anytls://${encodeURIComponent(String(proxy.password))}@${proxy.server}:${proxy.port}?${params.toString()}#${encodeURIComponent(proxy.name)}`;
  }

  if (proxy.type === "tuic") {
    const params = new URLSearchParams();
    if (proxy.sni) params.set("sni", String(proxy.sni));
    if (proxy["skip-cert-verify"]) params.set("allow_insecure", "1");
    if (proxy["disable-sni"]) params.set("disable_sni", "1");
    if (proxy["reduce-rtt"]) params.set("reduce_rtt", "1");
    if (proxy["udp-relay-mode"]) params.set("udp_relay_mode", String(proxy["udp-relay-mode"]));
    if (proxy["congestion-controller"]) params.set("congestion_control", String(proxy["congestion-controller"]));
    return `tuic://${encodeURIComponent(String(proxy.uuid))}:${encodeURIComponent(String(proxy.password))}@${proxy.server}:${proxy.port}?${params.toString()}#${encodeURIComponent(proxy.name)}`;
  }

  if (proxy.type === "trojan") {
    const params = new URLSearchParams();
    if (proxy.sni) params.set("sni", String(proxy.sni));
    if (proxy["skip-cert-verify"]) params.set("allowInsecure", "1");
    return `trojan://${encodeURIComponent(String(proxy.password))}@${proxy.server}:${proxy.port}?${params.toString()}#${encodeURIComponent(proxy.name)}`;
  }

  if (proxy.type === "socks5") {
    const params = new URLSearchParams();
    if (proxy.tls) params.set("tls", "1");
    const auth = proxy.username ? `${encodeURIComponent(String(proxy.username))}:${encodeURIComponent(String(proxy.password || ""))}@` : "";
    const scheme = proxy.tls ? "socks5+tls" : "socks5";
    return `${scheme}://${auth}${proxy.server}:${proxy.port}${params.size > 0 ? `?${params.toString()}` : ""}#${encodeURIComponent(proxy.name)}`;
  }

  if (proxy.type === "http") {
    const auth = proxy.username ? `${encodeURIComponent(String(proxy.username))}:${encodeURIComponent(String(proxy.password || ""))}@` : "";
    const scheme = proxy.tls ? "https" : "http";
    return `${scheme}://${auth}${proxy.server}:${proxy.port}#${encodeURIComponent(proxy.name)}`;
  }

  if (proxy.type === "ss") {
    const userInfo = base64Utf8(`${proxy.cipher}:${proxy.password}@${proxy.server}:${proxy.port}`);
    return `ss://${userInfo}#${encodeURIComponent(proxy.name)}`;
  }

  if (proxy.type === "ssr") {
    const main = [
      proxy.server,
      proxy.port,
      proxy.protocol || "origin",
      proxy.cipher || "aes-256-cfb",
      proxy.obfs || "plain",
      encodeBase64UrlText(String(proxy.password || "")),
    ].join(":");
    const params = new URLSearchParams();
    params.set("remarks", encodeBase64UrlText(proxy.name));
    if (proxy["protocol-param"]) params.set("protoparam", encodeBase64UrlText(String(proxy["protocol-param"])));
    if (proxy["obfs-param"]) params.set("obfsparam", encodeBase64UrlText(String(proxy["obfs-param"])));
    return `ssr://${encodeBase64UrlText(`${main}/?${params.toString()}`)}`;
  }

  if (proxy.type === "wireguard") {
    const params = new URLSearchParams();
    if (proxy.ip) params.set("ip", String(proxy.ip));
    if (proxy.ipv6) params.set("ipv6", String(proxy.ipv6));
    if (proxy["public-key"]) params.set("public-key", String(proxy["public-key"]));
    if (proxy["pre-shared-key"]) params.set("pre-shared-key", String(proxy["pre-shared-key"]));
    if (proxy.reserved) params.set("reserved", String(proxy.reserved));
    return `wireguard://${encodeURIComponent(String(proxy["private-key"] || ""))}@${proxy.server}:${proxy.port}?${params.toString()}#${encodeURIComponent(proxy.name)}`;
  }

  if (proxy.type === "vmess") {
    const wsOpts = proxy["ws-opts"] as { path?: unknown; headers?: { Host?: unknown } } | undefined;
    return `vmess://${base64Utf8(
      JSON.stringify({
        v: "2",
        ps: proxy.name,
        add: proxy.server,
        port: String(proxy.port || ""),
        id: proxy.uuid,
        aid: String(proxy.alterId || 0),
        scy: proxy.cipher || "auto",
        tls: proxy.tls ? "tls" : "",
        sni: proxy.servername || "",
        net: proxy.network || "tcp",
        type: "none",
        host: wsOpts?.headers?.Host || "",
        path: wsOpts?.path || "",
      }),
    )}`;
  }

  return undefined;
}

function normalizeProxy(input: unknown): ProxyNode | undefined {
  if (!input || typeof input !== "object") return undefined;
  const proxy = input as Record<string, unknown>;
  return stripUndefined({
    ...proxy,
    name: String(proxy.name || ""),
    type: String(proxy.type || ""),
    port: proxy.port === undefined ? undefined : Number(proxy.port),
  });
}

function isProxyNode(input: ProxyNode | undefined): input is ProxyNode {
  return Boolean(input?.name && input.type);
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function stripUndefined<T extends Record<string, unknown>>(input: T) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && value !== "")) as T;
}

function boolParam(value: string | null) {
  return value === "1" || value === "true";
}

function commaList(value: string | null) {
  if (!value) return undefined;
  const list = value.split(",").map((item) => item.trim()).filter(Boolean);
  return list.length > 0 ? list : undefined;
}

function numberOrUndefined(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseWireGuardReserved(value: unknown) {
  if (Array.isArray(value)) return value.map(Number).filter(Number.isFinite);
  if (typeof value !== "string" || !value.trim()) return undefined;
  const list = value.split(",").map((item) => Number(item.trim())).filter(Number.isFinite);
  return list.length > 0 ? list : undefined;
}

function base64Utf8(input: string) {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64UrlText(input: string) {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
  try {
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
}

function encodeBase64UrlText(input: string) {
  return base64Utf8(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function isTargetCompatible(proxy: ProxyNode, target: OutputTarget): boolean {
  if (["clash-party-config", "mihomo-config", "stash-config", "mihomo", "clash", "stash", "json"].includes(target)) return true;
  if (["uri", "v2ray", "shadowrocket"].includes(target)) return ["ss", "ssr", "vmess", "vless", "trojan", "hysteria", "hysteria2", "tuic", "anytls", "http", "socks5", "wireguard"].includes(proxy.type);
  if (["sing-box", "sing-box-config"].includes(target)) return ["ss", "vmess", "vless", "trojan", "hysteria", "hysteria2", "tuic", "anytls", "http", "socks5", "wireguard"].includes(proxy.type);
  if (["surge", "surge-config"].includes(target)) return ["ss", "vmess", "trojan", "http", "socks5", "hysteria2", "tuic", "anytls", "snell"].includes(proxy.type);
  if (["surfboard", "surfboard-config"].includes(target)) return ["ss", "vmess", "trojan", "http", "socks5"].includes(proxy.type);
  if (["loon", "loon-config"].includes(target)) return ["ss", "ssr", "vmess", "vless", "trojan", "http", "socks5", "hysteria2", "tuic", "anytls", "wireguard"].includes(proxy.type);
  if (target === "quantumult-x") return ["ss", "ssr", "vmess", "vless", "trojan", "http", "socks5", "anytls"].includes(proxy.type);
  if (["egern", "egern-config"].includes(target)) return ["ss", "vmess", "vless", "trojan", "http", "socks5", "hysteria2", "tuic", "anytls", "wireguard"].includes(proxy.type);
  return false;
}

function prepareNodes(nodes: ProxyNode[]): SubscriptionNode[] {
  const fingerprints = new Set<string>();
  const names = new Set(["DIRECT", "REJECT", ...mihomoProxyGroups.map((group) => group.name)]);
  return nodes.flatMap((candidate) => {
    const node = Object.fromEntries(Object.entries(candidate).filter(([key]) => key !== "id" && !key.startsWith("_"))) as ProxyNode;
    const fingerprint = JSON.stringify(Object.fromEntries(Object.entries(node).filter(([key]) => key !== "name").sort(([left], [right]) => left.localeCompare(right))));
    if (fingerprints.has(fingerprint)) return [];
    fingerprints.add(fingerprint);
    const baseName = node.name.trim();
    let name = baseName;
    let suffix = 2;
    while (names.has(name)) {
      name = `${baseName} · ${suffix}`;
      suffix += 1;
    }
    names.add(name);
    return [{ ...node, name }];
  });
}

function isPrivateIpv4(hostname: string): boolean {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(hostname)) {
    return false;
  }
  const octets = hostname.split(".").map(Number);
  if (octets.some((octet) => octet > 255)) {
    return true;
  }
  return octets[0] === 0
    || octets[0] === 10
    || octets[0] === 127
    || (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127)
    || (octets[0] === 169 && octets[1] === 254)
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168)
    || (octets[0] === 198 && octets[1] >= 18 && octets[1] <= 19)
    || octets[0] >= 224;
}

function isPrivateIpv6(hostname: string): boolean {
  const address = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return address === "::"
    || address === "::1"
    || address.startsWith("fc")
    || address.startsWith("fd")
    || /^fe[89ab]/u.test(address)
    || address.startsWith("::ffff:127.")
    || address.startsWith("::ffff:10.")
    || address.startsWith("::ffff:192.168.");
}

export function parseRemoteSubscriptionUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApiError(400, "invalid_subscription_url", "Subscription source is not a valid URL");
  }

  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== "https:") {
    throw new ApiError(400, "invalid_subscription_url", "Subscription source must use HTTPS");
  }
  if (
    hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname.endsWith(".local")
    || isPrivateIpv4(hostname)
    || (hostname.includes(":") && isPrivateIpv6(hostname))
  ) {
    throw new ApiError(400, "invalid_subscription_url", "Subscription source must use a public host");
  }
  return url;
}

const subscriptionUserinfoFields = ["upload", "download", "total", "expire"] as const;

function normalizeSubscriptionUserinfo(value: string | null): string | undefined {
  if (!value) {
    return undefined;
  }
  const fields = new Map<string, string>();
  for (const part of value.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const key = part.slice(0, separator).trim().toLowerCase();
    const fieldValue = part.slice(separator + 1).trim();
    if (
      subscriptionUserinfoFields.includes(key as typeof subscriptionUserinfoFields[number])
      && /^\d{1,20}$/u.test(fieldValue)
    ) {
      fields.set(key, fieldValue);
    }
  }
  const normalized = subscriptionUserinfoFields
    .filter((field) => fields.has(field))
    .map((field) => `${field}=${fields.get(field)}`);
  return normalized.length > 0 ? normalized.join("; ") : undefined;
}

async function requestRemoteSource(
  value: string,
  sourceUserAgent: string,
  method: "GET" | "HEAD",
): Promise<Response> {
  let url = parseRemoteSubscriptionUrl(value);
  let response: Response | null = null;

  for (let redirectCount = 0; redirectCount <= maximumRedirects; redirectCount += 1) {
    try {
      response = await fetch(url.toString(), {
        headers: { "User-Agent": sourceUserAgent },
        method,
        redirect: "manual",
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new ApiError(502, "source_unreachable", "Subscription source did not respond");
    }

    if (!redirectStatuses.has(response.status)) {
      break;
    }
    if (redirectCount === maximumRedirects) {
      throw new ApiError(502, "source_redirect_limit", "Subscription source redirected too many times");
    }
    const location = response.headers.get("location");
    if (!location) {
      throw new ApiError(502, "source_failed", "Subscription source returned an invalid redirect");
    }
    url = parseRemoteSubscriptionUrl(new URL(location, url).toString());
  }

  if (!response) {
    throw new ApiError(502, "source_unreachable", "Subscription source did not respond");
  }
  if (!response.ok) {
    throw new ApiError(502, "source_failed", `Subscription source returned HTTP ${response.status}`);
  }
  return response;
}

async function readRemoteSource(
  value: string,
  sourceUserAgent: string,
): Promise<{ content: string; subscriptionUserinfo?: string }> {
  const response = await requestRemoteSource(value, sourceUserAgent, "GET");
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > maximumRemoteBytes) {
    throw new ApiError(413, "source_response_too_large", "Subscription source exceeds the 1 MiB limit");
  }
  const content = await response.text();
  if (new TextEncoder().encode(content).byteLength > maximumRemoteBytes) {
    throw new ApiError(413, "source_response_too_large", "Subscription source exceeds the 1 MiB limit");
  }
  return {
    content,
    subscriptionUserinfo: normalizeSubscriptionUserinfo(
      response.headers.get("subscription-userinfo"),
    ),
  };
}

export async function probeRemoteSubscriptionUserinfo(
  value: string,
  sourceUserAgent: string,
): Promise<string | undefined> {
  try {
    const response = await requestRemoteSource(value, sourceUserAgent, "HEAD");
    return normalizeSubscriptionUserinfo(response.headers.get("subscription-userinfo"));
  } catch {
    return undefined;
  }
}

export function probeConverter(): "ready" {
  return "ready";
}

export async function normalizeSources(
  _env: SubscriptionEnv,
  input: {
    profileName: string;
    sourceUserAgent?: string;
    subscriptionUrls: string[];
    nodes: string[];
  },
): Promise<SubscriptionNode[]> {
  return (await normalizeSourceBundle(_env, input)).nodes;
}

export async function normalizeSourceBundle(
  _env: SubscriptionEnv,
  input: {
    profileName: string;
    sourceUserAgent?: string;
    subscriptionUrls: string[];
    nodes: string[];
  },
): Promise<{ nodes: SubscriptionNode[]; subscriptionUserinfo?: string }> {
  if (input.subscriptionUrls.length > maximumRemoteSources) {
    throw new ApiError(413, "too_many_sources", "A profile supports at most 10 remote sources");
  }
  const remote = await Promise.all(input.subscriptionUrls.map(
    (url) => readRemoteSource(url, input.sourceUserAgent || "mihomo/1.19"),
  ));
  const parsed = [
    ...remote.map((source) => source.content),
    ...input.nodes,
  ].flatMap((content) => parseProxies(decodeMaybeBase64(content)));
  if (parsed.length === 0) {
    throw new ApiError(422, "no_nodes_found", "Subscription sources contained no supported nodes");
  }
  return {
    nodes: prepareNodes(parsed),
    ...(remote.length === 1 && remote[0].subscriptionUserinfo
      ? { subscriptionUserinfo: remote[0].subscriptionUserinfo }
      : {}),
  };
}

export async function produceTarget(
  _env: SubscriptionEnv,
  nodes: SubscriptionNode[],
  target: OutputTarget,
  rulePreset: MihomoRulePreset = "flacier",
  updateIntervalHours = 6,
): Promise<string> {
  const supported = (nodes as ProxyNode[]).filter((node) => isTargetCompatible(node, target));
  if (supported.length === 0) {
    throw new ApiError(422, "target_unsupported", `${target} could not represent the normalized nodes`);
  }
  const mihomoNodes = stringifyYaml({ proxies: supported });
  if (target === "clash-party-config" || target === "mihomo-config") {
    return createMihomoProfile(mihomoNodes, rulePreset, updateIntervalHours);
  }
  if (target === "stash-config") return createStashProfile(mihomoNodes);
  if (target === "surge-config") return createSurgeProfile(renderSurgeProxies(supported));
  if (target === "surfboard-config") return createSurfboardProfile(renderSurfboardProxies(supported));
  if (target === "loon-config") return createLoonProfile(renderLoonProxies(supported));
  if (target === "egern-config") return createEgernProfile(renderEgernYaml(supported));
  if (target === "sing-box-config") return createSingBoxProfile(renderSingBoxJson(supported));
  if (target === "mihomo" || target === "clash" || target === "stash") return mihomoNodes;
  if (target === "surge") return renderSurgeProxies(supported);
  if (target === "surfboard") return renderSurfboardProxies(supported);
  if (target === "loon") return renderLoonProxies(supported);
  if (target === "egern") return renderEgernYaml(supported);
  if (target === "quantumult-x") return renderQxProxies(supported);
  if (target === "sing-box") return renderSingBoxJson(supported);
  if (target === "v2ray") return base64Utf8(renderProxyUris(supported));
  if (target === "uri" || target === "shadowrocket") return renderProxyUris(supported);
  return JSON.stringify({ proxies: supported }, null, 2);
}
