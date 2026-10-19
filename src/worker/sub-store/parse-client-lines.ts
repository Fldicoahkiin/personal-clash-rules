import { commaList, numberOrUndefined, stripUndefined } from "./codec";
import type { ProxyNode } from "./types";

// Adapted from realchendahuang/sub-store-cloudflare under AGPL-3.0.
export function parseClientProxyLine(line: string, index: number): ProxyNode | undefined {
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
