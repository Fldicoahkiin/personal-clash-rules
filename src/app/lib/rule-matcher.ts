import { parse } from "yaml";

export interface RuleSetDefinition {
  id: string;
  label: string;
  path: string;
  policy: string;
}

type RuleType = "DOMAIN" | "DOMAIN-SUFFIX" | "IP-CIDR";

interface RuleEntry {
  type: RuleType;
  value: string;
  source: string;
}

export interface LoadedRuleSet extends RuleSetDefinition {
  rules: RuleEntry[];
}

export interface RouteMatch {
  hostname: string;
  rule: string;
  ruleSetId: string;
  ruleSetLabel: string;
  ruleSetPath: string;
  policy: string;
}

function parseRules(content: string): RuleEntry[] {
  return content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .flatMap((source) => {
      const [type, value] = source.split(",", 2);
      if (
        (type !== "DOMAIN" &&
          type !== "DOMAIN-SUFFIX" &&
          type !== "IP-CIDR") ||
        !value
      ) {
        return [];
      }
      return [
        {
          type,
          value: value.toLowerCase(),
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

export async function loadPublishedRuleSets(
  signal?: AbortSignal,
): Promise<LoadedRuleSet[]> {
  const manifestResponse = await fetch("/rules/manifest.yaml", { signal });
  if (!manifestResponse.ok) {
    throw new Error("规则目录加载失败");
  }
  const manifest = parse(await manifestResponse.text()) as {
    ruleSets: RuleSetDefinition[];
  };
  return Promise.all(
    manifest.ruleSets.map(async (definition) => {
      const response = await fetch(`/${definition.path}`, { signal });
      if (!response.ok) {
        throw new Error(`${definition.label} 加载失败`);
      }
      return createRuleSet(definition, await response.text());
    }),
  );
}

function ipv4ToNumber(address: string): number | null {
  const parts = address.split(".");
  if (parts.length !== 4) {
    return null;
  }
  let value = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) {
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
    !Number.isInteger(prefix) ||
    prefix < 0 ||
    prefix > 32
  ) {
    return false;
  }
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (addressNumber & mask) >>> 0 === (networkNumber & mask) >>> 0;
}

function matches(hostname: string, rule: RuleEntry): boolean {
  if (rule.type === "DOMAIN") {
    return hostname === rule.value;
  }
  if (rule.type === "DOMAIN-SUFFIX") {
    return hostname === rule.value || hostname.endsWith(`.${rule.value}`);
  }
  return matchesCidr(hostname, rule.value);
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
): RouteMatch {
  const hostname = readHostname(input);

  for (const ruleSet of ruleSets) {
    const rule = ruleSet.rules.find((entry) => matches(hostname, entry));
    if (rule) {
      return {
        hostname,
        rule: rule.source,
        ruleSetId: ruleSet.id,
        ruleSetLabel: ruleSet.label,
        ruleSetPath: ruleSet.path,
        policy: ruleSet.policy,
      };
    }
  }

  return {
    hostname,
    rule: "MATCH",
    ruleSetId: "default",
    ruleSetLabel: "默认规则",
    ruleSetPath: "",
    policy: "DEFAULT",
  };
}
