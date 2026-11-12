import { timingSafeEqual } from "node:crypto";
import { isMap, isSeq, parseDocument } from "yaml";
import { ApiError } from "./api-error";
import type { prepareRolaProfile } from "./residential-profile";
import { hashText } from "./secrets";
import { readRequestObject } from "./subscriptions";

// The VPS pushes its own monthly interface counter here; the main link shows it as an entry of the residential group.
const usageKey = "vps-usage";
// Pushes arrive every 30 minutes; a record from an earlier month is ignored anyway.
const usageTtl = 40 * 86400;
const gib = 2 ** 30;
const encoder = new TextEncoder();

type Prepared = ReturnType<typeof prepareRolaProfile>;
type VpsUsage = { server: string; month: string; txBytes: number; quotaBytes: number; updatedAt: string };
export type VpsUsageGroup = { name: string; server: string };

function result(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

function parseUsage(input: Record<string, unknown>): Omit<VpsUsage, "updatedAt"> {
  const { server, month, txBytes, quotaBytes } = input;
  if (typeof server !== "string" || !/^[\w.:-]{1,253}$/u.test(server)
    || typeof month !== "string" || !/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(month)
    || typeof txBytes !== "number" || !Number.isSafeInteger(txBytes) || txBytes < 0
    || typeof quotaBytes !== "number" || !Number.isSafeInteger(quotaBytes) || quotaBytes <= 0) {
    throw new ApiError(400, "invalid_vps_usage", "需要 server、month（YYYY-MM）、txBytes 和 quotaBytes。");
  }
  return { server, month, txBytes, quotaBytes };
}

function groupName(usage: Omit<VpsUsage, "updatedAt">): string {
  return `📊 VPS 本月 ${(usage.txBytes / gib).toFixed(1)} / ${Math.round(usage.quotaBytes / gib)} GiB`;
}

export async function routeVpsUsage(request: Request, url: URL,
  env: Pick<Env, "SUBSCRIPTIONS" | "SUBSCRIPTION_RATE_LIMITER"> & { VPS_USAGE_TOKEN_SHA256: string }): Promise<Response | null> {
  if (url.pathname !== "/api/vps-usage") return null;
  try {
    const allowed = await env.SUBSCRIPTION_RATE_LIMITER.limit({ key: `vps-usage:${request.headers.get("CF-Connecting-IP") || "unknown"}` });
    if (!allowed.success) throw new ApiError(429, "rate_limited", "请求过于频繁，请一分钟后再试。");
    if (request.method !== "PUT") throw new ApiError(405, "method_not_allowed", "用量只接受 PUT。");
    const presented = /^Bearer (\S+)$/u.exec(request.headers.get("Authorization") ?? "")?.[1] ?? "";
    if (!timingSafeEqual(encoder.encode(await hashText(presented)), encoder.encode(env.VPS_USAGE_TOKEN_SHA256))) {
      throw new ApiError(401, "vps_usage_denied", "口令不匹配，用量未更新。");
    }
    const usage = parseUsage(await readRequestObject(request, 1024));
    await env.SUBSCRIPTIONS.put(usageKey, JSON.stringify({ ...usage, updatedAt: new Date().toISOString() } satisfies VpsUsage), { expirationTtl: usageTtl });
    return result({ stored: true, group: groupName(usage) });
  } catch (error) {
    if (error instanceof ApiError) return result({ error: error.code, message: error.message }, error.status);
    console.error(JSON.stringify({ event: "vps_usage_failed", error: error instanceof Error ? error.name : "unknown" }));
    return result({ error: "vps_usage_failed", message: "用量未更新，请稍后重试。" }, 500);
  }
}

/** This month's usage as a display group, or null when the VPS has not reported for the current UTC month. */
export async function readVpsUsageGroup(env: Pick<Env, "SUBSCRIPTIONS">, now = new Date()): Promise<VpsUsageGroup | null> {
  const usage = await env.SUBSCRIPTIONS.get<VpsUsage>(usageKey, "json");
  if (!usage || usage.month !== now.toISOString().slice(0, 7)) return null;
  return { name: groupName(usage), server: usage.server };
}

/**
 * Adds the usage as a hidden group listing the nodes that connect to the VPS, and appends it to the residential group,
 * so clients show it as the last entry there instead of as a group of its own.
 */
export function withVpsUsageGroup(prepared: Prepared, group: VpsUsageGroup): Prepared {
  const document = parseDocument(prepared.profile, { prettyErrors: false, uniqueKeys: true });
  const proxies = document.get("proxies", true);
  const groups = document.get("proxy-groups", true);
  if (!isSeq(proxies) || !isSeq(groups)) throw new Error("Invalid prepared profile");
  const members = proxies.items.flatMap(node => isMap(node) && node.get("server") === group.server ? [String(node.get("name"))] : []);
  if (!members.length || groups.items.some(item => isMap(item) && item.get("name") === group.name)) return prepared;
  const anchor = groups.items.findIndex(item => isMap(item) && item.get("name") === prepared.summary.groupName);
  const residential = groups.items[anchor];
  const entries = isMap(residential) ? residential.get("proxies", true) : undefined;
  if (!isSeq(entries)) throw new Error("Invalid residential group");
  entries.add(group.name);
  groups.items.splice(anchor + 1, 0, document.createNode({ name: group.name, type: "select", hidden: true, proxies: members }));
  return { ...prepared, profile: document.toString({ lineWidth: 0 }), toJS: () => document.toJS({ maxAliasCount: 100 }) };
}
