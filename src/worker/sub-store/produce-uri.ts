import { base64Utf8, encodeBase64UrlText } from "./codec";
import type { ProxyNode } from "./types";

// Adapted from realchendahuang/sub-store-cloudflare under AGPL-3.0.
export function renderProxyUris(proxies: ProxyNode[]) {
  return proxies.map(toProxyUri).filter(Boolean).join("\n");
}

function setUriTransport(params: URLSearchParams, proxy: ProxyNode) {
  params.set("type", String(proxy.network || "tcp"));
  if (Array.isArray(proxy.alpn)) params.set("alpn", proxy.alpn.join(","));
  if (proxy["skip-cert-verify"]) params.set("allowInsecure", "1");
  const ws = proxy["ws-opts"] as { path?: string; headers?: Record<string, string> } | undefined;
  if (proxy.network === "ws" && ws) {
    if (ws.path) params.set("path", ws.path);
    if (ws.headers?.Host || ws.headers?.host) params.set("host", ws.headers.Host || ws.headers.host);
  }
  const grpc = proxy["grpc-opts"] as { "grpc-service-name"?: string } | undefined;
  if (proxy.network === "grpc" && grpc?.["grpc-service-name"]) params.set("serviceName", grpc["grpc-service-name"]);
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
    setUriTransport(params, proxy);
    return `vless://${encodeURIComponent(String(proxy.uuid))}@${proxy.server}:${proxy.port}?${params.toString()}#${encodeURIComponent(proxy.name)}`;
  }

  if (proxy.type === "hysteria2") {
    const params = new URLSearchParams();
    if (proxy.sni) params.set("sni", String(proxy.sni));
    if (proxy["skip-cert-verify"]) params.set("insecure", "1");
    if (proxy.obfs) params.set("obfs", String(proxy.obfs));
    if (proxy["obfs-password"]) params.set("obfs-password", String(proxy["obfs-password"]));
    if (proxy.ports || proxy.mport) params.set("mport", String(proxy.ports || proxy.mport));
    if (proxy.fingerprint) params.set("pinSHA256", String(proxy.fingerprint));
    if (proxy["hop-interval"]) params.set("hop-interval", String(proxy["hop-interval"]));
    if (Array.isArray(proxy.alpn)) params.set("alpn", proxy.alpn.join(","));
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
    setUriTransport(params, proxy);
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
