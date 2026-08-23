import {
  mihomoProxyGroups,
  mihomoRuleProviders,
  mihomoRules,
} from "../config/mihomo-policy";
import { ApiError } from "./api-error";

const regions = new Set(["US", "JP", "SG", "HK", "TW", "KR", "EU"]);

type LoonGroup = {
  name: string;
  type: string;
  proxies?: readonly string[];
  filter?: string;
  interval?: number;
};

function readLoonNodes(input: string): { content: string; names: string[] } {
  const lines = input.trim().split(/\r?\n/u);
  const nodeLines = lines.filter((line) => {
    const trimmed = line.trim();
    return trimmed && !trimmed.startsWith("#") && !trimmed.startsWith("//");
  });
  const names = nodeLines.map((line) => line.slice(0, line.indexOf("=")).trim());
  if (
    nodeLines.length === 0
    || nodeLines.some((line) => line.trim().startsWith("[") || !line.includes("="))
    || names.some((name) => !name)
  ) {
    throw new ApiError(502, "converter_invalid_response", "Loon node resource is invalid");
  }
  return { content: lines.join("\n"), names: [...new Set(names)] };
}

function matchingNodes(names: string[], filter: string | undefined): string[] {
  if (!filter) {
    return names;
  }
  const pattern = new RegExp(filter.replace(/^\(\?i\)/u, ""), "iu");
  return names.filter((name) => pattern.test(name));
}

function loonGroupLine(source: (typeof mihomoProxyGroups)[number], names: string[]): string {
  const group = source as LoonGroup;
  if (group.name === "AUTO") {
    return `AUTO = url-test, ${names.join(", ")}, url=https://cp.cloudflare.com/generate_204, interval=${group.interval ?? 300}`;
  }
  if (regions.has(group.name)) {
    const members = matchingNodes(names, group.filter);
    return `${group.name} = select, ${(members.length > 0 ? members : ["DIRECT"]).join(", ")}`;
  }
  const members = [...(group.proxies ?? [])];
  if (group.name === "GLOBAL") {
    members.push(...names);
  }
  return `${group.name} = ${group.type}, ${members.join(", ")}`;
}

function loonRemoteRules(): string[] {
  return mihomoRules.flatMap((rule) => {
    if (!rule.startsWith("RULE-SET,")) {
      return [];
    }
    const [, name, policy] = rule.split(",");
    const provider = mihomoRuleProviders[name];
    if (!provider) {
      throw new Error(`Unknown rule provider: ${name}`);
    }
    return [`${provider.url}, policy=${policy}, tag=${name}, enabled=true`];
  });
}

export function createLoonProfile(nodeResource: string): string {
  const nodes = readLoonNodes(nodeResource);
  return [
    "[General]",
    "ipv6 = true",
    "dns-server = system, 1.1.1.1",
    "internet-test-url = https://cp.cloudflare.com/generate_204",
    "proxy-test-url = https://cp.cloudflare.com/generate_204",
    "",
    "[Proxy]",
    nodes.content,
    "",
    "[Proxy Group]",
    ...mihomoProxyGroups.map((group) => loonGroupLine(group, nodes.names)),
    "",
    "[Rule]",
    "FINAL,DEFAULT",
    "",
    "[Remote Rule]",
    ...loonRemoteRules(),
    "",
  ].join("\n");
}
