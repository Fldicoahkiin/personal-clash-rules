import { boolParam, commaList, decodeBase64UrlText, numberOrUndefined, stripUndefined } from "./codec";
import type { ProxyNode } from "./types";

// Adapted from realchendahuang/sub-store-cloudflare under AGPL-3.0.
export function parseProxyUri(line: string, index: number): ProxyNode | undefined {
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

function parseUriTransport(params: URLSearchParams) {
  const network = params.get("type") || "tcp";
  return stripUndefined({
    network,
    alpn: commaList(params.get("alpn")),
    "skip-cert-verify": boolParam(params.get("insecure") || params.get("allowInsecure")),
    "ws-opts": network === "ws" ? { path: params.get("path") || "/", headers: stripUndefined({ Host: params.get("host") || undefined }) } : undefined,
    "grpc-opts": network === "grpc" ? { "grpc-service-name": params.get("serviceName") || "" } : undefined,
  });
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
    tls: security !== "none",
    servername: params.get("sni") || undefined,
    encryption: params.get("encryption") || "none",
    "client-fingerprint": params.get("fp") || "chrome",
    "reality-opts": publicKey ? stripUndefined({ "public-key": publicKey, "short-id": shortId, "spider-x": params.get("spx") || "/" }) : undefined,
    ...parseUriTransport(params),
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
    password: decodeURIComponent(url.password ? `${url.username}:${url.password}` : url.username),
    sni: params.get("sni") || params.get("peer") || undefined,
    "skip-cert-verify": boolParam(params.get("insecure") || params.get("allowInsecure")),
    obfs: params.get("obfs") || undefined,
    "obfs-password": params.get("obfs-password") || params.get("salamander-password") || undefined,
    ports: params.get("mport") || undefined,
    fingerprint: params.get("pinSHA256") || undefined,
    "hop-interval": numberOrUndefined(params.get("hop-interval")),
    alpn: commaList(params.get("alpn")),
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
    udp: true,
    ...parseUriTransport(url.searchParams),
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
  return stripUndefined({
    name: decodeURIComponent(url.hash.slice(1) || `${url.protocol === "https:" ? "https" : "http"}-${index + 1}`),
    type: "http",
    server: url.hostname,
    port: Number(url.port || (url.protocol === "https:" ? 443 : 80)),
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
