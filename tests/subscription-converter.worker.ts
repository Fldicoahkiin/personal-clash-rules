import { describe, expect, it, vi } from "vitest";
import { parse } from "yaml";

import {
  normalizeSourceBundle,
  normalizeSources,
  produceTarget,
} from "../src/worker/sub-store";
import type { SubscriptionEnv } from "../src/worker/types";

const env = {} as SubscriptionEnv;

describe("native subscription converter", () => {
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

  it("does not combine usage from multiple upstream subscriptions", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const host = new URL(String(input)).hostname;
      return new Response(`trojan://secret@${host}:443?sni=${host}#${host}`, {
        headers: {
          "Subscription-Userinfo": "upload=1024; download=2048; total=107374182400",
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
      expect(result.subscriptionUserinfo).toBeUndefined();
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
