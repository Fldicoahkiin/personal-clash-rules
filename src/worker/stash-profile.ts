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

export function createStashProfile(nodeResource: string): string {
  return stringifyYaml({
    mode: "rule",
    "log-level": "info",
    ipv6: true,
    proxies: readYamlProxyResource(nodeResource, "Stash"),
    "proxy-groups": stashProxyGroups(),
    "rule-providers": mihomoRuleProviders,
    rules: mihomoRules,
  });
}
