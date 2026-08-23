import { authorizeControlRequest, isControlRequestAuthorized } from "./access";
import { ApiError } from "./api-error";
import { applyNodeTransforms, parseNodeSettings } from "./node-transforms";
import { createShareToken, decryptSource, encryptSource, hashToken } from "./secrets";
import { normalizeSources, probeSubStore, produceTarget } from "./sub-store";
import { managedProfileUrlPlaceholder } from "./surge-profile";
import {
  createProfile,
  deleteProfile,
  deleteSource,
  insertShareLink,
  insertSource,
  listRefreshableProfileIds,
  listProfiles,
  finishRefresh,
  readConversionSources,
  readEditableSource,
  readProfile,
  readProfileLinks,
  readPublishedOutput,
  replaceOutputs,
  renameProfile,
  revokeShareLink,
  setSourceEnabled,
  startRefresh,
  updateSource,
  updateProfileNodeSettings,
  writeOutput,
} from "./subscription-store";
import { isOutputTarget, outputTargets, type SubscriptionEnv } from "./types";
import { targetForUserAgent } from "./subscription-target";

const encoder = new TextEncoder();
const maximumSourceBytes = 64 * 1024;
const maximumOutputBytes = 1_800_000;

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return Response.json(data, { ...init, headers });
}

function requireDatabase(env: SubscriptionEnv): D1Database {
  if (!env.DB) {
    throw new ApiError(503, "database_unavailable", "Subscription database is not configured");
  }
  return env.DB;
}

async function probeDatabase(
  db: D1Database,
): Promise<"ready" | "migration_required"> {
  try {
    await db.prepare("SELECT id FROM profiles LIMIT 1").first();
    return "ready";
  } catch {
    return "migration_required";
  }
}

async function readObject(request: Request): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("not an object");
    }
    return value as Record<string, unknown>;
  } catch {
    throw new ApiError(400, "invalid_json", "Request body must be a JSON object");
  }
}

function readTextField(
  body: Record<string, unknown>,
  field: string,
  options: { fallback?: string; maximum: number },
): string {
  const candidate = body[field] ?? options.fallback;
  if (typeof candidate !== "string") {
    throw new ApiError(400, "invalid_field", `${field} must be a string`);
  }
  const value = candidate.trim();
  if (!value || value.length > options.maximum) {
    throw new ApiError(400, "invalid_field", `${field} is invalid`);
  }
  return value;
}

function contentTypeFor(target: string): string {
  if (target === "json" || target === "sing-box" || target === "sing-box-config") {
    return "application/json; charset=utf-8";
  }
  if (target === "mihomo-config" || target === "stash-config" || target === "egern-config") {
    return "text/yaml; charset=utf-8";
  }
  return "text/plain; charset=utf-8";
}

function urlsForToken(origin: string, token: string) {
  return Object.fromEntries(
    outputTargets.map((target) => [target, `${origin}/s/${token}/${target}`]),
  );
}

function universalUrlForToken(origin: string, token: string): string {
  return `${origin}/s/${token}`;
}

function validateSource(type: "subscription" | "node", value: string): void {
  if (type === "subscription" && !/^https?:\/\//i.test(value)) {
    throw new ApiError(400, "invalid_subscription_url", "Subscription source must use HTTP or HTTPS");
  }
  if (
    type === "node"
    && !/^(?:anytls|socks5(?:\+tls)?|https?|ssr?|vmess|vless|trojan|hysteria2?|hy2|tuic|wireguard):\/\//i.test(value)
  ) {
    throw new ApiError(400, "invalid_node_uri", "Node source uses an unsupported URI scheme");
  }
}

