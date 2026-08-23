import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LinkPanel } from "../src/app/features/subscriptions/LinkPanel";
import type { ProfileDetail } from "../src/app/features/subscriptions/api";

describe("LinkPanel", () => {
  it("shows the universal node link before client-specific outputs", () => {
    const universalUrl = "https://rules.example.com/s/share-token";
    const profile: ProfileDetail = {
      id: "profile-1",
      name: "个人订阅",
      createdAt: "2026-08-23T00:00:00.000Z",
      updatedAt: "2026-08-23T00:00:00.000Z",
      nodeSettings: {
        includePattern: "",
        excludePattern: "",
        renameRules: [],
        sortMode: "source",
      },
      sources: [],
      nodeCount: 1,
      normalizedAt: "2026-08-23T00:00:00.000Z",
      links: [
        {
          id: "link-1",
          name: "默认链接",
          enabled: true,
          createdAt: "2026-08-23T00:00:00.000Z",
          revokedAt: null,
          universalUrl,
          urls: {},
        },
      ],
      latestRefresh: null,
      refreshHistory: [],
    };
    const queryClient = new QueryClient();

    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(LinkPanel, { profile, onNotice: () => undefined }),
      ),
    );

    expect(html).toContain("通用节点链接");
    expect(html).toContain("自动识别客户端");
    expect(html).toContain(universalUrl);
    expect(html).toContain("复制通用链接");
  });
});
