import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SubscriptionResult } from "../src/app/components/SubscriptionResult";
import { completeConfigFormats } from "../src/app/features/subscriptions/client-formats";

const format = completeConfigFormats[0];

describe("SubscriptionResult", () => {
  it("shows Worker conversion counts", () => {
    const html = renderToStaticMarkup(createElement(SubscriptionResult, {
      copied: false,
      format,
      onCopy: () => undefined,
      result: {
        nodeStats: { read: 12, output: 10, skipped: 2 },
        profileName: "Flacierの分流规则",
        sourceMode: "convert",
        target: "clash-party-config",
        universalUrl: "https://rules.flacier.com/s/abcdefghijklmnop",
        url: "https://rules.flacier.com/s/abcdefghijklmnop/clash-party-config",
      },
    }));

    expect(html).toContain("Worker 转换");
    expect(html).toContain("读取</dt><dd>12");
    expect(html).toContain("输出</dt><dd>10");
    expect(html).toContain("跳过</dt><dd>2");
  });

  it("does not invent node counts for client-direct sources", () => {
    const html = renderToStaticMarkup(createElement(SubscriptionResult, {
      copied: false,
      format,
      onCopy: () => undefined,
      result: {
        nodeStats: { read: null, output: null, skipped: null },
        profileName: "Flacierの分流规则",
        sourceMode: "mihomo-provider",
        target: "clash-party-config",
        universalUrl: "https://rules.flacier.com/s/abcdefghijklmnop",
        url: "https://rules.flacier.com/s/abcdefghijklmnop/clash-party-config",
      },
    }));

    expect(html).toContain("客户端直读");
    expect(html).toContain("由客户端读取");
    expect(html).not.toContain("读取</dt><dd>0");
  });
});
