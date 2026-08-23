import { env, exports } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { parse } from "yaml";

import { finishRefresh, startRefresh } from "../src/worker/subscription-store";
import { normalizeSources } from "../src/worker/sub-store";
import { managedProfileUrlPlaceholder } from "../src/worker/surge-profile";

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
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      expect(String(input)).toBe("https://sub-store.example/healthz");
      const headers = new Headers(init?.headers);
      expect(headers.get("cf-access-client-id")).toBe("sub-store-client-id");
      expect(headers.get("cf-access-client-secret")).toBe("sub-store-client-secret");
      return new Response("ok");
    });

    try {
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
    } finally {
      fetchSpy.mockRestore();
    }
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
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({
      status: "success",
      data: {
        processed: [
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
      },
    }));

    try {
      const nodes = await normalizeSources(testEnv, {
        profileName: "合并订阅",
        subscriptionUrls: [],
        nodes: ["ss://local-test"],
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
    } finally {
      fetchSpy.mockRestore();
    }
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

  it("publishes generated output behind a stable revocable link", async () => {
    const profile = await createProfile();
    const output = "proxies:\n  - name: test-node\n    type: ss\n";
    const outputResponse = await exports.default.fetch(
      `https://example.com/api/manage/profiles/${profile.id}/outputs/mihomo`,
      {
        method: "PUT",
        headers: { ...authorization, "Content-Type": "application/json" },
        body: JSON.stringify({ content: output }),
      },
    );
    expect(outputResponse.status).toBe(200);
    const outputData = await outputResponse.json<{ etag: string }>();
    const managedOutput = `#!MANAGED-CONFIG ${managedProfileUrlPlaceholder} interval=21600 strict=false\n[General]\n`;
    const managedOutputResponse = await exports.default.fetch(
      `https://example.com/api/manage/profiles/${profile.id}/outputs/surge-config`,
      {
        method: "PUT",
        headers: { ...authorization, "Content-Type": "application/json" },
        body: JSON.stringify({ content: managedOutput }),
      },
    );
    expect(managedOutputResponse.status).toBe(200);
    const surgeNodes = "test-node = ss, example.com, 443\n";
    const surgeOutputResponse = await exports.default.fetch(
      `https://example.com/api/manage/profiles/${profile.id}/outputs/surge`,
      {
        method: "PUT",
        headers: { ...authorization, "Content-Type": "application/json" },
        body: JSON.stringify({ content: surgeNodes }),
      },
    );
    expect(surgeOutputResponse.status).toBe(200);

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
    expect(linkData.urls.mihomo).toMatch(/^https:\/\/example\.com\/s\/[A-Za-z0-9_-]{43}\/mihomo$/);
    expect(linkData.urls["mihomo-config"]).toMatch(
      /^https:\/\/example\.com\/s\/[A-Za-z0-9_-]{43}\/mihomo-config$/,
    );
    expect(linkData.urls["surge-config"]).toMatch(
      /^https:\/\/example\.com\/s\/[A-Za-z0-9_-]{43}\/surge-config$/,
    );
    expect(linkData.urls["sing-box-config"]).toMatch(
      /^https:\/\/example\.com\/s\/[A-Za-z0-9_-]{43}\/sing-box-config$/,
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

    const profileDetail = await exports.default.fetch(
      `https://example.com/api/manage/profiles/${profile.id}`,
      { headers: authorization },
    );
    const profileData = await profileDetail.json<{
      profile: {
        links: Array<{
          id: string;
          universalUrl: string;
          urls: Record<string, string>;
        }>;
      };
    }>();
    expect(profileData.profile.links[0].urls.mihomo).toBe(linkData.urls.mihomo);
    expect(profileData.profile.links[0].universalUrl).toBe(linkData.universalUrl);

    const universalDefault = await exports.default.fetch(linkData.universalUrl, {
      headers: { "User-Agent": "unknown-client/1.0" },
    });
    expect(universalDefault.status).toBe(200);
    expect(universalDefault.headers.get("x-subscription-target")).toBe("mihomo");
    expect(universalDefault.headers.get("vary")).toBe("User-Agent");
    await expect(universalDefault.text()).resolves.toBe(output);

    const universalSurge = await exports.default.fetch(linkData.universalUrl, {
      headers: { "User-Agent": "Surge iOS/3004" },
    });
    expect(universalSurge.status).toBe(200);
    expect(universalSurge.headers.get("x-subscription-target")).toBe("surge");
    await expect(universalSurge.text()).resolves.toBe(surgeNodes);

    const universalManagedUrl = `${linkData.universalUrl}?target=surge-config`;
    const universalManaged = await exports.default.fetch(universalManagedUrl, {
      headers: { "User-Agent": "curl/8" },
    });
    expect(universalManaged.status).toBe(200);
    expect(universalManaged.headers.get("x-subscription-target")).toBe("surge-config");
    await expect(universalManaged.text()).resolves.toBe(
      managedOutput.replace(managedProfileUrlPlaceholder, universalManagedUrl),
    );

    const invalidUniversalTarget = await exports.default.fetch(
      `${linkData.universalUrl}?target=unknown`,
    );
    expect(invalidUniversalTarget.status).toBe(400);

    const published = await exports.default.fetch(linkData.urls.mihomo);
    expect(published.status).toBe(200);
    expect(published.headers.get("etag")).toBe(outputData.etag);
    const lastModified = published.headers.get("last-modified");
    expect(lastModified).toBeTruthy();
    expect(published.headers.get("cache-control")).toBe("private, max-age=300, stale-while-revalidate=3600");
    await expect(published.text()).resolves.toBe(output);

    const unchangedSince = await exports.default.fetch(linkData.urls.mihomo, {
      headers: { "If-Modified-Since": lastModified ?? "" },
    });
    expect(unchangedSince.status).toBe(304);

    const managedPublished = await exports.default.fetch(linkData.urls["surge-config"]);
    expect(managedPublished.status).toBe(200);
    expect(managedPublished.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    const managedPublishedEtag = managedPublished.headers.get("etag");
    expect(managedPublishedEtag).toBeTruthy();
    await expect(managedPublished.text()).resolves.toBe(
      managedOutput.replace(managedProfileUrlPlaceholder, linkData.urls["surge-config"]),
    );
    const managedUnchanged = await exports.default.fetch(linkData.urls["surge-config"], {
      headers: { "If-None-Match": managedPublishedEtag ?? "" },
    });
    expect(managedUnchanged.status).toBe(304);

    const unchanged = await exports.default.fetch(linkData.urls.mihomo, {
      headers: { "If-None-Match": outputData.etag },
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

    const revokedUniversal = await exports.default.fetch(linkData.universalUrl);
    expect(revokedUniversal.status).toBe(404);
  });

  it("refreshes every client output through Sub-Store", async () => {
    const profile = await createProfile("设备订阅");
    const subscriptionUrl = "https://provider.example/sub?token=refresh-secret";
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

    const converterBodies: Array<Record<string, unknown>> = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      converterBodies.push(body);
      const headers = new Headers(init?.headers);
      expect(headers.get("cf-access-client-id")).toBe("sub-store-client-id");
      expect(headers.get("cf-access-client-secret")).toBe("sub-store-client-secret");

      if (url.endsWith("/api/preview/sub?target=JSON")) {
        return Response.json({
          status: "success",
          data: {
            processed: [
              { name: "remote", type: "ss", server: "one.example", port: 443 },
              { name: "manual", type: "vless", server: "node.example", port: 443 },
            ],
          },
        });
      }

      if (url.endsWith("/api/proxy/parse")) {
        const client = String(body.client);
        return Response.json({
          status: "success",
          data: {
            par_res: client === "Mihomo" || client === "Stash"
              ? `proxies:\n  - name: US-01\n    type: ss\n    server: one.example\n    port: 443\n    cipher: aes-128-gcm\n    password: test\n`
              : client === "Egern"
                ? `proxies:\n  - shadowsocks:\n      name: US-01\n      method: aes-128-gcm\n      server: one.example\n      port: 443\n      password: test\n`
              : client === "Surge" || client === "Surfboard"
                ? `US-01 = ss, one.example, 443, encrypt-method=aes-128-gcm, password=test`
                : client === "Loon"
                  ? `US-01=shadowsocks,one.example,443,aes-128-gcm,\"test\",udp=true`
                  : client === "sing-box"
                    ? JSON.stringify({
                      outbounds: [{
                        type: "shadowsocks",
                        tag: "US-01",
                        server: "one.example",
                        server_port: 443,
                        method: "aes-128-gcm",
                        password: "test",
                      }],
                    })
                    : `${client} generated output`,
          },
        });
      }

      return new Response(null, { status: 404 });
    });

    try {
      const response = await exports.default.fetch(
        `https://example.com/api/manage/profiles/${profile.id}/refresh`,
        { method: "POST", headers: authorization },
      );
      expect(response.status).toBe(200);
      const data = await response.json<{
        refresh: { status: string; nodeCount: number; targetCount: number; targets: string[] };
      }>();
      expect(data.refresh).toMatchObject({
        status: "succeeded",
        nodeCount: 2,
        targetCount: 20,
      });
      expect(data.refresh.targets).toContain("mihomo");
      expect(data.refresh.targets).toContain("mihomo-config");
      expect(data.refresh.targets).toContain("stash-config");
      expect(data.refresh.targets).toContain("surge-config");
      expect(data.refresh.targets).toContain("surfboard-config");
      expect(data.refresh.targets).toContain("loon-config");
      expect(data.refresh.targets).toContain("egern-config");
      expect(data.refresh.targets).toContain("sing-box-config");
      expect(data.refresh.targets).toContain("sing-box");

      const preview = converterBodies[0];
      expect(preview.url).toBe(subscriptionUrl);
      expect(preview.content).toBe(nodeUri);
      expect(preview.mergeSources).toBe("remoteFirst");
      const parseBodies = converterBodies.slice(1);
      expect(parseBodies).toHaveLength(20);
      expect(parseBodies.every((body) => (
        typeof body.data === "string" && body.data.startsWith("proxies:\n")
      ))).toBe(true);
      const transformedData = String(parseBodies[0]?.data);
      expect(transformedData.indexOf("name: Tokyo 2")).toBeLessThan(
        transformedData.indexOf("name: Tokyo 10"),
      );
      expect(fetchSpy).toHaveBeenCalledTimes(21);

      const storedOutputs = await testEnv.DB.prepare(`
        SELECT COUNT(*) AS count
        FROM generated_outputs
        WHERE profile_id = ?
      `).bind(profile.id).first<{ count: number }>();
      expect(storedOutputs?.count).toBe(20);

      const completeOutput = await testEnv.DB.prepare(`
        SELECT content, content_type
        FROM generated_outputs
        WHERE profile_id = ? AND target = 'mihomo-config'
      `).bind(profile.id).first<{ content: string; content_type: string }>();
      expect(completeOutput?.content_type).toBe("text/yaml; charset=utf-8");
      const completeConfig = parse(completeOutput?.content ?? "") as Record<string, unknown>;
      expect(completeConfig.proxies).toHaveLength(1);
      expect(completeConfig["proxy-groups"]).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "AI" }),
      ]));
      expect(completeConfig.rules).toEqual(expect.arrayContaining([
        "RULE-SET,ai-openai,AI",
        "MATCH,DEFAULT",
      ]));

      const singBoxOutput = await testEnv.DB.prepare(`
        SELECT content, content_type
        FROM generated_outputs
        WHERE profile_id = ? AND target = 'sing-box-config'
      `).bind(profile.id).first<{ content: string; content_type: string }>();
      expect(singBoxOutput?.content_type).toBe("application/json; charset=utf-8");
      const singBoxConfig = JSON.parse(singBoxOutput?.content ?? "") as Record<string, unknown>;
      expect(singBoxConfig.route).toEqual(expect.objectContaining({ final: "DEFAULT" }));
      expect(singBoxConfig.outbounds).toEqual(expect.arrayContaining([
        expect.objectContaining({ tag: "AI", type: "selector" }),
      ]));

      const detail = await exports.default.fetch(
        `https://example.com/api/manage/profiles/${profile.id}`,
        { headers: authorization },
      );
      const detailData = await detail.json<{
        profile: {
          latestRefresh: { status: string; nodeCount: number; targetCount: number };
          refreshHistory: Array<{
            status: string;
            nodeCount: number;
            targetCount: number;
            finishedAt: string;
          }>;
        };
      }>();
      expect(detailData.profile.latestRefresh).toMatchObject({
        status: "succeeded",
        nodeCount: 2,
        targetCount: 20,
      });
      expect(detailData.profile.refreshHistory).toHaveLength(1);
      expect(detailData.profile.refreshHistory[0]).toMatchObject({
        status: "succeeded",
        nodeCount: 2,
        targetCount: 20,
      });
      expect(detailData.profile.refreshHistory[0].finishedAt).toBeTruthy();
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
        targetCount: 20,
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

  it("does not publish an empty client conversion", async () => {
    const profile = await createProfile("兼容性检查");
    await addSource(profile.id, {
      name: "测试节点",
      type: "node",
      value: "ss://YWVzLTEyOC1nY206bG9jYWwtdGVzdA==@node.example:8388#E2E",
    });
    await testEnv.DB.prepare(`
      INSERT INTO generated_outputs (
        profile_id, target, content, content_type, etag, generated_at
      ) VALUES (?, 'surge', 'stale output', 'text/plain', '"stale"', ?)
    `).bind(profile.id, new Date().toISOString()).run();

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (url.endsWith("/api/preview/sub?target=JSON")) {
        return Response.json({
          status: "success",
          data: {
            processed: [{
              name: "E2E",
              type: "ss",
              server: "node.example",
              port: 8388,
              cipher: "aes-128-gcm",
              password: "local-test",
            }],
          },
        });
      }
      if (url.endsWith("/api/proxy/parse")) {
        const client = String(body.client);
        return Response.json({
          status: "success",
          data: {
            par_res: client === "Surge"
              ? ""
              : client === "Mihomo" || client === "Stash"
                ? `proxies:\n  - name: E2E\n    type: ss\n    server: node.example\n    port: 8388\n    cipher: aes-128-gcm\n    password: local-test\n`
                : client === "Egern"
                  ? `proxies:\n  - shadowsocks:\n      name: E2E\n      method: aes-128-gcm\n      server: node.example\n      port: 8388\n      password: local-test\n`
                : client === "Surfboard"
                  ? "E2E = ss, node.example, 8388, encrypt-method=aes-128-gcm, password=local-test"
                  : client === "Loon"
                    ? `E2E=shadowsocks,node.example,8388,aes-128-gcm,\"local-test\",udp=true`
                    : client === "sing-box"
                      ? JSON.stringify({
                        outbounds: [{
                          type: "shadowsocks",
                          tag: "E2E",
                          server: "node.example",
                          server_port: 8388,
                          method: "aes-128-gcm",
                          password: "local-test",
                        }],
                      })
                      : `${client} output`,
          },
        });
      }
      return new Response(null, { status: 404 });
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
          targetCount: 18,
          unavailableTargets: ["surge-config", "surge"],
        },
      });

      const outputs = await testEnv.DB.prepare(`
        SELECT target, content
        FROM generated_outputs
        WHERE profile_id = ?
        ORDER BY target
      `).bind(profile.id).all<{ target: string; content: string }>();
      expect(outputs.results).toHaveLength(18);
      expect(outputs.results.some((output) => output.target === "surge")).toBe(false);
      expect(outputs.results.every((output) => output.content.length > 0)).toBe(true);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
