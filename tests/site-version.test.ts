import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSiteVersion, versionFailureText } from "../src/app/lib/site-version";

const version = { build: { builtAt: "2026-10-02T00:00:00Z", commit: "a".repeat(40), dirty: false }, deployment: null };
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("version request recovery", () => {
  it("retries a transient failure and returns the real version", async () => {
    vi.useFakeTimers();
    const fetcher = vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("offline")).mockResolvedValueOnce(Response.json(version));
    const pending = fetchSiteVersion(new AbortController().signal);
    await vi.runAllTimersAsync();
    expect(await pending).toEqual(version);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("bounds retrying and distinguishes the final network failure", async () => {
    vi.useFakeTimers();
    const fetcher = vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("offline"));
    const pending = fetchSiteVersion(new AbortController().signal).catch(error => error);
    await vi.runAllTimersAsync();
    expect(versionFailureText(await pending)).toBe("网络连接失败");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("does not retry malformed metadata or continue after unmount", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ bad: true }));
    expect(versionFailureText(await fetchSiteVersion(new AbortController().signal).catch(error => error))).toBe("版本数据异常");
    expect(fetcher).toHaveBeenCalledTimes(1);
    const controller = new AbortController(); controller.abort();
    await expect(fetchSiteVersion(controller.signal)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
