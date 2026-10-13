import { describe, expect, it } from "vitest";
import { defaultDnsSettings } from "../src/config/dns-settings";
import { createShadowrocketProfile } from "../src/worker/shadowrocket-profile";

describe("Shadowrocket paired configuration", () => {
  it("routes unknown traffic through proxy policies with explicit imported nodes and country flags", () => {
    const output = createShadowrocketProfile(["US-01", "JP-01"]);
    expect(output).toContain("🇺🇸 美国 = select, US-01");
    expect(output).toContain("🇯🇵 日本 = select, JP-01");
    expect(output).toContain("🇭🇰 香港 = select, REJECT");
    expect(output).toContain("FINAL,🐟 未匹配流量");
    expect(output).toContain("🐟 未匹配流量 = select, 🚀 节点选择");
    expect(output).toContain("RULE-SET,https://rules.flacier.com/rules/ai/anthropic.list,🤖 AI");
    expect(output).not.toContain("PROCESS-NAME");
    expect(output).not.toContain("COMPATIBLE");
    expect(output).not.toContain("[MITM]");
    expect(output).not.toContain("[Proxy]\n");
  });

  it("keeps node bootstrap separate and does not leave business DNS fallback empty or system", () => {
    const output = createShadowrocketProfile(["US-01"]);
    expect(output).toContain("ipv6 = false");
    expect(output).toContain("proxy-dns-server = system");
    for (const key of ["dns-server", "direct-dns-server", "fallback-dns-server"]) {
      expect(output).toContain(`${key} = https://1.1.1.1/dns-query#proxy, https://8.8.8.8/dns-query#proxy`);
    }
    expect(output).toContain("udp-policy-not-supported-behaviour = REJECT");
    expect(output).toContain("dns-direct-system = false");
    expect(output).toContain("close-if-proxy-chain-missing = true");
    const custom = createShadowrocketProfile(["US-01"], "flacier", "doh", { ...defaultDnsSettings, bootstrapMode: "custom", bootstrap: ["https://1.1.1.1/dns-query"] });
    expect(custom).toContain("proxy-dns-server = https://1.1.1.1/dns-query\n");
  });

  it("shares domestic domain routing after explicit services and limits the China IP fallback to known addresses", () => {
    const output = createShadowrocketProfile(["US-01"]);
    const domestic = "RULE-SET,https://rules.flacier.com/rules/direct/china-domains.list,DIRECT";
    expect(output).toContain(domestic);
    expect(output.indexOf("RULE-SET,https://rules.flacier.com/rules/developer/developer.list,🛠 开发服务")).toBeLessThan(output.indexOf(domestic));
    expect(output.indexOf("RULE-SET,https://rules.flacier.com/rules/ai/openai.list,🤖 AI")).toBeLessThan(output.indexOf(domestic));
    expect(output).toContain("GEOIP,CN,DIRECT,no-resolve\nFINAL,🐟 未匹配流量");
    expect(output).toContain("📺 Bilibili = select, DIRECT,");
  });

  it("rejects missing nodes, INI injection and incompatible inherited DNS instead of guessing", () => {
    expect(() => createShadowrocketProfile([])).toThrow();
    expect(() => createShadowrocketProfile(["US, DIRECT"])).toThrow();
    expect(() => createShadowrocketProfile(["US\n[Rule]"])).toThrow();
    expect(() => createShadowrocketProfile(["US-01"], "flacier", "upstream")).toThrow();
    expect(() => createShadowrocketProfile(["US-01"], "flacier", "doh", { ...defaultDnsSettings, bootstrapMode: "upstream" })).toThrow();
    expect(() => createShadowrocketProfile(["US-01"], "global")).toThrow();
  });
});
