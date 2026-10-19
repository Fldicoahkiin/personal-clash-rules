import { defaultDnsSettings } from "../../../config/dns-settings";
import { SubscriptionApiError, type ConvertedSubscription, type OutputTarget, type SourceType } from "./api";

export type RolaExit = {
  authMode: "literal" | "dynamic";
  id: string; name: string; protocol: "http" | "socks5"; server: string; port: number;
  country: string; sessionId: string; sessionMinutes: number;
  exitIp?: string; region?: string; platform?: string;
};
export type RolaExitDraft = Omit<RolaExit, "id"> & { id?: string; account: string; password: string };
export type AdditionalRolaExitDraft = RolaExitDraft & { authMode: "literal" };
export const maxAdditionalRolaExits = 7;
export type RolaSetup = { exits: RolaExit[]; defaults: { rules: string[]; dns: string[] } };
export type RolaPreview = {
  baseId: string;
  nodes: { name: string; type: string; selectable: boolean }[];
  result: Pick<ConvertedSubscription, "nodeStats" | "usage">;
  sourceMode?: "convert" | "snapshot" | "local-sync";
};
export type RolaResult = { url: string; overrideUrl: string; summary: { connectionMode: "chain" | "direct"; groupName: string; policyGroup: string; country: string; sessionMinutes: number | null; protectedRules: number; inlineNodes: number; dnsSelection?: string } };
export type RolaCloudResult = Omit<RolaResult, "overrideUrl"> & { universalUrl: string; shadowrocketConfigUrl?: string; revokeToken: string; expiresAt: string; sourceMode: "convert" | "snapshot" | "local-sync" };
export type RolaManagement = Pick<RolaCloudResult, "url" | "revokeToken">;

export function rolaExitLabel(exit: Pick<RolaExit, "name" | "exitIp" | "region" | "platform">): string {
  return exit.exitIp && exit.region?.trim() ? `[${exit.platform?.trim() || "Rola"}] ${exit.region.trim()} · ${exit.exitIp}` : exit.name || "ROLA-RESIDENTIAL";
}

export function rolaPlatformError(platform?: string): string {
  return !platform || (platform.length <= 24 && /^[\p{L}\p{N} ._-]+$/u.test(platform))
    ? ""
    : "平台最多 24 个字符，仅支持文字、数字、空格、点、下划线和连字符；不要填写方括号或配置分隔符。";
}

export function additionalRolaExitError(connectionMode: "chain" | "direct", count: number): string {
  if (count > maxAdditionalRolaExits) return "最多添加 7 个附加家宽出口。";
  return connectionMode === "chain" && count > 0
    ? "多个家宽出口只支持直接接入。请切回直接接入，或移除附加出口后再生成；当前填写内容仍保留。"
    : "";
}

export async function requestCloudRola<T>(path: "/preview" | "/chains" | "/revoke", input: unknown): Promise<T> {
  const origin = import.meta.env.DEV ? window.location.origin : "https://rules.flacier.com";
  let response: Response;
  try {
    response = await fetch(`${origin}/api/rola${path}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
      credentials: "omit", redirect: "error", referrerPolicy: "no-referrer", cache: "no-store", signal: AbortSignal.timeout(70000),
    });
  } catch { throw new Error("云端没有响应，请稍后重试。"); }
  if (!response.headers.get("content-type")?.includes("application/json")) throw new Error(`云端返回了非预期内容（HTTP ${response.status}），请稍后重试。`);
  const data = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new SubscriptionApiError(response.status, String(data.error || "cloud_rola_failed"), typeof data.message === "string" ? data.message : "云端请求失败。", data.upstream);
  return data as T;
}

export function saveRolaManagement(result: RolaManagement) {
  const blob = new Blob([JSON.stringify({ url: result.url, revokeToken: result.revokeToken }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = "Flacier-Rola-management.json"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function rolaLocalOrigin(location: Pick<Location, "protocol" | "hostname" | "origin">): string {
  return location.protocol === "http:" && ["localhost", "127.0.0.1"].includes(location.hostname)
    ? location.origin : "http://127.0.0.1:25500";
}

export async function requestRola<T>(path: "" | "/exits" | "/preview" | "/chains", input?: unknown): Promise<T> {
  // Never use the normal converter's backend selector or fall back to the public Worker.
  const origin = rolaLocalOrigin(window.location);
  let response: Response;
  try {
    response = await fetch(`${origin}/api/local/rola${path}`, {
      method: input === undefined ? "GET" : "POST",
      ...(input === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }),
      credentials: "omit", redirect: "error", referrerPolicy: "no-referrer", cache: "no-store",
      signal: AbortSignal.timeout(60000),
    });
  } catch { throw new Error("无法连接本地服务。请先启动本地后端；如浏览器阻止本地网络访问，请打开本地页面。不会改用云端。"); }
  if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("本地服务版本不匹配，请更新并重启本地后端。");
  const data = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new SubscriptionApiError(response.status, typeof data.error === "string" ? data.error : "local_request_failed", typeof data.message === "string" ? data.message : "本地请求失败。", data.upstream);
  return data as T;
}

export async function createRolaCloudBase(input: {
  sources: Array<{ name: string; type: SourceType; value: string }>;
  name: string; sourceUserAgent: string; target: OutputTarget;
}): Promise<ConvertedSubscription> {
  // Explicit airport-only allowlist: never serialize the form state or a saved Rola exit.
  const response = await fetch("https://rules.flacier.com/api/subscriptions", {
    method: "POST", headers: { "Content-Type": "application/json" },
    credentials: "omit", redirect: "error", referrerPolicy: "no-referrer", cache: "no-store",
    signal: AbortSignal.timeout(60000),
    body: JSON.stringify({ sources: input.sources.map(({ name, type, value }) => ({ name, type, value })),
      name: input.name, sourceUserAgent: input.sourceUserAgent, target: input.target,
      rulePreset: "flacier", dnsMode: "doh", dnsSettings: defaultDnsSettings, fallbackMode: "error", updateIntervalHours: 6 }),
  });
  const data = await response.json() as ConvertedSubscription & { error?: string; message?: string; upstream?: unknown };
  if (!response.ok) throw new SubscriptionApiError(response.status, typeof data.error === "string" ? data.error : "cloud_base_failed", typeof data.message === "string" ? data.message : "云端基础订阅生成失败；本地配置保持不变。", data.upstream);
  return data;
}
