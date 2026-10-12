export type ProxyEndpoint = { protocol: "socks5" | "http" | "https"; server: string; port: number; username: string; password: string; name: string };

export function parseProxyEndpoint(text: string): Pick<ProxyEndpoint, "server" | "port" | "username" | "password"> {
  const match = /^([^:\s]+):(\d{1,5}):([^:]+):(.+)$/u.exec(text.trim());
  if (!match) throw new Error("请按 主机:端口:账号:密码 填写；IPv6 请使用下方独立字段。");
  return { server: match[1], port: Number(match[2]), username: match[3], password: match[4] };
}

export function proxyEndpointUri(input: ProxyEndpoint): string {
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) throw new Error("端口需要在 1–65535 之间。");
  if (!input.name.trim() || input.name.length > 64 || /[\u0000-\u001f\u007f]/u.test(input.name)) throw new Error("请填写最多 64 字的节点备注。");
  const server = input.server.trim();
  if (!server || /[\s/@?#\\]/u.test(server)) throw new Error("地址只填写 IP 或域名，不带协议或路径。");
  if (/[:\u0000-\u001f\u007f]/u.test(input.username) || /[\u0000-\u001f\u007f]/u.test(input.password)) throw new Error("账号不能含冒号，账号密码不能含控制字符。");
  const host = server.includes(":") && !server.startsWith("[") ? `[${server}]` : server;
  let url: URL;
  try { url = new URL(`${input.protocol}://${host}:${input.port}`); } catch { throw new Error("IP 或域名格式无效。"); }
  if (input.username || input.password) { url.username = encodeURIComponent(input.username); url.password = encodeURIComponent(input.password); }
  url.hash = encodeURIComponent(input.name.trim());
  return url.href;
}
