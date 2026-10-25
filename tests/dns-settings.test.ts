import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { defaultDnsSettings, parseDnsSettings } from "../src/config/dns-settings";
import { createMihomoProfile } from "../src/worker/mihomo-profile";
import { applyRuleTemplate } from "../src/worker/rule-template";

const nodes = "proxies: [{name: JP, type: ss, server: node.example, port: 443, cipher: aes-128-gcm, password: dummy}]";

describe("DNS dependency boundary", () => {
  it("separates bootstrap from business queries without enabling TUN or sniffing", () => {
    const config = parse(createMihomoProfile(nodes));
    expect(config.dns["proxy-server-nameserver"]).toEqual(["system"]);
    expect(config.dns.nameserver.every((url: string) => url.endsWith("#DNS-PROXY"))).toBe(true);
    expect(config["proxy-groups"].find((group: { name: string }) => group.name === "DNS-PROXY")).toMatchObject({ "empty-fallback": "REJECT", "include-all": true, "exclude-type": "direct|reject" });
    expect(config.ipv6).toBe(false);
    expect(config.dns.ipv6).toBe(false);
    expect(config.tun).toBeUndefined();
    expect(config.sniffer).toBeUndefined();
  });
  it("sends only DIRECT connections and Tencent media lookups to domestic DoH", () => {
    const config = parse(createMihomoProfile(nodes));
    const domestic = ["https://223.5.5.5/dns-query", "https://1.12.12.12/dns-query"];
    expect(config.dns["direct-nameserver"]).toEqual(domestic);
    expect(config.dns["fake-ip-filter"]).toEqual(["*.lan", "*.local", "localhost", "+.qq.com", "+.qpic.cn", "+.qlogo.cn", "+.gtimg.cn", "+.gtimg.com", "+.wechat.com", "+.icbc.com.cn", "+.icbc.com", "+.95588.com"]);
    expect(config.dns["nameserver-policy"]).toEqual(Object.fromEntries(config.dns["fake-ip-filter"].slice(3).map((domain: string) => [domain, domestic])));
    expect(config.dns.fallback).toBeUndefined();
    expect(config.dns["direct-nameserver-follow-policy"]).toBeUndefined();
  });
  it("accepts explicit bootstrap DoH but prevents a hostname bootstrap loop", () => {
    const settings = { ...defaultDnsSettings, bootstrapMode: "custom" as const, bootstrap: ["https://9.9.9.9/dns-query"], ipv6: true };
    const config = parse(createMihomoProfile(nodes, "flacier", 6, "doh", undefined, settings));
    expect(config.dns["default-nameserver"]).toEqual(settings.bootstrap);
    expect(config.dns.ipv6).toBe(true);
    expect(config.ipv6).toBe(true);
    expect(() => createMihomoProfile(nodes, "flacier", 6, "doh", undefined, { ...settings, bootstrap: ["https://dns.example/dns-query"] })).toThrow("Bootstrap DoH");
  });
  it("inherits only independent bootstrap resolvers and preserves host mappings", () => {
    const upstream = { hosts: { "node.example": "192.0.2.1" }, dns: {
      "default-nameserver": ["223.5.5.5"], "proxy-server-nameserver": ["https://dns.alidns.com/dns-query"],
    } };
    const settings = { ...defaultDnsSettings, bootstrapMode: "upstream" as const };
    const config = parse(createMihomoProfile(nodes, "flacier", 6, "doh", upstream, settings));
    expect(config.hosts).toEqual(upstream.hosts);
    expect(config.dns["proxy-server-nameserver"]).toEqual(upstream.dns["proxy-server-nameserver"]);
    expect(() => createMihomoProfile(nodes, "flacier", 6, "doh", { dns: {} }, settings)).toThrow("independent");
  });
  it.each([
    { nameserver: ["https://1.1.1.1/dns-query#RemovedGroup"] },
    { "nameserver-policy": { "rule-set:removed": "1.1.1.1" } },
    { "respect-rules": true, nameserver: ["1.1.1.1"] },
    { "proxy-server-nameserver": ["https://1.1.1.1/dns-query#en0"] },
  ])("refuses DNS dependencies that conversion cannot preserve: %j", dns => {
    expect(() => createMihomoProfile(nodes, "flacier", 6, "upstream", { dns })).toThrow("DNS dependency");
  });
  it("keeps DNS routing stable when applying a template with a direct first group", () => {
    const profile = createMihomoProfile(nodes);
    const ini = "custom_proxy_group=Direct`select`[]DIRECT\ncustom_proxy_group=Proxy`select`.*\nruleset=Proxy,[]FINAL";
    const result = parse(applyRuleTemplate(profile, ini));
    expect(result.dns).toEqual(parse(profile).dns);
    expect(result["proxy-groups"].find((group: { name: string }) => group.name === "DNS-PROXY")["empty-fallback"]).toBe("REJECT");
    expect(parse(profile).proxies).toEqual(result.proxies);
  });
  it("does not silently make proxy DNS direct for a direct-only legacy preset", () => {
    expect(() => createMihomoProfile(nodes, "direct")).toThrow("Proxy DNS cannot");
  });
  it("rejects unsafe or injected custom resolver parameters", () => {
    for (const value of ["http://1.1.1.1/dns-query", "https://a:b@1.1.1.1/dns-query", "https://1.1.1.1/dns-query#DIRECT"]) {
      expect(() => parseDnsSettings({ ...defaultDnsSettings, nameservers: [value] })).toThrow();
    }
    expect(() => parseDnsSettings({ ...defaultDnsSettings, nameservers: [] })).toThrow();
    expect(() => parseDnsSettings({ ...defaultDnsSettings, ipv6: "false" })).toThrow();
  });
});
