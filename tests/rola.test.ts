import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { parse, stringify } from "yaml";

import { createRolaOverride, createRolaTemplate, parseRolaSettings, prepareRolaProfile, rolaRulePaths } from "../src/local/rola";
import { parseRolaUsage, readRolaUsage } from "../src/local/rola-usage";
import { createMihomoProfile } from "../src/worker/mihomo-profile";

const settings = {
  ...createRolaTemplate(["DOMAIN-SUFFIX,claude.ai\nDOMAIN,anthropic.auth0.com"]),
  protocol: "socks5", server: "residential.example", port: 1080,
  account: "demo", password: "demo:p@ss", upstreamNode: "Airport",
};
const source = `# Keep the user's comment
mode: rule
mixed-port: 7890
ipv6: false
custom-field: keep-me
tun: {enable: false, strict-route: false}
sniffer: {enable: false}
dns:
  enable: true
  nameserver: [https://1.1.1.1/dns-query#Airport]
  proxy-server-nameserver: [system] # Bootstrap must not depend on Rola
  use-system-hosts: false
proxies:
  - name: Airport
    type: vless
    server: airport.example
    port: 443
    uuid: 00000000-0000-4000-8000-000000000000
    tls: true
    network: ws
    ws-opts: {path: /route, headers: {Host: transport.example}}
    custom-field: preserve-node-field
proxy-groups:
  - name: AUTO
    type: url-test
    include-all: true
    exclude-filter: '(?i)expired'
    url: https://cp.cloudflare.com/generate_204
    interval: 300
  - name: MANUAL
    type: select
    include-all-proxies: true
  - name: OTHER
    type: select
    proxies: [DIRECT]
rules:
  # Preserve original rule order
  - DOMAIN-SUFFIX,example.org,DIRECT
  - MATCH,AUTO
`;

