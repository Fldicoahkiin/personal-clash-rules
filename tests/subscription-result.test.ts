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
        usage: {
          combined: {
            upload: "5120",
            download: "10240",
            total: "322122547200",
            expire: "1805938734",
          },
          sources: [
            {
              name: "机场 A",
              status: "available",
              usage: { upload: "1024", download: "2048", total: "107374182400" },
            },
            {
              name: "机场 B",
              status: "available",
              usage: { upload: "4096", download: "8192", total: "214748364800" },
            },
          ],
        },
        universalUrl: "https://rules.flacier.com/s/abcdefghijklmnop",
        url: "https://rules.flacier.com/s/abcdefghijklmnop/clash-party-config",
      },
    }));

    expect(html).toContain("Worker 转换");
    expect(html).toContain("读取</dt><dd>12");
    expect(html).toContain("输出</dt><dd>10");
    expect(html).toContain("跳过不兼容节点</dt><dd>2");
    expect(html).toContain("合计流量");
    expect(html).toContain("机场 A");
    expect(html).toContain("已读取");
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
        usage: {
          combined: null,
          sources: [{ name: "机场 A", status: "client-only" }],
        },
        universalUrl: "https://rules.flacier.com/s/abcdefghijklmnop",
        url: "https://rules.flacier.com/s/abcdefghijklmnop/clash-party-config",
      },
    }));

    expect(html).toContain("客户端直读");
    expect(html).toContain("由客户端读取");
    expect(html).toContain("Worker 不可见");
    expect(html).toContain("Worker 无法统计节点，也无法重新排序");
    expect(html).toContain("机场未向 Worker 返回用量，Clash Party 会显示“远程”");
    expect(html).toContain("跳过不兼容节点");
    expect(html).not.toContain("读取</dt><dd>0");
  });
});
