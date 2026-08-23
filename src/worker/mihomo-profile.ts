import { stringify as stringifyYaml } from "yaml";

import {
  mihomoProxyGroups,
  mihomoRuleProviders,
  mihomoRules,
} from "../config/mihomo-policy";
import { readYamlProxyResource } from "./yaml-proxy-resource";

export function createMihomoProfile(nodeResource: string): string {
  return stringifyYaml({
    "mixed-port": 7890,
    "allow-lan": false,
    mode: "rule",
    "log-level": "info",
    ipv6: true,
    "unified-delay": true,
    "tcp-concurrent": true,
    profile: {
      "store-selected": true,
    },
    proxies: readYamlProxyResource(nodeResource, "Mihomo"),
    "proxy-groups": mihomoProxyGroups,
    "rule-providers": mihomoRuleProviders,
    rules: mihomoRules,
  });
}