describe("local Rola preparation", () => {
  it.each([undefined, "Zulu Airport"])("keeps the original DNS default %s while making residential selectable once", defaultSelected => {
    const original = parse(createMihomoProfile(stringify({ proxies: [
      { name: "Zulu Airport", type: "trojan", server: "airport.example", port: 443, password: "demo" },
      { name: "Alpha Airport", type: "trojan", server: "airport.example", port: 443, password: "demo" },
      { name: "0 Direct Airport", type: "direct" },
      { name: "0 剩余流量 Airport", type: "trojan", server: "airport.example", port: 443, password: "demo" },
    ] })));
    const before = original["proxy-groups"].find((group: { name: string }) => group.name === "DNS-PROXY");
    before.filter = "(?i)(airport|residential)";
    if (defaultSelected) before["default-selected"] = defaultSelected;
    const base = stringify(original);
    const input = { ...settings, connectionMode: "direct", upstreamNode: "", name: "0 Residential" };
    const prepared = prepareRolaProfile(base, input);
    const output = parse(prepared.profile);
    expect(prepared.summary.dnsSelection).toContain("已加入家宽选项");
    const group = output["proxy-groups"].find((group: { name: string }) => group.name === "DNS-PROXY");
    expect(group).toEqual({ ...before, "default-selected": defaultSelected ?? "Alpha Airport" });
    const candidates = output.proxies.filter((node: { name: string; type: string }) => (
      !group["exclude-type"].split("|").includes(node.type)
      && new RegExp(group.filter.replace(/^\(\?i\)/u, ""), "iu").test(node.name)
      && !new RegExp(group["exclude-filter"].replace(/^\(\?i\)/u, ""), "iu").test(node.name)
    )).map((node: { name: string }) => node.name);
    expect(candidates.filter((name: string) => name === input.name)).toHaveLength(1);
    expect(candidates).not.toContain("0 Direct Airport");
    expect(candidates).not.toContain("0 剩余流量 Airport");
    expect(candidates).not.toContain("DIRECT");
    expect(group.proxies ?? []).not.toContain(input.name);
    const auto = output["proxy-groups"].find((group: { name: string }) => group.name === "♻️ 自动选择");
    expect(new RegExp(auto["exclude-filter"].replace(/^\(\?i\)/u, ""), "iu").test(input.name)).toBe(true);
    expect(output.dns["proxy-server-nameserver"]).toEqual(original.dns["proxy-server-nameserver"]);
    expect(output.dns.nameserver).toEqual(original.dns.nameserver);
    expect(output.profile).toEqual(original.profile);
    expect(JSON.parse(JSON.stringify(runInNewContext(createRolaOverride(base, input) + '\nmain(config)', { config: original }, { timeout: 1000 })))).toEqual(output);
  });

  it("recomputes the DNS airport default from refreshed local override nodes", () => {
    const base = createMihomoProfile("proxies: [{name: Zulu Airport, type: trojan, server: airport.example, port: 443, password: demo}]");
    const input = { ...settings, connectionMode: "direct", upstreamNode: "", name: "0 Residential" };
    const current = parse(base);
    current.proxies.push({ ...current.proxies[0], name: "Alpha Airport" });
    const output = runInNewContext(createRolaOverride(base, input) + '\nmain(config)', { config: current }, { timeout: 1000 });
    const dns = output["proxy-groups"].find((group: { name: string }) => group.name === "DNS-PROXY");
    expect(dns["default-selected"]).toBe("Alpha Airport");
    expect(dns["include-all"]).toBe(true);
    expect(dns["exclude-filter"]).not.toContain(input.name);
  });

  it.each([undefined, "Provider selection"])("preserves provider-backed DNS when the original default %s cannot be established locally", selected => {
    const original = parse(createMihomoProfile("proxies: [{name: 剩余流量, type: trojan, server: airport.example, port: 443, password: demo}]"));
    original["proxy-providers"] = { remote: { type: "http", url: "https://provider.example/nodes", path: "./remote.yaml" } };
    const before = original["proxy-groups"].find((group: { name: string }) => group.name === "DNS-PROXY");
    if (selected) before["default-selected"] = selected;
    const input = { ...settings, connectionMode: "direct", upstreamNode: "", name: "0 Residential" };
    const base = stringify(original);
    const prepared = prepareRolaProfile(base, input);
    const output = parse(prepared.profile);
    expect(prepared.summary.dnsSelection).toContain("尚未加入家宽");
    const dns = output["proxy-groups"].find((group: { name: string }) => group.name === "DNS-PROXY");
    expect(dns).toEqual({ ...before, "exclude-filter": `${before["exclude-filter"]}|^0 Residential$` });
    expect(output["proxy-providers"]).toEqual(original["proxy-providers"]);
    expect(JSON.parse(JSON.stringify(runInNewContext(createRolaOverride(base, input) + '\nmain(config)', { config: original }, { timeout: 1000 })))).toEqual(output);
  });

  it.each([undefined, "Zulu Airport", "0 Provider"])("preserves mixed inline/provider DNS and its default %s", selected => {
    const original = parse(createMihomoProfile(stringify({ proxies: [
      { name: "Zulu Airport", type: "trojan", server: "airport.example", port: 443, password: "demo" },
      { name: "Alpha Airport", type: "trojan", server: "airport.example", port: 443, password: "demo" },
    ] })));
    original["proxy-providers"] = { remote: { type: "inline", payload: [
      { name: "0 Provider", type: "trojan", server: "provider.example", port: 443, password: "demo" },
    ] } };
    const before = original["proxy-groups"].find((group: { name: string }) => group.name === "DNS-PROXY");
    if (selected) before["default-selected"] = selected;
    const input = { ...settings, connectionMode: "direct", upstreamNode: "", name: "0 Residential" };
    const base = stringify(original);
    const prepared = prepareRolaProfile(base, input);
    const output = parse(prepared.profile);
    const dns = output["proxy-groups"].find((group: { name: string }) => group.name === "DNS-PROXY");
    // Mihomo prepends inline nodes before external provider pools; provider names are not globally sorted with them.
    expect(dns).toEqual(selected === "0 Provider"
      ? { ...before, "exclude-filter": `${before["exclude-filter"]}|^0 Residential$` }
      : { ...before, "default-selected": selected ?? "Alpha Airport" });
    expect(prepared.summary.dnsSelection).toContain(selected === "0 Provider" ? "尚未加入家宽" : "已加入家宽选项");
    expect(output["proxy-providers"]).toEqual(original["proxy-providers"]);
    expect(JSON.parse(JSON.stringify(runInNewContext(createRolaOverride(base, input) + '\nmain(config)', { config: original }, { timeout: 1000 })))).toEqual(output);
  });

  it("does not guess an airport default from Mihomo multi-expression filters", () => {
    const original = parse(createMihomoProfile("proxies: [{name: Alpha Airport, type: trojan, server: airport.example, port: 443, password: demo}]"));
    const before = original["proxy-groups"].find((group: { name: string }) => group.name === "DNS-PROXY");
    before["exclude-filter"] = "Alpha`Expired";
    const input = { ...settings, connectionMode: "direct", upstreamNode: "", name: "0 Residential" };
    const prepared = prepareRolaProfile(stringify(original), input);
    expect(prepared.summary.dnsSelection).toContain("尚未加入家宽");
    const group = parse(prepared.profile)["proxy-groups"].find((group: { name: string }) => group.name === "DNS-PROXY");
    expect(group["default-selected"]).toBeUndefined();
    expect(group["exclude-filter"]).toBe("Alpha`Expired|^0 Residential$");
  });

  it.each([
    ["192.0.2.20", "AND,((IP-CIDR,192.0.2.20/32,no-resolve),(DST-PORT,1080)),DIRECT"],
    ["residential.example", "AND,((DOMAIN,residential.example),(DST-PORT,1080)),DIRECT"],
  ])("routes external clients directly only to the exact residential endpoint %s", (server, gatewayRule) => {
    const input = { ...settings, connectionMode: "direct", upstreamNode: "", server };
    const original = parse(source);
    original.rules.push(gatewayRule, gatewayRule);
    const base = stringify(original);
    const output = parse(prepareRolaProfile(base, input).profile);
    expect(output.rules[0]).toBe(gatewayRule);
    expect(output.rules.filter((rule: string) => rule === gatewayRule)).toHaveLength(1);
    expect(output.rules).not.toContain(`IP-CIDR,${server}/32,DIRECT,no-resolve`);
    expect(output.rules).not.toContain(`DOMAIN-SUFFIX,${server},DIRECT`);
    expect(output.rules).not.toContain("PROCESS-NAME,Roxy,DIRECT");
    expect(JSON.parse(JSON.stringify(runInNewContext(createRolaOverride(base, input) + '\nmain(config)', { config: original }, { timeout: 1000 })))).toEqual(output);
    const chained = parse(prepareRolaProfile(source, { ...settings, server }).profile);
    expect(chained.rules).not.toContain(gatewayRule);
    for (const invalid of [`${server},DIRECT`, `${server}),(DST-PORT,443`, `${server}\nMATCH,DIRECT`]) {
      expect(() => prepareRolaProfile(source, { ...input, server: invalid })).toThrow("Rola server");
    }
  });

  it.each([
    ["us", "Dedicated exit", "🇺🇸 美国"],
    ["jp", "US Home", "🇯🇵 日本"],
    ["de", "Dedicated exit", "🇪🇺 欧洲"],
    ["", "US Home", "🇺🇸 美国"],
    ["", "Tokyo Home", "🇯🇵 日本"],
    ["", "Private exit", ""],
    ["zz", "US Home", ""],
  ])("adds residential country %s / name %s only to its matching region", (country, name, region) => {
    const base = createMihomoProfile("proxies: [{name: US Airport, type: trojan, server: airport.example, port: 443, password: demo}]");
    const input = { ...settings, authMode: "literal", connectionMode: "direct", upstreamNode: "", country, name };
    const output = parse(prepareRolaProfile(base, input).profile);
    for (const groupName of ["🇺🇸 美国", "🇯🇵 日本", "🇸🇬 新加坡", "🇭🇰 香港", "🇹🇼 台湾", "🇰🇷 韩国", "🇪🇺 欧洲"]) {
      const group = output["proxy-groups"].find((group: { name: string }) => group.name === groupName);
      const members: string[] = group.proxies ?? [];
      expect(members).not.toContain(name);
      expect(members).not.toContain("ROLA");
      const matches = (filter: string) => new RegExp(filter.replace(/^\(\?i\)/u, ""), "iu").test(name);
      expect(matches(group["exclude-filter"]), groupName).toBe(groupName !== region);
      if (groupName === region) expect(matches(group.filter)).toBe(true);
    }
    const us = output["proxy-groups"].find((group: { name: string }) => group.name === "🇺🇸 美国");
    expect(us["include-all"]).toBe(true);
    expect(new RegExp(us.filter.replace(/^\(\?i\)/u, ""), "iu").test("US Airport")).toBe(true);
    const usNodes = output.proxies.filter((node: { name: string }) => new RegExp(us.filter.replace(/^\(\?i\)/u, ""), "iu").test(node.name)
      && !new RegExp(us["exclude-filter"].replace(/^\(\?i\)/u, ""), "iu").test(node.name)).map((node: { name: string }) => node.name);
    expect(usNodes).toEqual(region === "🇺🇸 美国" ? ["US Airport", name] : ["US Airport"]);
    const auto = output["proxy-groups"].find((group: { name: string }) => group.name === "♻️ 自动选择");
    expect(auto.proxies ?? []).not.toContain(name);
    expect(new RegExp(auto["exclude-filter"].replace(/^\(\?i\)/u, ""), "iu").test(name)).toBe(true);
    expect(output["proxy-groups"].find((group: { name: string }) => group.name === "ROLA").proxies).toEqual([name]);
    expect(JSON.parse(JSON.stringify(runInNewContext(createRolaOverride(base, input) + '\nmain(config)', { config: parse(base) }, { timeout: 1000 })))).toEqual(output);
  });

  it.each([false, true])("preserves regional ordering with include-all-proxies=%s", includeAllProxies => {
    const original = parse(createMihomoProfile("proxies: [{name: US Airport, type: trojan, server: airport.example, port: 443, password: demo}]"));
    const us = original["proxy-groups"].find((group: { name: string }) => group.name === "🇺🇸 美国");
    delete us["include-all"];
    if (includeAllProxies) us["include-all-proxies"] = true;
    else us.proxies = ["US Airport"];
    const base = stringify(original);
    const input = { ...settings, connectionMode: "direct", upstreamNode: "", name: "Dedicated exit" };
    const output = parse(prepareRolaProfile(base, input).profile);
    expect(output["proxy-groups"].find((group: { name: string }) => group.name === "🇺🇸 美国").proxies)
      .toEqual(includeAllProxies ? undefined : ["US Airport", input.name]);
    expect(JSON.parse(JSON.stringify(runInNewContext(createRolaOverride(base, input) + '\nmain(config)', { config: original }, { timeout: 1000 })))).toEqual(output);
  });

  it("makes the residential group selectable in every business policy without adding it to automatic or unrelated regional pools", () => {
    const base = createMihomoProfile("proxies: [{name: Airport, type: trojan, server: airport.example, port: 443, password: demo}]");
    const input = { ...settings, connectionMode: "direct", upstreamNode: "", groupName: "🇺🇸 美国家宽", policyGroup: "AI" };
    const output = parse(prepareRolaProfile(base, input).profile);
    const businessNames = ["🤖 AI", "🍎 Apple", "🎮 Steam", "📥 Steam 下载", "🕹️ Steam 联机", "💬 Discord", "🛠️ 开发服务", "🎬 流媒体", "📺 哔哩哔哩", "📺 巴哈姆特", "💬 社交", "🐟 未匹配流量"];
    const eligible = ["🌐 全局", "🖐 手动选择", "♻️ 自动选择", "🇺🇸 美国", "🇯🇵 日本", "🇸🇬 新加坡", "🇭🇰 香港", "🇹🇼 台湾", "🇰🇷 韩国", "🇪🇺 欧洲", "DIRECT", input.groupName];
    for (const name of businessNames) {
      const group = output["proxy-groups"].find((group: { name: string }) => group.name === name);
      expect(new Set(group.proxies), name).toEqual(new Set(eligible));
      expect(group["include-all"], name).toBe(true);
      expect(group["exclude-filter"], name).toContain("ROLA-RESIDENTIAL");
    }
    for (const name of ["♻️ 自动选择", "🇯🇵 日本"]) {
      const group = output["proxy-groups"].find((group: { name: string }) => group.name === name);
      expect(group.proxies ?? []).not.toContain(input.groupName);
      expect(group["exclude-filter"]).toContain("ROLA-RESIDENTIAL");
    }
    expect(output["proxy-groups"].slice(0, 3).map((group: { name: string }) => group.name)).toEqual(["🖐 手动选择", "🌐 全局", input.groupName]);
    expect(JSON.parse(JSON.stringify(runInNewContext(createRolaOverride(base, input) + '\nmain(config)', { config: parse(base) }, { timeout: 1000 })))).toEqual(output);
  });

  it("migrates stored settings without a policy choice to AI so DNS follows later client exit changes", () => {
    const base = createMihomoProfile("proxies: [{name: Airport, type: trojan, server: airport.example, port: 443, password: demo}]");
    const input = { ...settings, connectionMode: "direct", upstreamNode: "", groupName: "🇺🇸 美国家宽" };
    const output = parse(prepareRolaProfile(base, input).profile);
    expect(output.rules[2]).toBe("DOMAIN-SUFFIX,claude.ai,🤖 AI");
    expect(output.dns["nameserver-policy"]["+.claude.ai"]).toEqual(settings.dns.map(url => `${url}#🤖 AI`));
    expect(output.dns.nameserver).toEqual(parse(base).dns.nameserver);
    expect(JSON.stringify(output.dns["nameserver-policy"])).not.toContain(`#${input.groupName}`);
    const dedicated = parse(prepareRolaProfile(base, { ...input, policyGroup: "" }).profile);
    expect(dedicated.rules[2]).toBe(`DOMAIN-SUFFIX,claude.ai,${input.groupName}`);
    expect(dedicated.dns["nameserver-policy"]["+.claude.ai"]).toEqual(settings.dns.map(url => `${url}#${input.groupName}`));
  });

  it("exposes residential in manual, global and AI while allowing the AI choice to control protected domains and DNS", () => {
    const base = createMihomoProfile("proxies: [{name: Airport, type: trojan, server: airport.example, port: 443, password: demo}]");
    const input = { ...settings, connectionMode: "direct", upstreamNode: "", groupName: "🇺🇸 美国家宽", policyGroup: "AI" };
    const output = parse(prepareRolaProfile(base, input).profile);
    for (const name of ["🖐 手动选择", "🌐 全局", "🤖 AI"]) {
      expect(output["proxy-groups"].find((group: { name: string }) => group.name === name).proxies).toContain(input.groupName);
    }
    expect(output["proxy-groups"].find((group: { name: string }) => group.name === "🤖 AI").proxies[0]).toBe(input.groupName);
    expect(output.rules[2]).toBe("DOMAIN-SUFFIX,claude.ai,🤖 AI");
    expect(output.dns["nameserver-policy"]["+.claude.ai"][0]).toBe(`${settings.dns[0]}#🤖 AI`);
    expect(output["proxy-groups"].find((group: { name: string }) => group.name === "♻️ 自动选择")["exclude-filter"]).toContain("ROLA-RESIDENTIAL");
    expect(JSON.parse(JSON.stringify(runInNewContext(createRolaOverride(base, input) + '\nmain(config)', { config: parse(base) }, { timeout: 1000 })))).toEqual(output);
    expect(() => prepareRolaProfile(source, input)).toThrow("policy group");
    const changed = parse(base);
    changed["proxy-groups"].find((group: { name: string }) => group.name === "🤖 AI").proxies.push("Airport");
    const overlaid = runInNewContext(createRolaOverride(base, input) + '\nmain(config)', { config: changed }, { timeout: 1000 });
    expect(overlaid["proxy-groups"].find((group: { name: string }) => group.name === "🤖 AI").proxies).toContain("Airport");
    changed["proxy-groups"] = changed["proxy-groups"].filter((group: { name: string }) => group.name !== "🤖 AI");
    expect(() => runInNewContext(createRolaOverride(base, input) + '\nmain(config)', { config: changed }, { timeout: 1000 })).toThrow("policy group");
  });
  it.each(["socks5", "http"])("supports explicit direct %s access with a separate named group and no airport fallback", protocol => {
    const direct = { ...settings, connectionMode: "direct", upstreamNode: "", groupName: "🇺🇸 美国家宽", protocol };
    const output = prepareRolaProfile(source, direct);
    const profile = parse(output.profile);
    expect(profile.proxies.at(-1)).toMatchObject({ type: protocol, "dialer-proxy": "DIRECT", udp: false });
    expect(profile["proxy-groups"][2]).toMatchObject({ name: direct.groupName, proxies: ["ROLA-RESIDENTIAL"], "empty-fallback": "REJECT" });
    expect(profile.rules[2]).toBe(`DOMAIN-SUFFIX,claude.ai,${direct.groupName}`);
    expect(profile.dns["nameserver-policy"]["+.claude.ai"][0]).toBe(`${settings.dns[0]}#${direct.groupName}`);
    expect(output.summary.connectionMode).toBe("direct");
    const config = parse(source);
    config.proxies[0].name = "RenamedAirport";
    const actual = runInNewContext(createRolaOverride(source, direct) + '\nmain(config)', { config }, { timeout: 1000 });
    expect(actual.proxies.at(-1)["dialer-proxy"]).toBe("DIRECT");
    expect(actual["proxy-groups"][2].name).toBe(direct.groupName);
  });

  it("requires a deliberate valid connection mode and safe group name", () => {
    expect(parseRolaSettings(settings).connectionMode).toBe("chain");
    for (const change of [{ connectionMode: "automatic" }, { connectionMode: "direct" }, { groupName: "DIRECT" }, { groupName: "AUTO" }, { groupName: "A,REJECT" }, { groupName: "A#DIRECT" }]) {
      expect(() => prepareRolaProfile(source, { ...settings, ...change })).toThrow();
    }
  });

  it("uses ready-made proxy credentials verbatim without inventing location or session suffixes", () => {
    const literal = { ...settings, authMode: "literal", account: "ready_user-country-label", country: "", sessionId: undefined, sessionMinutes: undefined };
    const parsed = parseRolaSettings(literal);
    expect(parsed.username).toBe(literal.account);
    expect(parsed.sessionMinutes).toBeNull();
    const generated = prepareRolaProfile(source, literal);
    expect(parse(generated.profile).proxies.at(-1).username).toBe(literal.account);
    expect(generated.summary.country).toBe("地区未声明");
    expect(() => parseRolaSettings({ ...literal, authMode: "invalid" })).toThrow();
  });

  it("preserves working hostname bootstrap only with independent IP bootstrap and no rule-routed DNS", () => {
    const base = parse(source);
    base.dns['proxy-server-nameserver'] = ['https://dns.example/dns-query'];
    expect(() => prepareRolaProfile(stringify(base), settings)).toThrow("independent");
    base.dns['default-nameserver'] = ['1.1.1.1'];
    expect(parse(prepareRolaProfile(stringify(base), settings).profile).dns['proxy-server-nameserver']).toEqual(base.dns['proxy-server-nameserver']);
    base.dns['respect-rules'] = true;
    expect(() => prepareRolaProfile(stringify(base), settings)).toThrow("independent");
  });

  it("exports a local-only Party override matching the validated profile and preserving refreshed airport credentials", () => {
    const script = createRolaOverride(source, { ...settings, authMode: "literal" });
    const config = parse(source);
    const expected = parse(prepareRolaProfile(source, { ...settings, authMode: "literal" }).profile);
    const actual = runInNewContext(script + '\nmain(config)', { config }, { timeout: 1000 });
    expect(JSON.parse(JSON.stringify(actual))).toEqual(expected);
    expect(config.proxies.length).toBe(1);
    config.proxies[0].uuid = "00000000-0000-4000-8000-000000000001";
    expect(runInNewContext(script + '\nmain(config)', { config }, { timeout: 1000 }).proxies[0].uuid).toBe(config.proxies[0].uuid);
    config.proxies[0].name = "Missing";
    expect(() => runInNewContext(script + '\nmain(config)', { config }, { timeout: 1000 })).toThrow("first hop");
    const dnsChanged = parse(source);
    dnsChanged.dns['proxy-server-nameserver'] = ['https://1.1.1.1/dns-query#ROLA'];
    expect(() => runInNewContext(script + '\nmain(config)', { config: dnsChanged }, { timeout: 1000 })).toThrow("DNS changed");
  });
  it("reuses the published domain rules and stable, documented session syntax", () => {
    const template = createRolaTemplate(rolaRulePaths.map(path => readFileSync(new URL(`../public/${path}`, import.meta.url), "utf8")));
    expect(template.rules).toContain("DOMAIN,anthropic.auth0.com");
    expect(template.rules).toContain("DOMAIN-SUFFIX,oaistatic.com");
    expect(parseRolaSettings({ ...settings, rules: template.rules }).username).toBe("demo_main-country-us-sessiontime-120");
    expect(parseRolaSettings(settings).username).toBe(parseRolaSettings(settings).username);
  });

  it.each(["socks5", "http"])("builds a fixed %s chain, preserves fields/comments and excludes metered nodes from include-all groups", protocol => {
    const { profile, summary } = prepareRolaProfile(source, { ...settings, protocol });
    const original = parse(source);
    const output = parse(profile);
    expect(output.proxies[0]).toEqual(original.proxies[0]);
    expect(output.proxies[1]).toMatchObject({ type: protocol, password: settings.password, udp: false, "dialer-proxy": "Airport" });
    expect(output["proxy-groups"][0]["exclude-filter"]).toBe("(?i)expired|^ROLA-RESIDENTIAL$");
    expect(output["proxy-groups"][1]["exclude-filter"]).toBe("^ROLA-RESIDENTIAL$");
    expect(output["proxy-groups"][3]).toEqual(original["proxy-groups"][2]);
    expect(output["proxy-groups"][2]).toMatchObject({ name: "ROLA", type: "select", proxies: ["ROLA-RESIDENTIAL"], "empty-fallback": "REJECT", "disable-udp": true });
    expect(output.rules.slice(0, 2)).toEqual(["AND,((DOMAIN-SUFFIX,claude.ai),(NETWORK,UDP)),REJECT", "DOMAIN-SUFFIX,claude.ai,ROLA"]);
    expect(output.rules.slice(-2)).toEqual(original.rules);
    expect(output.dns["nameserver-policy"]["+.claude.ai"]).toEqual(settings.dns.map(url => `${url}#ROLA`));
    expect(output.dns["nameserver-policy"]["anthropic.auth0.com"]).toBeDefined();
    expect(output.dns.nameserver).toEqual(original.dns.nameserver);
    expect(output.dns["proxy-server-nameserver"]).toEqual(["system"]);
    expect(output.ipv6).toBe(false);
    expect(output.dns.ipv6).toBe(false);
    expect(output["custom-field"]).toBe("keep-me");
    expect(output.tun).toEqual(original.tun);
    expect(output.sniffer).toEqual(original.sniffer);
    expect(profile).toContain("# Keep the user's comment");
    expect(profile).toContain("# Preserve original rule order");
    expect(profile).toContain("# Bootstrap must not depend on Rola");
    expect(JSON.stringify(summary)).not.toContain(settings.password);
    expect(JSON.stringify(summary)).not.toContain("demo_main");
  });

  it.each(["AUTO", "DIRECT", "COMPATIBLE", "missing"])("rejects non-concrete upstream %s", upstreamNode => {
    expect(() => prepareRolaProfile(source, { ...settings, upstreamNode })).toThrow("concrete encrypted upstream");
  });

  it.each([
    { tls: false }, { "skip-cert-verify": true }, { "dialer-proxy": "AUTO" }, { type: "direct" },
    { type: "ss", cipher: "none" }, { type: "vmess", cipher: "zero" },
  ])("rejects unsafe or already chained first hops: %j", changes => {
    const base = parse(source);
    Object.assign(base.proxies[0], changes);
    expect(() => prepareRolaProfile(stringify(base), settings)).toThrow("concrete encrypted upstream");
  });

  it("rejects empty/provider-only bases, conflicting DNS and recursive bootstrap", () => {
    const empty = parse(source);
    empty.proxies = [];
    expect(() => prepareRolaProfile(stringify(empty), settings)).toThrow("concrete encrypted upstream");
    expect(() => prepareRolaProfile("proxies: []", settings)).toThrow();
    const dns = parse(source);
    dns.dns["proxy-server-nameserver"] = ["https://1.1.1.1/dns-query#ROLA"];
    expect(() => prepareRolaProfile(stringify(dns), settings)).toThrow("independent");
    dns.dns["proxy-server-nameserver"] = ["system"];
    dns.dns["nameserver-policy"] = { "+.claude.ai": "system" };
    expect(() => prepareRolaProfile(stringify(dns), settings)).toThrow("overlaps");
    expect(() => prepareRolaProfile(source, { ...settings, server: "proxy.claude.ai" })).toThrow("overlap");
    const candidate = prepareRolaProfile(source, settings).profile;
    expect(() => prepareRolaProfile(candidate, settings)).toThrow("reserved Rola name");
  });

  it.each([
    { sessionMinutes: 0 }, { sessionMinutes: 121 }, { sessionMinutes: 1.5 },
    { sessionId: "f-1" }, { account: "demo-country-us-f-1" }, { protocol: "https" },
    { rules: ["MATCH,DIRECT"] }, { rules: ["DOMAIN,claude.ai,DIRECT"] },
    { dns: ["https://dns.example/dns-query"] }, { server: "https://residential.example" },
  ])("rejects ambiguous parameters without logging credentials: %j", changes => {
    expect(() => prepareRolaProfile(source, { ...settings, ...changes })).toThrow();
    try { prepareRolaProfile(source, { ...settings, ...changes }); }
    catch (error) { expect(String(error)).not.toContain(settings.password); }
  });
});

