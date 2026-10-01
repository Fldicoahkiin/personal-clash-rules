import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { applyRuleTemplate } from "../src/worker/rule-template";

const ini = `[custom]
ruleset=Direct,https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/LocalAreaNetwork.list
ruleset=Direct,[]GEOIP,CN,no-resolve
ruleset=Select,[]FINAL
custom_proxy_group=Select\`select\`[]Auto\`[]DIRECT\`.*
custom_proxy_group=Auto\`url-test\`.*\`https://cp.cloudflare.com/generate_204\`300,,50
custom_proxy_group=Direct\`select\`[]DIRECT
enable_rule_generator=true
overwrite_original_rules=true`;
const profile = `proxies: [{name: JP, type: ss}]
dns:
  nameserver: ["https://1.1.1.1/dns-query#GLOBAL"]
`;

describe("remote rule templates", () => {
  it("preserves nodes and rule order while applying real groups", () => {
    const output = parse(applyRuleTemplate(profile, ini));
    expect(output.proxies).toEqual([{ name: "JP", type: "ss" }]);
    expect(output.rules).toEqual(["RULE-SET,template-1,Direct", "GEOIP,CN,Direct,no-resolve", "MATCH,Select"]);
    expect(output["proxy-groups"][1]).toMatchObject({ name: "Auto", type: "url-test", interval: 300, tolerance: 50, "include-all": true });
    expect(output.dns.nameserver).toEqual(["https://1.1.1.1/dns-query#Select"]);
  });
  it("rejects unimplemented directives instead of dropping them", () => {
    expect(() => applyRuleTemplate(profile, ini + "\nscript=malicious.js")).toThrow();
    expect(() => applyRuleTemplate(profile, ini.replace("https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/LocalAreaNetwork.list", "https://127.0.0.1/private"))).toThrow();
    expect(() => applyRuleTemplate(profile, ini.replace("[]Auto", "[]Missing"))).toThrow();
  });
});
