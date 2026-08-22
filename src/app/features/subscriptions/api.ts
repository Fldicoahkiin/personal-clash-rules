import { queryOptions } from "@tanstack/react-query";

export type OutputTarget =
  | "mihomo"
  | "clash"
  | "stash"
  | "surge"
  | "loon"
  | "shadowrocket"
  | "quantumult-x"
  | "sing-box"
  | "egern"
  | "surfboard"
  | "v2ray"
  | "uri"
  | "json";

export type SourceType = "subscription" | "node";

export interface ProfileSummary {
  id: string;
  name: string;
  sourceCount: number;
  outputCount: number;
  linkCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SubscriptionSource {
  id: string;
  name: string;
  type: SourceType;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SubscriptionLink {
  id: string;
  name: string;
  enabled: boolean;
  createdAt: string;
  revokedAt: string | null;
  urls: Partial<Record<OutputTarget, string>> | null;
}

export interface ProfileDetail {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  sources: SubscriptionSource[];
  outputs: Array<{
    target: OutputTarget;
    contentType: string;
    etag: string;
    generatedAt: string;
  }>;
  links: SubscriptionLink[];
  latestRefresh: {
    id: string;
    status: "running" | "succeeded" | "failed";
    nodeCount: number | null;
    targetCount: number | null;
    error: string | null;
    startedAt: string;
    finishedAt: string | null;
  } | null;
}

interface ApiErrorBody {
  error?: string;
  message?: string;
}

const controlTokenKey = "flacier-control-token";

function authenticatedHeaders(headers?: HeadersInit): Headers {
  const next = new Headers(headers);
  if (typeof sessionStorage === "undefined") {
    return next;
  }
  const token = sessionStorage.getItem(controlTokenKey);
  if (token) {
    next.set("Authorization", `Bearer ${token}`);
  }
  return next;
}

export function setControlToken(token: string): void {
  sessionStorage.setItem(controlTokenKey, token.trim());
}

export class SubscriptionApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: authenticatedHeaders(init?.headers),
  });
  if (!response.ok) {
    let body: ApiErrorBody = {};
    try {
      const parsed: unknown = await response.json();
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        body = parsed as ApiErrorBody;
      }
    } catch {
      body = {};
    }
    throw new SubscriptionApiError(
      response.status,
      body.error ?? "request_failed",
      body.message ?? `Request failed with HTTP ${response.status}`,
    );
  }
  return await response.json() as T;
}

function jsonInit(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

export const subscriptionQueries = {
  all: ["subscription-profiles"] as const,
  list: () => queryOptions({
    queryKey: ["subscription-profiles", "list"] as const,
    queryFn: async () => {
      const data = await requestJson<{ profiles: ProfileSummary[] }>("/api/manage/profiles");
      return data.profiles;
    },
  }),
  detail: (profileId: string) => queryOptions({
    queryKey: ["subscription-profiles", "detail", profileId] as const,
    queryFn: async () => {
      const data = await requestJson<{ profile: ProfileDetail }>(
        `/api/manage/profiles/${profileId}`,
      );
      return data.profile;
    },
  }),
};

export async function createSubscriptionProfile(name: string): Promise<ProfileDetail> {
  const data = await requestJson<{ profile: ProfileDetail }>(
    "/api/manage/profiles",
    jsonInit("POST", { name }),
  );
  return data.profile;
}

export async function addSubscriptionSource(
  profileId: string,
  source: { name: string; type: SourceType; value: string },
): Promise<void> {
  await requestJson(
    `/api/manage/profiles/${profileId}/sources`,
    jsonInit("POST", source),
  );
}

export async function removeSubscriptionSource(sourceId: string): Promise<void> {
  const response = await fetch(`/api/manage/sources/${sourceId}`, {
    method: "DELETE",
    headers: authenticatedHeaders(),
  });
  if (!response.ok) {
    throw new SubscriptionApiError(response.status, "delete_failed", "Source could not be removed");
  }
}

export async function refreshSubscriptionProfile(profileId: string): Promise<void> {
  await requestJson(`/api/manage/profiles/${profileId}/refresh`, jsonInit("POST"));
}

export async function createSubscriptionLink(
  profileId: string,
  name: string,
): Promise<void> {
  await requestJson(
    `/api/manage/profiles/${profileId}/links`,
    jsonInit("POST", { name }),
  );
}

export async function revokeSubscriptionLink(linkId: string): Promise<void> {
  const response = await fetch(`/api/manage/links/${linkId}`, {
    method: "DELETE",
    headers: authenticatedHeaders(),
  });
  if (!response.ok) {
    throw new SubscriptionApiError(response.status, "revoke_failed", "Link could not be revoked");
  }
}

export function subscriptionErrorText(error: unknown): string {
  if (!(error instanceof SubscriptionApiError)) {
    return "操作失败，请重试";
  }
  const messages: Record<string, string> = {
    authentication_required: "登录已失效，请重新进入管理页",
    no_sources: "先添加一个订阅或节点",
    converter_unavailable: "转换服务尚未配置",
    converter_unreachable: "转换服务没有响应",
    conversion_failed: "订阅转换失败，请检查订阅源",
    source_decryption_failed: "订阅源无法解密，请检查数据密钥",
  };
  return messages[error.code] ?? error.message;
}
