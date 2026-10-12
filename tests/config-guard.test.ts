import { describe, expect, it, vi } from "vitest";
import { changedConfigPaths, guardControlUnchanged, runGuardedTrial, type GuardEvent } from "../src/local/config-guard";

function fixture() {
  let clock = 0;
  const events: GuardEvent[] = [];
  return { baseline: "working-private", candidate: "trial-private", timeoutMs: 3000,
    now: () => clock, wait: async (ms: number) => { clock += ms; },
    apply: vi.fn<(payload: string) => Promise<void>>().mockResolvedValue(), healthy: vi.fn().mockResolvedValue(true),
    confirmed: vi.fn().mockResolvedValue(false), report: async (event: GuardEvent) => { events.push(event); }, events };
}
describe("independent confirmation watchdog", () => {
  it("restores the baseline after no confirmation even when HTTP probes pass", async () => {
    const f = fixture(); await runGuardedTrial(f);
    expect(f.apply.mock.calls).toEqual([[f.candidate], [f.baseline]]);
    expect(f.events.at(-1)).toMatchObject({ phase: "rolled_back", reason: "confirmation_timeout" });
    expect(JSON.stringify(f.events)).not.toContain("private");
  });
  it("refuses to apply when the existing connection is unhealthy", async () => {
    const f = fixture(); f.healthy.mockResolvedValue(false); await runGuardedTrial(f);
    expect(f.apply).not.toHaveBeenCalled(); expect(f.events.at(-1)?.phase).toBe("not_applied");
  });
  it("rolls back on two failed probes and ignores confirmation while unhealthy", async () => {
    const f = fixture(); f.healthy.mockResolvedValueOnce(true).mockResolvedValue(false); f.confirmed.mockResolvedValue(true);
    await runGuardedTrial(f);
    expect(f.apply.mock.calls).toEqual([[f.candidate], [f.baseline]]);
    expect(f.events.some(event => event.reason === "consecutive_probe_failures")).toBe(true);
    expect(f.events.at(-1)?.phase).toBe("rollback_unhealthy");
  });
  it("keeps an explicitly confirmed healthy trial", async () => {
    const f = fixture(); f.confirmed.mockResolvedValue(true); await runGuardedTrial(f);
    expect(f.apply.mock.calls).toEqual([[f.candidate]]); expect(f.events.at(-1)?.phase).toBe("confirmed");
  });
  it("restores after an apply timeout and reports recovery failure rather than pretending success", async () => {
    const f = fixture(); f.apply.mockRejectedValue(new Error("timeout")); await runGuardedTrial(f);
    expect(f.apply.mock.calls).toEqual([[f.candidate], [f.baseline]]); expect(f.events.at(-1)?.phase).toBe("rollback_failed");
  });
  it("records changed option paths without recording their values", () => {
    expect(changedConfigPaths({ dns: { nameserver: ["secret-a"] }, tun: { enable: false } }, { dns: { nameserver: ["secret-b"] }, tun: { enable: false } })).toEqual(["/dns/nameserver"]);
  });
  it("prevents a trial from removing its own probe or rollback access", () => {
    const before = { "mixed-port": 7890, secret: "local-secret", "external-controller-unix": "/tmp/test.sock" };
    expect(guardControlUnchanged(before, { ...before, dns: { enable: true } })).toBe(true);
    for (const changed of [{ "mixed-port": 0 }, { "mixed-port": 7891 }, { secret: "different" }, { "external-controller-unix": "/tmp/other.sock" }, { "bind-address": "192.0.2.1" }, { authentication: ["test:test"] }]) {
      expect(guardControlUnchanged(before, { ...before, ...changed })).toBe(false);
    }
    expect(guardControlUnchanged({ "mixed-port": 0 }, { "mixed-port": 0 })).toBe(false);
  });
});
