import { stringify as stringifyYaml } from "yaml";

import {
  mihomoProxyGroups,
  mihomoRuleProviders,
  mihomoRules,
} from "../config/mihomo-policy";
import { readYamlProxyResource } from "./yaml-proxy-resource";

function stashProxyGroups(): Array<Record<string, unknown>> {
  return mihomoProxyGroups.map((source) => {
    const group = { ...source } as Record<string, unknown>;
    delete group["empty-fallback"];
    delete group["exclude-type"];
    delete group["exclude-filter"];
    return group;
  });
}

function ruleProviders(updateIntervalHours: number) {
  return Object.fromEntries(Object.entries(mihomoRuleProviders).map(([name, provider]) => [
    name,
    { ...provider, interval: updateIntervalHours * 3600 },
  ]));
}

export function createStashProfile(nodeResource: string, updateIntervalHours = 6): string {
  return stringifyYaml({
    mode: "rule",
    "log-level": "info",
    ipv6: true,
    "profile-update-interval": updateIntervalHours,
    proxies: readYamlProxyResource(nodeResource, "Stash"),
    "proxy-groups": stashProxyGroups(),
    "rule-providers": ruleProviders(updateIntervalHours),
    rules: mihomoRules,
  });
}
