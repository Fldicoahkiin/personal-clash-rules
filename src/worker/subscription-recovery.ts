import { ApiError } from "./api-error";
import { hashText } from "./secrets";
import type { SubscriptionEnv } from "./types";

const lifetime = 86400;
const retryable = new Set(["source_unreachable", "source_failed", "source_redirect_limit", "source_response_too_large", "no_nodes_found"]);
type Snapshot = { savedAt: number; content: string; headers: [string, string][] };

export async function subscriptionRecoveryKey(identity: string) {
  return `last-good:${await hashText(identity)}`;
}

// Store whole validated outputs, never merge failed source results into a working profile.
export async function withSubscriptionRecovery(
  storage: SubscriptionEnv["SUBSCRIPTIONS"], identity: string, build: () => Promise<Response>,
): Promise<Response> {
  const key = await subscriptionRecoveryKey(identity);
  let previous: Snapshot | null = null;
  let storageAvailable = true;
  try {
    const raw = await storage.get(key);
    if (raw && raw.length <= 2_000_000) {
      const value = JSON.parse(raw) as Snapshot;
      if (Number.isFinite(value.savedAt) && typeof value.content === "string" && Array.isArray(value.headers)) previous = value;
    }
  } catch { storageAvailable = false; }
  let response: Response;
  try { response = await build(); }
  catch (error) {
    if (!(error instanceof ApiError) || !retryable.has(error.code) || !previous
      || Date.now() - previous.savedAt > lifetime * 1000 || previous.savedAt > Date.now()) throw error;
    const headers = new Headers(previous.headers);
    headers.set("X-Subscription-Refresh-Status", "last-good");
    headers.set("X-Subscription-Refresh-Error", error.code);
    headers.set("X-Subscription-Last-Success", new Date(previous.savedAt).toISOString());
    headers.set("Cache-Control", "no-store");
    headers.set("Warning", '110 - "Upstream refresh failed; nodes and quota are from last successful conversion"');
    return new Response(previous.content, { headers });
  }
  if (response.status !== 200 || response.headers.get("x-subscription-source-mode") === "mihomo-provider") return response;
  response.headers.set("X-Subscription-Refresh-Status", "fresh");
  response.headers.set("X-Subscription-Last-Success", new Date().toISOString());
  // KV permits one write/second per key. A minute between snapshots also bounds write cost.
  if (!previous || Date.now() - previous.savedAt >= 60000) {
    try {
      const content = await response.clone().text();
      if (new TextEncoder().encode(content).length > 1_800_000) throw new Error("Snapshot too large");
      await storage.put(key, JSON.stringify({ savedAt: Date.now(), content, headers: [...response.headers] } satisfies Snapshot), { expirationTtl: lifetime });
    } catch { storageAvailable = false; }
  }
  if (!storageAvailable) response.headers.set("X-Subscription-Recovery-Storage", "unavailable");
  return response;
}
