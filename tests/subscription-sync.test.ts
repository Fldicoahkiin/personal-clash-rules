import { afterEach, expect, it, vi } from "vitest";
import { createSubscriptionSync } from "../src/local/subscription-sync";
import { routeSubscriptionRequest } from "../src/worker/subscriptions";
import { isSyncOverdue } from "../src/worker/subscription-snapshot";
import type { SubscriptionEnv } from "../src/worker/types";

afterEach(() => vi.restoreAllMocks());
it("publishes through the local API, stores management credentials only locally, and reuses its cloud identity after failure", async () => {
  const storage = new Map<string, string>();
  const cloudStorage = new Map<string, string>();
  const envFor = (data: Map<string, string>): SubscriptionEnv => ({
    SUBSCRIPTIONS: { get: async key => data.get(key) ?? null, put: async (key, value) => { data.set(key, value); } },
    SUBSCRIPTION_RATE_LIMITER: { limit: async () => ({ success: true }) },
  });
  const env = envFor(storage), cloud = envFor(cloudStorage);
  const origin = "http://127.0.0.1:25500";
  const now = vi.spyOn(Date, "now").mockReturnValue(Date.now());
  let fail = false;
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    if (fail) throw new Error("connection failed");
    const request = new Request(String(url), init);
    return (await routeSubscriptionRequest(request, new URL(request.url), cloud))!;
  });
  const localUrl = new URL("/api/subscriptions", origin);
  const created = await routeSubscriptionRequest(new Request(localUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sources: [{ type: "node", value: "socks5://test:secret@home.example:9004#Home" }], target: "mihomo-config" }) }), localUrl, env);
  const { url } = await created!.json() as { url: string };
  const sync = createSubscriptionSync({ env, origin, keys: async () => [...storage.keys()].filter(key => key.startsWith("cloud-sync:")) });
  const publish = () => sync.route(new Request(new URL("/api/local/subscriptions/publish", origin), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) }));
  const response = await publish();
  expect(response?.status).toBe(200);
  const result = await response!.json() as { url: string };
  expect(JSON.stringify(result)).not.toContain("managementToken");
  const key = [...storage.keys()].find(key => key.startsWith("cloud-sync:"))!;
  const first = JSON.parse(storage.get(key)!);
  expect(first.managementToken).toHaveLength(32);
  expect(first.nextAttemptAt).toBeGreaterThan(Date.now());
  now.mockReturnValue(Date.now() + 7 * 3_600_000);
  fail = true;
  expect((await publish())?.status).toBe(502);
  const failed = JSON.parse(storage.get(key)!);
  expect(failed.result.url).toBe(result.url);
  expect(failed.id).toBe(first.id);
  expect(failed.error).toBe("cloud_sync_unreachable");
  expect(cloudStorage.get(`subscription:${first.id}`)).not.toContain(first.managementToken);

  const endpoint = new URL("/api/local/subscriptions/publish", origin);
  const listing = await sync.route(new Request(endpoint));
  const tasks = await listing!.json() as { tasks: { localId: string; url: string; error?: string }[] };
  expect(tasks.tasks).toHaveLength(1);
  expect(tasks.tasks[0]).toMatchObject({ url: result.url, error: "cloud_sync_unreachable" });
  expect(JSON.stringify(tasks)).not.toContain(first.managementToken);
  expect(JSON.stringify(tasks)).not.toContain("secret");
  const pause = (paused: boolean) => sync.route(new Request(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ localId: tasks.tasks[0].localId, paused }) }));
  expect((await pause(true))?.status).toBe(200);
  now.mockReturnValue(Date.now() + 3_600_000);
  const attempts = fetchMock.mock.calls.length;
  await sync.refreshDue();
  expect(fetchMock).toHaveBeenCalledTimes(attempts);
  fail = false;
  expect((await pause(false))?.status).toBe(200);
  await sync.refreshDue();
  expect(fetchMock).toHaveBeenCalledTimes(attempts + 1);
  const refreshed = JSON.parse(storage.get(key)!);
  expect(refreshed.result.url).toBe(result.url);
  expect(refreshed.result.syncedAt).not.toBe(first.result.syncedAt);
  expect(refreshed.error).toBeUndefined();
  expect(JSON.parse(cloudStorage.get(`subscription:${first.id}`)!).localSync.readAt).toBe(refreshed.result.syncedAt);
});

it("treats a sync as overdue only after its interval plus a short grace period", () => {
  vi.useFakeTimers({ now: Date.parse("2026-10-19T12:00:00.000Z") });
  expect(isSyncOverdue("2026-10-19T06:00:00.000Z", 6)).toBe(false);
  expect(isSyncOverdue("2026-10-19T05:55:00.000Z", 6)).toBe(false);
  expect(isSyncOverdue("2026-10-19T05:49:00.000Z", 6)).toBe(true);
  vi.useRealTimers();
});
