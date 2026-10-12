import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, readdir, rename } from "node:fs/promises";
import { resolve } from "node:path";

import { defaultDnsSettings } from "../config/dns-settings";
import { createRolaOverride, createRolaTemplate, parseRolaSettings, prepareRolaProfile, rolaUpstreamChoices } from "./rola";
export { rolaRulePaths } from "./rola";

type LocalRouterOptions = {
  directory: string;
  origin: string;
  ruleLists: string[];
  convert: (request: Request) => Promise<Response>;
};
type Exit = {
  authMode?: "literal" | "dynamic";
  id: string; name: string; protocol: "http" | "socks5"; server: string; port: number;
  account: string; password: string; country: string; sessionId: string; sessionMinutes: number;
};
type Chain = { baseId: string; target: string; exit: Exit; connectionMode?: unknown; groupName?: unknown; policyGroup?: unknown; upstreamNode: string; rules: string[]; dns: string[] };
const idPattern = /^[A-Za-z0-9_-]{16}$/u;
const targets = new Set(["clash-party-config", "clash-verge-config", "flclash-config", "mihomo-config"]);

class LocalError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
function id(value: unknown): string {
  if (typeof value !== "string" || !idPattern.test(value)) throw new LocalError(400, "invalid_local_id", "本地记录 ID 无效。");
  return value;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new LocalError(400, "invalid_local_input", "请求必须是 JSON 对象。");
  return value as Record<string, unknown>;
}
async function body(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json") throw new LocalError(415, "json_required", "仅接受 JSON 请求。");
  const reader = request.body?.getReader();
  if (!reader) throw new LocalError(400, "invalid_local_input", "请求内容为空。");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 65536) { await reader.cancel(); throw new LocalError(413, "local_input_too_large", "请求超过 64 KB。"); }
    chunks.push(value);
  }
  try { return object(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
  catch (error) { if (error instanceof LocalError) throw error; throw new LocalError(400, "invalid_local_input", "JSON 内容无效。"); }
}
function metadata(exit: Exit) {
  // Account and password are write-only. The browser cannot read saved credentials back.
  const { id, name, protocol, server, port, country, sessionId, sessionMinutes } = exit;
  return { id, name, protocol, server, port, country, sessionId, sessionMinutes, authMode: exit.authMode ?? "dynamic" };
}
function json(value: unknown, status = 200) { return Response.json(value, { status, headers: { "Cache-Control": "no-store" } }); }

export async function createRolaRouter({ directory, origin, ruleLists, convert }: LocalRouterOptions) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if ((await lstat(directory)).isSymbolicLink()) throw new Error("Rola directory must not be a symlink");
  await chmod(directory, 0o700);
  const defaults = createRolaTemplate(ruleLists);
  async function read<T>(kind: "exit" | "chain", token: string): Promise<T> {
    const path = resolve(directory, `${kind}-${id(token)}.json`);
    let file;
    try { file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new LocalError(404, "local_not_found", "本地记录不存在，请重新生成。");
      throw error;
    }
    try {
      const stat = await file.stat();
      if (!stat.isFile() || (stat.mode & 0o077) || stat.size > 65536) throw new Error("Unsafe local Rola file");
      return JSON.parse(await file.readFile("utf8")) as T;
    } finally { await file.close(); }
  }
  async function write(kind: "exit" | "chain", token: string, value: unknown) {
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized) > 65536) throw new LocalError(413, "local_input_too_large", "本地记录超过 64 KB，请减少规则数量。");
    const path = resolve(directory, `${kind}-${id(token)}.json`);
    const temporary = `${path}.${randomBytes(8).toString("hex")}.tmp`;
    const file = await open(temporary, "wx", 0o600);
    try { await file.writeFile(serialized); }
    finally { await file.close(); }
    await rename(temporary, path);
  }
  async function renderBase(baseId: string, target: string) {
    if (!targets.has(target)) throw new LocalError(400, "rola_target_unsupported", "Rola 串联目前只输出 Mihomo 完整配置。");
    return convert(new Request(`${origin}/s/${id(baseId)}/${target}`));
  }
  async function candidate(base: Response, chain: Chain) {
    try { return prepareRolaProfile(await base.text(), { ...chain.exit, connectionMode: chain.connectionMode, groupName: chain.groupName, policyGroup: chain.policyGroup, upstreamNode: chain.upstreamNode, rules: chain.rules, dns: chain.dns }); }
    catch {
      throw new LocalError(422, "rola_profile_rejected", "无法生成串联配置：请确认所选前置节点仍存在、启用加密和证书验证，域名规则有效且 DNS 不与网关形成循环。不会返回空节点或直连替代配置。");
    }
  }

  return async function route(request: Request): Promise<Response | null> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/local/rola") && !url.pathname.startsWith("/local/rola/")) return null;
    try {
      if (url.pathname === "/api/local/rola" && request.method === "GET") {
        const exits = await Promise.all((await readdir(directory)).filter(name => /^exit-[A-Za-z0-9_-]{16}\.json$/u.test(name)).sort().map(name => read<Exit>("exit", name.slice(5, -5))));
        return json({ exits: exits.map(metadata), defaults: { rules: defaults.rules, dns: defaults.dns } });
      }
      if (url.pathname === "/api/local/rola/exits" && request.method === "POST") {
        const input = await body(request);
        const existing = input.id ? await read<Exit>("exit", id(input.id)) : undefined;
        const value: Record<string, unknown> = { ...input,
          account: input.account === "" || input.account === undefined ? existing?.account : input.account,
          password: input.password === "" || input.password === undefined ? existing?.password : input.password };
        try {
          parseRolaSettings({ ...value, upstreamNode: "validation", rules: defaults.rules, dns: defaults.dns });
          if (typeof value.name !== "string" || !value.name.trim() || value.name.length > 64 || /[\u0000-\u001f\u007f]/u.test(value.name)) throw new Error("Invalid name");
        } catch { throw new LocalError(400, "invalid_rola_exit", "请检查出口名称、网关、端口、账号和密码。现成节点应选用户名原样使用；仅动态模式需要基础账号、两位国家代码与会话参数（1–120 分钟）。"); }
        const exit: Exit = {
          authMode: value.authMode === "literal" ? "literal" : "dynamic",
          id: existing?.id || randomBytes(12).toString("base64url"), name: String(value.name).trim(),
          protocol: value.protocol as Exit["protocol"], server: String(value.server), port: Number(value.port),
          account: String(value.account), password: String(value.password), country: String(value.country ?? "").toLowerCase(),
          sessionId: String(value.sessionId ?? ""), sessionMinutes: Number(value.sessionMinutes ?? 0),
        };
        await write("exit", exit.id, exit);
        return json(metadata(exit), existing ? 200 : 201);
      }
      if (url.pathname === "/api/local/rola/preview" && request.method === "POST") {
        const input = await body(request);
        if (!targets.has(String(input.target))) throw new LocalError(400, "rola_target_unsupported", "请选择 Mihomo 完整配置。");
        const created = await convert(new Request(`${origin}/api/subscriptions`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sources: input.sources, name: input.name, sourceUserAgent: input.sourceUserAgent,
            target: input.target, rulePreset: "flacier", dnsMode: "doh", dnsSettings: defaultDnsSettings,
            fallbackMode: "error", updateIntervalHours: 6 }),
        }));
        if (!created.ok) return created;
        const result = await created.json() as { url: string };
        const baseId = id(new URL(result.url).pathname.split("/")[2]);
        const base = await renderBase(baseId, String(input.target));
        if (!base.ok) return base;
        try { return json({ baseId, nodes: rolaUpstreamChoices(await base.text()), result }); }
        catch { throw new LocalError(422, "rola_no_inline_nodes", "未读取到可供选择的内联节点；客户端直读或空配置不能用于串联。"); }
      }
      if (url.pathname === "/api/local/rola/chains" && request.method === "POST") {
        const input = await body(request);
        const exit = await read<Exit>("exit", id(input.exitId));
        const chain: Chain = { baseId: id(input.baseId), target: String(input.target), exit, connectionMode: input.connectionMode, groupName: input.groupName, policyGroup: input.policyGroup,
          upstreamNode: input.upstreamNode as string, rules: input.rules as string[], dns: input.dns as string[] };
        const base = await renderBase(chain.baseId, chain.target);
        if (!base.ok) return base;
        const generated = await candidate(base, chain);
        const token = randomBytes(12).toString("base64url");
        // Snapshot the exit: editing its saved credentials must not change an existing subscription.
        await write("chain", token, chain);
        return json({ url: `${origin}/local/rola/${token}.yaml`, overrideUrl: `${origin}/local/rola/${token}.js`, summary: generated.summary }, 201);
      }
      const match = /^\/local\/rola\/([A-Za-z0-9_-]{16})\.(yaml|js)$/u.exec(url.pathname);
      if (match && ["GET", "HEAD"].includes(request.method)) {
        const chain = await read<Chain>("chain", match[1]);
        const base = await renderBase(chain.baseId, chain.target);
        if (!base.ok) return base;
        const headers = new Headers(base.headers);
        const scriptSource = match[2] === "js" ? await base.clone().text() : null;
        const generated = await candidate(base, chain);
        const script = scriptSource === null ? null : createRolaOverride(scriptSource, { ...chain.exit, connectionMode: chain.connectionMode, groupName: chain.groupName, policyGroup: chain.policyGroup, upstreamNode: chain.upstreamNode, rules: chain.rules, dns: chain.dns });
        headers.delete("ETag");
        headers.set("Cache-Control", "no-store");
        headers.set("Content-Type", script ? "application/javascript; charset=utf-8" : "text/yaml; charset=utf-8");
        headers.set("Content-Disposition", script ? "attachment; filename=Flacier-Rola-private.js" : "attachment; filename=Flacier-Rola.yaml");
        return new Response(request.method === "HEAD" ? null : script ?? generated.profile, { headers });
      }
      throw new LocalError(404, "local_route_not_found", "本地 Rola 接口或请求方法不存在。");
    } catch (error) {
      if (error instanceof LocalError) return json({ error: error.code, message: error.message }, error.status);
      return json({ error: "local_rola_failed", message: "本地 Rola 处理失败，请检查本地文件权限和服务状态；未修改代理配置。" }, 500);
    }
  };
}
