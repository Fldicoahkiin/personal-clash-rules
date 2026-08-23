import {
  mihomoProxyGroups,
  mihomoRuleProviders,
  mihomoRules,
} from "../config/mihomo-policy";
import { ApiError } from "./api-error";

export const managedProfileUrlPlaceholder = "__FLACIER_SUBSCRIPTION_URL__";

type SurgeGroup = {
  name: string;
  type: string;
  proxies?: readonly string[];
  filter?: string;
  "include-all"?: boolean;
  interval?: number;
  tolerance?: number;
};

function readProxyLines(input: string, client: "Surge" | "Surfboard"): string {
  const lines = input.trim().split(/\r?\n/u);
  const proxyLines = lines.filter((line) => {
    const trimmed = line.trim();
    return trimmed && !trimmed.startsWith("#") && !trimmed.startsWith("//");
  });
  if (
    proxyLines.length === 0
    || proxyLines.some((line) => line.trim().startsWith("[") || !line.includes("="))
  ) {
    throw new ApiError(502, "converter_invalid_response", `${client} node resource is invalid`);
  }
  return lines.join("\n");
}

function surgeGroupLine(source: (typeof mihomoProxyGroups)[number]): string {
  const group = source as SurgeGroup;
  const members = [...(group.proxies ?? [])];
  const parameters: string[] = [];
  if (group["include-all"]) {
    parameters.push("include-all-proxies=true");
  }
  if (group.filter) {
    parameters.push(`policy-regex-filter=${group.filter}`);
  } else if (group["include-all"]) {
    parameters.push("policy-regex-filter=(?i)^(?!.*(剩余|流量|到期|官网|客服|订阅)).*$");
  }
  if (group.interval !== undefined) {
    parameters.push(`interval=${group.interval}`);
  }
  if (group.tolerance !== undefined) {
    parameters.push(`tolerance=${group.tolerance}`);
  }
  return `${group.name} = ${[group.type, ...members, ...parameters].join(", ")}`;
}

function surgeRules(): string[] {
  return mihomoRules.flatMap((rule) => {
    if (rule.startsWith("PROCESS-NAME-REGEX,")) {
      return [];
    }
    if (rule === "MATCH,DEFAULT") {
      return ["FINAL,DEFAULT,dns-failed"];
    }
    if (!rule.startsWith("RULE-SET,")) {
      return [rule];
    }
    const [, name, policy, ...options] = rule.split(",");
    const provider = mihomoRuleProviders[name];
    if (!provider) {
      throw new Error(`Unknown rule provider: ${name}`);
    }
    return [[
      "RULE-SET",
      provider.url,
      policy,
      ...options,
      "update-interval=86400",
    ].join(",")];
  });
}

function createProfile(
  nodeResource: string,
  client: "Surge" | "Surfboard",
): string {
  const sections = [
    `#!MANAGED-CONFIG ${managedProfileUrlPlaceholder} interval=21600 strict=false`,
    "",
    "[General]",
    "loglevel = notify",
    "dns-server = system, 1.1.1.1",
    "ipv6 = true",
    "internet-test-url = https://cp.cloudflare.com/generate_204",
    "proxy-test-url = https://cp.cloudflare.com/generate_204",
    "test-timeout = 5",
    "",
    "[Proxy]",
    readProxyLines(nodeResource, client),
    "",
    "[Proxy Group]",
    ...mihomoProxyGroups.map(surgeGroupLine),
    "",
    "[Rule]",
    "PROCESS-NAME,codex,AI",
    "PROCESS-NAME,claude,AI",
    ...surgeRules(),
    "",
  ];
  return sections.join("\n");
}

export function createSurgeProfile(nodeResource: string): string {
  return createProfile(nodeResource, "Surge");
}

export function createSurfboardProfile(nodeResource: string): string {
  return createProfile(nodeResource, "Surfboard");
}
