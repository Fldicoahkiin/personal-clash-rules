import { stringify as stringifyYaml } from "yaml";

import { ApiError } from "../api-error";
import { stringSetting, stripUndefined } from "./codec";
import type { ProxyNode } from "./types";

// Adapted from realchendahuang/sub-store-cloudflare under AGPL-3.0.
export function renderSurgeProxies(proxies: ProxyNode[]) {
  return renderTextProxyList(proxies, "surge", toSurgeProxyLine);
}

export function renderSurfboardProxies(proxies: ProxyNode[]) {
  return renderTextProxyList(proxies, "surfboard", toSurfboardProxyLine);
}

export function renderLoonProxies(proxies: ProxyNode[]) {
  return renderTextProxyList(proxies, "loon", toLoonProxyLine);
}

export function renderQxProxies(proxies: ProxyNode[]) {
  return renderTextProxyList(proxies, "qx", toQxProxyLine);
}

function renderTextProxyList(proxies: ProxyNode[], target: string, producer: (proxy: ProxyNode) => string | undefined) {
  const lines = proxies.map(producer).filter((line): line is string => Boolean(line));
  if (lines.length === 0) throw new ApiError(422, "target_unsupported", `${target} could not represent the normalized nodes`);
  return lines.join("\n");
}

export function renderEgernYaml(proxies: ProxyNode[]) {
  const list = proxies.map(toEgernProxy).filter((proxy) => Boolean(proxy));
  if (list.length === 0) throw new ApiError(422, "target_unsupported", "egern could not represent the normalized nodes");
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
