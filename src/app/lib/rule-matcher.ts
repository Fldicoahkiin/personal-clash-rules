import type { RulePreview } from "../../config/rule-preview";
import type { RuleTemplateId } from "../../config/rule-templates";

export interface RuleSetDefinition {
  id: string;
  label: string;
  path: string;
  policy: string;
}

interface RuleEntry {
  type: string;
  value: string;
  source: string;
}

export interface LoadedRuleSet extends RuleSetDefinition {
  rules: RuleEntry[];
}

export interface RouteMatch {
  uncertain?: string;
  destination?: { mode: string; route: string };
  hostname: string;
  matched: boolean;
  rule: string;
  ruleSetId: string;
  ruleSetLabel: string;
  policy: string;
}

function parseRules(content: string): RuleEntry[] {
  return content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^[#;]/u.test(line))
    .flatMap((source) => {
      const [type, value] = source.split(",", 2);
      return [
        {
          type,
          value: (value ?? "").toLowerCase(),
          source,
        },
      ];
    });
}

export function createRuleSet(
  definition: RuleSetDefinition,
  content: string,
): LoadedRuleSet {
  return { ...definition, rules: parseRules(content) };
}

export async function loadRulePreview(rulePreset: RuleTemplateId, ruleTemplateUrl: string, signal?: AbortSignal): Promise<RulePreview> {
  const response = await fetch("/api/rules/preview", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rulePreset, ruleTemplateUrl }), signal });
  if (!response.ok) throw new Error(`规则方案加载失败（HTTP ${response.status}），请检查模板地址或稍后重试`);
  return await response.json() as RulePreview;
}

function ipv4ToNumber(address: string): number | null {
  const parts = address.split(".");
  if (parts.length !== 4) {
    return null;
  }
  let value = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!/^\d{1,3}$/u.test(part) || octet > 255) {
      return null;
    }
    value = (value << 8) | octet;
  }
  return value >>> 0;
}

function matchesCidr(hostname: string, cidr: string): boolean {
  const [network, prefixText] = cidr.split("/");
  const addressNumber = ipv4ToNumber(hostname);
  const networkNumber = ipv4ToNumber(network);
  const prefix = Number(prefixText);
  if (
    addressNumber === null ||
    networkNumber === null ||
    !/^\d{1,2}$/u.test(prefixText ?? "") ||
    !Number.isInteger(prefix) ||
    prefix < 0 ||
    prefix > 32
  ) {
    return false;
  }
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (addressNumber & mask) >>> 0 === (networkNumber & mask) >>> 0;
}

function matches(hostname: string, rule: RuleEntry, context: { ip?: string; processName?: string }): boolean | string {
  if (rule.type === "DOMAIN") {
    return hostname === rule.value;
  }
  if (rule.type === "DOMAIN-SUFFIX") {
    return hostname === rule.value || hostname.endsWith(`.${rule.value}`);
  }
  if (rule.type === "DOMAIN-KEYWORD") return hostname.includes(rule.value);
  if (rule.type === "MATCH" || rule.type === "FINAL") return true;
  if (rule.type === "IP-CIDR" || rule.type === "IP-CIDR6") {
    const ip = context.ip || (ipv4ToNumber(hostname) !== null || hostname.includes(":") ? hostname : "");
    if (!ip) return rule.source.endsWith(",no-resolve") ? false : "此规则需要目标 IP；网页不会替你解析域名";
    if (rule.type === "IP-CIDR6") return ip.includes(":") ? "IPv6 网段匹配需在客户端验证" : false;
    return matchesCidr(ip, rule.value);
  }
  if (rule.type === "PROCESS-NAME" || rule.type === "PROCESS-NAME-REGEX") {
    if (!context.processName) return "此规则需要进程名，请补充后重试";
    if (rule.type === "PROCESS-NAME") return context.processName.toLowerCase() === rule.value;
    // Only the built-in patterns are evaluated here; arbitrary remote regexes can block the UI thread.
    if (["(?i)^codex(\\.exe)?$", "(?i)^claude(\\.exe)?$"].includes(rule.value)) {
      return context.processName.toLowerCase().replace(/\.exe$/u, "") === rule.value.slice(5).split("(")[0];
    }
  }
  return `${rule.type} 需要客户端规则数据或上下文，网页无法确定`;
}

function readHostname(input: string): string {
  const value = input.trim();
  const url = new URL(value.includes("://") ? value : `https://${value}`);
  if (!url.hostname) {
    throw new Error("请输入网址或域名");
  }
  return url.hostname.toLowerCase().replace(/\.$/u, "");
}

export function matchUrl(
  input: string,
  ruleSets: LoadedRuleSet[],
  context: { ip?: string; processName?: string; groups?: RulePreview["groups"] } = {},
): RouteMatch {
  const hostname = readHostname(input);
  if (context.ip && ipv4ToNumber(context.ip) === null) throw new Error("目标 IPv4 格式有误");

  for (const ruleSet of ruleSets) {
    for (const rule of ruleSet.rules) {
      const matched = matches(hostname, rule, context);
      if (matched === false) continue;
      return {
        hostname,
        matched: matched === true && !["MATCH", "FINAL"].includes(rule.type),
        rule: rule.source,
        ruleSetId: ruleSet.id,
        ruleSetLabel: ruleSet.label,
        policy: ruleSet.policy,
        ...(typeof matched === "string" ? { uncertain: matched } : {}),
        ...(context.groups ? { destination: previewDestination(ruleSet.policy, context.groups) } : {}),
      };
    }
  }

  return {
    hostname,
    matched: false,
    rule: "MATCH",
    ruleSetId: "default",
    ruleSetLabel: "默认规则",
    policy: "DEFAULT",
  };
}

function previewDestination(policy: string, groups: RulePreview["groups"]): { mode: string; route: string } {
  const path = [policy];
  let current = policy;
  const seen = new Set<string>();
  while (!seen.has(current)) {
    seen.add(current);
    if (["DIRECT", "COMPATIBLE", "REJECT", "REJECT-DROP"].includes(current)) {
      return { mode: ["DIRECT", "COMPATIBLE"].includes(current) ? "直连" : "拒绝", route: path.join(" → ") };
    }
    const group = groups.find(group => group.name === current);
    if (!group) return { mode: "无法确定", route: path.join(" → ") };
    if (group.type !== "select" || !group.proxies?.length) return { mode: "代理", route: path.join(" → ") };
    current = group.proxies[0];
    path.push(current);
  }
  return { mode: "无法确定", route: "策略组存在循环引用" };
}
