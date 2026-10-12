export type GuardEvent = { phase: string; reason?: string; elapsedMs: number };
type GuardTrial = {
  baseline: string; candidate: string; timeoutMs: number;
  apply: (payload: string) => Promise<void>;
  healthy: () => Promise<boolean>;
  confirmed: () => Promise<boolean>;
  report: (event: GuardEvent) => Promise<void>;
  stopped?: () => boolean;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
};

export async function runGuardedTrial(trial: GuardTrial) {
  const now = trial.now ?? Date.now;
  const wait = trial.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const started = now();
  const report = (phase: string, reason?: string) => trial.report({ phase, ...(reason ? { reason } : {}), elapsedMs: now() - started });
  if (!await trial.healthy()) { await report("not_applied", "baseline_health_failed"); return; }
  await report("armed");
  let rollbackReason = "confirmation_timeout";
  try {
    await trial.apply(trial.candidate);
    await report("awaiting_confirmation");
    let failures = 0;
    while (now() - started < trial.timeoutMs && !trial.stopped?.()) {
      const healthy = await trial.healthy();
      failures = healthy ? 0 : failures + 1;
      await report(healthy ? "probe_ok" : "probe_failed");
      if (healthy && now() - started < trial.timeoutMs && await trial.confirmed()) {
        await report("confirmed"); return;
      }
      if (failures >= 2) { rollbackReason = "consecutive_probe_failures"; break; }
      await wait(Math.min(1000, Math.max(0, trial.timeoutMs - (now() - started))));
    }
    if (trial.stopped?.()) rollbackReason = "watchdog_stop_requested";
  } catch { rollbackReason = "apply_or_probe_failed"; }
  // A failed apply may have taken effect before its response was lost.
  // Roll back even when the candidate request timed out.
  try {
    await trial.apply(trial.baseline);
    await report("rolled_back", rollbackReason);
    if (!await trial.healthy()) await report("rollback_unhealthy", rollbackReason);
  } catch { await report("rollback_failed", rollbackReason); }
}

export function changedConfigPaths(before: unknown, after: unknown, path = ""): string[] {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (!before || !after || typeof before !== "object" || typeof after !== "object" || Array.isArray(before) || Array.isArray(after)) return [path || "/"];
  const left = before as Record<string, unknown>, right = after as Record<string, unknown>;
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].flatMap(key =>
    changedConfigPaths(left[key], right[key], `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`));
}

export function guardControlUnchanged(before: Record<string, unknown>, after: Record<string, unknown>): boolean {
  return Number.isInteger(before["mixed-port"]) && Number(before["mixed-port"]) > 0 && Number(before["mixed-port"]) <= 65535
    && ["mixed-port", "secret", "bind-address", "authentication", "external-controller", "external-controller-tls", "external-controller-unix", "external-controller-pipe"]
      .every(key => JSON.stringify(before[key]) === JSON.stringify(after[key]));
}
