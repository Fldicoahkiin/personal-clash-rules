import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SubscriptionFormatPicker } from "../src/app/components/SubscriptionFormatPicker";
import { SubscriptionMoreSettings } from "../src/app/components/SubscriptionMoreSettings";

describe("subscription controls", () => {
  it("separates complete configurations from node-only outputs", () => {
    const html = renderToStaticMarkup(createElement(SubscriptionFormatPicker, {
      target: "clash-party-config",
      onChange: () => undefined,
    }));

    expect(html).toContain("完整配置");
    expect(html).toContain("含策略组、规则和 DNS");
    expect(html).toContain("仅节点");
    expect(html).toContain("不含策略组、规则和 DNS");
    expect(html).not.toContain("其他输出格式");
  });

  it("explains every advanced setting and keeps the country flag wording", () => {
    const html = renderToStaticMarkup(createElement(SubscriptionMoreSettings, {
      addCountryFlag: true,
      allowClientFallback: false,
      dnsMode: "doh",
      excludePattern: "",
      includePattern: "",
      renameRules: [{ id: "rename-test", pattern: "", replacement: "" }],
      showNodeType: false,
      skipCertVerify: false,
      sourceUserAgent: "mihomo/1.19",
      sortMode: "source",
      tfo: false,
      udp: true,
      updateIntervalHours: 6,
      xudp: false,
      onBooleanChange: () => undefined,
      onDnsModeChange: () => undefined,
      onRenameRulesChange: () => undefined,
      onSortChange: () => undefined,
      onTextChange: () => undefined,
      onUpdateIntervalChange: () => undefined,
    }));

    for (const description of [
      "用于请求机场订阅",
      "控制配置和节点源刷新",
      "仅保留名称匹配的节点",
      "移除名称匹配的节点",
      "正则匹配节点名称",
      "替换匹配到的名称",
      "客户端直读时仅支持来源顺序",
      "按节点名称识别国家或地区",
      "在名称前显示协议类型",
      "用于语音、游戏和 QUIC",
      "为 VMess 与 VLESS 使用 XUDP",
      "仅用于证书异常的 TLS 节点",
      "仅对支持 TFO 的连接生效",
    ]) {
      expect(html).toContain(description);
    }
    expect(html).toContain("国家旗帜");
    expect(html).toContain("客户端直读备用");
    expect(html).toContain("添加重命名");
    expect(html).not.toContain("Emoji");
  });
});
