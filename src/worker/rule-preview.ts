import { parse } from "yaml";
import type { RulePreview } from "../config/rule-preview";
import { ruleTemplates, type RuleTemplateId } from "../config/rule-templates";
import { mihomoProxyGroups, mihomoRuleProviders, mihomoRules } from "../config/mihomo-policy";
import { applyRuleTemplate } from "./rule-template";
import { ApiError } from "./api-error";
import { hashText } from "./secrets";
import { readRemoteSource } from "./sub-store";

export async function createRulePreview(
  id: RuleTemplateId,
  customUrl: string,
  assets?: Pick<Env["ASSETS"], "fetch">,
): Promise<RulePreview> {
  const template = ruleTemplates.find(item => item.id === id);
  if (!template) throw new ApiError(400, "invalid_rule_preset", "Rule preset is invalid");
  let config: { rules: readonly string[]; "proxy-groups": ReadonlyArray<{ name: string; type: string; proxies?: readonly string[] }>; "rule-providers": Record<string, { url: string }> } = {
    rules: mihomoRules, "proxy-groups": mihomoProxyGroups, "rule-providers": mihomoRuleProviders,
  };
  if (id !== "flacier") {
    const remote = await readRemoteSource(template.url || customUrl, "Flacier-Rules/1.0");
    config = parse(applyRuleTemplate("proxies: []", remote.content));
  }
  const urls = [...new Set(Object.values(config["rule-providers"]).map(provider => provider.url))];
  if (urls.length > 32) throw new ApiError(413, "rule_preview_too_large", "Preview supports at most 32 rule sources");
  const contents = new Map<string, string>();
  let total = 0;
  for (let index = 0; index < urls.length; index += 4) {
    await Promise.all(urls.slice(index, index + 4).map(async url => {
      const content = id === "flacier" && assets
        ? await (async () => {
          const response = await assets.fetch(new Request(url));
          if (!response.ok) throw new ApiError(502, "rule_preview_failed", "Published rules could not be read");
          return response.text();
        })()
        : (await readRemoteSource(url, "Flacier-Rules/1.0")).content;
      total += new TextEncoder().encode(content).byteLength;
      if (total > 8 * 1024 * 1024) throw new ApiError(413, "rule_preview_too_large", "Rule preview exceeds 8 MiB");
      contents.set(url, content);
    }));
  }
  const ruleSets = config.rules.map((rule, index) => {
    const parts = rule.split(",");
    const noResolve = parts.at(-1) === "no-resolve";
    const policy = parts.at(noResolve ? -2 : -1)!;
    const source = parts.slice(0, noResolve ? -2 : -1).join(",");
    if (parts[0] === "RULE-SET") {
      const provider = config["rule-providers"][parts[1]];
      if (!provider) throw new ApiError(422, "rule_preview_failed", "Referenced rule source is missing");
      const content = contents.get(provider.url)!;
      return { id: `${index}`, label: parts[1], path: provider.url, policy,
        content: noResolve ? content.split(/\r?\n/u).map(line => {
          const rule = line.trim();
          return rule && !/^[#;]/u.test(rule) && !rule.endsWith(",no-resolve") ? `${rule},no-resolve` : rule;
        }).join("\n") : content };
    }
    return { id: `${index}`, label: parts[0] === "MATCH" ? "默认规则" : "模板内规则", path: "", policy, content: source + (noResolve ? ",no-resolve" : "") };
  });
  const groups = config["proxy-groups"].map(group => ({ name: group.name, type: group.type, ...(group.proxies ? { proxies: [...group.proxies] } : {}) }));
  return { name: template.name, fingerprint: await hashText(JSON.stringify({ ruleSets, groups })), ruleSets, groups };
}
