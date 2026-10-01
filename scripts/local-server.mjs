import { createServer } from "node:http";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { resolve, extname, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Readable } from "node:stream";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const data = resolve(root, ".local/subscriptions");
const port = Number(process.env.LOCAL_PORT || 25500);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid LOCAL_PORT");
await mkdir(data, { recursive: true, mode: 0o700 });
const bundle = resolve(root, ".local/subscriptions.mjs");
await build({ entryPoints: [resolve(root, "src/worker/subscriptions.ts")], outfile: bundle, bundle: true, platform: "node", format: "esm", packages: "external" });
const { routeSubscriptionRequest } = await import(pathToFileURL(bundle).href);
const origin = `http://127.0.0.1:${port}`;
const allowedOrigins = new Set([origin, `http://localhost:${port}`, "https://rules.flacier.com"]);
const limits = new Map();
setInterval(() => {
  for (const [key, value] of limits) if (value.until <= Date.now()) limits.delete(key);
}, 60000).unref();

function keyPath(key) {
  if (!/^subscription:[\w-]{16}$/.test(key)) throw new Error("Invalid subscription key");
  return resolve(data, key.replace(":", "-") + ".json");
}
const env = {
  SUBSCRIPTIONS: {
    async get(key) {
      try { return await readFile(keyPath(key), "utf8"); }
      catch (error) { if (error.code === "ENOENT") return null; throw error; }
    },
    async put(key, value) {
      const file = keyPath(key);
      await writeFile(file + ".tmp", value, { mode: 0o600 });
      await rename(file + ".tmp", file);
    },
  },
  SUBSCRIPTION_RATE_LIMITER: {
    async limit({ key }) {
      const current = limits.get(key);
      const bucket = current && current.until > Date.now() ? current : { count: 0, until: Date.now() + 60000 };
      bucket.count += 1;
      limits.set(key, bucket);
      return { success: bucket.count <= 30 };
    },
  },
};
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".yaml": "text/yaml" };
const server = createServer(async (incoming, outgoing) => {
  outgoing.setHeader("Cache-Control", "no-store");
  outgoing.setHeader("X-Content-Type-Options", "nosniff");
  const requestOrigin = incoming.headers.origin;
  if (![new URL(origin).host, `localhost:${port}`].includes(incoming.headers.host)
    || (requestOrigin && !allowedOrigins.has(requestOrigin))
    || (incoming.headers["sec-fetch-site"] === "cross-site" && !requestOrigin)) {
    outgoing.writeHead(403).end("Origin not allowed"); return;
  }
  if (requestOrigin) {
    outgoing.setHeader("Access-Control-Allow-Origin", requestOrigin);
    outgoing.setHeader("Vary", "Origin");
    outgoing.setHeader("Access-Control-Allow-Headers", "Content-Type");
    outgoing.setHeader("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS");
    outgoing.setHeader("Access-Control-Allow-Private-Network", "true");
  }
  if (incoming.method === "OPTIONS") { outgoing.writeHead(204).end(); return; }
  try {
    const url = new URL(incoming.url, origin);
    const headers = new Headers();
    for (const [key, value] of Object.entries(incoming.headers)) {
      if (typeof value === "string") headers.set(key, value);
    }
    headers.set("CF-Connecting-IP", incoming.socket.remoteAddress || "loopback");
    const request = new Request(url, { method: incoming.method, headers,
      ...(["GET", "HEAD"].includes(incoming.method) ? {} : { body: Readable.toWeb(incoming), duplex: "half" }),
    });
    let response = await routeSubscriptionRequest(request, url, env);
    if (!response && url.pathname === "/health") response = Response.json({ status: "ok", service: "personal-clash-rules", backend: "local" });
    if (!response) {
      let path = resolve(root, "dist", "." + decodeURIComponent(url.pathname));
      if (!path.startsWith(resolve(root, "dist") + "/")) path = resolve(root, "dist/index.html");
      try { response = new Response(await readFile(path), { headers: { "Content-Type": mime[extname(path)] || "text/plain" } }); }
      catch (error) {
        if (!["ENOENT", "EISDIR"].includes(error.code)) throw error;
        response = new Response(await readFile(resolve(root, "dist/index.html")), { headers: { "Content-Type": "text/html" } });
      }
    }
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    if (request.method === "HEAD" || !response.body) outgoing.end();
    else Readable.fromWeb(response.body).pipe(outgoing);
  } catch (error) {
    console.error("Local request failed:", error.name);
    if (!outgoing.headersSent) outgoing.writeHead(500, { "Content-Type": "application/json" });
    outgoing.end(JSON.stringify({ error: "local_backend_failed", message: "Local conversion failed" }));
  }
});
server.requestTimeout = 30000;
server.headersTimeout = 10000;
server.listen(port, "127.0.0.1", () => console.log(`Local converter: ${origin}`));
