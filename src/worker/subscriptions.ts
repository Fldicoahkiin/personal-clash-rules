import { ApiError } from "./api-error";
import {
  applyNodeTransforms,
  defaultNodeSettings,
  parseNodeSettings,
  type NodeSettings,
} from "./node-transforms";
import {
  createMihomoProviderProfile,
  type MihomoDnsMode,
  type MihomoRulePreset,
} from "./mihomo-profile";
import { decodeSubscriptionConfig, hashText, randomSubscriptionId } from "./secrets";
import {
  combineSubscriptionUsage,
  countTargetCompatibleNodes,
  formatSubscriptionUserinfo,
  normalizeSourceBundle,
  normalizeSources,
  parseRemoteSubscriptionUrl,
  probeRemoteSubscriptionMetadata,
  produceTarget,
  type RemoteSubscriptionMetadata,
  type SubscriptionUsage,
} from "./sub-store";
import { managedProfileUrlPlaceholder } from "./surge-profile";
import { targetForUserAgent } from "./subscription-target";
import {
  isOutputTarget,
  outputTargets,
  type OutputTarget,
  type SubscriptionEnv,
} from "./types";

const encoder = new TextEncoder();
const maximumRequestBytes = 16 * 1024;
const maximumSourceBytes = 8 * 1024;
const maximumSources = 20;
const maximumRemoteSources = 10;
const maximumOutputBytes = 1_800_000;
const subscriptionKeyPrefix = "subscription:";
const defaultProfileName = "Flacierの分流规则";
const defaultSourceUserAgent = "mihomo/1.19";
const defaultUpdateIntervalHours = 6;
const nodeScheme = /^(?:anytls|socks5(?:\+tls)?|https?|ssr?|vmess|vless|trojan|hysteria2?|hy2|tuic|wireguard):\/\//iu;

type SubscriptionSource = {
  name: string;
  type: "subscription" | "node";
  value: string;
};

type SourceMode = "convert" | "mihomo-provider";
type FallbackMode = "error" | "mihomo-provider";

type SubscriptionConfig = {
  version: 1;
  dnsMode: MihomoDnsMode;
  name: string;
  fallbackMode: FallbackMode;
  nodeSettings: NodeSettings;
  rulePreset: MihomoRulePreset;
  sourceUserAgent: string;
  sourceMode: SourceMode;
  sources: SubscriptionSource[];
  updateIntervalHours: number;
};

type NodeStats = {
  output: number | null;
  read: number | null;
  skipped: number | null;
};

type SubscriptionUsageSource = {
  name: string;
  status: "available" | "missing" | "client-only";
  usage?: SubscriptionUsage;
};

type GeneratedUsage = {
  combined: SubscriptionUsage | null;
  sources: SubscriptionUsageSource[];
};

function generatedUsage(
  remoteSources: SubscriptionSource[],
  metadata: RemoteSubscriptionMetadata[],
  sourceMode: SourceMode,
): GeneratedUsage {
  return {
    combined: combineSubscriptionUsage(metadata.map((source) => source.usage)) ?? null,
    sources: remoteSources.map((source, index) => {
      const sourceMetadata = metadata[index] ?? { usageStatus: "unavailable" as const };
      const status = sourceMetadata.usageStatus === "available"
        ? "available"
        : sourceMetadata.usageStatus === "missing" && sourceMode === "convert"
          ? "missing"
          : "client-only";
      return {
        name: source.name,
        status,
        ...(sourceMetadata.usage ? { usage: sourceMetadata.usage } : {}),
      };
    }),
  };
}

function displayProfileName(config: SubscriptionConfig, inheritedName?: string): string {
  return config.name || inheritedName || defaultProfileName;
}

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return Response.json(data, { ...init, headers });
}

function readName(value: unknown): string {
  if (value === undefined) {
    return "";
  }
  if (typeof value !== "string") {
    throw new ApiError(400, "invalid_field", "name must be a string");
  }
  const name = value.trim();
  if (name.length > 64) {
    throw new ApiError(400, "invalid_field", "name is invalid");
  }
  return name;
}

function readRulePreset(value: unknown): MihomoRulePreset {
  if (value === undefined || value === "flacier") {
    return "flacier";
  }
  if (value === "global" || value === "direct") {
    return value;
  }
  throw new ApiError(400, "invalid_rule_preset", "Rule preset is invalid");
}

