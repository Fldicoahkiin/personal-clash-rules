import type { SubscriptionNode } from "../node-transforms";

// Adapted from realchendahuang/sub-store-cloudflare under AGPL-3.0.
export type ProxyNode = SubscriptionNode & { type: string; server?: string; port?: number };

export type SingBoxOutbound = Record<string, unknown> & { type: string; tag: string };

export const TEST_URL = "https://www.gstatic.com/generate_204";
