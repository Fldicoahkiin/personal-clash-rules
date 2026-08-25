import { ApiError } from "./api-error";
import {
  applyNodeTransforms,
  defaultNodeSettings,
  parseNodeSettings,
  type NodeSettings,
} from "./node-transforms";
import {
  createMihomoProviderProfile,
  type MihomoRulePreset,
} from "./mihomo-profile";
import { decodeSubscriptionConfig, encodeSubscriptionConfig, hashText } from "./secrets";
import {
  normalizeSources,
  parseRemoteSubscriptionUrl,
  produceTarget,
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
const maximumTokenLength = 24 * 1024;
const maximumOutputBytes = 1_800_000;
const defaultProfileName = "Flacier";
const defaultSourceUserAgent = "mihomo/1.19";
const defaultUpdateIntervalHours = 6;
const nodeScheme = /^(?:anytls|socks5(?:\+tls)?|https?|ssr?|vmess|vless|trojan|hysteria2?|hy2|tuic|wireguard):\/\//iu;

type SubscriptionSource = {
  name: string;
  type: "subscription" | "node";
  value: string;
};

type SourceMode = "convert" | "mihomo-provider";

type SubscriptionConfig = {
  version: 1;
  name: string;
  nodeSettings: NodeSettings;
  rulePreset: MihomoRulePreset;
  sourceUserAgent: string;
  sourceMode: SourceMode;
  sources: SubscriptionSource[];
  updateIntervalHours: number;
};

function displayProfileName(config: SubscriptionConfig): string {
  return config.name || defaultProfileName;
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
  if (value === "global") {
    return "global";
  }
  throw new ApiError(400, "invalid_rule_preset", "Rule preset is invalid");
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

function readConfig(value: unknown): SubscriptionConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "invalid_subscription", "Subscription configuration is invalid");
  }
  const input = value as Record<string, unknown>;
  if (input.version !== undefined && input.version !== 1) {
    throw new ApiError(400, "invalid_subscription", "Subscription configuration is invalid");
  }
  return {
    version: 1,
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
): Promise<{ content: string; sourceMode: SourceMode }> {
  let output: string;
  let sourceMode = config.sourceMode;
  if (sourceMode === "mihomo-provider") {
    output = await generateMihomoProviderTarget(env, config, target);
  } else {
    try {
      const normalized = await normalizeSources(env, {
        profileName: config.name,
        sourceUserAgent: config.sourceUserAgent,
        subscriptionUrls: config.sources
          .filter((source) => source.type === "subscription")
          .map((source) => source.value),
        nodes: config.sources
          .filter((source) => source.type === "node")
          .map((source) => source.value),
      });
      const nodes = applyNodeTransforms(normalized, config.nodeSettings);
      if (nodes.length === 0) {
        throw new ApiError(422, "no_nodes_after_processing", "No nodes match the current settings");
      }
      output = await produceTarget(
        env,
        nodes,
        target,
        config.rulePreset,
        config.updateIntervalHours,
      );
    } catch (error) {
      const hasRemoteSource = config.sources.some((source) => source.type === "subscription");
      if (!hasRemoteSource || !isMihomoConfigTarget(target) || !canUseMihomoProvider(error)) {
        throw error;
      }
      sourceMode = "mihomo-provider";
      output = await generateMihomoProviderTarget(env, config, target);
    }
  }
  if (encoder.encode(output).byteLength > maximumOutputBytes) {
    throw new ApiError(413, "output_too_large", `${target} output exceeds the 1.8 MB limit`);
  }
  return { content: output, sourceMode };
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
  const config = readConfig(body);

  const generated = await generateTarget(env, config, body.target);
  config.sourceMode = generated.sourceMode;
  const token = encodeSubscriptionConfig(JSON.stringify(config));
  if (token.length > maximumTokenLength) {
    throw new ApiError(413, "subscription_link_too_long", "Subscription configuration is too large for one link");
  }

  return json({
    profileName: displayProfileName(config),
    sourceMode: config.sourceMode,
    target: body.target,
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
    value = JSON.parse(decodeSubscriptionConfig(token));
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
  const content = target === "surge-config" || target === "surfboard-config"
    ? generated.content.replace(managedProfileUrlPlaceholder, url.toString())
    : generated.content;
  const etag = `"${await hashText(content)}"`;
  const profileName = displayProfileName(config);
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
