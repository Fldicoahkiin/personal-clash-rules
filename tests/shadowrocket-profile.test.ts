import { describe, expect, it } from "vitest";
import { defaultDnsSettings } from "../src/config/dns-settings";
import { createShadowrocketProfile } from "../src/worker/shadowrocket-profile";

describe("Shadowrocket paired configuration", () => {
  it("uses the homepage node for proxy traffic without creating policy groups or pinning node names", () => {
    const output = createShadowrocketProfile(["US-01", "JP-01"]);
    expect(output).toContain("FINAL,PROXY");
    expect(output).toContain("RULE-SET,https://rules.flacier.com/rules/ai/anthropic.list,PROXY");
    expect(output).not.toContain("[Proxy Group]");
    expect(output).not.toMatch(/US-01|JP-01| = select,| = url-test,/);
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

  it("resolves the China IP fallback after explicit services and before the homepage proxy fallback", () => {
    const output = createShadowrocketProfile(["US-01"]);
    const domestic = "RULE-SET,https://rules.flacier.com/rules/direct/china-domains.list,DIRECT";
    expect(output).toContain(domestic);
    expect(output.indexOf("RULE-SET,https://rules.flacier.com/rules/developer/developer.list,PROXY")).toBeLessThan(output.indexOf(domestic));
    expect(output.indexOf("RULE-SET,https://rules.flacier.com/rules/ai/openai.list,PROXY")).toBeLessThan(output.indexOf(domestic));
    expect(output).toContain("GEOIP,CN,DIRECT\nFINAL,PROXY");
    expect(output).toContain("RULE-SET,https://rules.flacier.com/rules/media/bilibili.list,DIRECT");
  });

  it("preserves explicit direct and reject rules while mapping inherited node and group policies to the homepage", () => {
    const output = createShadowrocketProfile(["US-01"], "flacier", "doh", defaultDnsSettings, {
      groups: [], providers: {}, bootstrap: ["system"], rules: [
        "DOMAIN-SUFFIX,dingtalk.com,DIRECT", "DOMAIN-SUFFIX,blocked.example,REJECT",
        "DOMAIN-SUFFIX,claude.ai,Home", "DOMAIN,other.example,US-01", "MATCH,GLOBAL",
      ],
    });
    expect(output).toContain("DOMAIN-SUFFIX,dingtalk.com,DIRECT");
    expect(output).toContain("DOMAIN-SUFFIX,blocked.example,REJECT");
    expect(output).toContain("DOMAIN-SUFFIX,claude.ai,PROXY");
    expect(output).toContain("DOMAIN,other.example,PROXY");
    expect(output).toContain("FINAL,PROXY");
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
