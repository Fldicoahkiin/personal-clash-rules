import { stringify as stringifyYaml } from "yaml";

import {
  mihomoProxyGroups,
  mihomoRuleProviders,
  mihomoRules,
} from "../config/mihomo-policy";
import { ApiError } from "./api-error";
import { readYamlProxyResource } from "./yaml-proxy-resource";

const regions = new Set(["US", "JP", "SG", "HK", "TW", "KR", "EU"]);

type EgernGroup = {
  name: string;
  type: string;
  proxies?: readonly string[];
  filter?: string;
  interval?: number;
  tolerance?: number;
};

function proxyName(proxy: unknown): string {
  if (!proxy || typeof proxy !== "object" || Array.isArray(proxy)) {
    return "";
  }
  const protocol = Object.values(proxy)[0];
  if (!protocol || typeof protocol !== "object" || Array.isArray(protocol)) {
    return "";
  }
  return typeof (protocol as { name?: unknown }).name === "string"
    ? (protocol as { name: string }).name
    : "";
}

function matchingNames(names: string[], filter: string | undefined): string[] {
  if (!filter) {
    return names;
  }
  const pattern = new RegExp(filter.replace(/^\(\?i\)/u, ""), "iu");
  return names.filter((name) => pattern.test(name));
}

function egernPolicyGroup(
  source: (typeof mihomoProxyGroups)[number],
  names: string[],
): Record<string, unknown> {
  const group = source as EgernGroup;
  if (group.name === "AUTO") {
    return {
      auto_test: {
        name: group.name,
        policies: names,
        interval: group.interval ?? 300,
        tolerance: group.tolerance ?? 80,
        timeout: 5,
      },
    };
  }
  let policies = [...(group.proxies ?? [])];
  if (regions.has(group.name)) {
    policies = matchingNames(names, group.filter);
    if (policies.length === 0) {
      policies = ["DIRECT"];
    }
  } else if (group.name === "GLOBAL") {
    policies.push(...names);
  }
  return { select: { name: group.name, policies } };
}

function egernRules(updateIntervalSeconds: number): Array<Record<string, unknown>> {
  const rules: Array<Record<string, unknown>> = [];
  for (const rule of mihomoRules) {
    if (rule.startsWith("PROCESS-NAME-REGEX,")) {
      continue;
    }
    if (rule === "MATCH,DEFAULT") {
      rules.push({ default: { policy: "DEFAULT" } });
      continue;
    }
    if (!rule.startsWith("RULE-SET,")) {
      continue;
    }
    const [, name, policy, ...options] = rule.split(",");
    if (!mihomoRuleProviders[name]) {
      throw new Error(`Unknown rule provider: ${name}`);
    }
    rules.push({
      rule_set: {
        match: `https://rules.flacier.com/rules/egern/${name}.yaml`,
        policy,
        update_interval: updateIntervalSeconds,
        ...(options.includes("no-resolve") ? { no_resolve: true } : {}),
      },
    });
  }
  return rules;
}

export function createEgernProfile(nodeResource: string, updateIntervalHours = 6): string {
  const proxies = readYamlProxyResource(nodeResource, "Egern");
  const names = proxies.map(proxyName);
  if (names.some((name) => !name)) {
    throw new ApiError(502, "converter_invalid_response", "Egern node resource is invalid");
  }
  return stringifyYaml({
    ipv6: true,
    vif_only: true,
    proxies,
    policy_groups: mihomoProxyGroups.map((group) => egernPolicyGroup(group, names)),
    rules: egernRules(updateIntervalHours * 3600),
  });
}
