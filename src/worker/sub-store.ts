import { stringify as stringifyYaml } from "yaml";

import { mihomoProxyGroups } from "../config/mihomo-policy";
import { ApiError } from "./api-error";
import { createEgernProfile } from "./egern-profile";
import { createLoonProfile } from "./loon-profile";
import { createMihomoProfile } from "./mihomo-profile";
import { createSingBoxProfile } from "./sing-box-profile";
import { createStashProfile } from "./stash-profile";
import { createSurgeProfile, createSurfboardProfile } from "./surge-profile";
import type { OutputTarget, SubscriptionEnv } from "./types";

const targetNames: Record<OutputTarget, string> = {
  "mihomo-config": "Mihomo",
  "stash-config": "Stash",
  "surge-config": "Surge",
  "surfboard-config": "Surfboard",
  "loon-config": "Loon",
  "egern-config": "Egern",
  "sing-box-config": "sing-box",
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

function prepareNodes(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw new ApiError(502, "converter_invalid_response", "Sub-Store returned no node list");
  }

  const fingerprints = new Set<string>();
  const names = new Set(["DIRECT", "REJECT", ...mihomoProxyGroups.map((group) => group.name)]);
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new ApiError(502, "converter_invalid_response", "Sub-Store returned an invalid node");
    }
    const node = Object.fromEntries(
      Object.entries(candidate as Record<string, unknown>)
        .filter(([key]) => key !== "id" && !key.startsWith("_")),
    );
    if (typeof node.name !== "string" || !node.name.trim()) {
      throw new ApiError(502, "converter_invalid_response", "Sub-Store returned a node without a name");
    }

    const fingerprint = JSON.stringify(Object.fromEntries(
      Object.entries(node)
        .sort(([left], [right]) => left.localeCompare(right)),
    ));
    if (fingerprints.has(fingerprint)) {
      return [];
    }
    fingerprints.add(fingerprint);

    const name = node.name.trim();
    let uniqueName = name;
    let suffix = 2;
    while (names.has(uniqueName)) {
      uniqueName = `${name} · ${suffix}`;
      suffix += 1;
    }
    names.add(uniqueName);
    return [{
      ...node,
      name: uniqueName,
    }];
  });
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

  return prepareNodes(data.processed);
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
  const output = typeof data.par_res === "string"
    ? data.par_res
    : data.par_res === undefined
      ? ""
      : JSON.stringify(data.par_res, null, 2);
  if (!output.trim() || output === "null" || output === "[]" || output === "{}") {
    throw new ApiError(
      422,
      "target_unsupported",
      `${target} could not represent the enabled nodes`,
    );
  }

  if (target === "mihomo-config") {
    return createMihomoProfile(output);
  }
  if (target === "stash-config") {
    return createStashProfile(output);
  }
  if (target === "surge-config") {
    return createSurgeProfile(output);
  }
  if (target === "surfboard-config") {
    return createSurfboardProfile(output);
  }
  if (target === "loon-config") {
    return createLoonProfile(output);
  }
  if (target === "egern-config") {
    return createEgernProfile(output);
  }
  if (target === "sing-box-config") {
    return createSingBoxProfile(output);
  }
  return output;
}
