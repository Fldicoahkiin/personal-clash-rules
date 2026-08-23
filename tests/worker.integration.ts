import { env, exports } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { parse } from "yaml";

import worker from "../src/worker";
import { refreshDueProfiles, routeSubscriptionRequest } from "../src/worker/subscriptions";
import { finishRefresh, startRefresh } from "../src/worker/subscription-store";
import { normalizeSources } from "../src/worker/sub-store";
import { managedProfileUrlPlaceholder } from "../src/worker/surge-profile";
import type { SubscriptionEnv } from "../src/worker/types";

const authorization = { Authorization: "Bearer worker-test-token" };
const testEnv = env as typeof env & { DB: D1Database };

async function createProfile(name = "Flacier") {
  const response = await exports.default.fetch("https://example.com/api/manage/profiles", {
    method: "POST",
    headers: { ...authorization, "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  expect(response.status).toBe(201);
  const data = await response.json<{ profile: { id: string; name: string } }>();
  return data.profile;
}

async function addSource(
  profileId: string,
  source: { name: string; type: "subscription" | "node"; value: string },
) {
  const response = await exports.default.fetch(
    `https://example.com/api/manage/profiles/${profileId}/sources`,
    {
      method: "POST",
      headers: { ...authorization, "Content-Type": "application/json" },
      body: JSON.stringify(source),
    },
  );
  expect(response.status).toBe(201);
}

describe("Worker entrypoint", () => {
  it("returns a private health response with security headers", async () => {
    const response = await exports.default.fetch("https://example.com/health");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      service: "personal-clash-rules",
    });
  });

  it("opens the management page from the subscription domain root", async () => {
    const response = await worker.fetch(
      new Request("https://sub.flacier.com/") as Parameters<typeof worker.fetch>[0],
      testEnv,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://sub.flacier.com/manage");
  });

  it("prevents Cloudflare from injecting scripts into HTML", async () => {
    const response = await exports.default.fetch("https://example.com/");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-cache, no-transform");
  });

  it("rejects state-changing methods", async () => {
    const response = await exports.default.fetch("https://example.com/", {
      method: "POST",
    });

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD");
  });

  it("requires authentication for subscription management", async () => {
    const response = await exports.default.fetch("https://example.com/api/manage/profiles");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "authentication_required",
      message: "Authentication required",
    });
  });

  it("reports the management session without an expected 401 response", async () => {
    const signedOut = await exports.default.fetch(
      "https://example.com/api/manage/session",
    );
    expect(signedOut.status).toBe(200);
    expect(signedOut.headers.get("cache-control")).toBe("no-store");
    await expect(signedOut.json()).resolves.toEqual({ authenticated: false });

    const signedIn = await exports.default.fetch(
      "https://example.com/api/manage/session",
      { headers: authorization },
    );
    expect(signedIn.status).toBe(200);
    await expect(signedIn.json()).resolves.toEqual({ authenticated: true });
  });

  it("reports database, converter, and refresh status to an authenticated manager", async () => {
    const response = await exports.default.fetch(
      "https://example.com/api/manage/status",
      { headers: authorization },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      database: "ready",
      converter: "ready",
      refreshSchedule: "0 */6 * * *",
    });
  });

  it("reports a pending migration when the latest profile columns are missing", async () => {
    const database = {
      prepare(query: string) {
        if (query.includes("include_pattern")) {
          throw new Error("no such column: include_pattern");
        }
        return {
          async first() {
            return { id: "existing-profile" };
          },
        };
      },
    } as unknown as D1Database;
    const request = new Request("https://example.com/api/manage/status", {
      headers: { Authorization: "Bearer test-token" },
    });

    const response = await routeSubscriptionRequest(
      request,
      new URL(request.url),
      {
        DB: database,
        CONTROL_API_TOKEN: "test-token",
      } as SubscriptionEnv,
    );

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toMatchObject({
      database: "migration_required",
    });
  });

  it("bounds the number of profiles handled by one scheduled refresh", async () => {
    let selectedLimit: number | null = null;
    const statement = {
      bind(limit: number) {
        selectedLimit = limit;
        return this;
      },
      async all() {
        return { results: [] };
      },
    };
    const database = {
      prepare() {
        return statement;
      },
    } as unknown as D1Database;

    await refreshDueProfiles({ DB: database } as SubscriptionEnv);

    expect(selectedLimit).toBe(5);
  });

  it("deduplicates identical nodes and makes repeated names unique", async () => {
    const first = {
      type: "ss",
      server: "one.example",
      port: 8388,
      cipher: "aes-128-gcm",
      password: "first",
      name: "Tokyo",
      id: 0,
      _subName: "合并订阅",
    };
    const nodes = await normalizeSources(testEnv, {
      profileName: "合并订阅",
      subscriptionUrls: [],
      nodes: [JSON.stringify({
        proxies: [
          first,
          { ...first, id: 1 },
          {
            ...first,
            server: "two.example",
            password: "second",
            name: "Tokyo · 2",
            id: 2,
          },
          {
            ...first,
            server: "three.example",
            password: "third",
            id: 3,
          },
          {
            ...first,
            server: "policy-name.example",
            password: "reserved",
            name: "AI",
            id: 4,
          },
        ],
      })],
    });

    expect(nodes).toEqual([
        {
          type: "ss",
          server: "one.example",
          port: 8388,
          cipher: "aes-128-gcm",
          password: "first",
          name: "Tokyo",
        },
        {
          type: "ss",
          server: "two.example",
          port: 8388,
          cipher: "aes-128-gcm",
          password: "second",
          name: "Tokyo · 2",
        },
        {
          type: "ss",
          server: "three.example",
          port: 8388,
          cipher: "aes-128-gcm",
          password: "third",
          name: "Tokyo · 3",
        },
        {
          type: "ss",
          server: "policy-name.example",
          port: 8388,
          cipher: "aes-128-gcm",
          password: "reserved",
          name: "AI · 2",
        },
    ]);
  });

  it("uses the personal subscription name when no profile name is provided", async () => {
    const response = await exports.default.fetch(
      "https://example.com/api/manage/profiles",
      {
        method: "POST",
        headers: { ...authorization, "Content-Type": "application/json" },
        body: "{}",
      },
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      profile: { name: "个人订阅" },
    });
  });

  it("creates a profile and stores subscription sources encrypted", async () => {
    const profile = await createProfile("旅行设备");
    const secretUrl = "https://provider.example/subscription?token=private-value";
    const response = await exports.default.fetch(
      `https://example.com/api/manage/profiles/${profile.id}/sources`,
      {
        method: "POST",
        headers: { ...authorization, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "主订阅",
          type: "subscription",
          value: secretUrl,
        }),
      },
    );

    expect(response.status).toBe(201);
    const responseText = await response.text();
    expect(responseText).not.toContain(secretUrl);
    expect(responseText).not.toContain("private-value");

    const stored = await testEnv.DB.prepare(`
      SELECT secret_ciphertext, secret_iv
      FROM sources
      WHERE profile_id = ?
    `).bind(profile.id).first<{ secret_ciphertext: string; secret_iv: string }>();
    expect(stored?.secret_ciphertext).toBeTruthy();
    expect(stored?.secret_ciphertext).not.toContain("private-value");
    expect(stored?.secret_iv).toBeTruthy();

    const detail = await exports.default.fetch(
      `https://example.com/api/manage/profiles/${profile.id}`,
      { headers: authorization },
    );
    const detailText = await detail.text();
    expect(detail.status).toBe(200);
    expect(detailText).toContain("主订阅");
    expect(detailText).not.toContain("secret_ciphertext");
    expect(detailText).not.toContain("private-value");
  });

  it("renames a subscription profile", async () => {
    const profile = await createProfile("旧名称");
    const response = await exports.default.fetch(
      `https://example.com/api/manage/profiles/${profile.id}`,
      {
        method: "PATCH",
        headers: { ...authorization, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "旅行设备" }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      profile: { id: profile.id, name: "旅行设备" },
    });

    const stored = await testEnv.DB.prepare("SELECT name FROM profiles WHERE id = ?")
      .bind(profile.id)
      .first<{ name: string }>();
    expect(stored?.name).toBe("旅行设备");
  });

  it("stores node processing settings and rejects invalid patterns", async () => {
    const profile = await createProfile("节点处理");
    const initial = await exports.default.fetch(
      `https://example.com/api/manage/profiles/${profile.id}`,
      { headers: authorization },
    );
    await expect(initial.json()).resolves.toMatchObject({
      profile: {
        nodeSettings: {
          includePattern: "",
          excludePattern: "",
          renameRules: [],
          sortMode: "source",
        },
      },
    });

    const invalid = await exports.default.fetch(
      `https://example.com/api/manage/profiles/${profile.id}/node-settings`,
      {
        method: "PUT",
        headers: { ...authorization, "Content-Type": "application/json" },
        body: JSON.stringify({
          includePattern: "(",
          excludePattern: "",
          renameRules: [],
          sortMode: "source",
        }),
      },
    );
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({
      error: "invalid_node_pattern",
    });

    const settings = {
      includePattern: "US|JP",
      excludePattern: "backup",
      renameRules: [
        { pattern: "^🇺🇸\\s*", replacement: "" },
        { pattern: "^🇯🇵\\s*", replacement: "" },
      ],
      sortMode: "name-asc",
    };
    const update = await exports.default.fetch(
      `https://example.com/api/manage/profiles/${profile.id}/node-settings`,
      {
        method: "PUT",
        headers: { ...authorization, "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      },
    );
    expect(update.status).toBe(200);
    await expect(update.json()).resolves.toEqual({ nodeSettings: settings });

    const detail = await exports.default.fetch(
      `https://example.com/api/manage/profiles/${profile.id}`,
      { headers: authorization },
    );
    await expect(detail.json()).resolves.toMatchObject({
      profile: { nodeSettings: settings },
    });
  });

  it("disables and enables a subscription source", async () => {
    const profile = await createProfile();
    await addSource(profile.id, {
      name: "机场",
      type: "subscription",
      value: "https://provider.example/subscription",
    });
    const source = await testEnv.DB.prepare(`
      SELECT id
      FROM sources
      WHERE profile_id = ?
    `).bind(profile.id).first<{ id: string }>();
    expect(source).toBeTruthy();

    const disable = await exports.default.fetch(
      `https://example.com/api/manage/sources/${source?.id}`,
      {
        method: "PATCH",
        headers: { ...authorization, "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: false }),
      },
    );
    expect(disable.status).toBe(200);
    await expect(disable.json()).resolves.toMatchObject({
      source: { id: source?.id, enabled: false },
    });

    const profiles = await exports.default.fetch(
      "https://example.com/api/manage/profiles",
      { headers: authorization },
    );
    const profilesData = await profiles.json<{
      profiles: Array<{ id: string; enabledSourceCount: number }>;
    }>();
    expect(profilesData.profiles.find((item) => item.id === profile.id)).toMatchObject({
      enabledSourceCount: 0,
    });

    const enable = await exports.default.fetch(
      `https://example.com/api/manage/sources/${source?.id}`,
      {
        method: "PATCH",
        headers: { ...authorization, "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      },
    );
    expect(enable.status).toBe(200);
    await expect(enable.json()).resolves.toMatchObject({
      source: { id: source?.id, enabled: true },
    });
  });

  it("updates a source without returning its replacement value", async () => {
    const profile = await createProfile();
    await addSource(profile.id, {
      name: "旧机场",
      type: "subscription",
      value: "https://old.example/subscription",
    });
    const before = await testEnv.DB.prepare(`
      SELECT id, secret_ciphertext
      FROM sources
      WHERE profile_id = ?
    `).bind(profile.id).first<{ id: string; secret_ciphertext: string }>();
    expect(before).toBeTruthy();

    const replacement = "https://new.example/subscription?token=replacement-secret";
    const response = await exports.default.fetch(
      `https://example.com/api/manage/sources/${before?.id}`,
      {
        method: "PATCH",
        headers: { ...authorization, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "新机场", value: replacement }),
      },
    );
    expect(response.status).toBe(200);
    const responseText = await response.text();
    expect(responseText).toContain("新机场");
    expect(responseText).not.toContain(replacement);
    expect(responseText).not.toContain("replacement-secret");

    const after = await testEnv.DB.prepare(`
      SELECT name, secret_ciphertext
      FROM sources
      WHERE id = ?
    `).bind(before?.id).first<{ name: string; secret_ciphertext: string }>();
    expect(after?.name).toBe("新机场");
    expect(after?.secret_ciphertext).not.toBe(before?.secret_ciphertext);
    expect(after?.secret_ciphertext).not.toContain("replacement-secret");

    const rename = await exports.default.fetch(
      `https://example.com/api/manage/sources/${before?.id}`,
      {
        method: "PATCH",
        headers: { ...authorization, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "仅改名称" }),
      },
    );
    expect(rename.status).toBe(200);
    const renamed = await testEnv.DB.prepare(`
      SELECT name, secret_ciphertext
      FROM sources
      WHERE id = ?
    `).bind(before?.id).first<{ name: string; secret_ciphertext: string }>();
    expect(renamed).toEqual({
      name: "仅改名称",
      secret_ciphertext: after?.secret_ciphertext,
    });
  });

  it("deletes a profile and its subscription data", async () => {
    const profile = await createProfile();
    await addSource(profile.id, {
      name: "机场",
      type: "subscription",
      value: "https://provider.example/subscription",
    });

    const response = await exports.default.fetch(
      `https://example.com/api/manage/profiles/${profile.id}`,
      { method: "DELETE", headers: authorization },
    );
    expect(response.status).toBe(204);

    const storedProfile = await testEnv.DB.prepare("SELECT id FROM profiles WHERE id = ?")
      .bind(profile.id)
      .first<{ id: string }>();
    const storedSource = await testEnv.DB.prepare("SELECT id FROM sources WHERE profile_id = ?")
      .bind(profile.id)
      .first<{ id: string }>();
    expect(storedProfile).toBeNull();
    expect(storedSource).toBeNull();
  });

  it("publishes normalized nodes through a stable revocable link", async () => {
    const profile = await createProfile();
    await addSource(profile.id, {
      name: "手工节点",
      type: "node",
      value: "ss://YWVzLTEyOC1nY206c2VjcmV0@us.example.com:8388#US-01",
    });
    const refresh = await exports.default.fetch(
      `https://example.com/api/manage/profiles/${profile.id}/refresh`,
      { method: "POST", headers: authorization },
    );
    expect(refresh.status).toBe(200);

    const linkResponse = await exports.default.fetch(
      `https://example.com/api/manage/profiles/${profile.id}/links`,
      {
        method: "POST",
        headers: { ...authorization, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "手机" }),
      },
    );
    expect(linkResponse.status).toBe(201);
    const linkData = await linkResponse.json<{
      link: { id: string };
      universalUrl: string;
      urls: Record<string, string>;
    }>();
    expect(linkData.universalUrl).toMatch(
      /^https:\/\/example\.com\/s\/[A-Za-z0-9_-]{43}$/,
    );
    expect(linkData.urls.mihomo).toMatch(
      /^https:\/\/example\.com\/s\/[A-Za-z0-9_-]{43}\/mihomo$/,
    );
    expect(linkData.urls["surge-config"]).toMatch(
      /^https:\/\/example\.com\/s\/[A-Za-z0-9_-]{43}\/surge-config$/,
    );

    const rawToken = linkData.urls.mihomo.split("/").at(-2);
    const storedLink = await testEnv.DB.prepare(`
      SELECT token_hash, token_ciphertext, token_iv
      FROM share_links
      WHERE id = ?
    `).bind(linkData.link.id).first<{
      token_hash: string;
      token_ciphertext: string;
      token_iv: string;
    }>();
    expect(storedLink?.token_hash).not.toBe(rawToken);
    expect(storedLink?.token_ciphertext).not.toContain(String(rawToken));
    expect(storedLink?.token_iv).toBeTruthy();

    const universalDefault = await exports.default.fetch(linkData.universalUrl, {
      headers: { "User-Agent": "unknown-client/1.0" },
    });
    expect(universalDefault.status).toBe(200);
    expect(universalDefault.headers.get("x-subscription-target")).toBe("mihomo");
    expect(universalDefault.headers.get("vary")).toBe("User-Agent");
    expect(parse(await universalDefault.text())).toMatchObject({
      proxies: [expect.objectContaining({ name: "US-01" })],
    });

    const universalSurge = await exports.default.fetch(linkData.universalUrl, {
      headers: { "User-Agent": "Surge iOS/3004" },
    });
    expect(universalSurge.status).toBe(200);
    expect(universalSurge.headers.get("x-subscription-target")).toBe("surge");
    await expect(universalSurge.text()).resolves.toContain(
      "US-01=ss,us.example.com,8388",
    );

    const managedUrl = `${linkData.universalUrl}?target=surge-config`;
    const managed = await exports.default.fetch(managedUrl);
    expect(managed.status).toBe(200);
    expect(managed.headers.get("x-subscription-target")).toBe("surge-config");
    const managedText = await managed.text();
    expect(managedText).toContain(`#!MANAGED-CONFIG ${managedUrl}`);
    expect(managedText).not.toContain(managedProfileUrlPlaceholder);

    const invalidTarget = await exports.default.fetch(
      `${linkData.universalUrl}?target=unknown`,
    );
    expect(invalidTarget.status).toBe(400);

    const published = await exports.default.fetch(linkData.urls.mihomo);
    expect(published.status).toBe(200);
    const etag = published.headers.get("etag");
    const lastModified = published.headers.get("last-modified");
    expect(etag).toBeTruthy();
    expect(lastModified).toBeTruthy();
    expect(published.headers.get("cache-control")).toBe(
      "private, max-age=300, stale-while-revalidate=3600",
    );

    const unchanged = await exports.default.fetch(linkData.urls.mihomo, {
      headers: { "If-None-Match": etag ?? "" },
    });
    expect(unchanged.status).toBe(304);

    const revoke = await exports.default.fetch(
      `https://example.com/api/manage/links/${linkData.link.id}`,
      { method: "DELETE", headers: authorization },
    );
    expect(revoke.status).toBe(204);
    const revoked = await exports.default.fetch(linkData.urls.mihomo);
    expect(revoked.status).toBe(404);
    expect(revoked.headers.get("cache-control")).toBe("no-store");
  });

  it("refreshes once and generates only the requested client format", async () => {
    const profile = await createProfile("设备订阅");
    const subscriptionUrl = "https://provider.example/sub?token=refresh-secret";
    const remoteUri = "ss://YWVzLTEyOC1nY206cmVtb3Rl@one.example:443#remote";
    const nodeUri = "vless://00000000-0000-4000-8000-000000000000@node.example:443#manual";
    await addSource(profile.id, {
      name: "机场",
      type: "subscription",
      value: subscriptionUrl,
    });
    await addSource(profile.id, {
      name: "手工节点",
      type: "node",
      value: nodeUri,
    });
    const settings = await exports.default.fetch(
      `https://example.com/api/manage/profiles/${profile.id}/node-settings`,
      {
        method: "PUT",
        headers: { ...authorization, "Content-Type": "application/json" },
        body: JSON.stringify({
          includePattern: "remote|manual",
          excludePattern: "",
          renameRules: [
            { pattern: "remote", replacement: "Tokyo 10" },
            { pattern: "manual", replacement: "Tokyo 2" },
          ],
          sortMode: "name-asc",
        }),
      },
    );
    expect(settings.status).toBe(200);

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      expect(String(input)).toBe(subscriptionUrl);
      return new Response(remoteUri);
    });

    try {
      const response = await exports.default.fetch(
        `https://example.com/api/manage/profiles/${profile.id}/refresh`,
        { method: "POST", headers: authorization },
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        refresh: {
          status: "succeeded",
          nodeCount: 2,
        },
      });
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      const snapshot = await testEnv.DB.prepare(`
        SELECT nodes_json, node_count
        FROM normalized_nodes
        WHERE profile_id = ?
      `).bind(profile.id).first<{ nodes_json: string; node_count: number }>();
      expect(snapshot?.node_count).toBe(2);
      expect(JSON.parse(snapshot?.nodes_json ?? "[]")).toEqual([
        expect.objectContaining({ name: "Tokyo 2" }),
        expect.objectContaining({ name: "Tokyo 10" }),
      ]);
      const link = await exports.default.fetch(
        `https://example.com/api/manage/profiles/${profile.id}/links`,
        {
          method: "POST",
          headers: { ...authorization, "Content-Type": "application/json" },
          body: JSON.stringify({ name: "默认链接" }),
        },
      );
      const linkData = await link.json<{ urls: Record<string, string> }>();
      const configResponse = await exports.default.fetch(
        linkData.urls["mihomo-config"],
      );
      expect(configResponse.status).toBe(200);
      const config = parse(await configResponse.text()) as Record<string, unknown>;
      expect(config.proxies).toHaveLength(2);
      expect(config["proxy-groups"]).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "AI" }),
      ]));
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      const detail = await exports.default.fetch(
        `https://example.com/api/manage/profiles/${profile.id}`,
        { headers: authorization },
      );
      await expect(detail.json()).resolves.toMatchObject({
        profile: {
          nodeCount: 2,
          normalizedAt: expect.any(String),
          latestRefresh: {
            status: "succeeded",
            nodeCount: 2,
          },
        },
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });
  it("retains only the eight latest refresh runs", async () => {
    const profile = await createProfile("刷新记录");

    for (let index = 0; index < 10; index += 1) {
      const refresh = await startRefresh(testEnv.DB, profile.id);
      await finishRefresh(testEnv.DB, {
        id: refresh.id,
        status: "succeeded",
        nodeCount: index + 1,
      });
    }

    const stored = await testEnv.DB.prepare(`
      SELECT COUNT(*) AS count
      FROM refresh_runs
      WHERE profile_id = ?
    `).bind(profile.id).first<{ count: number }>();
    expect(stored?.count).toBe(8);

    const detail = await exports.default.fetch(
      `https://example.com/api/manage/profiles/${profile.id}`,
      { headers: authorization },
    );
    const data = await detail.json<{
      profile: { refreshHistory: Array<{ nodeCount: number }> };
    }>();
    expect(data.profile.refreshHistory).toHaveLength(8);
    expect(data.profile.refreshHistory[0]?.nodeCount).toBe(10);
    expect(data.profile.refreshHistory.at(-1)?.nodeCount).toBe(3);
  });

  it("rejects a target that cannot represent the stored nodes", async () => {
    const profile = await createProfile("兼容性检查");
    await addSource(profile.id, {
      name: "WireGuard",
      type: "node",
      value: "wireguard://private-key@wg.example.com:51820?public-key=public-key&ip=10.0.0.2%2F32#WG-01",
    });
    const refresh = await exports.default.fetch(
      `https://example.com/api/manage/profiles/${profile.id}/refresh`,
      { method: "POST", headers: authorization },
    );
    expect(refresh.status).toBe(200);

    const link = await exports.default.fetch(
      `https://example.com/api/manage/profiles/${profile.id}/links`,
      {
        method: "POST",
        headers: { ...authorization, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "兼容性" }),
      },
    );
    const linkData = await link.json<{ urls: Record<string, string> }>();
    const unsupported = await exports.default.fetch(linkData.urls.surge);
    expect(unsupported.status).toBe(422);
    await expect(unsupported.json()).resolves.toMatchObject({
      error: "target_unsupported",
    });
    const mihomo = await exports.default.fetch(linkData.urls.mihomo);
    expect(mihomo.status).toBe(200);

  });
});