describe("Rola quota is a separate read-only account view", () => {
  const payload = { code: 0, data: { residential: { total_traffic: 1024, cost_traffic: 100, status: "active", expire_time: "2026-11-01 08:00:00" } } };
  it("keeps byte units, expiry text and each product separate", () => {
    const result = parseRolaUsage({ ...payload, data: { ...payload.data, mobile: { total_traffic: 512, cost_traffic: 600, expire_time: null } } });
    expect(result).toEqual([
      { product: "residential", totalBytes: 1024, usedBytes: 100, remainingBytes: 924, status: "active", expiresAtProviderText: "2026-11-01 08:00:00" },
      { product: "mobile", totalBytes: 512, usedBytes: 600, remainingBytes: 0, status: "unknown", expiresAtProviderText: null },
    ]);
    expect(parseRolaUsage({ code: 0, data: {} })).toEqual([]);
    expect(parseRolaUsage({ code: 0, data: { residential: {} } })[0]).toMatchObject({ totalBytes: null, usedBytes: null, remainingBytes: null });
    expect(() => parseRolaUsage({ code: 0, data: { residential: { total_traffic: -1 } } })).toThrow("byte counter");
    expect(() => parseRolaUsage({ code: 0, data: { residential: { total_traffic: Number.MAX_SAFE_INTEGER + 1 } } })).toThrow("byte counter");
  });

  it("sends the token only to the fixed package endpoint, rejects redirects and bounds the request", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload));
    const result = await readRolaUsage("private-test-token", request);
    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith("https://api2.rola-ip.co/api/users/traffic/packages/current", {
      method: "GET", headers: { "Api-Token": "private-test-token", Accept: "application/json" },
      redirect: "error", signal: expect.any(AbortSignal),
    });
    expect(result.packages[0].remainingBytes).toBe(924);
    expect(JSON.stringify(result)).not.toContain("private-test-token");
    expect(result).not.toHaveProperty("Subscription-Userinfo");
  });

  it("does not retry denial or log untrusted error bodies", async () => {
    const denied = vi.fn<typeof fetch>().mockResolvedValue(new Response("private-test-token", { status: 403 }));
    await expect(readRolaUsage("private-test-token", denied)).rejects.toThrow("HTTP 403");
    expect(denied).toHaveBeenCalledOnce();
    await expect(readRolaUsage("private-test-token", vi.fn<typeof fetch>().mockRejectedValue(new Error("private-test-token")))).rejects.toThrow("request failed");
    await expect(readRolaUsage("private-test-token", vi.fn<typeof fetch>().mockResolvedValue(new Response("x".repeat(1024 * 1024 + 1))))).rejects.toThrow("exceeds");
    await expect(readRolaUsage("private-test-token", vi.fn<typeof fetch>().mockResolvedValue(Response.json({ code: 1, message: "private-test-token" })))).rejects.toThrow("check the account console");
  });
});
