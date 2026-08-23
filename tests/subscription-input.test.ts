import { describe, expect, it } from "vitest";

import { parseSubscriptionInput } from "../src/app/lib/subscription-input";

describe("parseSubscriptionInput", () => {
  it("accepts multiple subscriptions and standalone nodes", () => {
    expect(parseSubscriptionInput([
      "https://one.example/sub",
      "https://two.example/sub | vless://user@example.com:443#US",
      "hy2://secret@example.net:8443#JP",
    ].join("\n"))).toEqual([
      { name: "订阅 1", type: "subscription", value: "https://one.example/sub" },
      { name: "订阅 2", type: "subscription", value: "https://two.example/sub" },
      { name: "节点 1", type: "node", value: "vless://user@example.com:443#US" },
      { name: "节点 2", type: "node", value: "hy2://secret@example.net:8443#JP" },
    ]);
  });

  it("rejects unsupported text before creating a profile", () => {
    expect(() => parseSubscriptionInput("example.com/sub")).toThrow(
      "第 1 项不是订阅地址或节点链接",
    );
  });
});
