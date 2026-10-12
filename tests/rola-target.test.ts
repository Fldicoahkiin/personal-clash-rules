import { describe, expect, it, vi } from "vitest";
import * as yaml from "yaml";
import { defaultDnsSettings } from "../src/config/dns-settings";
import { prepareRolaProfile } from "../src/local/rola";
import { createMihomoProfile } from "../src/worker/mihomo-profile";
import { renderRolaTarget } from "../src/worker/rola-target";
import { createShadowrocketProfile } from "../src/worker/shadowrocket-profile";
import type { SubscriptionEnv } from "../src/worker/types";

vi.mock("yaml", async importOriginal => {
  const original = await importOriginal<typeof import("yaml")>();
  return { ...original, stringify: vi.fn(original.stringify) };
});

const env = {} as SubscriptionEnv;
const settings = {
  authMode: "literal", connectionMode: "direct", protocol: "socks5", country: "us",
  name: "US Home", groupName: "Home", policyGroup: "AI", server: "residential.example",
  port: 9004, account: "fixture-account", password: "fixture-password",
  rules: ["DOMAIN-SUFFIX,claude.ai"], dns: ["https://1.1.1.1/dns-query"],
};
const airportNodes = Array.from({ length: 68 }, (_, index) => ({
  name: `${index < 34 ? "US" : "JP"} Airport ${index + 1}`, server: "airport.example", port: 443,
  ...(index % 2 ? { type: "hysteria2", password: "fixture-airport-secret", sni: "tls.example" }
    : { type: "vless", uuid: "00000000-0000-4000-8000-000000000001", tls: true, network: "ws", "ws-opts": { path: "/socket" } }),
}));
const profile = prepareRolaProfile(createMihomoProfile(yaml.stringify({ proxies: airportNodes })), settings).profile;

describe("residential mobile rendering resource budget", () => {
  it("renders 69 paired nodes and configuration without serializing unused Mihomo YAML", async () => {
    const serialize = vi.mocked(yaml.stringify).mockClear();
    try {
      const nodes = await renderRolaTarget(env, profile, settings, "shadowrocket");
      expect(nodes.split("\n")).toHaveLength(69);
      const config = await renderRolaTarget(env, profile, settings, "shadowrocket-config");
      for (const node of airportNodes) expect(config).toContain(node.name);
      expect(config).toContain("Home = select, US Home");
      expect(config).toContain("🇺🇸 美国 = select, US Airport 1");
      expect(config).toContain("DOMAIN-SUFFIX,claude.ai,🤖 AI");
      expect(config).not.toMatch(/fixture-password|fixture-airport-secret/);
      expect(serialize).not.toHaveBeenCalled();
    } finally { serialize.mockClear(); }
  });

  it("compiles each group filter once, not once per node", () => {
    const source = yaml.parse(profile);
    const OriginalRegExp = RegExp;
    let compilations = 0;
    vi.stubGlobal("RegExp", class extends OriginalRegExp {
      constructor(pattern: string | RegExp, flags?: string) {
        super(pattern, flags);
        compilations += 1;
      }
    });
    try {
      const config = createShadowrocketProfile(source.proxies.map((node: { name: string }) => node.name), "flacier", "doh", defaultDnsSettings, {
        groups: source["proxy-groups"], rules: ["MATCH,🌐 全局"], providers: {}, dnsNode: settings.name, bootstrap: ["system"],
      });
      expect(config).toContain("🇺🇸 美国 = select, US Airport 1");
      expect(config).toContain("Home = select, US Home");
      expect(compilations).toBeLessThanOrEqual(source["proxy-groups"].length * 2);
    } finally { vi.unstubAllGlobals(); }
  });

  it("does not compile unused filters on an explicit group", () => {
    const output = createShadowrocketProfile(["US Home"], "flacier", "doh", defaultDnsSettings, {
      groups: [{ name: "Home", type: "select", proxies: ["US Home"], filter: "[", "exclude-filter": "[" }],
      rules: ["MATCH,Home"], providers: {}, dnsNode: "US Home", bootstrap: ["system"],
    });
    expect(output).toContain("Home = select, US Home");
  });
});
