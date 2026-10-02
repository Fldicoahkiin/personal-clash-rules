import { isVersionInfo, type VersionInfo } from "../../config/build-info";

export class VersionReadError extends Error {
  constructor(readonly reason: "network" | "timeout" | "http" | "invalid", readonly retryable: boolean) { super(reason); }
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    function abort() { clearTimeout(timer); reject(signal.reason); }
    signal.addEventListener("abort", abort, { once: true });
  });
}

export async function fetchSiteVersion(signal: AbortSignal): Promise<VersionInfo> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    signal.throwIfAborted();
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), 5000);
    try {
      const response = await fetch("/api/version", { cache: "no-store", signal: AbortSignal.any([signal, timeout.signal]) });
      if (!response.ok) throw new VersionReadError("http", response.status === 429 || response.status >= 500);
      let data: unknown;
      try { data = await response.json(); } catch { throw new VersionReadError("invalid", false); }
      if (!isVersionInfo(data)) throw new VersionReadError("invalid", false);
      return data;
    } catch (error) {
      signal.throwIfAborted();
      const failure = timeout.signal.aborted ? new VersionReadError("timeout", true)
        : error instanceof VersionReadError ? error : new VersionReadError("network", true);
      if (attempt === 2 || !failure.retryable) throw failure;
    } finally { clearTimeout(timer); }
    await pause(attempt === 0 ? 1000 : 3000, signal);
  }
  throw new VersionReadError("network", false);
}

export function versionFailureText(error: unknown): string {
  if (!(error instanceof VersionReadError)) return "读取失败";
  return { timeout: "读取超时", network: "网络连接失败", http: "版本接口暂不可用", invalid: "版本数据异常" }[error.reason];
}