function readDnsMode(value: unknown): MihomoDnsMode {
  if (value === undefined || value === "doh") {
    return "doh";
  }
  if (value === "system") {
    return "system";
  }
  throw new ApiError(400, "invalid_dns_mode", "DNS mode is invalid");
}

function readSourceUserAgent(value: unknown): string {
  if (value === undefined) {
    return defaultSourceUserAgent;
  }
  if (typeof value !== "string") {
    throw new ApiError(400, "invalid_source_user_agent", "Source User-Agent must be a string");
  }
  const sourceUserAgent = value.trim();
  if (!sourceUserAgent || sourceUserAgent.length > 128 || /[\u0000-\u001F\u007F]/u.test(sourceUserAgent)) {
    throw new ApiError(400, "invalid_source_user_agent", "Source User-Agent is invalid");
  }
  return sourceUserAgent;
}

function readUpdateIntervalHours(value: unknown): number {
  if (value === undefined) {
    return defaultUpdateIntervalHours;
  }
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 168) {
    throw new ApiError(400, "invalid_update_interval", "Update interval is invalid");
  }
  return Number(value);
}

function readSourceMode(value: unknown): SourceMode {
  if (value === undefined || value === "convert") {
    return "convert";
  }
  if (value === "mihomo-provider") {
    return "mihomo-provider";
  }
  throw new ApiError(400, "invalid_subscription", "Subscription configuration is invalid");
}

function readFallbackMode(value: unknown, fallback: FallbackMode): FallbackMode {
  if (value === "error") {
    return "error";
  }
  if (value === "mihomo-provider") {
    return "mihomo-provider";
  }
  if (value === undefined) {
    return fallback;
  }
  throw new ApiError(400, "invalid_subscription", "Subscription configuration is invalid");
}

function readSettings(value: unknown): NodeSettings {
  if (value === undefined) {
    return defaultNodeSettings;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "invalid_node_settings", "Node settings must be an object");
  }
  return parseNodeSettings({
    ...defaultNodeSettings,
    ...(value as Record<string, unknown>),
  });
}

function readSources(value: unknown): SubscriptionSource[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ApiError(400, "no_sources", "Add at least one subscription or node");
  }
  if (value.length > maximumSources) {
    throw new ApiError(413, "too_many_sources", `A link supports at most ${maximumSources} sources`);
  }

  const sources = value.map((candidate, index) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new ApiError(400, "invalid_source", "Source must be an object");
    }
    const { name, type, value: sourceValue } = candidate as Record<string, unknown>;
    if (type !== "subscription" && type !== "node") {
      throw new ApiError(400, "invalid_source_type", "Source type is invalid");
    }
    if (typeof sourceValue !== "string") {
      throw new ApiError(400, "invalid_source", "Source value must be a string");
    }
    const normalizedValue = sourceValue.trim();
    if (!normalizedValue || encoder.encode(normalizedValue).byteLength > maximumSourceBytes) {
      throw new ApiError(400, "invalid_source", "Source value is invalid");
    }
    if (type === "subscription") {
      parseRemoteSubscriptionUrl(normalizedValue);
    } else if (!nodeScheme.test(normalizedValue)) {
      throw new ApiError(400, "invalid_node_uri", "Node source uses an unsupported URI scheme");
    }
    const sourceName = typeof name === "string" && name.trim()
      ? name.trim().slice(0, 64)
      : type === "subscription" ? `订阅 ${index + 1}` : `节点 ${index + 1}`;
    const source: SubscriptionSource = { name: sourceName, type, value: normalizedValue };
    return source;
  });

  if (sources.filter((source) => source.type === "subscription").length > maximumRemoteSources) {
    throw new ApiError(413, "too_many_sources", "A link supports at most 10 remote subscriptions");
  }
  return sources;
}

