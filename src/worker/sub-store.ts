import { stringify as stringifyYaml } from "yaml";

import { ApiError } from "./api-error";
import type { OutputTarget, SubscriptionEnv } from "./types";

const targetNames: Record<OutputTarget, string> = {
  mihomo: "Mihomo",
  clash: "Clash",
  stash: "Stash",
  surge: "Surge",
  loon: "Loon",
  shadowrocket: "Shadowrocket",
  "quantumult-x": "QX",
  "sing-box": "sing-box",
  egern: "Egern",
  surfboard: "Surfboard",
  v2ray: "V2Ray",
  uri: "URI",
  json: "JSON",
};

interface SubStoreSuccess<T> {
  status: "success";
  data: T;
}

function converterUrl(env: SubscriptionEnv, path: string): URL {
  if (!env.SUB_STORE_URL) {
    throw new ApiError(503, "converter_unavailable", "Sub-Store URL is not configured");
  }
  return new URL(path, `${env.SUB_STORE_URL.replace(/\/$/, "")}/`);
}

function authorizedHeaders(env: SubscriptionEnv): Headers {
  const headers = new Headers();
  if (env.SUB_STORE_ACCESS_CLIENT_ID && env.SUB_STORE_ACCESS_CLIENT_SECRET) {
    headers.set("CF-Access-Client-Id", env.SUB_STORE_ACCESS_CLIENT_ID);
    headers.set("CF-Access-Client-Secret", env.SUB_STORE_ACCESS_CLIENT_SECRET);
  } else if (env.SUB_STORE_TOKEN) {
    headers.set("Authorization", `Bearer ${env.SUB_STORE_TOKEN}`);
  }
  return headers;
}

export async function probeSubStore(
  env: SubscriptionEnv,
): Promise<"ready" | "not_configured" | "unreachable"> {
  if (!env.SUB_STORE_URL) {
    return "not_configured";
  }
  try {
    const response = await fetch(converterUrl(env, "/healthz"), {
      headers: authorizedHeaders(env),
      signal: AbortSignal.timeout(5_000),
    });
    return response.ok ? "ready" : "unreachable";
  } catch {
    return "unreachable";
  }
}

async function postToSubStore<T>(
  env: SubscriptionEnv,
  path: string,
  body: unknown,
): Promise<T> {
  const headers = authorizedHeaders(env);
  headers.set("Content-Type", "application/json");

  let response: Response;
  try {
    response = await fetch(converterUrl(env, path), {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new ApiError(502, "converter_unreachable", "Sub-Store did not respond");
  }

  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new ApiError(502, "converter_invalid_response", "Sub-Store returned invalid JSON");
  }

  if (
    !response.ok
    || !result
    || typeof result !== "object"
    || (result as { status?: unknown }).status !== "success"
    || !("data" in result)
  ) {
    throw new ApiError(502, "conversion_failed", `Sub-Store returned HTTP ${response.status}`);
  }

  return (result as SubStoreSuccess<T>).data;
}

export async function normalizeSources(
  env: SubscriptionEnv,
  input: {
    profileName: string;
    subscriptionUrls: string[];
    nodes: string[];
  },
): Promise<unknown[]> {
  const hasRemote = input.subscriptionUrls.length > 0;
  const hasLocal = input.nodes.length > 0;
  const data = await postToSubStore<{ processed?: unknown }>(
    env,
    "/api/preview/sub?target=JSON",
    {
      name: input.profileName,
      source: hasRemote ? "remote" : "local",
      url: input.subscriptionUrls.join("\n"),
      content: input.nodes.join("\n"),
      mergeSources: hasRemote && hasLocal ? "remoteFirst" : undefined,
      process: [],
      noFlow: true,
    },
  );

  if (!Array.isArray(data.processed)) {
    throw new ApiError(502, "converter_invalid_response", "Sub-Store returned no node list");
  }
  return data.processed;
}

export async function produceTarget(
  env: SubscriptionEnv,
  nodes: unknown[],
  target: OutputTarget,
): Promise<string> {
  const data = await postToSubStore<{ par_res?: unknown }>(env, "/api/proxy/parse", {
    data: stringifyYaml({ proxies: nodes }),
    client: targetNames[target],
  });
  if (typeof data.par_res === "string") {
    if (data.par_res.trim()) {
      return data.par_res;
    }
  } else if (data.par_res !== undefined) {
    const serialized = JSON.stringify(data.par_res, null, 2);
    if (serialized !== "null" && serialized !== "[]" && serialized !== "{}") {
      return serialized;
    }
  }
  throw new ApiError(
    422,
    "target_unsupported",
    `${target} could not represent the enabled nodes`,
  );
}
