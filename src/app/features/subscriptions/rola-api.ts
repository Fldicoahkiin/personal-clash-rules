import { defaultDnsSettings } from "../../../config/dns-settings";
import { SubscriptionApiError, type ConvertedSubscription, type OutputTarget, type SourceType } from "./api";

export type RolaExit = {
  authMode: "literal" | "dynamic";
  id: string; name: string; protocol: "http" | "socks5"; server: string; port: number;
  country: string; sessionId: string; sessionMinutes: number;
};
export type RolaExitDraft = Omit<RolaExit, "id"> & { id?: string; account: string; password: string };
export type RolaSetup = { exits: RolaExit[]; defaults: { rules: string[]; dns: string[] } };
export type RolaPreview = {
  baseId: string;
  nodes: { name: string; type: string; selectable: boolean }[];
  result: ConvertedSubscription;
};
export type RolaResult = { url: string; overrideUrl: string; summary: { country: string; sessionMinutes: number | null; protectedRules: number; inlineNodes: number } };

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
  if (!response.ok) throw new SubscriptionApiError(response.status, typeof data.error === "string" ? data.error : "local_request_failed", typeof data.message === "string" ? data.message : "本地请求失败。");
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
  const data = await response.json() as ConvertedSubscription & { error?: string; message?: string };
  if (!response.ok) throw new SubscriptionApiError(response.status, typeof data.error === "string" ? data.error : "cloud_base_failed", typeof data.message === "string" ? data.message : "云端基础订阅生成失败；本地配置保持不变。");
  return data;
}