function readConfig(
  value: unknown,
  fallbackMode: FallbackMode = "mihomo-provider",
): SubscriptionConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "invalid_subscription", "Subscription configuration is invalid");
  }
  const input = value as Record<string, unknown>;
  if (input.version !== undefined && input.version !== 1) {
    throw new ApiError(400, "invalid_subscription", "Subscription configuration is invalid");
  }
  return {
    version: 1,
    dnsMode: readDnsMode(input.dnsMode),
    fallbackMode: readFallbackMode(input.fallbackMode, fallbackMode),
    name: readName(input.name),
    nodeSettings: readSettings(input.nodeSettings),
    rulePreset: readRulePreset(input.rulePreset),
    sourceUserAgent: readSourceUserAgent(input.sourceUserAgent),
    sourceMode: readSourceMode(input.sourceMode),
    sources: readSources(input.sources),
    updateIntervalHours: readUpdateIntervalHours(input.updateIntervalHours),
  };
}

async function readRequestObject(request: Request): Promise<Record<string, unknown>> {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > maximumRequestBytes) {
    throw new ApiError(413, "request_too_large", "Request exceeds the 16 KiB limit");
  }

  const body = await request.text();
  if (encoder.encode(body).byteLength > maximumRequestBytes) {
    throw new ApiError(413, "request_too_large", "Request exceeds the 16 KiB limit");
  }
  try {
    const value: unknown = JSON.parse(body);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("not an object");
    }
    return value as Record<string, unknown>;
  } catch {
    throw new ApiError(400, "invalid_json", "Request body must be a JSON object");
  }
}

function contentTypeFor(target: OutputTarget): string {
  if (target === "json" || target === "sing-box" || target === "sing-box-config") {
    return "application/json; charset=utf-8";
  }
  if (
    target === "clash-party-config"
    || target === "mihomo-config"
    || target === "stash-config"
    || target === "egern-config"
  ) {
    return "text/yaml; charset=utf-8";
  }
  return "text/plain; charset=utf-8";
}

function urlsForToken(origin: string, token: string): Record<OutputTarget, string> {
  return Object.fromEntries(
    outputTargets.map((target) => [target, `${origin}/s/${token}/${target}`]),
  ) as Record<OutputTarget, string>;
}

function universalUrlForToken(origin: string, token: string): string {
  return `${origin}/s/${token}`;
}

function isMihomoConfigTarget(target: OutputTarget): boolean {
  return target === "clash-party-config" || target === "mihomo-config";
}

function canUseMihomoProvider(error: unknown): boolean {
  return error instanceof ApiError
    && error.code === "source_failed"
    && /HTTP (?:403|429)$/u.test(error.message);
}

async function generateMihomoProviderTarget(
  env: SubscriptionEnv,
  config: SubscriptionConfig,
  target: OutputTarget,
): Promise<string> {
  if (!isMihomoConfigTarget(target)) {
    throw new ApiError(
      422,
      "source_client_fetch_only",
      "This upstream can only be loaded directly by Mihomo or Clash Party",
    );
  }
  if (config.nodeSettings.sortMode !== "source") {
    throw new ApiError(
      422,
      "source_transform_unavailable",
      "Client-fetched subscriptions cannot be sorted by the Worker",
    );
  }
  const nodeSources = config.sources
    .filter((source) => source.type === "node")
    .map((source) => source.value);
  let nodeResource = "proxies: []\n";
  if (nodeSources.length > 0) {
    const normalized = await normalizeSources(env, {
      profileName: config.name,
      sourceUserAgent: config.sourceUserAgent,
      subscriptionUrls: [],
      nodes: nodeSources,
    });
    const nodes = applyNodeTransforms(normalized, config.nodeSettings);
    nodeResource = await produceTarget(env, nodes, "mihomo");
  }
  return createMihomoProviderProfile({
    dnsMode: config.dnsMode,
    nodeResource,
    nodeSettings: config.nodeSettings,
    providers: config.sources
      .filter((source) => source.type === "subscription")
      .map((source) => ({ name: source.name, url: source.value })),
    rulePreset: config.rulePreset,
    sourceUserAgent: config.sourceUserAgent,
    updateIntervalHours: config.updateIntervalHours,
  });
}

