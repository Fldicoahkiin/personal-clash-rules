import { chmod, mkdtemp, readFile, readdir, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";

import { createRolaRouter } from "../src/local/rola-server";
import { createRolaCloudBase, requestRola, rolaLocalOrigin } from "../src/app/features/subscriptions/rola-api";

const origin = "http://127.0.0.1:25500";
const baseId = "abcdefghijklmnop";
const exit = { name: "Test US", protocol: "socks5", server: "residential.example", port: 1080, account: "privateaccount", password: "privatepassword", country: "us", sessionId: "web", sessionMinutes: 120 };
const base = `mode: rule
dns: {enable: true, nameserver: [https://1.1.1.1/dns-query], proxy-server-nameserver: [system]}
proxies:
  - {name: Airport, type: ss, server: airport.example, port: 443, cipher: aes-128-gcm, password: airportsecret}
  - {name: Insecure, type: http, server: insecure.example, port: 80}
proxy-groups: [{name: AUTO, type: url-test, include-all: true, url: https://cp.cloudflare.com/generate_204, interval: 300}]
rules: ['MATCH,AUTO']
`;

async function fixture() {
  const directory = await mkdtemp(resolve(tmpdir(), "rola-web-"));
  let currentBase = base;
  let failure = false;
  const convert = vi.fn(async (request: Request) => {
    if (failure) return Response.json({ error: "source_failed", message: "HTTP 403" }, { status: 422 });
    if (request.method === "POST") return Response.json({ url: `${origin}/s/${baseId}/clash-party-config`, nodeStats: { read: 2, output: 2, skipped: 0 } }, { status: 201 });
    return new Response(currentBase, { headers: { "Subscription-Userinfo": "upload=10; download=20; total=1000; expire=0", ETag: "base-etag", "Profile-Update-Interval": "6" } });
  });
  const router = await createRolaRouter({ directory, origin, ruleLists: ["DOMAIN-SUFFIX,claude.ai"], convert });
  async function call(path: string, input?: unknown) {
    return (await router(new Request(`${origin}${path}`, input === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) })))!;
  }
  async function chain() {
    const saved = await (await call("/api/local/rola/exits", exit)).json() as { id: string };
    const input = { baseId, target: "clash-party-config", exitId: saved.id, upstreamNode: "Airport", rules: ["DOMAIN-SUFFIX,claude.ai"], dns: ["https://1.1.1.1/dns-query"] };
    const response = await call("/api/local/rola/chains", input);
    expect(response.status).toBe(201);
    const created = await response.json() as { url: string };
    return { saved, input, path: new URL(created.url).pathname };
  }
  return { call, chain, directory, convert, router, setBase: (value: string) => { currentBase = value; }, fail: () => { failure = true; } };
}

