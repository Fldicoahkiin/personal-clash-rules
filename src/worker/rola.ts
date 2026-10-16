import { timingSafeEqual } from "node:crypto";
import { defaultDnsSettings } from "../config/dns-settings";
import { parseRolaSettings, prepareRolaProfile, RolaExitMetadataError, rolaUpstreamChoices } from "../local/rola";
import { ApiError } from "./api-error";
import { hashText } from "./secrets";
import { formatSubscriptionUserinfo } from "./sub-store";
import { buildSubscription, buildSynchronizedSubscription, readRequestObject, readSynchronizedSubscription } from "./subscriptions";
import { subscriptionRecoveryKey, withSubscriptionRecovery } from "./subscription-recovery";
import { renderRolaTarget, requireRolaTarget, rolaMobileFiles, rolaRequestTarget, type RolaTarget } from "./rola-target";
import { isMihomoConfigTarget, isOutputTarget, type OutputTarget } from "./types";

const profileBytes = 256 * 1024;
const sourceBytes = 1024 * 1024;
const requestBytes = 512 * 1024;
const nodeLimit = 500;
const previewTtl = 3600;
const chainTtl = 90 * 86400;
const encoder = new TextEncoder();
type Built = Awaited<ReturnType<typeof buildSubscription>>;
type Source = { kind: "convert"; config: Built["config"] } | { kind: "snapshot"; profile: string } | { kind: "local-sync"; id: string };
type Preview = { source: Source; target: OutputTarget; name: string; profile: string; userinfo: string | null; expiresAt: number };
type Chain = { source: Source; target: OutputTarget; name: string; settings: Record<string, unknown>; revokeHash: string; expiresAt: number };

