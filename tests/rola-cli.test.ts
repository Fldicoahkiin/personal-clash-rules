import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function fixture() {
  const directory = mkdtempSync(resolve(tmpdir(), "rola-cli-"));
  for (const path of ["scripts/rola.mjs", "src/local", "src/config", "public/rules/ai"]) {
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
  it("creates private settings and candidate files without overwriting or activating anything", () => {
    const { directory, run, settingsPath } = fixture();
    expect(run("init")).toContain("no connection was made");
    expect(statSync(settingsPath).mode & 0o777).toBe(0o600);
    expect(statSync(dirname(settingsPath)).mode & 0o777).toBe(0o700);
    const initial = readFileSync(settingsPath, "utf8");
    expect(() => run("init")).toThrow();
    expect(readFileSync(settingsPath, "utf8")).toBe(initial);
    const settings = JSON.parse(initial);
    Object.assign(settings, { server: "residential.example", port: 1080, account: "demo", password: "proxy-test-secret", apiToken: "api-test-secret", upstreamNode: "Airport" });
    writeFileSync(settingsPath, JSON.stringify(settings));
    const base = resolve(directory, "base.yaml");
    const source = `mode: rule
dns: {enable: true, nameserver: [https://1.1.1.1/dns-query], proxy-server-nameserver: [system]}
proxies: [{name: Airport, type: ss, server: airport.example, port: 443, cipher: aes-128-gcm, password: test}]
proxy-groups: [{name: AUTO, type: url-test, include-all: true, interval: 300, url: https://cp.cloudflare.com/generate_204}]
rules: ['MATCH,AUTO']
`;
    writeFileSync(base, source, { mode: 0o600 });
    const output = run("prepare", "--base", base);
    expect(output).toContain("not activated");
    expect(output).not.toContain("proxy-test-secret");
    expect(output).not.toContain("api-test-secret");
    expect(readFileSync(base, "utf8")).toBe(source);
    const candidate = resolve(dirname(settingsPath), readdirSync(dirname(settingsPath)).find(path => path.startsWith("candidate-"))!);
    expect(statSync(candidate).mode & 0o777).toBe(0o700);
    const profile = resolve(candidate, "mihomo.yaml");
    expect(statSync(profile).mode & 0o777).toBe(0o600);
    expect(readFileSync(profile, "utf8")).toContain("proxy-test-secret");
    expect(readFileSync(profile, "utf8")).not.toContain("api-test-secret");
    expect(readFileSync(resolve(candidate, "summary.json"), "utf8")).not.toContain("secret");
    if (process.env.MIHOMO_TEST_BINARY) {
      const checkDirectory = mkdtempSync(resolve(tmpdir(), "rola-mihomo-check-"));
      const check = execFileSync(process.env.MIHOMO_TEST_BINARY, ["-t", "-d", checkDirectory, "-f", profile], { encoding: "utf8", timeout: 15000 });
      expect(check).toContain("test is successful");
    }
    chmodSync(settingsPath, 0o644);
    expect(() => run("prepare", "--base", base)).toThrow();
    expect(readFileSync(base, "utf8")).toBe(source);
  }, 30000);

  it("refuses symlinked settings, direct API access and a remote proxy endpoint", () => {
    const { directory, run, settingsPath } = fixture();
    run("init");
    expect(() => run("usage")).toThrow();
    expect(() => run("usage", "--proxy", "https://remote.example")).toThrow();
    const separate = fixture();
    mkdirSync(resolve(separate.directory, ".local/rola"), { recursive: true, mode: 0o700 });
    symlinkSync(settingsPath, separate.settingsPath);
    expect(() => separate.run("usage", "--proxy", "http://127.0.0.1:1")).toThrow();
    expect(readdirSync(resolve(directory, ".local/rola")).filter(path => path.startsWith("candidate-"))).toEqual([]);
  }, 30000);
});
