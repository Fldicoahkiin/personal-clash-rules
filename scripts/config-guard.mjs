import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { appendFile, lstat, mkdir, mkdtemp, open, rename, unlink, writeFile } from "node:fs/promises";
import http from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { build } from "esbuild";
import { parseDocument } from "yaml";
import { fetch, ProxyAgent } from "undici";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const directory = resolve(root, ".local/config-guard");
const script = fileURLToPath(import.meta.url);
const active = resolve(directory, "active.json");
class GuardInputError extends Error {}
async function privateRead(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw new Error("Invalid configuration file");
    return await file.readFile("utf8");
  } finally { await file.close(); }
}
function config(source) {
  const doc = parseDocument(source, { uniqueKeys: true });
  if (doc.errors.length) throw new Error("Invalid YAML");
  return doc.toJS({ maxAliasCount: 100 });
}
async function control(socketPath, secret, payload) {
  return new Promise((done, reject) => {
    const request = http.request({ socketPath, path: payload === undefined ? "/version" : "/configs?force=true", method: payload === undefined ? "GET" : "PUT",
      headers: { "Content-Type": "application/json", ...(secret ? { Authorization: `Bearer ${secret}` } : {}) }, timeout: 4000 }, response => {
      response.resume();
      response.on("end", () => response.statusCode >= 200 && response.statusCode < 300 ? done() : reject(new Error("Controller rejected request")));
    });
    const deadline = setTimeout(() => request.destroy(new Error("Controller deadline")), 5000);
    request.once("close", () => clearTimeout(deadline));
    request.on("error", reject);
    request.on("timeout", () => request.destroy(new Error("Controller timeout")));
    request.end(payload === undefined ? undefined : JSON.stringify({ payload }));
  });
}
async function main() {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: {
    baseline: { type: "string" }, candidate: { type: "string" }, socket: { type: "string" },
    seconds: { type: "string", default: "90" }, label: { type: "string" }, "allow-batch": { type: "boolean" },
  } });
  const [command, trialArgument] = positionals;
  if (command === "start") {
    if (!values.baseline || !values.candidate || !values.socket || !values.label || positionals.length !== 1) throw new GuardInputError("start requires --baseline, --candidate, --socket and --label; validate the candidate with Mihomo -t first");
    const seconds = Number(values.seconds);
    if (!Number.isInteger(seconds) || seconds < 15 || seconds > 300) throw new GuardInputError("Confirmation window must be 15–300 seconds");
    if (!(await lstat(values.socket)).isSocket()) throw new Error("Use the existing local Unix controller socket");
    const baseline = await privateRead(resolve(values.baseline)), candidate = await privateRead(resolve(values.candidate));
    const before = config(baseline), after = config(candidate);
    if (!before || !after || typeof before !== "object" || typeof after !== "object") throw new GuardInputError("Use complete baseline and candidate configuration objects");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const permissions = await lstat(directory);
    if (!permissions.isDirectory() || permissions.isSymbolicLink() || (permissions.mode & 0o077)) throw new Error("Watchdog directory must be private");
    const bundle = resolve(directory, "guard.mjs");
    await build({ entryPoints: [resolve(root, "src/local/config-guard.ts")], outfile: bundle, platform: "node", format: "esm", bundle: true });
    const { changedConfigPaths, guardControlUnchanged } = await import(pathToFileURL(bundle).href);
    if (!guardControlUnchanged(before, after)) throw new GuardInputError("Keep the active mixed port, bind address, proxy authentication and controller endpoints/authentication unchanged during a trial");
    const changedPaths = changedConfigPaths(before, after);
    if (!changedPaths.length || (changedPaths.length > 1 && !values["allow-batch"])) throw new GuardInputError("Change one option per trial; a deliberate multi-field profile requires --allow-batch and cannot identify a single cause");
    await control(values.socket, before.secret);
    const trial = await mkdtemp(resolve(directory, "trial-"));
    await writeFile(resolve(trial, "baseline.yaml"), baseline, { flag: "wx", mode: 0o600 });
    await writeFile(resolve(trial, "candidate.yaml"), candidate, { flag: "wx", mode: 0o600 });
    await writeFile(resolve(trial, "plan.json"), JSON.stringify({ socket: values.socket, seconds, label: values.label, changedPaths }), { flag: "wx", mode: 0o600 });
    try { await writeFile(active, trial, { flag: "wx", mode: 0o600 }); }
    catch (error) { if (error.code === "EEXIST") throw new GuardInputError("Another trial is active, or a previous watchdog stopped unexpectedly. Inspect its status before removing the stale lock."); throw error; }
    const child = spawn(process.execPath, [script, "watch", trial], { detached: true, stdio: "ignore" });
    try { await new Promise((done, reject) => { child.once("spawn", done); child.once("error", reject); }); }
    catch (error) { await unlink(active); throw error; }
    child.unref();
    console.log(JSON.stringify({ trial, watchdogPid: child.pid, changedPaths, confirmationSeconds: seconds, note: "Independent trial requested. Inspect status before confirming; no confirmation means rollback." }));
    return;
  }
  if (!["watch", "confirm", "status"].includes(command) || !trialArgument || positionals.length !== 2) throw new Error("Usage: config-guard start [options] | confirm TRIAL | status TRIAL");
  const trial = resolve(trialArgument);
  if (dirname(trial) !== directory || !(await lstat(trial)).isDirectory() || (await lstat(trial)).isSymbolicLink()) throw new Error("Invalid trial directory");
  if (command === "status") { console.log(await privateRead(resolve(trial, "status.json"))); return; }
  if (command === "confirm") {
    const status = JSON.parse(await privateRead(resolve(trial, "status.json")));
    if (status.phase !== "probe_ok" || Date.now() >= status.deadline) throw new GuardInputError("Only a healthy trial still inside its confirmation window may be kept");
    await writeFile(resolve(trial, "confirmed"), "confirmed", { flag: "wx", mode: 0o600 });
    console.log("Confirmation requested; check status for confirmed."); return;
  }
  const plan = JSON.parse(await privateRead(resolve(trial, "plan.json")));
  const baseline = await privateRead(resolve(trial, "baseline.yaml")), candidate = await privateRead(resolve(trial, "candidate.yaml"));
  const before = config(baseline);
  const { runGuardedTrial } = await import(pathToFileURL(resolve(directory, "guard.mjs")).href);
  const proxy = new ProxyAgent({ uri: `http://127.0.0.1:${before["mixed-port"]}`, connectTimeout: 3000 });
  const deadline = Date.now() + plan.seconds * 1000;
  let stopped = false;
  process.on("SIGTERM", () => { stopped = true; });
  process.on("SIGINT", () => { stopped = true; });
  try {
    await runGuardedTrial({ baseline, candidate, timeoutMs: plan.seconds * 1000,
      apply: payload => control(plan.socket, before.secret, payload), stopped: () => stopped,
      healthy: async () => {
        try {
          await control(plan.socket, before.secret);
          for (const url of ["https://www.cloudflare.com/cdn-cgi/trace", "https://chatgpt.com/"]) {
            const response = await fetch(url, { method: "HEAD", dispatcher: proxy, redirect: "error", signal: AbortSignal.timeout(4000) });
            await response.body?.cancel();
            // A 401/403 proves an HTTPS response, not that Codex authentication or WebSockets work.
            if (response.status >= 500) return false;
          }
          return true;
        } catch { return false; }
      },
      confirmed: async () => { try { return (await privateRead(resolve(trial, "confirmed"))) === "confirmed"; } catch { return false; } },
      report: async event => {
        const value = JSON.stringify({ ...event, deadline, label: plan.label, changedPaths: plan.changedPaths, timestamp: new Date().toISOString() });
        await appendFile(resolve(trial, "events.jsonl"), value + "\n", { mode: 0o600 });
        const temporary = resolve(trial, "status.tmp");
        await writeFile(temporary, value, { mode: 0o600 });
        await rename(temporary, resolve(trial, "status.json"));
      },
    });
  } finally {
    await proxy.destroy();
    if (await privateRead(active) === trial) await unlink(active);
  }
}
main().catch(error => { console.error(error instanceof GuardInputError ? error.message : `Watchdog operation failed${error?.code ? ` (${error.code})` : ""}; inspect the local trial state. No credentials were logged.`); process.exitCode = 1; });
