import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { hashText } from "../src/worker/secrets";
import base from "./fixtures/live-shape/subscription-base.json";
import chain from "./fixtures/live-shape/rola-chain.json";

// Stored production records must keep loading and rendering after every deploy.
const chainId = "LiveShapeChain00000000000000001A";
const origin = "https://example.com";
const vpsName = chain.settings.residentialNodeNames[0];
const airportNodes = ["🇯🇵 日本 AWS01", "🇯🇵 日本 AWS08", "🇺🇸 美国 01", "🇺🇸 美国 Hy2 01", "🇸🇬 新加坡 01", "🇭🇰 香港 01", "🇨🇳 台湾 01"];
const secrets = ["fake-pass-01", "fake-pass-02", "fake-acc", "fake-hy2-password", "fake-token"];

let client = 0;
function request(path: string, userAgent: string) {
  return exports.default.fetch(`${origin}${path}`, { headers: { "User-Agent": userAgent, "CF-Connecting-IP": `198.51.100.${client}` } });
}

describe("stored production subscription shape", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(async () => {
    client += 1;
    const recovery = await env.SUBSCRIPTIONS.list({ prefix: "last-good:" });
    await Promise.all(recovery.keys.map(entry => env.SUBSCRIPTIONS.delete(entry.name)));
    await env.SUBSCRIPTIONS.put(`subscription:${chain.source.id}`, JSON.stringify(base));
    await env.SUBSCRIPTIONS.put(`rola:chain:${chainId}`, JSON.stringify(chain));
    fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Stored records must render without upstream requests"));
  });
  afterEach(() => fetchSpy.mockRestore());

  it("renders the desktop profile with every node, the fixed-IP group and gateway rules first", async () => {
    const response = await request(`/r/${chainId}.yaml`, "clash.meta");
    expect(response.status).toBe(200);
    expect(response.headers.get("subscription-userinfo")).toBe("upload=600000000000; download=1900000000000; total=4294967296000");
    expect(response.headers.get("x-subscription-source-mode")).toBe("local-sync");
    expect(response.headers.get("x-subscription-synced-at")).toBe(base.localSync.readAt);
    expect(response.headers.get("x-subscription-refresh-status")).toBe("sync-overdue");
    const text = await response.text();
    const profile = parse(text);
    const names = profile.proxies.map((node: { name: string }) => node.name);
    for (const name of [...airportNodes, vpsName]) expect(names).toContain(name);
    const homes = names.slice(-2);
    expect(homes).toHaveLength(2);
    const fixed = profile["proxy-groups"].find((group: { name: string }) => group.name === chain.settings.groupName);
    expect(fixed.proxies).toEqual([...homes, vpsName]);
    expect(profile.rules[0]).toMatch(/^AND,\(\(IP-CIDR,203\.0\.113\.10\/32,no-resolve\),\(DST-PORT,9004\)\),DIRECT$/u);
    expect(profile.rules[1]).toMatch(/^AND,\(\(IP-CIDR,198\.51\.100\.11\/32,no-resolve\),\(DST-PORT,5782\)\),DIRECT$/u);
    expect(profile.proxies.find((node: { name: string }) => node.name === vpsName)).toMatchObject({ type: "vless", udp: false });
    expect(text).toMatchSnapshot();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("extends a record that clients keep refreshing and still rejects an expired one", async () => {
    const soon = Date.now() + 10 * 86_400_000;
    await env.SUBSCRIPTIONS.put(`rola:chain:${chainId}`, JSON.stringify({ ...chain, expiresAt: soon }));
    const response = await request(`/r/${chainId}.yaml`, "clash.meta");
    expect(response.status).toBe(200);
    const stored = await env.SUBSCRIPTIONS.get<typeof chain>(`rola:chain:${chainId}`, "json");
    expect(stored!.expiresAt).toBeGreaterThan(Date.now() + 89 * 86_400_000);
    expect(stored!.settings).toEqual(chain.settings);
    expect(response.headers.get("x-rola-expires-at")).toBe(new Date(stored!.expiresAt).toISOString());

    await env.SUBSCRIPTIONS.put(`rola:chain:${chainId}`, JSON.stringify({ ...chain, expiresAt: Date.now() - 1000 }));
    expect((await request(`/r/${chainId}.yaml`, "clash.meta")).status).toBe(404);
  });

  it("serves the last good output when the base record fails validation and lets the owner repair it", async () => {
    expect((await request(`/r/${chainId}.yaml`, "clash.meta")).status).toBe(200);
    const token = "repair-token-".padEnd(32, "0");
    const broken = { ...base, localSync: { ...base.localSync, readAt: "not-a-timestamp", managementHash: await hashText(token) } };
    await env.SUBSCRIPTIONS.put(`subscription:${chain.source.id}`, JSON.stringify(broken));

    const recovered = await request(`/r/${chainId}.yaml`, "clash.meta");
    expect(recovered.status).toBe(200);
    expect(recovered.headers.get("x-subscription-refresh-status")).toBe("last-good");
    expect(recovered.headers.get("x-subscription-refresh-error")).toBe("stored_subscription_invalid");

    const recovery = await env.SUBSCRIPTIONS.list({ prefix: "last-good:" });
    await Promise.all(recovery.keys.map(entry => env.SUBSCRIPTIONS.delete(entry.name)));
    const failed = await request(`/r/${chainId}.yaml`, "clash.meta");
    expect(failed.status).toBe(500);
    expect(await failed.json()).toMatchObject({ error: "stored_subscription_invalid" });

    const { localSync, ...config } = base;
    const repaired = await exports.default.fetch(`${origin}/api/subscriptions/sync`, {
      method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": `198.51.100.${client}` },
      body: JSON.stringify({ id: chain.source.id, managementToken: token, target: "clash-party-config", config,
        snapshot: { readAt: new Date().toISOString(), sources: localSync.sources.map(({ content, metadata }) => ({ content, metadata: { profileName: metadata.profileName, usage: metadata.usage } })) } }),
    });
    expect(repaired.status).toBe(200);
    expect((await request(`/r/${chainId}.yaml`, "clash.meta")).status).toBe(200);
  });

  it("announces the base subscription's own update interval", async () => {
    await env.SUBSCRIPTIONS.put(`subscription:${chain.source.id}`, JSON.stringify({ ...base, updateIntervalHours: 12 }));
    const response = await request(`/r/${chainId}.yaml`, "clash.meta");
    expect(response.status).toBe(200);
    expect(response.headers.get("profile-update-interval")).toBe("12");
  });

  it("renders the paired Shadowrocket node list and rules without leaking credentials into the rules", async () => {
    const nodes = await request(`/r/${chainId}/Flacier-Mobile-Nodes.txt`, "Shadowrocket/2100");
    expect(nodes.status).toBe(200);
    const nodeText = await nodes.text();
    const lines = nodeText.trim().split("\n");
    for (const name of [...airportNodes, vpsName]) expect(nodeText).toContain(`#${encodeURIComponent(name)}`);
    expect(lines.length).toBeGreaterThanOrEqual(airportNodes.length + 3);
    expect(nodeText).toMatchSnapshot();

    const viaAgent = await request(`/r/${chainId}`, "Shadowrocket/2100");
    expect(viaAgent.status).toBe(200);
    expect(await viaAgent.text()).toBe(nodeText);

    const config = await request(`/r/${chainId}/Flacier-Mobile.conf`, "Shadowrocket/2100");
    expect(config.status).toBe(200);
    const configText = await config.text();
    expect(configText).toContain("FINAL,PROXY");
    expect(configText).not.toContain("[Proxy Group]");
    for (const secret of secrets) expect(configText).not.toContain(secret);
    expect(configText).toMatchSnapshot();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
