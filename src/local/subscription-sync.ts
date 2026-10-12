import { ApiError } from "../worker/api-error";
import { buildSubscription, readRequestObject, routeSubscriptionRequest } from "../worker/subscriptions";
import { loadRemoteSubscriptionSources } from "../worker/sub-store";
import { randomSubscriptionId } from "../worker/secrets";
import type { SubscriptionEnv } from "../worker/types";

const cloudOrigin = "https://rules.flacier.com";
type SyncRecord = {
  id: string; managementToken: string; localUrl: string; nextAttemptAt: number;
  result?: Record<string, unknown>; error?: string;
  paused?: boolean;
};
type SyncOptions = { env: SubscriptionEnv; origin: string; keys: () => Promise<string[]> };

export function createSubscriptionSync({ env, origin, keys }: SyncOptions) {
  let running = false;
  async function publish(localUrl: string) {
    const url = new URL(localUrl);
    if (url.origin !== origin || !/^\/s\/[\w-]{16}\/[^/]+$/u.test(url.pathname) || url.search || url.hash) {
      throw new ApiError(400, "invalid_local_subscription", "Select a generated subscription from this local server");
    }
    const localId = url.pathname.split("/")[2];
    const key = `cloud-sync:${localId}`;
    const existing = await env.SUBSCRIPTIONS.get(key);
    const record: SyncRecord = existing ? JSON.parse(existing) : {
      id: randomSubscriptionId(), managementToken: randomSubscriptionId() + randomSubscriptionId(), localUrl, nextAttemptAt: Date.now(),
    };
    record.localUrl = localUrl;
    record.paused = false;
    // Persist the identity before sending, so a timed-out upload never needs a different public URL.
    await env.SUBSCRIPTIONS.put(key, JSON.stringify(record));
    if (record.result && typeof record.result.syncedAt === "string" && Date.now() - Date.parse(record.result.syncedAt) < 60_000) return record.result;
    try {
      const resolveUrl = new URL("/api/subscriptions/resolve", origin);
      const resolved = await routeSubscriptionRequest(new Request(resolveUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: localUrl }) }), resolveUrl, env);
      if (!resolved?.ok) throw new ApiError(404, "subscription_not_found", "Local subscription not found");
      const data = await resolved.json() as { config: Awaited<ReturnType<typeof buildSubscription>>["config"]; target: string };
      if (data.config.sourceMode !== "convert") throw new ApiError(422, "sync_requires_conversion", "Client-direct shells cannot be synchronized");
      const sources = await loadRemoteSubscriptionSources(env, data.config.sources.filter(source => source.type === "subscription").map(source => source.value), data.config.sourceUserAgent);
      const config = { ...data.config, fallbackMode: "error" };
      await buildSubscription(env, { ...config, target: data.target }, undefined, sources);
      const response = await fetch(`${cloudOrigin}/api/subscriptions/sync`, {
        method: "POST", headers: { "Content-Type": "application/json" }, redirect: "error", signal: AbortSignal.timeout(60_000),
        body: JSON.stringify({ id: record.id, managementToken: record.managementToken, config, target: data.target, snapshot: { sources, readAt: new Date(Date.now()).toISOString() } }),
      });
      if (!response.ok) {
        // Do not trust remote error text to be free of URLs or credentials.
        throw new ApiError(502, "cloud_sync_failed", `Cloud synchronization returned HTTP ${response.status}; the previous subscription is unchanged`);
      }
      const result = await response.json() as Record<string, unknown>;
      if (result.universalUrl !== `${cloudOrigin}/s/${record.id}` || result.sourceMode !== "local-sync" || typeof result.syncedAt !== "string") {
        throw new ApiError(502, "invalid_sync_response", "Cloud synchronization returned an invalid response");
      }
      record.result = result;
      record.error = undefined;
      record.nextAttemptAt = Date.now() + data.config.updateIntervalHours * 3_600_000;
      await env.SUBSCRIPTIONS.put(key, JSON.stringify(record));
      return result;
    } catch (error) {
      record.error = error instanceof ApiError ? error.code : "cloud_sync_unreachable";
      record.nextAttemptAt = Date.now() + 15 * 60_000;
      await env.SUBSCRIPTIONS.put(key, JSON.stringify(record));
      if (error instanceof ApiError) throw error;
      throw new ApiError(502, "cloud_sync_unreachable", "Cloud synchronization did not complete; the previous subscription is unchanged");
    }
  }
  async function refreshDue() {
    if (running) return;
    running = true;
    try {
      for (const key of await keys()) {
        const raw = await env.SUBSCRIPTIONS.get(key);
        if (!raw) continue;
        const record = JSON.parse(raw) as SyncRecord;
        if (record.paused || record.nextAttemptAt > Date.now()) continue;
        try { await publish(record.localUrl); }
        catch (error) { console.warn(JSON.stringify({ event: "local_subscription_sync_failed", code: error instanceof ApiError ? error.code : "sync_storage_failed" })); }
      }
    } finally { running = false; }
  }
  async function route(request: Request) {
    if (new URL(request.url).pathname !== "/api/local/subscriptions/publish") return null;
    try {
      if (request.method === "GET") {
        const tasks = [];
        for (const key of await keys()) {
          const raw = await env.SUBSCRIPTIONS.get(key);
          if (!raw) continue;
          const record = JSON.parse(raw) as SyncRecord;
          tasks.push({ localId: key.slice(11), name: record.result?.profileName ?? "待同步订阅", url: record.result?.url,
            syncedAt: record.result?.syncedAt, nextAttemptAt: record.nextAttemptAt, paused: record.paused === true, error: record.error });
        }
        return Response.json({ tasks });
      }
      if (request.method !== "POST") throw new ApiError(405, "method_not_allowed", "Use POST for synchronization");
      if (running) throw new ApiError(409, "sync_busy", "A synchronization is already running");
      const body = await readRequestObject(request);
      if (typeof body.paused === "boolean" && typeof body.localId === "string" && /^[\w-]{16}$/u.test(body.localId)) {
        const key = `cloud-sync:${body.localId}`;
        const raw = await env.SUBSCRIPTIONS.get(key);
        if (!raw) throw new ApiError(404, "subscription_not_found", "Synchronization task not found");
        const record = JSON.parse(raw) as SyncRecord;
        await env.SUBSCRIPTIONS.put(key, JSON.stringify({ ...record, paused: body.paused, nextAttemptAt: Date.now() }));
        return Response.json({ paused: body.paused });
      }
      if (typeof body.url !== "string") throw new ApiError(400, "invalid_local_subscription", "A local subscription URL is required");
      running = true;
      try { return Response.json(await publish(body.url)); }
      finally { running = false; }
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      return Response.json({ error: error.code, message: error.message, ...(error.upstream ? { upstream: error.upstream } : {}) }, { status: error.status });
    }
  }
  return { route, refreshDue };
}