async function generateTarget(
  env: SubscriptionEnv,
  config: SubscriptionConfig,
  target: OutputTarget,
): Promise<{
  content: string;
  inheritedName?: string;
  nodeStats: NodeStats;
  sourceMode: SourceMode;
  usage: GeneratedUsage;
}> {
  let output: string;
  let sourceMode = config.sourceMode;
  let inheritedName: string | undefined;
  let nodeStats: NodeStats = { read: null, output: null, skipped: null };
  const remoteSources = config.sources.filter((source) => source.type === "subscription");
  let remoteMetadata: RemoteSubscriptionMetadata[] = [];
  if (sourceMode === "mihomo-provider") {
    output = await generateMihomoProviderTarget(env, config, target);
    remoteMetadata = await Promise.all(remoteSources.map((source) => (
      probeRemoteSubscriptionMetadata(source.value, config.sourceUserAgent)
    )));
    inheritedName = remoteSources.length === 1 ? remoteMetadata[0]?.profileName : undefined;
  } else {
    try {
      const normalized = await normalizeSourceBundle(env, {
        profileName: config.name,
        sourceUserAgent: config.sourceUserAgent,
        subscriptionUrls: config.sources
          .filter((source) => source.type === "subscription")
          .map((source) => source.value),
        nodes: config.sources
          .filter((source) => source.type === "node")
          .map((source) => source.value),
      });
      const nodes = applyNodeTransforms(normalized.nodes, config.nodeSettings);
      const outputNodeCount = countTargetCompatibleNodes(nodes, target);
      inheritedName = normalized.profileName;
      nodeStats = {
        read: normalized.nodes.length,
        output: outputNodeCount,
        skipped: normalized.nodes.length - outputNodeCount,
      };
      remoteMetadata = normalized.remoteMetadata;
      if (nodes.length === 0) {
        throw new ApiError(422, "no_nodes_after_processing", "No nodes match the current settings");
      }
      output = await produceTarget(
        env,
        nodes,
        target,
        config.rulePreset,
        config.updateIntervalHours,
        config.dnsMode,
      );
    } catch (error) {
      const hasRemoteSource = config.sources.some((source) => source.type === "subscription");
      if (
        !hasRemoteSource
        || config.fallbackMode !== "mihomo-provider"
        || !canUseMihomoProvider(error)
      ) {
        throw error;
      }
      if (!isMihomoConfigTarget(target)) {
        throw new ApiError(
          422,
          "source_client_fetch_only",
          "This upstream can only be loaded directly by Mihomo or Clash Party",
        );
      }
      sourceMode = "mihomo-provider";
      output = await generateMihomoProviderTarget(env, config, target);
      remoteMetadata = await Promise.all(remoteSources.map((source) => (
        probeRemoteSubscriptionMetadata(source.value, config.sourceUserAgent)
      )));
      inheritedName = remoteSources.length === 1 ? remoteMetadata[0]?.profileName : undefined;
    }
  }
  if (encoder.encode(output).byteLength > maximumOutputBytes) {
    throw new ApiError(413, "output_too_large", `${target} output exceeds the 1.8 MB limit`);
  }
  return {
    content: output,
    nodeStats,
    sourceMode,
    usage: generatedUsage(remoteSources, remoteMetadata, sourceMode),
    ...(inheritedName ? { inheritedName } : {}),
  };
}

async function createSubscription(
  request: Request,
  url: URL,
  env: SubscriptionEnv,
): Promise<Response> {
  if (request.method !== "POST") {
    throw new ApiError(405, "method_not_allowed", "Method not allowed");
  }
  const body = await readRequestObject(request);
  if (typeof body.target !== "string" || !isOutputTarget(body.target)) {
    throw new ApiError(400, "unsupported_target", "Output target is not supported");
  }
  const config = readConfig(body, "error");

  const generated = await generateTarget(env, config, body.target);
  const token = randomSubscriptionId();
  await env.SUBSCRIPTIONS.put(`${subscriptionKeyPrefix}${token}`, JSON.stringify(config));

  return json({
    nodeStats: generated.nodeStats,
    profileName: displayProfileName(config, generated.inheritedName),
    sourceMode: generated.sourceMode,
    target: body.target,
    usage: generated.usage,
    url: urlsForToken(url.origin, token)[body.target],
    universalUrl: universalUrlForToken(url.origin, token),
  }, { status: 201 });
}

