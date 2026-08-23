import { describe, expect, it, vi } from "vitest";
import { parse } from "yaml";

import { normalizeSources, produceTarget } from "../src/worker/sub-store";
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
      new Response("trojan://secret@tw.example.com:443?sni=tw.example.com#TW-01"),
    );
    try {
      const nodes = await normalizeSources(env, {
        profileName: "个人订阅",
        subscriptionUrls: ["https://provider.example/subscription"],
        nodes: [],
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(nodes).toEqual([
        expect.objectContaining({ name: "TW-01", type: "trojan" }),
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