export async function refreshProfile(
  db: D1Database,
  profileId: string,
  env: SubscriptionEnv,
) {
  const stored = await readConversionSources(db, profileId);
  if (!stored) {
    throw new ApiError(404, "profile_not_found", "Profile not found");
  }
  if (stored.sources.length === 0) {
    throw new ApiError(409, "no_sources", "Profile has no enabled sources");
  }

  const refresh = await startRefresh(db, profileId);
  try {
    const decrypted = await Promise.all(stored.sources.map(async (source) => ({
      type: source.source_type,
      value: await decryptSource(
        source.secret_ciphertext,
        source.secret_iv,
        env.DATA_ENCRYPTION_KEY,
      ),
    })));
    const normalizedNodes = await normalizeSources(env, {
      profileName: stored.profile.name,
      subscriptionUrls: decrypted
        .filter((source) => source.type === "subscription")
        .map((source) => source.value),
      nodes: decrypted
        .filter((source) => source.type === "node")
        .map((source) => source.value),
    });
    const nodes = applyNodeTransforms(normalizedNodes, stored.nodeSettings);
    if (nodes.length === 0) {
      throw new ApiError(
        422,
        "no_nodes_after_processing",
        "Node processing removed every enabled node",
      );
    }
    const attempts = await Promise.allSettled(outputTargets.map(async (target) => {
      const content = await produceTarget(env, nodes, target);
      if (encoder.encode(content).byteLength > maximumOutputBytes) {
        throw new ApiError(413, "output_too_large", `${target} output exceeds the 1.8 MB limit`);
      }
      return {
        target,
        content,
        contentType: contentTypeFor(target),
        etag: `"${await hashToken(content)}"`,
      };
    }));

    const converted = attempts.flatMap((attempt) => (
      attempt.status === "fulfilled" ? [attempt.value] : []
    ));
    const unavailableTargets = outputTargets.filter((_, index) => (
      attempts[index].status === "rejected"
    ));
    if (converted.length === 0) {
      const failed = attempts.find((attempt) => attempt.status === "rejected");
      throw failed?.status === "rejected" ? failed.reason : new ApiError(
        502,
        "conversion_failed",
        "Subscription conversion produced no output",
      );
    }

    await replaceOutputs(db, profileId, converted);
    const result = await finishRefresh(db, {
      id: refresh.id,
      status: "succeeded",
      nodeCount: nodes.length,
      targetCount: converted.length,
    });
    return {
      ...result,
      targets: converted.map((output) => output.target),
      unavailableTargets,
    };
  } catch (error) {
    const apiError = error instanceof ApiError
      ? error
      : new ApiError(502, "conversion_failed", "Subscription conversion failed");
    await finishRefresh(db, {
      id: refresh.id,
      status: "failed",
      error: apiError.message,
    });
    throw apiError;
  }
}

export async function refreshDueProfiles(env: SubscriptionEnv) {
  const db = requireDatabase(env);
  const profileIds = await listRefreshableProfileIds(db, 3);
  const results = await Promise.allSettled(
    profileIds.map((profileId) => refreshProfile(db, profileId, env)),
  );

  return {
    selected: profileIds.length,
    succeeded: results.filter((result) => result.status === "fulfilled").length,
    failed: results.filter((result) => result.status === "rejected").length,
  };
}

