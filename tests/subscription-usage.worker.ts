import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parse } from "yaml";

import { combineSubscriptionUsage, formatSubscriptionUserinfo, type SubscriptionUsage } from "../src/worker/sub-store/usage";

// 卡片上的用量条 = 机场订阅 + 自建节点的月度合计。
const origin = "https://example.com";
const airportUsage = "upload=600000000000; download=1900000000000; total=4294967296000; expire=1900000000";
const vpsUsage = { server: "203.0.113.10", month: "2026-11", txBytes: 107374182400, quotaBytes: 1073741824000 };
const nodeSource = { name: "自建", type: "node", value: "vless://{{UUID_n7qk2x4m}}@203.0.113.10:443?security=reality&sni=www.microsoft.com#self-hosted" };

let client = 0;
let fetchSpy: ReturnType<typeof vi.spyOn>;

function create(sources: Array<Record<string, string>>) {
  client += 1;
  return exports.default.fetch(`${origin}/api/subscriptions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": `198.51.100.${client % 250 + 1}` },
    body: JSON.stringify({ target: "clash-party-config", sources }),
  });
}

function airportSource() {
  return { name: "机场", type: "subscription", value: "https://airport.example/sub" };
}

describe("subscription usage total", () => {
  let created: string[] = [];
  beforeEach(async () => {
    await env.SUBSCRIPTIONS.delete("vps-usage");
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "https://airport.example/sub") {
        return new Response("proxies:\n  - {name: a, type: ss, server: a.example, port: 443, cipher: aes-128-gcm, password: p}\n",
          { headers: { "subscription-userinfo": airportUsage, "content-disposition": "attachment; filename*=UTF-8''airport" } });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
  });
  afterEach(async () => {
    fetchSpy.mockRestore();
    await Promise.all(created.map((key) => env.SUBSCRIPTIONS.delete(key)));
    await env.SUBSCRIPTIONS.delete("vps-usage");
    created = [];
  });

  it("adds the self-hosted monthly counter to the airport quota", async () => {
    await env.SUBSCRIPTIONS.put("vps-usage", JSON.stringify(vpsUsage));
    const response = await create([airportSource(), nodeSource]);
    expect(response.status).toBe(201);
    const body = await response.json() as { usage: { combined: SubscriptionUsage; sources: Array<{ name: string; usage?: SubscriptionUsage }> }; url: string };
    created.push(`subscription:${new URL(body.url).pathname.split("/").filter(Boolean)[1]}`);

    const airport = (await combineSubscriptionUsage([parseUserinfo(airportUsage)]))!;
    expect(body.usage.combined).toEqual({
      upload: airport.upload,
      download: (BigInt(airport.download) + BigInt(vpsUsage.txBytes)).toString(),
      total: (BigInt(airport.total) + BigInt(vpsUsage.quotaBytes)).toString(),
      // 自建节点按月重置、没有到期日，不能拉低机场的到期时间。
      expire: airport.expire,
    });
    expect(body.usage.sources.find((source) => source.name === `VPS ${vpsUsage.server}`)?.usage)
      .toEqual({ upload: "0", download: String(vpsUsage.txBytes), total: String(vpsUsage.quotaBytes) });

    // 客户端读的是响应头，而不是创建接口的 JSON。
    const profile = await exports.default.fetch(body.url, { headers: { "CF-Connecting-IP": `198.51.100.${client % 250 + 1}` } });
    expect(profile.status).toBe(200);
    expect(profile.headers.get("subscription-userinfo")).toBe(formatSubscriptionUserinfo({
      upload: airport.upload,
      download: (BigInt(airport.download) + BigInt(vpsUsage.txBytes)).toString(),
      total: (BigInt(airport.total) + BigInt(vpsUsage.quotaBytes)).toString(),
      expire: airport.expire,
    }));
    expect(profile.headers.get("subscription-userinfo")).toContain(`total=${(BigInt(airport.total) + BigInt(vpsUsage.quotaBytes)).toString()}`);
    expect(profile.headers.get("subscription-userinfo")).toContain(`expire=${airport.expire}`);
  });

  it("keeps the airport quota unchanged when the VPS has not reported", async () => {
    const response = await create([airportSource(), nodeSource]);
    expect(response.status).toBe(201);
    const body = await response.json() as { usage: { combined: SubscriptionUsage; sources: Array<{ name: string }> }; url: string };
    created.push(`subscription:${new URL(body.url).pathname.split("/").filter(Boolean)[1]}`);
    expect(body.usage.combined).toEqual(parseUserinfo(airportUsage));
    expect(body.usage.sources.some((source) => source.name === `VPS ${vpsUsage.server}`)).toBe(false);
  });

  it("ignores a malformed VPS record instead of dropping the usage bar", async () => {
    await env.SUBSCRIPTIONS.put("vps-usage", JSON.stringify({ ...vpsUsage, quotaBytes: 0 }));
    const response = await create([airportSource(), nodeSource]);
    expect(response.status).toBe(201);
    const body = await response.json() as { usage: { combined: SubscriptionUsage }; url: string };
    created.push(`subscription:${new URL(body.url).pathname.split("/").filter(Boolean)[1]}`);
    expect(body.usage.combined).toEqual(parseUserinfo(airportUsage));
  });

  it("does not attach the VPS usage to somebody else's self-hosted nodes", async () => {
    await env.SUBSCRIPTIONS.put("vps-usage", JSON.stringify(vpsUsage));
    // 另一个人自己的机器：是自建节点，但不是推用量的那一台。
    const foreign = { name: "别人的自建", type: "node", value: "vless://{{UUID_m4x8c2qp}}@198.51.100.77:443?security=reality&sni=www.microsoft.com#foreign" };
    const response = await create([airportSource(), foreign]);
    expect(response.status).toBe(201);
    const body = await response.json() as { usage: { combined: SubscriptionUsage; sources: Array<{ name: string }> }; url: string };
    created.push(`subscription:${new URL(body.url).pathname.split("/").filter(Boolean)[1]}`);
    expect(body.usage.combined).toEqual(parseUserinfo(airportUsage));
    expect(body.usage.sources.some((source) => source.name.startsWith("VPS "))).toBe(false);

    // 没有用量节点（那台机器不是他的）；固定 IP 出口照常有，但成员是他自己的节点。
    const profile = parse(await (await exports.default.fetch(body.url, { headers: { "CF-Connecting-IP": `198.51.100.${client % 250 + 1}` } })).text()) as {
      proxies: Array<{ name: string }>; "proxy-groups": Array<{ name: string; proxies?: string[] }>;
    };
    expect(profile.proxies.some((node) => node.name.includes("VPS 本月"))).toBe(false);
    const fixed = profile["proxy-groups"].find((group) => group.name === "🇺🇸 美国固定 IP");
    expect(fixed?.proxies).toEqual(["foreign"]);
    // 机场节点进不了他的固定出口。
    expect(fixed?.proxies ?? []).not.toContain("🇺🇸 美国 a");
  });

  it("leaves a subscription without self-hosted nodes alone", async () => {
    await env.SUBSCRIPTIONS.put("vps-usage", JSON.stringify(vpsUsage));
    const response = await create([airportSource()]);
    expect(response.status).toBe(201);
    const body = await response.json() as { usage: { combined: SubscriptionUsage }; url: string };
    created.push(`subscription:${new URL(body.url).pathname.split("/").filter(Boolean)[1]}`);
    expect(body.usage.combined).toEqual(parseUserinfo(airportUsage));
  });
});

function parseUserinfo(value: string): SubscriptionUsage {
  const fields = Object.fromEntries(value.split(";").map((part) => part.trim().split("=")));
  return { upload: fields.upload, download: fields.download, total: fields.total, expire: fields.expire };
}
