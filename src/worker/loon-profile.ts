import {
  mihomoProxyGroups,
  mihomoRuleProviders,
  mihomoRules,
} from "../config/mihomo-policy";
import { ApiError } from "./api-error";
import { countryRegionNames, metadataNamePattern, namesMatchingFilter } from "./policy-filters";


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

function loonGroupLine(source: (typeof mihomoProxyGroups)[number], names: string[], availableGroups: Set<string>): string {
  const group = source as LoonGroup;
  if (group.name === "AUTO") {
    return `AUTO = url-test, ${names.join(", ")}, url=https://cp.cloudflare.com/generate_204, interval=${group.interval ?? 300}`;
  }
  if (countryRegionNames.has(group.name)) {
    const members = namesMatchingFilter(names, group.filter);
    return `${group.name} = select, ${members.join(", ")}`;
  }
  const members = (group.proxies ?? []).filter(name => !countryRegionNames.has(name) || availableGroups.has(name));
  if ("include-all" in source && source["include-all"]) {
    members.push(...names);
  }
  return `${group.name} = ${group.type}, ${members.join(", ")}`;
}

function loonRemoteRules(updateIntervalSeconds: number): string[] {
  return mihomoRules.flatMap((rule) => {
    if (!rule.startsWith("RULE-SET,")) {
      return [];
    }
    const [, name, policy] = rule.split(",");
    const provider = mihomoRuleProviders[name];
    if (!provider) {
      throw new Error(`Unknown rule provider: ${name}`);
    }
    return [`${provider.url}, policy=${policy}, tag=${name}, enabled=true, update-interval=${updateIntervalSeconds}`];
  });
}

export function createLoonProfile(nodeResource: string, updateIntervalHours = 6): string {
  const nodes = readLoonNodes(nodeResource);
  const selectableNames = nodes.names.filter(name => !metadataNamePattern.test(name));
  if (!selectableNames.length) throw new ApiError(422, "no_nodes_found", "Loon profile has no selectable nodes");
  const groups = mihomoProxyGroups.filter(group => !countryRegionNames.has(group.name) || ("filter" in group && namesMatchingFilter(selectableNames, group.filter).length > 0));
  const availableGroups = new Set(groups.map(group => group.name));
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
    ...groups.map((group) => loonGroupLine(group, selectableNames, availableGroups)),
    "",
    "[Rule]",
    "FINAL,DEFAULT",
    "",
    "[Remote Rule]",
    ...loonRemoteRules(updateIntervalHours * 3600),
    "",
  ].join("\n");
}