describe("local Rola web workflow", () => {
  it("snapshots two saved exits and refreshes both YAML and private override without dropping either", async () => {
    const f = await fixture();
    const first = await (await f.call("/api/local/rola/exits", { ...exit, authMode: "literal" })).json() as { id: string };
    const extra = { ...exit, authMode: "literal", name: "Second US", server: "198.51.100.2", port: 1081, account: "second-user", password: "second-password" };
    const second = await (await f.call("/api/local/rola/exits", extra)).json() as { id: string };
    const input = { baseId, target: "clash-party-config", exitId: first.id, additionalExitIds: [second.id], connectionMode: "direct",
      groupName: "Homes", rules: ["DOMAIN-SUFFIX,claude.ai"], dns: ["https://1.1.1.1/dns-query"] };
    const response = await f.call("/api/local/rola/chains", input);
    expect(response.status).toBe(201);
    const created = await response.json() as { url: string; overrideUrl: string };
    expect(JSON.stringify(created)).not.toMatch(/privatepassword|second-password/);
    await f.call("/api/local/rola/exits", { id: second.id, password: "replacement-password" });
    for (let attempt = 0; attempt < 2; attempt++) {
      const refreshed = await f.call(new URL(created.url).pathname);
      expect(refreshed.headers.get("subscription-userinfo")).toContain("total=1000");
      const profile = parse(await refreshed.text());
      expect(profile.proxies.slice(-2)).toMatchObject([{ name: exit.name, password: exit.password }, { name: extra.name, password: extra.password }]);
      expect(profile["proxy-groups"].find((group: { name: string }) => group.name === "Homes").proxies).toEqual([exit.name, extra.name]);
      const script = await (await f.call(new URL(created.overrideUrl).pathname)).text();
      expect(runInNewContext(`${script}; main(config)`, { config: parse(base) })).toEqual(profile);
    }
    for (const additionalExitIds of [null, {}, [first.id], [second.id, second.id], Array(8).fill(second.id)]) {
      expect((await f.call("/api/local/rola/chains", { ...input, additionalExitIds })).status).toBe(400);
    }
    expect((await f.call("/api/local/rola/chains", { ...input, connectionMode: "chain", upstreamNode: "Airport" })).status).toBe(400);
    expect((await f.call("/api/local/rola/chains", { ...input, additionalExits: [extra] })).status).toBe(400);
  });

  it("round-trips exit metadata without exposing credentials or changing the gateway", async () => {
    const f = await fixture();
    const metadata = { exitIp: "203.0.113.24", region: "美国 Las Vegas" };
    const saved = await (await f.call("/api/local/rola/exits", { ...exit, ...metadata })).json() as { id: string };
    expect(saved).toMatchObject({ ...metadata, name: exit.name, server: exit.server });
    expect(JSON.stringify(saved)).not.toMatch(/privateaccount|privatepassword/);
    const edited = await f.call("/api/local/rola/exits", { id: saved.id, name: "Legacy note", account: "", password: "" });
    expect(edited.status).toBe(200);
    expect(await edited.json()).toMatchObject(metadata);
    const result = await f.call("/api/local/rola/chains", { baseId, target: "clash-party-config", exitId: saved.id,
      connectionMode: "direct", rules: ["DOMAIN-SUFFIX,claude.ai"], dns: ["https://1.1.1.1/dns-query"] });
    expect(result.status).toBe(201);
    const { url } = await result.json() as { url: string };
    const profile = parse(await (await f.call(new URL(url).pathname)).text());
    expect(profile.proxies.at(-1)).toMatchObject({ name: "203.0.113.24 · 美国 Las Vegas", server: exit.server });
    const invalid = await f.call("/api/local/rola/exits", { ...exit, exitIp: metadata.exitIp });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: "invalid_rola_exit_metadata", message: "出口 IP 和区域需同时填写；都留空时保留原备注。" });
  });

  it("persists explicit direct access and a private group in both YAML and local override", async () => {
    const f = await fixture();
    const saved = await (await f.call("/api/local/rola/exits", exit)).json() as { id: string };
    const result = await f.call("/api/local/rola/chains", { baseId, target: "clash-party-config", exitId: saved.id,
      connectionMode: "direct", groupName: "🇺🇸 美国家宽", rules: ["DOMAIN-SUFFIX,claude.ai"], dns: ["https://1.1.1.1/dns-query"] });
    expect(result.status).toBe(201);
    const created = await result.json() as { url: string; overrideUrl: string; summary: { connectionMode: string } };
    expect(created.summary.connectionMode).toBe("direct");
    f.setBase(base.replace("name: Airport", "name: RenamedAirport"));
    const refreshed = await f.call(new URL(created.url).pathname);
    expect(refreshed.headers.get("subscription-userinfo")).toContain("total=1000");
    const profile = parse(await refreshed.text());
    expect(profile.proxies.at(-1)["dialer-proxy"]).toBe("DIRECT");
    expect(profile["proxy-groups"].find((group: { name: string }) => group.name === "🇺🇸 美国家宽")).toBeDefined();
    expect(await (await f.call(new URL(created.overrideUrl).pathname)).text()).toContain('"connectionMode":"direct"');
  });

  it("saves private exits without credential echo and preserves credentials on edit", async () => {
    const f = await fixture();
    const saved = await (await f.call("/api/local/rola/exits", exit)).json() as { id: string };
    expect(JSON.stringify(saved)).not.toMatch(/privateaccount|privatepassword/);
    const list = await (await f.call("/api/local/rola")).text();
    expect(list).toContain("Test US");
    expect(list).not.toMatch(/privateaccount|privatepassword/);
    expect(f.convert).not.toHaveBeenCalled();
    expect((await stat(f.directory)).mode & 0o777).toBe(0o700);
    const file = resolve(f.directory, `exit-${saved.id}.json`);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    const edited = await f.call("/api/local/rola/exits", { ...exit, id: saved.id, name: "Renamed", account: "", password: "" });
    expect(edited.status).toBe(200);
    expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({ name: "Renamed", account: exit.account, password: exit.password });
    const invalid = await f.call("/api/local/rola/exits", { ...exit, sessionMinutes: 121 });
    expect(invalid.status).toBe(400);
    expect(await invalid.text()).not.toContain(exit.password);
  });

  it("lists only node names and types, disables unsafe first hops and forces local conversion without fallback", async () => {
    const f = await fixture();
    const response = await f.call("/api/local/rola/preview", { target: "clash-party-config", sources: [], name: "Demo", backend: "https://untrusted.example", fallbackMode: "mihomo-provider" });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain("airportsecret");
    expect(JSON.parse(text).nodes).toEqual([{ name: "Airport", type: "ss", selectable: true }, { name: "Insecure", type: "http", selectable: false }]);
    const request = f.convert.mock.calls[0][0];
    expect(new URL(request.url).origin).toBe(origin);
    expect(await request.json()).toMatchObject({ fallbackMode: "error", dnsMode: "doh", rulePreset: "flacier" });
    expect((await f.call("/api/local/rola/preview", { target: "shadowrocket-config" })).status).toBe(400);
  });

  it("generates a refreshable chain, keeps airport usage, and snapshots exit edits", async () => {
    const f = await fixture();
    const { saved, path } = await f.chain();
    await f.call("/api/local/rola/exits", { ...exit, id: saved.id, password: "replacement", country: "jp" });
    const result = await f.call(path);
    expect(result.status).toBe(200);
    expect(result.headers.get("subscription-userinfo")).toBe("upload=10; download=20; total=1000; expire=0");
    expect(result.headers.get("profile-update-interval")).toBe("6");
    expect(result.headers.has("etag")).toBe(false);
    expect(result.headers.get("cache-control")).toBe("no-store");
    const script = await f.call(path.replace(/\.yaml$/u, ".js"));
    expect(script.headers.get("content-type")).toContain("application/javascript");
    expect(script.headers.get("cache-control")).toBe("no-store");
    expect(await script.text()).toContain("function main(config)");
    const generated = parse(await result.text());
    expect(generated.proxies.at(-1)).toMatchObject({ password: exit.password, "dialer-proxy": "Airport", username: "privateaccount_web-country-us-sessiontime-120" });
    expect(generated.rules[1]).toBe("DOMAIN-SUFFIX,claude.ai,ROLA");
    const chainFile = (await readdir(f.directory)).find(file => file.startsWith("chain-"))!;
    expect((await stat(resolve(f.directory, chainFile))).mode & 0o777).toBe(0o600);
    f.setBase(base.replace("airportsecret", "updated-source-secret"));
    expect(parse(await (await f.call(path)).text()).proxies[0].password).toBe("updated-source-secret");
    const restarted = await createRolaRouter({ directory: f.directory, origin, ruleLists: [], convert: f.convert });
    expect((await restarted(new Request(`${origin}${path}`)))?.status).toBe(200);
  });

  it("saves literal accounts without dynamic parameters and does not expose credentials", async () => {
    const f = await fixture();
    const literal = { ...exit, authMode: "literal", country: "", sessionId: undefined, sessionMinutes: undefined };
    const response = await f.call("/api/local/rola/exits", literal);
    expect(response.status).toBe(201);
    const saved = await response.json() as { id: string; authMode: string };
    expect(saved.authMode).toBe("literal");
    expect(JSON.stringify(saved)).not.toMatch(/privateaccount|privatepassword/);
    const record = JSON.parse(await readFile(resolve(f.directory, `exit-${saved.id}.json`), "utf8"));
    expect(record.account).toBe(exit.account);
  });

  it("rejects missing nodes and upstream failure without publishing an empty or direct fallback", async () => {
    const f = await fixture();
    const { input, path } = await f.chain();
    f.setBase(base.replace("name: Airport", "name: Renamed"));
    const failed = await f.call(path);
    expect(failed.status).toBe(422);
    expect(await failed.text()).not.toMatch(/airportsecret|privatepassword|proxies:/);
    expect((await f.call("/api/local/rola/chains", input)).status).toBe(422);
    expect((await readdir(f.directory)).filter(name => name.startsWith("chain-")).length).toBe(1);
    f.fail();
    expect(await (await f.call(path)).json()).toMatchObject({ error: "source_failed" });
    expect((await f.call("/api/local/rola/chains", { ...input, baseId: "../../bad" })).status).toBe(400);
  });

  it("rejects rule/DNS loops, over-sized requests, symlinks and permissive secret files", async () => {
    const f = await fixture();
    const { input, path, saved } = await f.chain();
    for (const changes of [{ rules: ["MATCH,DIRECT"] }, { rules: ["DOMAIN-SUFFIX,residential.example"] }, { dns: ["https://1.1.1.1/dns-query#ROLA"] }, { upstreamNode: "Insecure" }]) {
      expect((await f.call("/api/local/rola/chains", { ...input, ...changes })).status).toBe(422);
    }
    expect((await f.call("/api/local/rola/exits", { ...exit, name: "x".repeat(65536) })).status).toBe(413);
    expect((await f.router(new Request(`${origin}/api/local/rola/exits`, { method: "POST", body: "{}" })))?.status).toBe(415);
    await chmod(resolve(f.directory, `exit-${saved.id}.json`), 0o644);
    expect((await f.call("/api/local/rola")).status).toBe(500);
    const chainName = (await readdir(f.directory)).find(name => name.startsWith("chain-"))!;
    const linkId = "aaaaaaaaaaaaaaaa";
    await symlink(resolve(f.directory, chainName), resolve(f.directory, `chain-${linkId}.json`));
    expect((await f.call(`/local/rola/${linkId}.yaml`)).status).toBe(500);
    expect(path).not.toContain(exit.password);
  });
});

