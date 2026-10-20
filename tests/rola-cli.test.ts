import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function fixture() {
  const directory = mkdtempSync(resolve(tmpdir(), "rola-cli-"));
  for (const path of ["scripts/rola.mjs", "src/local", "src/config", "src/worker/residential-profile.ts", "src/worker/mihomo-dns.ts", "src/worker/api-error.ts", "public/rules/ai", "public/rules/sing-box/ai-anthropic.json"]) {
    mkdirSync(dirname(resolve(directory, path)), { recursive: true });
    cpSync(resolve(root, path), resolve(directory, path), { recursive: true });
  }
  symlinkSync(resolve(root, "node_modules"), resolve(directory, "node_modules"));
  const run = (...args: string[]) => execFileSync(process.execPath, [resolve(directory, "scripts/rola.mjs"), ...args], {
    cwd: directory, encoding: "utf8", timeout: 15000, stdio: "pipe", maxBuffer: 65536,
  });
  return { directory, run, settingsPath: resolve(directory, ".local/rola/settings.json") };
}

describe("Rola CLI local boundaries", () => {
  it("creates private settings without overwriting them or connecting anywhere", () => {
    const { run, settingsPath } = fixture();
    expect(run("init")).toContain("no connection was made");
    expect(statSync(settingsPath).mode & 0o777).toBe(0o600);
    expect(statSync(dirname(settingsPath)).mode & 0o777).toBe(0o700);
    const initial = readFileSync(settingsPath, "utf8");
    expect(() => run("init")).toThrow();
    expect(readFileSync(settingsPath, "utf8")).toBe(initial);
    expect(() => run("prepare")).toThrow();
  }, 30000);

  it("refuses symlinked settings, direct API access and a remote proxy endpoint", () => {
    const { run, settingsPath } = fixture();
    run("init");
    expect(() => run("usage")).toThrow();
    expect(() => run("usage", "--proxy", "https://remote.example")).toThrow();
    const separate = fixture();
    mkdirSync(resolve(separate.directory, ".local/rola"), { recursive: true, mode: 0o700 });
    symlinkSync(settingsPath, separate.settingsPath);
    expect(() => separate.run("usage", "--proxy", "http://127.0.0.1:1")).toThrow();
  }, 30000);
});
