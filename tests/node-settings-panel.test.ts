import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NodeSettingsPanel } from "../src/app/features/subscriptions/NodeSettingsPanel";

describe("NodeSettingsPanel", () => {
  it("shows user-facing node processing controls without backend parameters", () => {
    const queryClient = new QueryClient();
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(NodeSettingsPanel, {
          profileId: "profile-1",
          settings: {
            includePattern: "",
            excludePattern: "",
            renameRules: [],
            sortMode: "source",
          },
          onNotice: () => undefined,
        }),
      ),
    );

    expect(html).toContain(">节点处理<");
    expect(html).toContain(">保留<");
    expect(html).toContain(">排除<");
    expect(html).toContain(">排序<");
    expect(html).toContain("保持来源顺序");
    expect(html).toContain("添加改名");
    expect(html).toContain("保存节点处理");
    expect(html).not.toContain("Sub-Store");
    expect(html).not.toContain("process");
  });
});