afterEach(() => vi.unstubAllGlobals());
describe("browser credential egress boundary", () => {
  it("sends only an explicit airport allowlist when cloud base creation is requested", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ url: "https://rules.flacier.com/s/abcdefghijklmnop/clash-party-config" }));
    vi.stubGlobal("fetch", fetcher);
    const input = { ...exit, rules: ["DOMAIN,private.example"], exitId: "private-exit", target: "clash-party-config" as const,
      sourceUserAgent: "clash.meta", sources: [{ name: "Airport", type: "subscription" as const, value: "https://airport.example/sub", password: "do-not-send" }] };
    await createRolaCloudBase(input);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith("https://rules.flacier.com/api/subscriptions", expect.objectContaining({ redirect: "error", credentials: "omit", method: "POST" }));
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body).toMatchObject({ sources: [{ name: "Airport", type: "subscription", value: "https://airport.example/sub" }], rulePreset: "flacier", dnsMode: "doh", fallbackMode: "error", updateIntervalHours: 6 });
    expect(JSON.stringify(body)).not.toMatch(/privateaccount|privatepassword|private\.example|private-exit|do-not-send/);
    expect(body.dnsSettings.bootstrapMode).toBe("system");
  });
  it("reports cloud rejection without falling back or sending a Rola payload elsewhere", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ error: "source_failed", message: "HTTP 403" }, { status: 422 }));
    vi.stubGlobal("fetch", fetcher);
    await expect(createRolaCloudBase({ name: "Test", sourceUserAgent: "clash.meta", sources: [], target: "clash-party-config" })).rejects.toMatchObject({ code: "source_failed" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("pins public pages to loopback and supports an alternate local port", () => {
    expect(rolaLocalOrigin(new URL("https://rules.flacier.com"))).toBe(origin);
    expect(rolaLocalOrigin(new URL("http://127.0.0.1.evil.example"))).toBe(origin);
    expect(rolaLocalOrigin(new URL("http://localhost:25512"))).toBe("http://localhost:25512");
  });
  it("posts secrets only to loopback, forbids redirects, cookies and automatic cloud retries", async () => {
    vi.stubGlobal("window", { location: new URL("https://rules.flacier.com") });
    const fetcher = vi.fn().mockResolvedValue(Response.json({ id: baseId }));
    vi.stubGlobal("fetch", fetcher);
    await requestRola("/exits", exit);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(`${origin}/api/local/rola/exits`, expect.objectContaining({ redirect: "error", credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store", method: "POST", signal: expect.any(AbortSignal) }));
    fetcher.mockRejectedValue(new Error("offline"));
    await expect(requestRola("/exits", exit)).rejects.toThrow("不会改用云端");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
