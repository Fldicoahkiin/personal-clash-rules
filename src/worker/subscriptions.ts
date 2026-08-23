import { ApiError } from "./api-error";
import {
  applyNodeTransforms,
  defaultNodeSettings,
  parseNodeSettings,
  type NodeSettings,
} from "./node-transforms";
import { hashText, openSubscriptionConfig, sealSubscriptionConfig } from "./secrets";
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
const nodeScheme = /^(?:anytls|socks5(?:\+tls)?|https?|ssr?|vmess|vless|trojan|hysteria2?|hy2|tuic|wireguard):\/\//iu;

type SubscriptionSource = {
  type: "subscription" | "node";
  value: string;
};

type SubscriptionConfig = {
  version: 1;
  name: string;
  nodeSettings: NodeSettings;
  sources: SubscriptionSource[];
};

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return Response.json(data, { ...init, headers });
}

function readName(value: unknown): string {
  if (value === undefined) {
    return "个人订阅";
  }
  if (typeof value !== "string") {
    throw new ApiError(400, "invalid_field", "name must be a string");
  }
  const name = value.trim();
  if (!name || name.length > 64) {
    throw new ApiError(400, "invalid_field", "name is invalid");
  }
  return name;
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

  const sources = value.map((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new ApiError(400, "invalid_source", "Source must be an object");
    }
    const { type, value: sourceValue } = candidate as Record<string, unknown>;
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
    const source: SubscriptionSource = { type, value: normalizedValue };
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
    sources: readSources(input.sources),
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
  if (target === "mihomo-config" || target === "stash-config" || target === "egern-config") {
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

async function generateTarget(
  env: SubscriptionEnv,
  config: SubscriptionConfig,
  target: OutputTarget,
): Promise<string> {
  const normalized = await normalizeSources(env, {
    profileName: config.name,
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
  const output = await produceTarget(env, nodes, target);
  if (encoder.encode(output).byteLength > maximumOutputBytes) {
    throw new ApiError(413, "output_too_large", `${target} output exceeds the 1.8 MB limit`);
  }
  return output;
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

  await generateTarget(env, config, body.target);
  const token = await sealSubscriptionConfig(
    JSON.stringify(config),
    env.DATA_ENCRYPTION_KEY,
  );
  if (token.length > maximumTokenLength) {
    throw new ApiError(413, "subscription_link_too_long", "Subscription configuration is too large for one link");
  }

  return json({
    profileName: config.name,
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
    value = JSON.parse(await openSubscriptionConfig(token, env.DATA_ENCRYPTION_KEY));
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
    ? generated.replace(managedProfileUrlPlaceholder, url.toString())
    : generated;
  const etag = `"${await hashText(content)}"`;
  const headers = new Headers({
    "Content-Type": contentTypeFor(target),
    ETag: etag,
    "X-Subscription-Profile": encodeURIComponent(config.name),
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
