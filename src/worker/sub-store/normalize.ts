import { parse as parseYaml } from "yaml";

import { countryGroupNames, mihomoProxyGroups } from "../../config/mihomo-policy";
import { ApiError } from "../api-error";
import type { SubscriptionNode } from "../node-transforms";
import type { SubscriptionEnv } from "../types";
import { decodeMaybeBase64, parseProxies } from "./parse";
import { loadRemoteSubscriptionSources, maximumRemoteSources, type RemoteSubscriptionSource } from "./remote";
import type { ProxyNode } from "./types";
import { combineSubscriptionUsage, type RemoteSubscriptionMetadata, type SubscriptionUsage } from "./usage";

// Adapted from realchendahuang/sub-store-cloudflare under AGPL-3.0.
function prepareNodes(nodes: ProxyNode[]): SubscriptionNode[] {
  const fingerprints = new Set<string>();
  const names = new Set(["DIRECT", "REJECT", ...Object.keys(countryGroupNames), ...mihomoProxyGroups.map((group) => group.name)]);
  return nodes.flatMap((candidate) => {
    const node = Object.fromEntries(Object.entries(candidate).filter(([key]) => key !== "id" && !key.startsWith("_"))) as ProxyNode;
    const fingerprint = JSON.stringify(Object.fromEntries(Object.entries(node).filter(([key]) => key !== "name").sort(([left], [right]) => left.localeCompare(right))));
    if (fingerprints.has(fingerprint)) return [];
    fingerprints.add(fingerprint);
    const baseName = node.name.trim();
    let name = baseName;
    let suffix = 2;
    while (names.has(name)) {
      name = `${baseName} · ${suffix}`;
      suffix += 1;
    }
    names.add(name);
    return [{ ...node, name }];
  });
}

export async function normalizeSources(
  _env: SubscriptionEnv,
  input: {
    profileName: string;
    sourceUserAgent?: string;
    subscriptionUrls: string[];
    nodes: string[];
  },
): Promise<SubscriptionNode[]> {
  return (await normalizeSourceBundle(_env, input)).nodes;
}

export type SourceResourceLimits = { sourceBytes: number; nodes: number };

export async function normalizeSourceBundle(
  env: SubscriptionEnv,
  input: {
    profileName: string;
    sourceUserAgent?: string;
    subscriptionUrls: string[];
    nodes: string[];
    resourceLimits?: SourceResourceLimits;
    resolvedSources?: RemoteSubscriptionSource[];
  },
): Promise<{
  inputNodeCount: number;
  nodes: SubscriptionNode[];
  profileName?: string;
  remoteMetadata: RemoteSubscriptionMetadata[];
  subscriptionUsage?: SubscriptionUsage;
  upstreamConfig?: Record<string, unknown>;
}> {
  if (input.subscriptionUrls.length > maximumRemoteSources) {
    throw new ApiError(413, "too_many_sources", "A profile supports at most 10 remote sources");
  }
  const remote = input.resolvedSources ?? await loadRemoteSubscriptionSources(env, input.subscriptionUrls, input.sourceUserAgent || "clash.meta", input.resourceLimits?.sourceBytes);
  if (remote.length !== input.subscriptionUrls.length) throw new ApiError(400, "invalid_source_snapshot", "Source snapshot does not match the configuration");
  const parsed = [
    ...remote.map((source) => source.content),
    ...input.nodes,
  ].flatMap((content, index) => {
    const nodes = parseProxies(decodeMaybeBase64(content));
    if (nodes.length === 0) throw new ApiError(422, "no_nodes_found", "A source returned no supported nodes; the combined profile was not replaced");
    const sourceName = remote.length > 1 ? remote[index]?.metadata.profileName : undefined;
    return sourceName ? nodes.map(node => ({ ...node, name: `[${sourceName}] ${node.name}` })) : nodes;
  });
  if (input.resourceLimits && parsed.length > input.resourceLimits.nodes) {
    throw new ApiError(413, "rola_too_many_nodes", `Rola supports at most ${input.resourceLimits.nodes} nodes`);
  }
  if (parsed.length === 0) {
    throw new ApiError(422, "no_nodes_found", "Subscription sources contained no supported nodes");
  }
  const subscriptionUsage = combineSubscriptionUsage(
    remote.map((source) => source.metadata.usage),
  );
  let upstreamConfig: Record<string, unknown> | undefined;
  if (remote.length === 1) {
    try {
      const value: unknown = parseYaml(decodeMaybeBase64(remote[0].content));
      if (value && typeof value === "object" && !Array.isArray(value) && "proxies" in value) {
        upstreamConfig = value as Record<string, unknown>;
      }
    } catch { /* URI subscriptions have no configuration to inherit. */ }
  }
  return {
    inputNodeCount: parsed.length,
    nodes: prepareNodes(parsed),
    remoteMetadata: remote.map((source) => source.metadata),
    ...(upstreamConfig ? { upstreamConfig } : {}),
    ...(remote.length === 1 && remote[0].metadata.profileName
      ? { profileName: remote[0].metadata.profileName }
      : {}),
    ...(subscriptionUsage ? { subscriptionUsage } : {}),
  };
}
