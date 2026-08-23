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
  enabledSourceCount: number;
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

export interface RefreshRun {
  id: string;
  status: "running" | "succeeded" | "failed";
  nodeCount: number | null;
  targetCount: number | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
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
  latestRefresh: RefreshRun | null;
  refreshHistory: RefreshRun[];
}

export interface SubscriptionRefreshResult {
  status: "succeeded";
  nodeCount: number;
  targetCount: number;
  targets: OutputTarget[];
  unavailableTargets: OutputTarget[];
}

export interface ControlSession {
  authenticated: boolean;
}

export interface RuntimeStatus {
  database: "ready" | "migration_required";
  converter: "ready" | "not_configured" | "unreachable";
  refreshSchedule: "0 */6 * * *";
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

export function clearControlToken(): void {
  sessionStorage.removeItem(controlTokenKey);
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

async function apiError(response: Response): Promise<SubscriptionApiError> {
  let body: ApiErrorBody = {};
  try {
    const parsed: unknown = await response.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      body = parsed as ApiErrorBody;
    }
  } catch {
    body = {};
  }
  return new SubscriptionApiError(
    response.status,
    body.error ?? "request_failed",
    body.message ?? `Request failed with HTTP ${response.status}`,
  );
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: authenticatedHeaders(init?.headers),
  });
  if (!response.ok) {
    throw await apiError(response);
  }
  return await response.json() as T;
}

async function requestEmpty(path: string, init: RequestInit): Promise<void> {
  const response = await fetch(path, {
    ...init,
    headers: authenticatedHeaders(init.headers),
  });
  if (!response.ok) {
    throw await apiError(response);
  }
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
  session: () => queryOptions({
    queryKey: ["subscription-session"] as const,
    queryFn: () => requestJson<ControlSession>("/api/manage/session"),
  }),
  status: () => queryOptions({
    queryKey: ["subscription-status"] as const,
    queryFn: () => requestJson<RuntimeStatus>("/api/manage/status"),
  }),
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

export async function renameSubscriptionProfile(
  profileId: string,
  name: string,
): Promise<void> {
  await requestJson(
    `/api/manage/profiles/${profileId}`,
    jsonInit("PATCH", { name }),
  );
}

export async function removeSubscriptionProfile(profileId: string): Promise<void> {
  await requestEmpty(`/api/manage/profiles/${profileId}`, jsonInit("DELETE"));
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
  await requestEmpty(`/api/manage/sources/${sourceId}`, jsonInit("DELETE"));
}

export async function setSubscriptionSourceEnabled(
  sourceId: string,
  enabled: boolean,
): Promise<void> {
  await requestJson(
    `/api/manage/sources/${sourceId}`,
    jsonInit("PATCH", { enabled }),
  );
}

export async function updateSubscriptionSource(
  sourceId: string,
  input: { name: string; value?: string },
): Promise<void> {
  await requestJson(
    `/api/manage/sources/${sourceId}`,
    jsonInit("PATCH", input),
  );
}

export async function refreshSubscriptionProfile(
  profileId: string,
): Promise<SubscriptionRefreshResult> {
  const data = await requestJson<{ refresh: SubscriptionRefreshResult }>(
    `/api/manage/profiles/${profileId}/refresh`,
    jsonInit("POST"),
  );
  return data.refresh;
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
  await requestEmpty(`/api/manage/links/${linkId}`, jsonInit("DELETE"));
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
    converter_invalid_response: "转换服务返回了无法识别的结果",
    conversion_failed: "订阅转换失败，请检查订阅源",
    source_decryption_failed: "订阅源无法解密，请检查数据密钥",
    target_unsupported: "当前节点无法生成可用的客户端格式",
  };
  return messages[error.code] ?? error.message;
}
