import { afterEach, describe, expect, it, vi } from "vitest";
import { SubscriptionApiError, subscriptionErrorText } from "../src/app/features/subscriptions/api";
import { createRolaCloudBase, requestCloudRola } from "../src/app/features/subscriptions/rola-api";

const upstream = { status: 403, challenge: true, cloudflare: true, responseType: "html", rayId: "a4942df21d672617-NRT", redirects: 0, checkedAt: "2026-10-12T06:52:04.891Z" };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("subscription refusal messages", () => {
  it("preserves challenge evidence from both cloud subscription callers", async () => {
    vi.stubGlobal("window", { location: { origin: "https://rules.flacier.com" } });
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ error: "source_failed", message: "Subscription source returned HTTP 403", upstream }, { status: 502 }));
    for (const request of [
      () => requestCloudRola("/preview", {}),
      () => createRolaCloudBase({ sources: [], name: "Test", sourceUserAgent: "clash.meta", target: "clash-party-config" }),
    ]) {
      const error = await request().catch(value => value);
      if (!(error instanceof SubscriptionApiError)) throw new Error("Expected a typed subscription error");
      expect(error.upstream).toEqual(upstream);
      expect(subscriptionErrorText(error)).toContain("浏览器验证页");
      expect(subscriptionErrorText(error)).toContain(upstream.rayId);
    }
  });

  it("does not claim that an ordinary 403 proves a specific block, and distinguishes rate limiting", () => {
    const denied = new SubscriptionApiError(502, "source_failed", "HTTP 403", { ...upstream, challenge: false });
    expect(subscriptionErrorText(denied)).toContain("不能确认具体拦截规则");
    expect(subscriptionErrorText(denied)).not.toContain("浏览器验证页");
    const limited = new SubscriptionApiError(502, "source_failed", "HTTP 429", { ...upstream, status: 429, challenge: false });
    expect(subscriptionErrorText(limited)).toContain("请求频率");
  });

  it("does not display arbitrary diagnostic fields returned by a backend", () => {
    const error = new SubscriptionApiError(502, "source_failed", "HTTP 403", { ...upstream, rayId: "private-token", source: "private-url", body: "private-body" });
    expect(JSON.stringify(error.upstream)).not.toContain("private-");
    expect(subscriptionErrorText(error)).not.toContain("private-");
    expect(new SubscriptionApiError(502, "source_failed", "HTTP 403", { ...upstream, status: "403" }).upstream).toBeUndefined();
  });
});

describe("connection failures", () => {
  it("only points to the local server when the selected backend is local", () => {
    const failure = new TypeError("Failed to fetch");
    expect(subscriptionErrorText(failure, "http://127.0.0.1:25500")).toContain("pnpm start:local");
    expect(subscriptionErrorText(failure, "https://rules.flacier.com")).not.toContain("pnpm start:local");
    expect(subscriptionErrorText(new DOMException("timed out", "TimeoutError"), "https://rules.flacier.com")).toContain("60 秒");
  });
});
