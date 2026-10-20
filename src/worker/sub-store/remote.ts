import { ApiError } from "../api-error";
import { hashText } from "../secrets";
import type { SubscriptionEnv } from "../types";
import { decodeMaybeBase64, parseProxies } from "./parse";
import { remoteSubscriptionMetadata, type RemoteSubscriptionMetadata } from "./usage";

// Adapted from realchendahuang/sub-store-cloudflare under AGPL-3.0.
const maximumRemoteBytes = 1024 * 1024;

export const maximumRemoteSources = 10;

const maximumRedirects = 3;

const redirectStatuses = new Set([301, 302, 303, 307, 308]);

function isPrivateIpv4(hostname: string): boolean {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(hostname)) {
    return false;
  }
  const octets = hostname.split(".").map(Number);
  if (octets.some((octet) => octet > 255)) {
    return true;
  }
  return octets[0] === 0
    || octets[0] === 10
    || octets[0] === 127
    || (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127)
    || (octets[0] === 169 && octets[1] === 254)
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168)
    || (octets[0] === 198 && octets[1] >= 18 && octets[1] <= 19)
    || octets[0] >= 224;
}

function isPrivateIpv6(hostname: string): boolean {
  const address = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return address === "::"
    || address === "::1"
    || address.startsWith("fc")
    || address.startsWith("fd")
    || /^fe[89ab]/u.test(address)
    || address.startsWith("::ffff:127.")
    || address.startsWith("::ffff:10.")
    || address.startsWith("::ffff:192.168.");
}

export function parseRemoteSubscriptionUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApiError(400, "invalid_subscription_url", "Subscription source is not a valid URL");
  }

  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== "https:") {
    throw new ApiError(400, "invalid_subscription_url", "Subscription source must use HTTPS");
  }
  if (
    hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname.endsWith(".local")
    || isPrivateIpv4(hostname)
    || (hostname.includes(":") && isPrivateIpv6(hostname))
  ) {
    throw new ApiError(400, "invalid_subscription_url", "Subscription source must use a public host");
  }
  return url;
}

export type RemoteSubscriptionSource = { content: string; metadata: RemoteSubscriptionMetadata };

async function requestRemoteSource(
  value: string,
  sourceUserAgent: string,
  method: "GET" | "HEAD",
): Promise<Response> {
  let url = parseRemoteSubscriptionUrl(value);
  let response: Response | null = null;
  const signal = AbortSignal.timeout(20_000);
  let redirectCount = 0;

  for (; redirectCount <= maximumRedirects; redirectCount += 1) {
    try {
      response = await fetch(url.toString(), {
        headers: { "User-Agent": sourceUserAgent },
        method,
        redirect: "manual",
        signal,
      });
    } catch {
      throw new ApiError(502, "source_unreachable", "Subscription source did not respond");
    }

    if (!redirectStatuses.has(response.status)) {
      break;
    }
    await response.body?.cancel();
    if (redirectCount === maximumRedirects) {
      throw new ApiError(502, "source_redirect_limit", "Subscription source redirected too many times");
    }
    const location = response.headers.get("location");
    if (!location) {
      throw new ApiError(502, "source_failed", "Subscription source returned an invalid redirect");
    }
    url = parseRemoteSubscriptionUrl(new URL(location, url).toString());
  }

  if (!response) {
    throw new ApiError(502, "source_unreachable", "Subscription source did not respond");
  }
  const challenge = response.headers.get("cf-mitigated") === "challenge";
  if (!response.ok || challenge) {
    const ray = response.headers.get("cf-ray") ?? "";
    const rayId = /^[a-f0-9]{16,32}(?:-[a-z]{3})?$/iu.test(ray) ? ray : undefined;
    const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    const error = new ApiError(502, "source_failed", `Subscription source returned HTTP ${response.status}`, {
      status: response.status, challenge,
      cloudflare: challenge || !!rayId || response.headers.get("server")?.toLowerCase() === "cloudflare",
      responseType: contentType === "text/html" ? "html" : contentType === "application/json" ? "json" : "other",
      ...(rayId ? { rayId } : {}), redirects: redirectCount, checkedAt: new Date().toISOString(),
    });
    // Error bodies may echo subscription tokens. Retain only allowlisted header evidence.
    try { await response.body?.cancel(); } finally { throw error; }
  }
  return response;
}

export async function readRemoteSource(
  value: string,
  sourceUserAgent: string,
  byteLimit = maximumRemoteBytes,
): Promise<RemoteSubscriptionSource> {
  const response = await requestRemoteSource(value, sourceUserAgent, "GET");
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > byteLimit) {
    await response.body?.cancel();
    throw new ApiError(413, "source_response_too_large", `Subscription source exceeds ${byteLimit} bytes`);
  }

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let content = "";
  let receivedBytes = 0;
  if (reader) {
    try {
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        receivedBytes += chunk.byteLength;
        if (receivedBytes > byteLimit) {
          await reader.cancel();
          throw new ApiError(413, "source_response_too_large", `Subscription source exceeds ${byteLimit} bytes`);
        }
        content += decoder.decode(chunk, { stream: true });
      }
      content += decoder.decode();
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(502, "source_unreachable", "Subscription body could not be read");
    } finally {
      reader.releaseLock();
    }
  }
  return {
    content,
    metadata: remoteSubscriptionMetadata(response),
  };
}

export async function loadRemoteSubscriptionSources(
  env: SubscriptionEnv, urls: string[], userAgent: string, byteLimit = maximumRemoteBytes,
): Promise<RemoteSubscriptionSource[]> {
  if (urls.length > maximumRemoteSources) throw new ApiError(413, "too_many_sources", "A profile supports at most 10 remote sources");
  const sources: RemoteSubscriptionSource[] = [];
  for (const url of urls) {
    const key = `source-cache:${await hashText(`${url}\n${userAgent}`)}`;
    let source: RemoteSubscriptionSource | undefined;
    if (env.SUBSCRIPTIONS) {
      try {
        const raw = await env.SUBSCRIPTIONS.get(key);
        if (raw && raw.length <= 8 * maximumRemoteBytes) {
          const cached = JSON.parse(raw) as { savedAt: number; source: RemoteSubscriptionSource };
          if (Number.isFinite(cached.savedAt) && Date.now() >= cached.savedAt && Date.now() - cached.savedAt < 300_000
            && typeof cached.source?.content === "string" && cached.source.metadata
            && new TextEncoder().encode(cached.source.content).length <= byteLimit) source = cached.source;
        }
      } catch { console.warn(JSON.stringify({ event: "subscription_source_cache_unavailable", operation: "read" })); }
    }
    if (!source) {
      source = await readRemoteSource(url, userAgent, byteLimit);
      if (parseProxies(decodeMaybeBase64(source.content)).length === 0) {
        throw new ApiError(422, "no_nodes_found", "A source returned no supported nodes; the combined profile was not replaced");
      }
      if (env.SUBSCRIPTIONS) {
        try { await env.SUBSCRIPTIONS.put(key, JSON.stringify({ savedAt: Date.now(), source }), { expirationTtl: 300 }); }
        catch { console.warn(JSON.stringify({ event: "subscription_source_cache_unavailable", operation: "write" })); }
      }
    }
    sources.push(source);
  }
  return sources;
}