async function routeControlApi(
  request: Request,
  url: URL,
  env: SubscriptionEnv,
): Promise<Response> {
  const parts = url.pathname.split("/").filter(Boolean);

  if (
    parts.length === 3
    && parts[2] === "session"
    && request.method === "GET"
  ) {
    return json({ authenticated: await isControlRequestAuthorized(request, env) });
  }

  await authorizeControlRequest(request, env);
  const db = requireDatabase(env);

  if (
    parts.length === 3
    && parts[2] === "status"
    && request.method === "GET"
  ) {
    const [database, converter] = await Promise.all([
      probeDatabase(db),
      probeSubStore(env),
    ]);
    return json({
      database,
      converter,
      refreshSchedule: "0 */6 * * *",
    });
  }

  if (parts.length === 3 && parts[2] === "profiles") {
    if (request.method === "GET") {
      return json({ profiles: await listProfiles(db) });
    }
    if (request.method === "POST") {
      const body = await readObject(request);
      const name = readTextField(body, "name", { fallback: "个人订阅", maximum: 64 });
      return json({ profile: await createProfile(db, name) }, { status: 201 });
    }
  }

  if (parts.length === 4 && parts[2] === "profiles") {
    if (request.method === "GET") {
      const profile = await readProfile(db, parts[3]);
      if (!profile) {
        throw new ApiError(404, "profile_not_found", "Profile not found");
      }
      const storedLinks = await readProfileLinks(db, parts[3]);
      const links = await Promise.all(storedLinks.map(async (link) => {
        let urls: Record<string, string> | null = null;
        let universalUrl: string | null = null;
        if (link.enabled === 1 && link.token_ciphertext && link.token_iv) {
          const token = await decryptSource(
            link.token_ciphertext,
            link.token_iv,
            env.DATA_ENCRYPTION_KEY,
          );
          urls = urlsForToken(url.origin, token);
          universalUrl = universalUrlForToken(url.origin, token);
        }
        return {
          id: link.id,
          name: link.name,
          enabled: link.enabled === 1,
          createdAt: link.created_at,
          revokedAt: link.revoked_at,
          universalUrl,
          urls,
        };
      }));
      return json({ profile: { ...profile, links } });
    }
    if (request.method === "PATCH") {
      const body = await readObject(request);
      const name = readTextField(body, "name", { maximum: 64 });
      const profile = await renameProfile(db, parts[3], name);
      if (!profile) {
        throw new ApiError(404, "profile_not_found", "Profile not found");
      }
      return json({ profile });
    }
    if (request.method === "DELETE") {
      if (!await deleteProfile(db, parts[3])) {
        throw new ApiError(404, "profile_not_found", "Profile not found");
      }
      return new Response(null, { status: 204 });
    }
  }

  if (
    parts.length === 5
    && parts[2] === "profiles"
    && parts[4] === "node-settings"
    && request.method === "PUT"
  ) {
    const settings = parseNodeSettings(await readObject(request));
    const nodeSettings = await updateProfileNodeSettings(db, parts[3], settings);
    if (!nodeSettings) {
      throw new ApiError(404, "profile_not_found", "Profile not found");
    }
    return json({ nodeSettings });
  }

  if (parts.length === 5 && parts[2] === "profiles" && parts[4] === "sources" && request.method === "POST") {
    const body = await readObject(request);
    const name = readTextField(body, "name", { maximum: 80 });
    const value = readTextField(body, "value", { maximum: maximumSourceBytes });
    const type = body.type;
    if (type !== "subscription" && type !== "node") {
      throw new ApiError(400, "invalid_source_type", "type must be subscription or node");
    }
    validateSource(type, value);
    if (encoder.encode(value).byteLength > maximumSourceBytes) {
      throw new ApiError(413, "source_too_large", "Source exceeds the 64 KiB limit");
    }

    const encrypted = await encryptSource(value, env.DATA_ENCRYPTION_KEY);
    const source = await insertSource(db, {
      profileId: parts[3],
      name,
      type,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
    });
    if (!source) {
      throw new ApiError(404, "profile_not_found", "Profile not found");
    }
    return json({ source }, { status: 201 });
  }

  if (
    parts.length === 5
    && parts[2] === "profiles"
    && parts[4] === "refresh"
    && request.method === "POST"
  ) {
    return json({ refresh: await refreshProfile(db, parts[3], env) });
  }

  if (parts.length === 4 && parts[2] === "sources" && request.method === "DELETE") {
    if (!await deleteSource(db, parts[3])) {
      throw new ApiError(404, "source_not_found", "Source not found");
    }
    return new Response(null, { status: 204 });
  }

  if (parts.length === 4 && parts[2] === "sources" && request.method === "PATCH") {
    const body = await readObject(request);
    if ("enabled" in body) {
      if (typeof body.enabled !== "boolean") {
        throw new ApiError(400, "invalid_field", "enabled must be a boolean");
      }
      const source = await setSourceEnabled(db, parts[3], body.enabled);
      if (!source) {
        throw new ApiError(404, "source_not_found", "Source not found");
      }
      return json({ source });
    }

    const stored = await readEditableSource(db, parts[3]);
    if (!stored) {
      throw new ApiError(404, "source_not_found", "Source not found");
    }
    const name = readTextField(body, "name", { maximum: 80 });
    let encrypted: { ciphertext: string; iv: string } | undefined;
    if (body.value !== undefined) {
      const value = readTextField(body, "value", { maximum: maximumSourceBytes });
      validateSource(stored.source_type, value);
      if (encoder.encode(value).byteLength > maximumSourceBytes) {
        throw new ApiError(413, "source_too_large", "Source exceeds the 64 KiB limit");
      }
      encrypted = await encryptSource(value, env.DATA_ENCRYPTION_KEY);
    }
    const source = await updateSource(db, parts[3], stored, {
      name,
      ciphertext: encrypted?.ciphertext,
      iv: encrypted?.iv,
    });
    return json({ source });
  }

  if (
    parts.length === 6
    && parts[2] === "profiles"
    && parts[4] === "outputs"
    && request.method === "PUT"
  ) {
    const target = parts[5];
    if (!isOutputTarget(target)) {
      throw new ApiError(400, "unsupported_target", "Output target is not supported");
    }
    const body = await readObject(request);
    if (typeof body.content !== "string" || !body.content) {
      throw new ApiError(400, "invalid_content", "content must be a non-empty string");
    }
    if (encoder.encode(body.content).byteLength > maximumOutputBytes) {
      throw new ApiError(413, "output_too_large", "Output exceeds the 1.8 MB limit");
    }

    const etag = `"${await hashToken(body.content)}"`;
    const written = await writeOutput(db, {
      profileId: parts[3],
      target,
      content: body.content,
      contentType: contentTypeFor(target),
      etag,
    });
    if (!written) {
      throw new ApiError(404, "profile_not_found", "Profile not found");
    }
    return json({ target, etag });
  }

  if (parts.length === 5 && parts[2] === "profiles" && parts[4] === "links" && request.method === "POST") {
    const body = await readObject(request);
    const name = readTextField(body, "name", { fallback: "默认链接", maximum: 80 });
    const token = createShareToken();
    const encryptedToken = await encryptSource(token, env.DATA_ENCRYPTION_KEY);
    const link = await insertShareLink(db, {
      profileId: parts[3],
      name,
      tokenHash: await hashToken(token),
      tokenCiphertext: encryptedToken.ciphertext,
      tokenIv: encryptedToken.iv,
    });
    if (!link) {
      throw new ApiError(404, "profile_not_found", "Profile not found");
    }

    return json({
      link,
      universalUrl: universalUrlForToken(url.origin, token),
      urls: urlsForToken(url.origin, token),
    }, { status: 201 });
  }

  if (parts.length === 4 && parts[2] === "links" && request.method === "DELETE") {
    if (!await revokeShareLink(db, parts[3])) {
      throw new ApiError(404, "link_not_found", "Active link not found");
    }
    return new Response(null, { status: 204 });
  }

  throw new ApiError(404, "api_not_found", "API endpoint not found");
}

