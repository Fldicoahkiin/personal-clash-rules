import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { build } from "esbuild";
import { ProxyAgent, setGlobalDispatcher } from "undici";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const directory = resolve(root, ".local/rola");
const settingsPath = resolve(directory, "settings.json");

async function privateDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077)) {
    throw new Error("Rola local directory must be an owner-only directory, not a symlink");
  }
}

async function readSettings() {
  const handle = await open(settingsPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || (stat.mode & 0o077) || stat.size > 65536) throw new Error("Rola settings must be an owner-only file, at most 64 KiB");
    try { return JSON.parse(await handle.readFile("utf8")); }
    catch { throw new Error("Rola settings must be valid JSON; file contents were not logged"); }
  } finally { await handle.close(); }
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { proxy: { type: "string" } } });
  const command = positionals[0];
  if (!["init", "usage"].includes(command) || positionals.length !== 1 || (values.proxy && command !== "usage")) {
    throw new Error("Usage: pnpm rola init | pnpm rola usage --proxy http://127.0.0.1:port");
  }
  await privateDirectory(resolve(root, ".local"));
  await privateDirectory(directory);
  const bundle = resolve(directory, command === "usage" ? "usage.mjs" : "profile.mjs");
  await build({ entryPoints: [resolve(root, command === "usage" ? "src/local/rola-usage.ts" : "src/worker/residential-profile.ts")],
    outfile: bundle, bundle: true, platform: "node", format: "esm", packages: "external" });
  const module = await import(pathToFileURL(bundle).href);
  if (command === "init") {
    const lists = await Promise.all(module.rolaRulePaths.map(path => readFile(resolve(root, "public", path), "utf8")));
    await writeFile(settingsPath, JSON.stringify(module.createRolaTemplate(lists), null, 2) + "\n", { flag: "wx", mode: 0o600 });
    console.log("Created .local/rola/settings.json (0600). Fill credentials locally; no connection was made.");
    return;
  }
  const settings = await readSettings();
  if (!values.proxy) throw new Error("Usage queries require --proxy with your existing local HTTP/mixed endpoint; no direct fallback");
  let proxy;
  try { proxy = new URL(values.proxy); }
  catch { throw new Error("Invalid loopback proxy URL"); }
  if (proxy.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(proxy.hostname)
    || proxy.username || proxy.password || proxy.pathname !== "/" || proxy.search || proxy.hash) {
    throw new Error("--proxy must be the unauthenticated HTTP/mixed loopback endpoint of your existing client");
  }
  const dispatcher = new ProxyAgent({ uri: proxy.href, connectTimeout: 8000 });
  setGlobalDispatcher(dispatcher);
  try { console.log(JSON.stringify(await module.readRolaUsage(settings.apiToken), null, 2)); }
  finally { await dispatcher.close(); }
}

main().catch(error => {
  // Parser and filesystem errors can include source text or private paths.
  const message = error?.code ? `Rola local operation failed (${error.code})` : error.message;
  console.error(message || "Rola local operation failed");
  process.exitCode = 1;
});
