import type { SourceType } from "../features/subscriptions/api";

export type ParsedSubscriptionSource = {
  name: string;
  type: SourceType;
  value: string;
};

const nodeScheme = /^(?:anytls|socks5(?:\+tls)?|https?|ssr?|vmess|vless|trojan|hysteria2?|hy2|tuic|wireguard):\/\//iu;

export function parseSubscriptionInput(input: string): ParsedSubscriptionSource[] {
  let subscriptionCount = 0;
  let nodeCount = 0;

  return input
    .split(/\r?\n|\s+\|\s+/u)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value, index) => {
      if (/^https?:\/\//iu.test(value)) {
        subscriptionCount += 1;
        return {
          name: `订阅 ${subscriptionCount}`,
          type: "subscription" as const,
          value,
        };
      }
      if (nodeScheme.test(value)) {
        nodeCount += 1;
        return {
          name: `节点 ${nodeCount}`,
          type: "node" as const,
          value,
        };
      }
      throw new Error(`第 ${index + 1} 项不是订阅地址或节点链接`);
    });
}