async function routePublishedOutput(
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
  let requestedTarget: (typeof outputTargets)[number] | null = null;
  if (targetParameter) {
    if (!isOutputTarget(targetParameter)) {
      throw new ApiError(400, "unsupported_target", "Output target is not supported");
    }
    requestedTarget = targetParameter;
  }
  const target = requestedTarget ?? targetForUserAgent(
    request.headers.get("user-agent") ?? "",
  );

  const output = await readPublishedOutput(
    requireDatabase(env),
    await hashToken(parts[1]),
    target,
  );
  if (!output) {
    throw new ApiError(404, "subscription_not_found", "Subscription not found");
  }

  const content = target === "surge-config" || target === "surfboard-config"
    ? output.content.replace(managedProfileUrlPlaceholder, url.toString())
    : output.content;
  const etag = content === output.content ? output.etag : `"${await hashToken(content)}"`;

  const headers = new Headers({
    "Content-Type": output.content_type,
    ETag: etag,
    "X-Subscription-Profile": encodeURIComponent(output.profile_name),
    "X-Subscription-Target": target,
    "X-Subscription-Updated-At": output.generated_at,
  });
  if (universal && !requestedTarget) {
    headers.set("Vary", "User-Agent");
  }
  const generatedAt = new Date(output.generated_at);
  const lastModified = Number.isNaN(generatedAt.valueOf())
    ? null
    : generatedAt.toUTCString();
  if (lastModified) {
    headers.set("Last-Modified", lastModified);
  }

  const ifNoneMatch = request.headers.get("if-none-match");
  const ifModifiedSince = request.headers.get("if-modified-since");
  const unchangedSince = !ifNoneMatch
    && lastModified
    && ifModifiedSince
    && Date.parse(ifModifiedSince) >= Date.parse(lastModified);
  if (ifNoneMatch === etag || unchangedSince) {
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
    if (url.pathname.startsWith("/api/manage/")) {
      return await routeControlApi(request, url, env);
    }
    if (url.pathname.startsWith("/s/")) {
      return await routePublishedOutput(request, url, env);
    }
    return null;
  } catch (error) {
    if (error instanceof ApiError) {
      return json(
        { error: error.code, message: error.message },
        {
          status: error.status,
          headers: error.status >= 400 ? { "Cache-Control": "no-store" } : undefined,
        },
      );
    }
    throw error;
  }
}
