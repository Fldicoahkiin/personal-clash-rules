import { env, exports } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";

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
      urls: Record<string, string>;
    }>();
    expect(linkData.urls.mihomo).toMatch(/^https:\/\/example\.com\/s\/[A-Za-z0-9_-]{43}\/mihomo$/);
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
      profile: { links: Array<{ id: string; urls: Record<string, string> }> };
    }>();
    expect(profileData.profile.links[0].urls.mihomo).toBe(linkData.urls.mihomo);

    const published = await exports.default.fetch(linkData.urls.mihomo);
    expect(published.status).toBe(200);
    expect(published.headers.get("etag")).toBe(outputData.etag);
    expect(published.headers.get("cache-control")).toBe("private, max-age=300, stale-while-revalidate=3600");
    await expect(published.text()).resolves.toBe(output);

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
        return Response.json({
          status: "success",
          data: { par_res: `${body.client} generated output` },
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
        targetCount: 13,
      });
      expect(data.refresh.targets).toContain("mihomo");
      expect(data.refresh.targets).toContain("sing-box");

      const preview = converterBodies[0];
      expect(preview.url).toBe(subscriptionUrl);
      expect(preview.content).toBe(nodeUri);
      expect(preview.mergeSources).toBe("remoteFirst");
      const parseBodies = converterBodies.slice(1);
      expect(parseBodies).toHaveLength(13);
      expect(parseBodies.every((body) => (
        typeof body.data === "string" && body.data.startsWith("proxies:\n")
      ))).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(14);

      const storedOutputs = await testEnv.DB.prepare(`
        SELECT COUNT(*) AS count
        FROM generated_outputs
        WHERE profile_id = ?
      `).bind(profile.id).first<{ count: number }>();
      expect(storedOutputs?.count).toBe(13);

      const detail = await exports.default.fetch(
        `https://example.com/api/manage/profiles/${profile.id}`,
        { headers: authorization },
      );
      const detailData = await detail.json<{
        profile: { latestRefresh: { status: string; nodeCount: number; targetCount: number } };
      }>();
      expect(detailData.profile.latestRefresh).toMatchObject({
        status: "succeeded",
        nodeCount: 2,
        targetCount: 13,
      });
    } finally {
      fetchSpy.mockRestore();
    }
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
        return Response.json({
          status: "success",
          data: { par_res: body.client === "Surge" ? "" : `${body.client} output` },
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
          targetCount: 12,
          unavailableTargets: ["surge"],
        },
      });

      const outputs = await testEnv.DB.prepare(`
        SELECT target, content
        FROM generated_outputs
        WHERE profile_id = ?
        ORDER BY target
      `).bind(profile.id).all<{ target: string; content: string }>();
      expect(outputs.results).toHaveLength(12);
      expect(outputs.results.some((output) => output.target === "surge")).toBe(false);
      expect(outputs.results.every((output) => output.content.length > 0)).toBe(true);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
