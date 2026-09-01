import { exports } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { parse } from "yaml";

type CreatedSubscription = {
  nodeStats: {
    output: number | null;
    read: number | null;
    skipped: number | null;
  };
  profileName: string;
  sourceMode: string;
  target: string;
  usage: {
    combined: {
      upload: string;
      download: string;
      total: string;
      expire?: string;
    } | null;
    sources: Array<{
      name: string;
      status: "available" | "missing" | "client-only";
      usage?: {
        upload: string;
        download: string;
        total: string;
        expire?: string;
      };
    }>;
  };
  url: string;
  universalUrl: string;
};

function nodeUri(name: string, host: string, password: string): string {
  const userInfo = btoa(`aes-128-gcm:${password}`);
  return `ss://${userInfo}@${host}:8388#${name}`;
}

function legacyToken(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return `v1.${btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "")}`;
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

describe("KV-backed subscription links", () => {
  it("stores the configuration behind a short link and renders it on demand", async () => {
    const { data, response } = await createSubscription();
    const responseText = JSON.stringify(data);

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(data.profileName).toBe("Flacier");
    expect(data.nodeStats).toEqual({ read: 1, output: 1, skipped: 0 });
    expect(data.url).toMatch(/^https:\/\/example\.com\/s\/[A-Za-z0-9_-]{16}\/mihomo-config$/u);
    expect(data.universalUrl).toMatch(/^https:\/\/example\.com\/s\/[A-Za-z0-9_-]{16}$/u);
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

  it("loads a short link back into the conversion form", async () => {
    const { data } = await createSubscription({ name: "个人订阅" });
    const response = await exports.default.fetch("https://example.com/api/subscriptions/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: data.url }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      config: {
        name: "个人订阅",
        sources: [expect.objectContaining({ type: "node" })],
      },
      target: "mihomo-config",
    });
  });

  it("keeps previously generated encoded links readable", async () => {
    const config = {
      ...requestBody(),
      version: 1,
      sourceMode: "convert",
      target: undefined,
    };
    const response = await exports.default.fetch(
      `https://example.com/s/${legacyToken(config)}/mihomo-config`,
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("US-01");
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
    expect(data.nodeStats).toEqual({ read: 3, output: 1, skipped: 2 });
  });

  it("inherits the upstream profile name when the custom name is blank", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => (
      new Response(nodeUri("US-01", "us.example.com", "secret"), {
        headers: {
          "Content-Disposition": "attachment; filename*=UTF-8''%E6%9C%BA%E5%9C%BA%E8%AE%A2%E9%98%85.yaml",
        },
      })
    ));
    try {
      const { data } = await createSubscription({
        name: "",
        sources: [{ name: "订阅 1", type: "subscription", value: "https://provider.example/sub" }],
      });

      expect(data.profileName).toBe("机场订阅");
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://provider.example/sub",
        expect.objectContaining({ headers: { "User-Agent": "clash.meta" } }),
      );
    } finally {
      fetchSpy.mockRestore();
    }
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

  it("passes through traffic usage from one upstream subscription", async () => {
    const sourceUrl = "https://provider.example/subscription";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => (
      new Response(nodeUri("US-01", "us.example.com", "secret"), {
        headers: {
          "Subscription-Userinfo": "upload=1024;download=2048; total=107374182400; expire=1805938734",
        },
      })
    ));

    try {
      const { data } = await createSubscription({
        sources: [{ name: "订阅 1", type: "subscription", value: sourceUrl }],
      });
      const published = await exports.default.fetch(data.url);

      expect(published.headers.get("subscription-userinfo")).toBe(
        "upload=1024; download=2048; total=107374182400; expire=1805938734",
      );
      expect(data.usage).toEqual({
        combined: {
          upload: "1024",
          download: "2048",
          total: "107374182400",
          expire: "1805938734",
        },
        sources: [{
          name: "订阅 1",
          status: "available",
          usage: {
            upload: "1024",
            download: "2048",
            total: "107374182400",
            expire: "1805938734",
          },
        }],
      });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("publishes a synthetic total for multiple complete subscriptions", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const host = new URL(String(input)).hostname;
      return new Response(nodeUri(host, host, "secret"), {
        headers: {
          "Subscription-Userinfo": host === "first.example"
            ? "upload=1024; download=2048; total=107374182400; expire=1805938734"
            : "upload=4096; download=8192; total=214748364800; expire=1837474734",
        },
      });
    });

    try {
      const { data } = await createSubscription({
        sources: [
          { name: "机场 A", type: "subscription", value: "https://first.example/sub" },
          { name: "机场 B", type: "subscription", value: "https://second.example/sub" },
        ],
      });
      const published = await exports.default.fetch(data.url);

      expect(published.headers.get("subscription-userinfo")).toBe(
        "upload=5120; download=10240; total=322122547200; expire=1805938734",
      );
      expect(data.usage.combined).toEqual({
        upload: "5120",
        download: "10240",
        total: "322122547200",
        expire: "1805938734",
      });
      expect(data.usage.sources.map((source) => source.status)).toEqual([
        "available",
        "available",
      ]);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("omits a synthetic total when one subscription has no usage", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const host = new URL(String(input)).hostname;
      return new Response(nodeUri(host, host, "secret"), {
        headers: host === "first.example"
          ? { "Subscription-Userinfo": "upload=1024; download=2048; total=107374182400" }
          : {},
      });
    });

    try {
      const { data } = await createSubscription({
        sources: [
          { name: "机场 A", type: "subscription", value: "https://first.example/sub" },
          { name: "机场 B", type: "subscription", value: "https://second.example/sub" },
        ],
      });
      const published = await exports.default.fetch(data.url);

      expect(published.headers.get("subscription-userinfo")).toBeNull();
      expect(data.usage.combined).toBeNull();
      expect(data.usage.sources.map((source) => source.status)).toEqual([
        "available",
        "missing",
      ]);
    } finally {
      fetchSpy.mockRestore();
    }
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
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => (
      init?.method === "HEAD"
        ? new Response(null, {
            headers: {
              "Subscription-Userinfo": "upload=4096; download=8192; total=214748364800; expire=1805938734",
            },
          })
        : new Response(null, { status: 403 })
    ));

    try {
      const { data, response } = await createSubscription({
        fallbackMode: "mihomo-provider",
        name: "",
        rulePreset: "flacier",
        sourceUserAgent: "ClashParty/2.0",
        updateIntervalHours: 12,
        sources: [{ name: "订阅 1", type: "subscription", value: sourceUrl }],
        target: "clash-party-config",
      });
      expect(response.status).toBe(201);
      expect(data.profileName).toBe("Flacierの分流规则");
      expect(data.sourceMode).toBe("mihomo-provider");
      expect(data.nodeStats).toEqual({ read: null, output: null, skipped: null });
      expect(data.usage.sources).toEqual([
        expect.objectContaining({ name: "订阅 1", status: "available" }),
      ]);

      const published = await exports.default.fetch(data.url);
      const config = parse(await published.text()) as {
        "profile-update-interval": number;
        "proxy-providers": Record<string, Record<string, unknown>>;
      };
      expect(published.status).toBe(200);
      expect(published.headers.get("content-disposition")).toContain(
        encodeURIComponent("Flacierの分流规则.yaml"),
      );
      expect(published.headers.get("profile-update-interval")).toBe("12");
      expect(published.headers.get("subscription-userinfo")).toBe(
        "upload=4096; download=8192; total=214748364800; expire=1805938734",
      );
      expect(config["profile-update-interval"]).toBe(12);
      expect(config["proxy-providers"]["订阅 1"]).toMatchObject({
        type: "http",
        url: sourceUrl,
        header: { "User-Agent": ["ClashParty/2.0"] },
      });
      expect(fetchSpy).toHaveBeenCalledTimes(4);
      expect(fetchSpy).toHaveBeenLastCalledWith(
        sourceUrl,
        expect.objectContaining({ method: "HEAD" }),
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("reports client-only usage when a provider source hides its metadata", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 403 }),
    );

    try {
      const { data, response } = await createSubscription({
        fallbackMode: "mihomo-provider",
        sources: [{ name: "机场 A", type: "subscription", value: "https://provider.example/sub" }],
        target: "clash-party-config",
      });

      expect(response.status).toBe(201);
      expect(data.usage).toEqual({
        combined: null,
        sources: [{ name: "机场 A", status: "client-only" }],
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("reports client-direct sources as incompatible with non-Mihomo configs", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 403 }),
    );
    try {
      const { data, response } = await createSubscription({
        fallbackMode: "mihomo-provider",
        sources: [{ name: "订阅 1", type: "subscription", value: "https://provider.example/sub" }],
        target: "surge-config",
      });

      expect(response.status).toBe(422);
      expect(data).toMatchObject({
        error: "source_client_fetch_only",
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("does not silently replace Worker conversion with client fetching", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 403 }),
    );

    try {
      const { data, response } = await createSubscription({
        sources: [{ name: "订阅 1", type: "subscription", value: "https://provider.example/sub" }],
        target: "clash-party-config",
      });

      expect(response.status).toBe(502);
      expect(data).toMatchObject({ error: "source_failed" });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("retries Worker conversion when an upstream becomes readable again", async () => {
    let blocked = true;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      if (blocked) {
        return new Response(null, { status: 403 });
      }
      return init?.method === "HEAD"
        ? new Response(null)
        : new Response(nodeUri("US-01", "us.example.com", "secret"));
    });

    try {
      const { data, response } = await createSubscription({
        fallbackMode: "mihomo-provider",
        sources: [{ name: "订阅 1", type: "subscription", value: "https://provider.example/sub" }],
        target: "clash-party-config",
      });
      expect(response.status).toBe(201);
      expect(data.sourceMode).toBe("mihomo-provider");

      blocked = false;
      const published = await exports.default.fetch(data.url);
      const config = parse(await published.text()) as Record<string, unknown>;

      expect(published.status).toBe(200);
      expect(published.headers.get("x-subscription-source-mode")).toBe("convert");
      expect(config).not.toHaveProperty("proxy-providers");
      expect(config.proxies).toEqual([
        expect.objectContaining({ name: "🇺🇸 US-01" }),
      ]);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
