import { exports } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { parse } from "yaml";

type CreatedSubscription = {
  profileName: string;
  sourceMode: string;
  target: string;
  url: string;
  universalUrl: string;
};

function nodeUri(name: string, host: string, password: string): string {
  const userInfo = btoa(`aes-128-gcm:${password}`);
  return `ss://${userInfo}@${host}:8388#${name}`;
}

function requestBody(overrides: Record<string, unknown> = {}) {
  return {
    name: "Flacier",
    nodeSettings: {
      includePattern: "",
      excludePattern: "",
      renameRules: [],
      sortMode: "source",
    },
    sources: [{
      name: "节点 1",
      type: "node",
      value: nodeUri("US-01", "us.example.com", "private-node-password"),
    }],
    target: "mihomo-config",
    ...overrides,
  };
}

async function createSubscription(
  overrides: Record<string, unknown> = {},
): Promise<{ data: CreatedSubscription; response: Response }> {
  const response = await exports.default.fetch("https://example.com/api/subscriptions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody(overrides)),
  });
  const data = await response.json<CreatedSubscription>();
  return { data, response };
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

  it("removes the management page and management API", async () => {
    const page = await exports.default.fetch("https://example.com/manage", {
      redirect: "manual",
    });
    const api = await exports.default.fetch("https://example.com/api/manage/session");

    expect(page.status).toBe(308);
    expect(page.headers.get("location")).toBe("https://example.com/#subscription");
    expect(api.status).toBe(404);
    await expect(api.json()).resolves.toMatchObject({ error: "api_not_found" });
  });

  it("prevents Cloudflare from injecting scripts into HTML", async () => {
    const response = await exports.default.fetch("https://example.com/");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-cache, no-transform");
    expect(response.headers.get("content-security-policy")).toContain("script-src 'self'");
  });

  it("rejects unsupported methods at the site boundary", async () => {
    const response = await exports.default.fetch("https://example.com/", {
      method: "POST",
    });

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD");
  });
});

describe("stateless subscription links", () => {
  it("encodes the configuration into a fixed link and renders it on demand", async () => {
    const { data, response } = await createSubscription();
    const responseText = JSON.stringify(data);

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(data.profileName).toBe("Flacier");
    expect(data.url).toMatch(/^https:\/\/example\.com\/s\/v1\.[A-Za-z0-9_-]+\/mihomo-config$/u);
    expect(data.universalUrl).toMatch(/^https:\/\/example\.com\/s\/v1\./u);
    expect(responseText).not.toContain("private-node-password");
    expect(responseText).not.toContain("us.example.com");

    const published = await exports.default.fetch(data.url);
    const profile = parse(await published.text()) as {
      proxies: Array<{ name: string; password: string }>;
    };

    expect(published.status).toBe(200);
    expect(published.headers.get("cache-control")).toBe(
      "private, max-age=300, stale-while-revalidate=3600",
    );
    expect(published.headers.get("x-subscription-profile")).toBe("Flacier");
    expect(published.headers.get("x-subscription-target")).toBe("mihomo-config");
    expect(profile.proxies).toEqual([
      expect.objectContaining({
        name: "🇺🇸 US-01",
        password: "private-node-password",
        udp: true,
      }),
    ]);
  });

  it("does not accept a malformed encoded link", async () => {
    const { data } = await createSubscription();
    const url = new URL(data.url);
    const parts = url.pathname.split("/");
    const token = parts[2];
    parts[2] = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
    url.pathname = parts.join("/");

    const response = await exports.default.fetch(url.toString());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: "subscription_not_found",
    });
  });

  it("applies node filters before generating the link", async () => {
    const { data } = await createSubscription({
      nodeSettings: {
        includePattern: "US",
        excludePattern: "backup",
        renameRules: [{ pattern: "US-", replacement: "United States " }],
        sortMode: "name-asc",
      },
      sources: [
        { name: "节点 1", type: "node", value: nodeUri("JP-01", "jp.example.com", "jp") },
        { name: "节点 2", type: "node", value: nodeUri("US-backup", "backup.example.com", "backup") },
        { name: "节点 3", type: "node", value: nodeUri("US-02", "us.example.com", "us") },
      ],
    });

    const published = await exports.default.fetch(data.url);
    const profile = parse(await published.text()) as { proxies: Array<{ name: string }> };

    expect(profile.proxies.map((proxy) => proxy.name)).toEqual(["🇺🇸 United States 02"]);
  });

  it("selects a format from the universal link user agent", async () => {
    const { data } = await createSubscription();
    const response = await exports.default.fetch(data.universalUrl, {
      headers: { "User-Agent": "Shadowrocket/2.2" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("vary")).toBe("User-Agent");
    expect(response.headers.get("x-subscription-target")).toBe("shadowrocket");
  });

  it("returns 304 for an unchanged generated response", async () => {
    const { data } = await createSubscription();
    const first = await exports.default.fetch(data.url);
    const etag = first.headers.get("etag");
    const second = await exports.default.fetch(data.url, {
      headers: { "If-None-Match": etag ?? "" },
    });

    expect(etag).toBeTruthy();
    expect(second.status).toBe(304);
  });

  it("requires remote subscriptions and redirects to stay on public HTTPS", async () => {
    const insecure = await exports.default.fetch("https://example.com/api/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody({
        sources: [{ name: "订阅 1", type: "subscription", value: "http://provider.example/sub" }],
      })),
    });
    expect(insecure.status).toBe(400);
    await expect(insecure.json()).resolves.toMatchObject({
      error: "invalid_subscription_url",
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { Location: "https://127.0.0.1/private" },
      }),
    );
    try {
      const redirected = await exports.default.fetch("https://example.com/api/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody({
          sources: [{ name: "订阅 1", type: "subscription", value: "https://provider.example/sub" }],
        })),
      });
      expect(redirected.status).toBe(400);
      await expect(redirected.json()).resolves.toMatchObject({
        error: "invalid_subscription_url",
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("uses a Mihomo provider when the upstream rejects the Worker with 403", async () => {
    const sourceUrl = "https://provider.example/subscription";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 403 }),
    );

    try {
      const { data, response } = await createSubscription({
        name: "",
        rulePreset: "flacier",
        sources: [{ name: "订阅 1", type: "subscription", value: sourceUrl }],
        target: "clash-party-config",
      });
      expect(response.status).toBe(201);
      expect(data.profileName).toBe("");
      expect(data.sourceMode).toBe("mihomo-provider");

      const published = await exports.default.fetch(data.url);
      const config = parse(await published.text()) as {
        "proxy-providers": Record<string, Record<string, unknown>>;
      };
      expect(published.status).toBe(200);
      expect(config["proxy-providers"]["订阅 1"]).toMatchObject({
        type: "http",
        url: sourceUrl,
      });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
