import JSON5 from "json5";
import { parse as parseYaml } from "yaml";

import { stripUndefined } from "./codec";
import { parseClientProxyLine } from "./parse-client-lines";
import { parseProxyUri } from "./parse-uri";
import type { ProxyNode } from "./types";

// Adapted from realchendahuang/sub-store-cloudflare under AGPL-3.0.
export function decodeMaybeBase64(raw: string) {
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

export function parseProxies(raw: string): ProxyNode[] {
  const text = raw.trim();
  if (!text) return [];
  if (/^\s*[\[{]/.test(text)) return parseJsonProxies(text);
  if (/^\s*proxies\s*:/m.test(text)) return parseYamlProxies(text);
  return parseProxyLines(text);
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
