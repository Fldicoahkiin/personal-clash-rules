import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, symlink } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { expect, it } from "vitest";
import { parse } from "yaml";

it("serves the local converter on loopback, rejects foreign origins and runs the actual converter", async () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const directory = await mkdtemp(resolve(tmpdir(), "rola-http-"));
  await mkdir(resolve(directory, "scripts"));
  await copyFile(resolve(root, "scripts/local-server.mjs"), resolve(directory, "scripts/local-server.mjs"));
  for (const path of ["src", "public", "node_modules"]) await symlink(resolve(root, path), resolve(directory, path));
  await mkdir(resolve(directory, "dist/brand"), { recursive: true });
  await copyFile(resolve(root, "public/favicon.svg"), resolve(directory, "dist/favicon.svg"));
  await copyFile(resolve(root, "public/brand/flacier-mark.svg"), resolve(directory, "dist/brand/flacier-mark.svg"));
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  const port = address.port;
  await new Promise<void>((done, reject) => probe.close(error => error ? reject(error) : done()));
  const origin = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [resolve(directory, "scripts/local-server.mjs")], { cwd: directory, env: { ...process.env, LOCAL_PORT: String(port) }, stdio: "pipe" });
  const exit = once(server, "exit");
  const ready = new Promise<void>((done, reject) => {
    const timer = setTimeout(() => reject(new Error("Local server startup timed out")), 10000);
    server.once("error", error => { clearTimeout(timer); reject(error); });
    server.stdout.on("data", data => { if (String(data).includes("Local converter:")) { clearTimeout(timer); done(); } });
    server.once("exit", () => { clearTimeout(timer); reject(new Error("Local server exited before ready")); });
  });
  const request = (path: string, init?: RequestInit) => fetch(origin + path, { ...init, signal: AbortSignal.timeout(10000) });
  const post = async (path: string, value: unknown) => request(path, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(value) });
  try {
    await ready;
    const compatibility = new URLSearchParams({ target: "clash", url: "socks5://test:fake@home.example:9004#Home", list: "true" });
    const converted = await request(`/sub?${compatibility}`);
    expect(converted.status).toBe(200);
    expect(converted.headers.get("content-type")).toContain("yaml");
    expect(parse(await converted.text()).proxies[0]).toMatchObject({ type: "socks5", name: "Home" });
    expect((await request("/sub-misspelled")).status).toBe(404);
    expect((await request("/favicon.svg")).headers.get("content-type")).toBe("image/svg+xml");
    expect((await request("/brand/flacier-mark.svg")).status).toBe(200);
    expect((await request("/api/local/subscriptions/publish", { headers: { Origin: "https://untrusted.example" } })).status).toBe(403);
    expect((await request("/api/local/subscriptions/publish", { headers: { Origin: "null" } })).status).toBe(403);
    expect((await request("/api/local/subscriptions/publish", { headers: { "Sec-Fetch-Site": "cross-site" } })).status).toBe(403);
    expect(await (await request("/api/local/subscriptions/publish")).json()).toEqual({ tasks: [] });
    expect((await post("/api/local/subscriptions/publish", { url: "https://untrusted.example/s/abcdefghijklmnop/mihomo-config" })).status).toBe(400);
    const cors = await request("/api/local/subscriptions/publish", { method: "OPTIONS", headers: { Origin: "https://rules.flacier.com", "Access-Control-Request-Private-Network": "true" } });
    expect(cors.headers.get("access-control-allow-origin")).toBe("https://rules.flacier.com");
    expect((await request("/api/local/subscriptions/publish")).headers.get("cache-control")).toBe("no-store");
    expect((await request("/api/local/rola")).status).toBe(404);
  } finally {
    server.kill("SIGTERM");
    await exit;
  }
}, 20000);