async function readSubscriptionConfig(
  token: string,
  env: SubscriptionEnv,
): Promise<SubscriptionConfig> {
  let value: unknown;
  try {
    if (token.startsWith("v1.")) {
      value = JSON.parse(decodeSubscriptionConfig(token));
    } else {
      if (!/^[A-Za-z0-9_-]{16}$/u.test(token)) {
        throw new ApiError(404, "subscription_not_found", "Subscription not found");
      }
      const stored = await env.SUBSCRIPTIONS.get(`${subscriptionKeyPrefix}${token}`);
      if (!stored) {
        throw new ApiError(404, "subscription_not_found", "Subscription not found");
      }
      value = JSON.parse(stored);
    }
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(404, "subscription_not_found", "Subscription not found");
  }
  try {
    return readConfig(value);
  } catch {
    throw new ApiError(404, "subscription_not_found", "Subscription not found");
  }
}

async function resolveSubscription(
  request: Request,
  env: SubscriptionEnv,
): Promise<Response> {
  if (request.method !== "POST") {
    throw new ApiError(405, "method_not_allowed", "Method not allowed");
  }
  const body = await readRequestObject(request);
  if (typeof body.url !== "string") {
    throw new ApiError(400, "invalid_subscription_url", "Subscription URL is invalid");
  }
  let link: URL;
  try {
    link = new URL(body.url.trim());
  } catch {
    throw new ApiError(400, "invalid_subscription_url", "Subscription URL is invalid");
  }
  const parts = link.pathname.split("/").filter(Boolean);
  if (parts[0] !== "s" || !parts[1] || parts.length > 3) {
    throw new ApiError(400, "invalid_subscription_url", "Subscription URL is invalid");
  }
  const config = await readSubscriptionConfig(parts[1], env);
  const targetValue = parts[2] || link.searchParams.get("target") || "clash-party-config";
  const target = isOutputTarget(targetValue) ? targetValue : "clash-party-config";
  return json({ config, target });
}

async function renderSubscription(
  request: Request,
  url: URL,
  env: SubscriptionEnv,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    throw new ApiError(405, "method_not_allowed", "Method not allowed");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length !== 2 && parts.length !== 3) {
    throw new ApiError(404, "subscription_not_found", "Subscription not found");
  }

  const universal = parts.length === 2;
  const targetParameter = universal ? url.searchParams.get("target") : parts[2];
  let target: OutputTarget;
  if (targetParameter) {
    if (!isOutputTarget(targetParameter)) {
      throw new ApiError(400, "unsupported_target", "Output target is not supported");
    }
    target = targetParameter;
  } else {
    target = targetForUserAgent(request.headers.get("user-agent") ?? "");
  }
  const config = await readSubscriptionConfig(parts[1], env);
  const generated = await generateTarget(env, config, target);
  const subscriptionUserinfo = generated.usage.combined
    ? formatSubscriptionUserinfo(generated.usage.combined)
    : undefined;
  const content = target === "surge-config" || target === "surfboard-config"
    ? generated.content.replace(managedProfileUrlPlaceholder, url.toString())
    : generated.content;
  const etag = `"${await hashText(content)}"`;
  const profileName = displayProfileName(config, generated.inheritedName);
  const headers = new Headers({
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${profileName}.yaml`)}`,
    "Content-Type": contentTypeFor(target),
    ETag: etag,
    "Profile-Update-Interval": String(config.updateIntervalHours),
    "X-Subscription-Profile": encodeURIComponent(profileName),
    "X-Subscription-Source-Mode": generated.sourceMode,
    "X-Subscription-Target": target,
  });
  if (universal && !targetParameter) {
    headers.set("Vary", "User-Agent");
  }
  if (subscriptionUserinfo) {
    headers.set("Subscription-Userinfo", subscriptionUserinfo);
  }
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(request.method === "HEAD" ? null : content, { headers });
}

export async function routeSubscriptionRequest(
  request: Request,
  url: URL,
  env: SubscriptionEnv,
): Promise<Response | null> {
  try {
    if (url.pathname === "/api/subscriptions") {
      return await createSubscription(request, url, env);
    }
    if (url.pathname === "/api/subscriptions/resolve") {
      return await resolveSubscription(request, env);
    }
    if (url.pathname.startsWith("/api/")) {
      throw new ApiError(404, "api_not_found", "API endpoint not found");
    }
    if (url.pathname.startsWith("/s/")) {
      return await renderSubscription(request, url, env);
    }
    return null;
  } catch (error) {
    if (error instanceof ApiError) {
      return json(
        { error: error.code, message: error.message },
        { status: error.status, headers: { "Cache-Control": "no-store" } },
      );
    }
    throw error;
  }
}
