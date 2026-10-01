import { describe, expect, it, vi } from "vitest";
import { parse } from "yaml";

import {
  normalizeSourceBundle,
  normalizeSources,
  combineSubscriptionUsage,
  produceTarget,
} from "../src/worker/sub-store";
import { routeSubscriptionRequest } from "../src/worker/subscriptions";
import type { SubscriptionEnv } from "../src/worker/types";

const env = {} as SubscriptionEnv;

describe("native subscription converter", () => {
  it("round-trips WebSocket and gRPC transport options through Shadowrocket URIs", async () => {
    const proxies = [
      { name: "vless-ws", type: "vless", server: "node.example", port: 443, uuid: "00000000-0000-4000-8000-000000000000", tls: true, network: "ws", servername: "sni.example", "skip-cert-verify": true, alpn: ["h2", "http/1.1"], "ws-opts": { path: "/socket?ed=2048", headers: { Host: "host.example" } } },
      { name: "trojan-grpc", type: "trojan", server: "node.example", port: 443, password: "dummy", sni: "sni.example", network: "grpc", "grpc-opts": { "grpc-service-name": "service-name" } },
    ];
    const output = await produceTarget(env, proxies, "shadowrocket");
    const nodes = await normalizeSources(env, { profileName: "", subscriptionUrls: [], nodes: output.trim().split("\n") });
    expect(nodes[0]).toMatchObject(proxies[0]);
    expect(nodes[1]).toMatchObject(proxies[1]);
  });

  it("preserves explicit unlimited expiry but never invents missing metadata", () => {
    const quota = { upload: "10", download: "20", total: "100", expire: "0" };
    expect(combineSubscriptionUsage([quota, quota])).toEqual({ upload: "20", download: "40", total: "200", expire: "0" });
    expect(combineSubscriptionUsage([quota, { ...quota, expire: "1800000000" }])?.expire).toBe("1800000000");
    expect(combineSubscriptionUsage([quota, undefined])).toBeUndefined();
  });

  it("keeps VLESS and Hysteria2 transport fields when converting for Verge and FlClash", async () => {
    const proxies = [
      { name: "JP", type: "vless", server: "node.example", port: 443, uuid: "00000000-0000-4000-8000-000000000000", tls: true, network: "ws", servername: "sni.example", "client-fingerprint": "chrome", "packet-encoding": "xudp", "ws-opts": { path: "/path?ed=2048", headers: { Host: "host.example" } }, "reality-opts": { "public-key": "key", "short-id": "" } },
      { name: "SG", type: "hysteria2", server: "hy.example", port: 443, password: "dummy", sni: "sni.example", "skip-cert-verify": true, ports: "443,500-600", obfs: "salamander", "obfs-password": "dummy-obfs" },
    ];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ proxies, dns: { enable: true, nameserver: ["https://dns.example/dns-query"] }, ipv6: false })));
    try {
      const normalized = await normalizeSourceBundle(env, { profileName: "", subscriptionUrls: ["https://provider.example/sub"], nodes: [] });
      for (const target of ["clash-verge-config", "flclash-config"] as const) {
        const output = parse(await produceTarget(env, normalized.nodes, target, "flacier", 6, "upstream", normalized.upstreamConfig));
        expect(output.proxies).toEqual(proxies.map((node) => ({ ...node, name: `${node.name} · 2` })));
        expect(output.dns.nameserver).toEqual(["https://dns.example/dns-query"]);
        expect(output["proxy-providers"]).toBeUndefined();
      }
    } finally { fetchSpy.mockRestore(); }
  });
  it("rate limits subscription creation by client IP", async () => {
    const limit = vi.fn().mockResolvedValue({ success: false });
    const response = await routeSubscriptionRequest(
      new Request("https://rules.flacier.com/api/subscriptions", {
        method: "POST",
        headers: { "CF-Connecting-IP": "203.0.113.7" },
      }),
      new URL("https://rules.flacier.com/api/subscriptions"),
      { SUBSCRIPTION_RATE_LIMITER: { limit } } as SubscriptionEnv,
    );

    expect(limit).toHaveBeenCalledWith({ key: "api/subscriptions:203.0.113.7" });
    expect(response?.status).toBe(429);
    expect(response?.headers.get("retry-after")).toBe("60");
    await expect(response?.json()).resolves.toMatchObject({ error: "rate_limited" });
  });

  it("parses local URI nodes and keeps names unique", async () => {
    const userInfo = btoa("aes-128-gcm:secret");
    const nodes = await normalizeSources(env, {
      profileName: "个人订阅",
      subscriptionUrls: [],
      nodes: [
        `ss://${userInfo}@us.example.com:8388#US-01`,
        "vless://00000000-0000-4000-8000-000000000000@jp.example.com:443?security=reality&sni=example.com&pbk=public-key&sid=01#JP-01",
      ],
    });

    expect(nodes).toEqual([
      expect.objectContaining({
        name: "US-01",
        type: "ss",
        server: "us.example.com",
        port: 8388,
      }),
      expect.objectContaining({
        name: "JP-01",
        type: "vless",
        server: "jp.example.com",
        tls: true,
        "reality-opts": expect.objectContaining({ "public-key": "public-key" }),
      }),
    ]);
  });

  it("fetches each remote source once while normalizing", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("trojan://secret@tw.example.com:443?sni=tw.example.com#TW-01", {
        headers: {
          "Content-Disposition": "attachment; filename*=UTF-8''%E6%9C%BA%E5%9C%BA%E8%AE%A2%E9%98%85.yaml",
        },
      }),
    );
    try {
      const nodes = await normalizeSources(env, {
        profileName: "个人订阅",
        sourceUserAgent: "ClashParty/2.0",
        subscriptionUrls: ["https://provider.example/subscription"],
        nodes: [],
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://provider.example/subscription",
        expect.objectContaining({
          headers: { "User-Agent": "ClashParty/2.0" },
        }),
      );
      expect(nodes).toEqual([
        expect.objectContaining({ name: "TW-01", type: "trojan" }),
      ]);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("stops reading a remote source after the response limit", async () => {
    let pulls = 0;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new ReadableStream({
        pull(controller) {
          pulls += 1;
          controller.enqueue(new Uint8Array(64 * 1024));
          if (pulls === 40) controller.close();
        },
      })),
    );
    try {
      await expect(normalizeSourceBundle(env, {
        profileName: "个人订阅",
        subscriptionUrls: ["https://provider.example/subscription"],
        nodes: [],
      })).rejects.toMatchObject({ code: "source_response_too_large" });

      expect(pulls).toBeLessThan(40);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("inherits a profile name from one upstream response", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("trojan://secret@tw.example.com:443?sni=tw.example.com#TW-01", {
        headers: {
          "Content-Disposition": "attachment; filename*=UTF-8''%E6%9C%BA%E5%9C%BA%E8%AE%A2%E9%98%85.yaml",
        },
      }),
    );
    try {
      const result = await normalizeSourceBundle(env, {
        profileName: "",
        subscriptionUrls: ["https://provider.example/subscription"],
        nodes: [],
      });

      expect(result.profileName).toBe("机场订阅");
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("combines complete usage from multiple upstream subscriptions", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const host = new URL(String(input)).hostname;
      return new Response(`trojan://secret@${host}:443?sni=${host}#${host}`, {
        headers: {
          "Subscription-Userinfo": host === "first.example"
            ? "upload=1024; download=2048; total=107374182400; expire=1805938734"
            : "upload=4096; download=8192; total=214748364800; expire=1837474734",
        },
      });
    });
    try {
      const result = await normalizeSourceBundle(env, {
        profileName: "合并订阅",
        subscriptionUrls: [
          "https://first.example/subscription",
          "https://second.example/subscription",
        ],
        nodes: [],
      });

      expect(result.nodes).toHaveLength(2);
      expect(result.subscriptionUsage).toEqual({
        upload: "5120",
        download: "10240",
        total: "322122547200",
        expire: "1805938734",
      });
      expect(result.remoteMetadata).toEqual([
        expect.objectContaining({ usageStatus: "available" }),
        expect.objectContaining({ usageStatus: "available" }),
      ]);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("does not publish a partial total when one upstream omits usage", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const host = new URL(String(input)).hostname;
      return new Response(`trojan://secret@${host}:443?sni=${host}#${host}`, {
        headers: host === "first.example"
          ? { "Subscription-Userinfo": "upload=1024; download=2048; total=107374182400" }
          : {},
      });
    });
    try {
      const result = await normalizeSourceBundle(env, {
        profileName: "合并订阅",
        subscriptionUrls: [
          "https://first.example/subscription",
          "https://second.example/subscription",
        ],
        nodes: [],
      });

      expect(result.subscriptionUsage).toBeUndefined();
      expect(result.remoteMetadata.map((source) => source.usageStatus)).toEqual([
        "available",
        "missing",
      ]);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("renders only the requested target from normalized nodes", async () => {
    const nodes = [{
      name: "US-01",
      type: "ss",
      server: "us.example.com",
      port: 8388,
      cipher: "aes-128-gcm",
      password: "secret",
    }];

    const mihomo = parse(await produceTarget(env, nodes, "mihomo-config")) as {
      proxies: unknown[];
      rules: string[];
    };
    const surge = await produceTarget(env, nodes, "surge-config");
    const qx = await produceTarget(env, nodes, "quantumult-x");

    expect(mihomo.proxies).toHaveLength(1);
    expect(mihomo.rules).toContain("MATCH,DEFAULT");
    expect(surge).toContain("[Proxy]\nUS-01=ss,us.example.com,8388");
    expect(qx).toContain("shadowsocks=us.example.com:8388");
  });
});