function token() { return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24)))).replaceAll("+", "-").replaceAll("/", "_"); }
function id(value: unknown): string {
  if (typeof value !== "string" || !/^[\w-]{32}$/u.test(value)) throw new ApiError(404, "rola_not_found", "记录不存在或已过期，请重新生成。");
  return value;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError(400, "invalid_rola_input", "请填写有效的出口设置。");
  return value as Record<string, unknown>;
}
function exitFields(value: unknown) {
  const exit = object(value);
  if (exit.additionalExits !== undefined || (exit.connectionMode !== undefined && exit.connectionMode !== "direct")) {
    throw new ApiError(400, "invalid_rola_additional_exits", "家宽出口不能嵌套或单独指定机场串联；接入方式由整份订阅统一选择。");
  }
  return { name: exit.name, authMode: exit.authMode, protocol: exit.protocol, server: exit.server, port: exit.port, account: exit.account, password: exit.password,
    country: exit.country, sessionId: exit.sessionId, sessionMinutes: exit.sessionMinutes, exitIp: exit.exitIp, region: exit.region, platform: exit.platform };
}
function boundedProfile(profile: string) {
  if (encoder.encode(profile).length > profileBytes) throw new ApiError(413, "rola_profile_too_large", "上传快照或转换后的基础配置不能超过 256 KiB，请减少节点或规则。");
  let nodes;
  try { nodes = rolaUpstreamChoices(profile); }
  catch { throw new ApiError(422, "rola_profile_rejected", "配置中没有有效的内联节点，或 YAML 无效。请上传未叠加 Rola 的完整 Mihomo 配置。"); }
  if (nodes.length > nodeLimit) throw new ApiError(413, "rola_too_many_nodes", "Rola 串联最多支持 500 个机场节点。");
  return nodes;
}
function prepare(profile: string, settings: unknown) {
  boundedProfile(profile);
  try {
    const generated = prepareRolaProfile(profile, settings);
    if (encoder.encode(generated.profile).length > requestBytes) throw new ApiError(413, "rola_output_too_large", "串联输出不能超过 512 KiB。");
    return generated;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof RolaExitMetadataError) throw new ApiError(400, "invalid_rola_exit_metadata", error.message);
    throw new ApiError(422, "rola_profile_rejected", "串联被拒绝：请检查账号格式、所选前置节点、证书验证、域名规则和独立引导 DNS。不会返回空节点或直连替代配置。");
  }
}
function result(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
async function read<T extends { expiresAt: number }>(env: Env, kind: "preview" | "chain", value: unknown): Promise<T> {
  const stored = await env.SUBSCRIPTIONS.get(`rola:${kind}:${id(value)}`);
  if (!stored || encoder.encode(stored).length > 2 * requestBytes) throw new ApiError(404, "rola_not_found", "记录不存在或已过期，请重新生成。");
  const data = JSON.parse(stored) as T;
  if (data.expiresAt <= Date.now()) throw new ApiError(404, "rola_not_found", "记录已过期，请重新生成。");
  return data;
}
async function write(env: Env, kind: "preview" | "chain", value: unknown, ttl: number) {
  const serialized = JSON.stringify(value);
  if (encoder.encode(serialized).length > 2 * requestBytes) throw new ApiError(413, "rola_record_too_large", "存储记录超过 1 MiB。");
  const key = token();
  await env.SUBSCRIPTIONS.put(`rola:${kind}:${key}`, serialized, { expirationTtl: ttl });
  return key;
}

function profileResponse(chain: Chain, profile: string, userinfo: string | null, target: RolaTarget = "mihomo-config") {
  const extension = target === "mihomo-config" ? "yaml" : target === "shadowrocket-config" ? "conf" : "txt";
  const filename = target === "mihomo-config" ? `${chain.name || "Flacier-Rola"}.${extension}` : rolaMobileFiles[target];
  const headers = new Headers({ "Content-Type": target === "mihomo-config" ? "text/yaml; charset=utf-8" : "text/plain; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
    "Content-Disposition": `attachment; ${target === "mihomo-config" ? "" : `filename="${filename}"; `}filename*=UTF-8''${encodeURIComponent(filename)}`,
    "Vary": "User-Agent", "X-Subscription-Target": target,
    "Profile-Update-Interval": "6", "X-Subscription-Source-Mode": chain.source.kind, "X-Rola-Expires-At": new Date(chain.expiresAt).toISOString() });
  if (userinfo) headers.set("Subscription-Userinfo", userinfo);
  return new Response(profile, { headers });
}

function synchronizedBaseId(sources: unknown[], origin: string): string | null {
  for (const source of sources) {
    if (!source || typeof source !== "object" || !("type" in source) || source.type !== "subscription"
      || !("value" in source) || typeof source.value !== "string") continue;
    let link: URL;
    try { link = new URL(source.value); } catch { continue; }
    if (link.origin !== origin) continue;
    const match = /^\/s\/([\w-]{16})(?:\/[\w-]+)?$/u.exec(link.pathname);
    if (!match || link.search || link.hash || link.username || link.password || sources.length !== 1) {
      throw new ApiError(400, "sync_base_required", "本站链接请先在本地合并并同步，再单独作为 Rola 基础订阅。");
    }
    return match[1];
  }
  return null;
}

export async function routeCloudRola(request: Request, url: URL, env: Env): Promise<Response | null> {
  if (!url.pathname.startsWith("/api/rola/") && !url.pathname.startsWith("/r/")) return null;
  try {
    const allowed = await env.SUBSCRIPTION_RATE_LIMITER.limit({ key: `rola:${request.headers.get("CF-Connecting-IP") || "unknown"}` });
    if (!allowed.success) return new Response(null, { status: 429, headers: { "Retry-After": "60", "Cache-Control": "no-store" } });
    if (request.method === "POST" && url.pathname.startsWith("/api/rola/")) {
      if (request.headers.get("content-type")?.split(";")[0] !== "application/json") throw new ApiError(415, "json_required", "仅接受 JSON 请求。");
      const input = await readRequestObject(request, requestBytes);
      if (url.pathname === "/api/rola/preview") {
        if (typeof input.target !== "string" || !isOutputTarget(input.target) || !isMihomoConfigTarget(input.target)) throw new ApiError(400, "rola_target_unsupported", "Rola 串联请选择 Mihomo 完整配置。");
        let source: Source;
        let profile: string;
        let stats: Built["generated"]["nodeStats"];
        let usage: Built["generated"]["usage"] = { combined: null, sources: [] };
        let name = typeof input.name === "string" ? input.name.trim().slice(0, 64) : "Flacier-Rola";
        if (typeof input.snapshot === "string") {
          if (input.sources !== undefined) throw new ApiError(400, "ambiguous_rola_source", "快照与订阅来源不能同时提交。");
          profile = input.snapshot;
          const nodes = boundedProfile(profile);
          stats = { read: nodes.length, output: nodes.length, skipped: 0 };
          source = { kind: "snapshot", profile };
        } else {
          if (!Array.isArray(input.sources) || input.sources.length > 3) throw new ApiError(413, "rola_too_many_sources", "Rola 串联最多支持 3 个机场来源。");
          const syncId = synchronizedBaseId(input.sources, url.origin);
          const built = syncId ? await buildSynchronizedSubscription(env, syncId, input.target, { sourceBytes, nodes: nodeLimit })
            : await buildSubscription(env, { sources: input.sources, target: input.target, name: input.name, sourceUserAgent: input.sourceUserAgent,
            fallbackMode: "error", dnsMode: "doh", dnsSettings: defaultDnsSettings, rulePreset: "flacier", updateIntervalHours: 6 }, { sourceBytes, nodes: nodeLimit });
          profile = built.generated.content;
          source = syncId ? { kind: "local-sync", id: syncId } : { kind: "convert", config: built.config };
          stats = built.generated.nodeStats;
          usage = built.generated.usage;
          name = typeof input.name === "string" && input.name.trim() ? name : built.profileName;
        }
        const nodes = boundedProfile(profile);
        const userinfo = usage.combined ? formatSubscriptionUserinfo(usage.combined) : null;
        const baseId = await write(env, "preview", { source, target: input.target, name, profile, userinfo, expiresAt: Date.now() + previewTtl * 1000 } satisfies Preview, previewTtl);
        return result({ baseId, nodes, sourceMode: source.kind, result: { nodeStats: stats, usage } });
      }
      if (url.pathname === "/api/rola/chains") {
        const preview = await read<Preview>(env, "preview", input.baseId);
        const additions = input.additionalExits === undefined ? [] : input.additionalExits;
        if (!Array.isArray(additions) || additions.length > 7) throw new ApiError(400, "invalid_rola_additional_exits", "其他家宽必须是最多 7 项的列表。");
        const settings = { ...exitFields(input.exit), additionalExits: additions.map(exitFields), connectionMode: input.connectionMode,
          groupName: input.groupName, policyGroup: input.policyGroup, residentialNodeNames: input.residentialNodeNames, upstreamNode: input.upstreamNode, rules: input.rules, dns: input.dns };
        const generated = prepare(preview.profile, settings);
        // Only validated, explicitly selected fields can enter a persistent cloud record.
        parseRolaSettings(settings);
        const revokeToken = token();
        const expiresAt = Date.now() + chainTtl * 1000;
        const chain: Chain = { source: preview.source, target: preview.target, name: preview.name, settings, expiresAt, revokeHash: await hashText(revokeToken) };
        const chainId = await write(env, "chain", chain, chainTtl);
        await withSubscriptionRecovery(env.SUBSCRIPTIONS, `rola:${chainId}`, async () => profileResponse(chain, generated.profile, preview.userinfo));
        const universalUrl = `${url.origin}/r/${chainId}`;
        return result({ url: `${universalUrl}.yaml`, universalUrl,
          ...(settings.connectionMode === "direct" ? { shadowrocketConfigUrl: `${universalUrl}/${rolaMobileFiles["shadowrocket-config"]}` } : {}),
          summary: generated.summary, revokeToken,
          expiresAt: new Date(expiresAt).toISOString(), sourceMode: preview.source.kind }, 201);
      }
      if (url.pathname === "/api/rola/revoke") {
        let link: URL;
        try { link = new URL(String(input.url)); } catch { throw new ApiError(400, "invalid_rola_url", "请填写云端串联订阅链接。"); }
        const match = /^\/r\/([\w-]{32})(?:\.yaml)?$/u.exec(link.pathname);
        if (!match || link.origin !== url.origin) throw new ApiError(400, "invalid_rola_url", "请填写本站云端串联订阅链接。");
        const chain = await read<Chain>(env, "chain", match[1]);
        const digest = await hashText(typeof input.revokeToken === "string" ? input.revokeToken : "");
        if (!timingSafeEqual(encoder.encode(digest), encoder.encode(chain.revokeHash))) throw new ApiError(403, "rola_revoke_denied", "删除码不匹配，订阅未改变。");
        await env.SUBSCRIPTIONS.delete(`rola:chain:${match[1]}`);
        await env.SUBSCRIPTIONS.delete(await subscriptionRecoveryKey(`rola:${match[1]}`));
        for (const target of ["shadowrocket", "shadowrocket-config"]) {
          await env.SUBSCRIPTIONS.delete(await subscriptionRecoveryKey(`rola:${match[1]}:${target}`));
        }
        return result({ deleted: true });
      }
    }
    const match = /^\/r\/([\w-]{32})(?:\.yaml|\/(?:Flacier-Mobile\.conf|Flacier-Mobile-Nodes\.txt))?$/u.exec(url.pathname);
    if (match && ["GET", "HEAD"].includes(request.method)) {
      const chain = await read<Chain>(env, "chain", match[1]);
      const target = rolaRequestTarget(request, url);
      requireRolaTarget(chain.settings, target);
      // Validate the source before consulting rendered output: removal, quota changes and
      // new nodes must invalidate the fast path even during its short freshness window.
      const synchronized = chain.source.kind === "local-sync" ? await readSynchronizedSubscription(env, chain.source.id) : undefined;
      const freshOutput = synchronized ? { freshForMs: 6 * 3_600_000,
        revision: await hashText(JSON.stringify([env.CF_VERSION_METADATA?.id ?? "local", target, chain.settings, synchronized])) } : undefined;
      const recoveryId = `rola:${match[1]}${target === "mihomo-config" ? "" : `:${target}`}`;
      const response = await withSubscriptionRecovery(env.SUBSCRIPTIONS, recoveryId, async () => {
        let profile: string;
        let userinfo: string | null = null;
        if (chain.source.kind === "snapshot") profile = chain.source.profile;
        else {
          const config = chain.source.kind === "convert" ? chain.source.config : synchronized?.config;
          if (!config) throw new ApiError(400, "sync_base_required", "同步基础订阅不存在。");
          const built = await buildSubscription(env, { ...config, target: chain.target }, { sourceBytes, nodes: nodeLimit }, synchronized?.localSync.sources);
          profile = built.generated.content;
          if (built.generated.usage.combined) userinfo = formatSubscriptionUserinfo(built.generated.usage.combined);
        }
        const content = await renderRolaTarget(env, prepare(profile, chain.settings), chain.settings, target);
        if (encoder.encode(content).length > requestBytes) throw new ApiError(413, "rola_output_too_large", "家宽输出不能超过 512 KiB，请减少节点或规则。");
        const rendered = profileResponse(chain, content, userinfo, target);
        if (synchronized) rendered.headers.set("X-Subscription-Synced-At", synchronized.localSync.readAt);
        return rendered;
      }, freshOutput);
      const syncedAt = response.headers.get("X-Subscription-Synced-At");
      if (syncedAt) response.headers.set("X-Subscription-Last-Success", syncedAt);
      if (synchronized) {
        if (Date.now() - Date.parse(synchronized.localSync.readAt) > synchronized.config.updateIntervalHours * 3_600_000) {
          response.headers.set("X-Subscription-Refresh-Status", "sync-overdue");
          response.headers.set("Warning", '110 - "Local synchronization is overdue; nodes and quota are from the last successful sync"');
        }
      }
      return request.method === "HEAD" ? new Response(null, { headers: response.headers }) : response;
    }
    throw new ApiError(404, "rola_not_found", "Rola 接口或请求方法不存在。");
  } catch (error) {
    if (error instanceof ApiError) return result({ error: error.code, message: error.message, ...(error.upstream ? { upstream: error.upstream } : {}) }, error.status);
    // Never include upstream bodies, YAML parsing diagnostics, settings, or bearer links in errors/logs.
    return result({ error: "cloud_rola_failed", message: "云端串联处理失败，请稍后重试；不会改变当前代理或返回直连替代配置。" }, 500);
  }
}
