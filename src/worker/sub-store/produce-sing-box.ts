import { ApiError } from "../api-error";
import { numberOrUndefined, parseWireGuardReserved, stripUndefined } from "./codec";
import { TEST_URL, type ProxyNode, type SingBoxOutbound } from "./types";

// Adapted from realchendahuang/sub-store-cloudflare under AGPL-3.0.
export function renderSingBoxJson(proxies: ProxyNode[]) {
  const nodeOutbounds = proxies.map(toSingBoxOutbound).filter(isSingBoxOutbound);
  const tags = nodeOutbounds.map((outbound) => String(outbound.tag));
  if (tags.length === 0) throw new ApiError(422, "target_unsupported", "sing-box could not represent the normalized nodes");

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
