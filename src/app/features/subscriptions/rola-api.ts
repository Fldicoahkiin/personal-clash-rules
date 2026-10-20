import { SubscriptionApiError, type ConvertedSubscription } from "./api";

export type RolaExit = {
  authMode: "literal" | "dynamic";
  id: string; name: string; protocol: "http" | "socks5"; server: string; port: number;
  country: string; sessionId: string; sessionMinutes: number;
  exitIp?: string; region?: string; platform?: string;
};
export type RolaExitDraft = Omit<RolaExit, "id"> & { id?: string; account: string; password: string };
export type AdditionalRolaExitDraft = RolaExitDraft & { authMode: "literal" };
export const maxAdditionalRolaExits = 7;
export type RolaPreview = {
  baseId: string;
  nodes: { name: string; type: string; selectable: boolean }[];
  result: Pick<ConvertedSubscription, "nodeStats" | "usage">;
  sourceMode?: "convert" | "snapshot" | "local-sync";
};
export type RolaCloudResult = { url: string; summary: { connectionMode: "chain" | "direct"; groupName: string; policyGroup: string; country: string; sessionMinutes: number | null; protectedRules: number; inlineNodes: number; dnsSelection?: string }; universalUrl: string; shadowrocketConfigUrl?: string; revokeToken: string; expiresAt: string; sourceMode: "convert" | "snapshot" | "local-sync" };
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
