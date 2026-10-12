import {
  countryGroupNames,
  metadataFilter,
  mihomoProxyGroups,
  mihomoRuleProviders,
  mihomoRules,
} from "../config/mihomo-policy";
import { ApiError } from "./api-error";

type SingBoxOutbound = Record<string, unknown> & {
  type: string;
  tag: string;
};

const regionNames = new Set(Object.values(countryGroupNames));
const metadataName = new RegExp(metadataFilter.replace(/^\(\?i\)/u, ""), "iu");
const processNames = ["codex", "codex.exe", "claude", "claude.exe"];

function readNodeResource(input: string): {
  outbounds: SingBoxOutbound[];
  endpoints?: unknown[];
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new ApiError(
      502,
      "converter_invalid_response",
      "sing-box node resource is invalid",
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ApiError(
      502,
      "converter_invalid_response",
      "sing-box node resource is invalid",
    );
  }
  const source = parsed as { outbounds?: unknown; endpoints?: unknown };
  if (
    !Array.isArray(source.outbounds)
    || source.outbounds.length === 0
    || source.outbounds.some((outbound) => (
      !outbound
      || typeof outbound !== "object"
      || Array.isArray(outbound)
      || typeof (outbound as { type?: unknown }).type !== "string"
      || typeof (outbound as { tag?: unknown }).tag !== "string"
      || !(outbound as { tag: string }).tag
    ))
  ) {
    throw new ApiError(
      502,
      "converter_invalid_response",
      "sing-box node resource is invalid",
    );
  }
  if (source.endpoints !== undefined && !Array.isArray(source.endpoints)) {
    throw new ApiError(
      502,
      "converter_invalid_response",
      "sing-box node resource is invalid",
    );
  }
  return {
    outbounds: source.outbounds as SingBoxOutbound[],
    ...(source.endpoints ? { endpoints: source.endpoints } : {}),
  };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function matchingTags(tags: string[], filter: string | undefined): string[] {
  if (!filter) {
    return tags;
  }
  const pattern = new RegExp(filter.replace(/^\(\?i\)/u, ""), "iu");
  return tags.filter((tag) => pattern.test(tag));
}

function selector(tag: string, outbounds: readonly string[]): Record<string, unknown> {
  return {
    type: "selector",
    tag,
    outbounds,
    default: outbounds[0],
  };
}

function policyOutbounds(nodeTags: string[]): Array<Record<string, unknown>> {
  const groups = mihomoProxyGroups.filter(group => !regionNames.has(group.name) || ("filter" in group && matchingTags(nodeTags, group.filter).length > 0));
  const availableGroups = new Set(groups.map(group => group.name));
  return groups.map((source) => {
    const group = source as {
      name: string;
      proxies?: readonly string[];
      "include-all"?: boolean;
      filter?: string;
      interval?: number;
      tolerance?: number;
    };
    if (group.name === "AUTO") {
      return {
        type: "urltest",
        tag: group.name,
        outbounds: nodeTags,
        url: "https://cp.cloudflare.com/generate_204",
        interval: `${Math.max(1, Math.round((group.interval ?? 300) / 60))}m`,
        tolerance: group.tolerance ?? 80,
      };
    }
    if (regionNames.has(group.name)) {
      const matches = matchingTags(nodeTags, group.filter);
      return selector(group.name, matches);
    }
    const policyChoices = (group.proxies ?? []).filter(name => !regionNames.has(name) || availableGroups.has(name));
    const members = group["include-all"]
      ? unique([...policyChoices, ...nodeTags])
      : policyChoices;
    return selector(group.name, members);
  });
}

function routeRules(): Array<Record<string, unknown>> {
  let processRuleAdded = false;
  const rules: Array<Record<string, unknown>> = [];
  for (const rule of mihomoRules) {
    if (rule.startsWith("PROCESS-NAME-REGEX,")) {
      if (!processRuleAdded) {
        processRuleAdded = true;
        rules.push({
          process_name: processNames,
          action: "route",
          outbound: "AI",
        });
      }
      continue;
    }
    if (!rule.startsWith("RULE-SET,")) {
      continue;
    }
    const [, name, policy] = rule.split(",");
    if (!mihomoRuleProviders[name]) {
      throw new Error(`Unknown rule provider: ${name}`);
    }
    rules.push({
      rule_set: [name],
      action: "route",
      outbound: policy,
    });
  }
  return rules;
}

function remoteRuleSets(updateIntervalHours: number): Array<Record<string, unknown>> {
  return Object.keys(mihomoRuleProviders).map((name) => ({
    type: "remote",
    tag: name,
    format: "source",
    url: `https://rules.flacier.com/rules/sing-box/${name}.json`,
    update_interval: `${updateIntervalHours}h`,
  }));
}

export function createSingBoxProfile(nodeResource: string, updateIntervalHours = 6): string {
  const nodes = readNodeResource(nodeResource);
  const nodeTags = nodes.outbounds.map((outbound) => outbound.tag);
  const reservedTags = new Set([
    "DIRECT",
    ...mihomoProxyGroups.map((group) => group.name),
  ]);
  if (
    new Set(nodeTags).size !== nodeTags.length
    || nodeTags.some((tag) => reservedTags.has(tag))
  ) {
    throw new ApiError(
      502,
      "converter_invalid_response",
      "sing-box node resource has conflicting tags",
    );
  }
  const selectableTags = nodeTags.filter(name => !metadataName.test(name));
  if (!selectableTags.length) throw new ApiError(422, "no_nodes_found", "sing-box profile has no selectable nodes");

  return `${JSON.stringify({
    log: {
      level: "info",
      timestamp: true,
    },
    dns: {
      servers: [{ type: "local", tag: "local" }],
      final: "local",
      strategy: "prefer_ipv4",
    },
    http_clients: [{ tag: "rule-download" }],
    inbounds: [{
      type: "tun",
      tag: "tun-in",
      address: ["172.18.0.1/30", "fdfe:dcba:9876::1/126"],
      auto_route: true,
      strict_route: true,
      stack: "mixed",
    }],
    outbounds: [
      { type: "direct", tag: "DIRECT" },
      ...nodes.outbounds,
      ...policyOutbounds(selectableTags),
    ],
    ...(nodes.endpoints ? { endpoints: nodes.endpoints } : {}),
    route: {
      rules: routeRules(),
      rule_set: remoteRuleSets(updateIntervalHours),
      final: "DEFAULT",
      auto_detect_interface: true,
      default_http_client: "rule-download",
      default_domain_resolver: "local",
    },
    experimental: {
      cache_file: {
        enabled: true,
      },
    },
  }, null, 2)}\n`;
}
