export type OutputTarget =
  | "clash-party-config"
  | "mihomo-config"
  | "stash-config"
  | "surge-config"
  | "surfboard-config"
  | "loon-config"
  | "egern-config"
  | "sing-box-config"
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
export type NodeSortMode = "source" | "name-asc" | "name-desc";
export type RulePreset = "flacier" | "global" | "direct";
export type SourceMode = "convert" | "mihomo-provider";
export type FallbackMode = "error" | "mihomo-provider";
export type DnsMode = "doh" | "system";

export interface NodeRenameRule {
  pattern: string;
  replacement: string;
}

export interface NodeSettings {
  addCountryFlag: boolean;
  includePattern: string;
  excludePattern: string;
  renameRules: NodeRenameRule[];
  showNodeType: boolean;
  skipCertVerify: boolean;
  sortMode: NodeSortMode;
  tfo: boolean;
  udp: boolean;
  xudp: boolean;
}

export interface ConvertedSubscription {
  nodeStats: {
    output: number | null;
    read: number | null;
    skipped: number | null;
  };
  profileName: string;
  sourceMode: SourceMode;
  target: OutputTarget;
  usage: {
    combined: SubscriptionUsage | null;
    sources: SubscriptionUsageSource[];
  };
  url: string;
  universalUrl: string;
}

export interface SubscriptionUsage {
  upload: string;
  download: string;
  total: string;
  expire?: string;
}

export interface SubscriptionUsageSource {
  name: string;
  status: "available" | "missing" | "client-only";
  usage?: SubscriptionUsage;
}

interface ApiErrorBody {
  error?: string;
  message?: string;
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

export async function createConvertedSubscription(input: {
  dnsMode: DnsMode;
  fallbackMode: FallbackMode;
  name: string;
  nodeSettings: NodeSettings;
  rulePreset: RulePreset;
  sourceUserAgent: string;
  sources: Array<{ name: string; type: SourceType; value: string }>;
  target: OutputTarget;
  updateIntervalHours: number;
}): Promise<ConvertedSubscription> {
  const response = await fetch("/api/subscriptions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw await apiError(response);
  }
  return await response.json() as ConvertedSubscription;
}

export function subscriptionErrorText(error: unknown): string {
  if (!(error instanceof SubscriptionApiError)) {
    return "生成失败，请重试";
  }
  if (error.code === "source_failed" && /HTTP (?:403|429)$/u.test(error.message)) {
    return "机场拒绝 Worker 读取；可在进阶设置开启客户端直读备用";
  }
  const messages: Record<string, string> = {
    no_sources: "请添加一个订阅或节点",
    invalid_subscription_url: "订阅地址必须是公网 HTTPS 地址",
    invalid_node_uri: "节点链接格式不受支持",
    source_unreachable: "订阅源没有响应",
    source_failed: "订阅源返回错误",
    source_redirect_limit: "订阅源重定向次数过多",
    source_response_too_large: "订阅源内容超过 1 MiB",
    too_many_sources: "订阅来源数量过多",
    request_too_large: "输入内容超过 16 KiB",
    no_nodes_found: "不兼容：订阅中没有可识别的节点",
    invalid_node_pattern: "正则格式有误，请检查更多设置",
    invalid_node_settings: "节点处理设置有误",
    invalid_rule_preset: "规则方案无效",
    invalid_dns_mode: "DNS 模板无效",
    invalid_source_user_agent: "订阅请求 UA 无效",
    invalid_update_interval: "更新间隔需要在 1 到 168 小时之间",
    no_nodes_after_processing: "没有节点符合当前筛选条件",
    source_client_fetch_only: "不兼容：机场只能由 Clash Party 或 Mihomo 直接读取",
    source_transform_unavailable: "客户端直连模式不支持节点排序",
    target_unsupported: "不兼容：节点协议无法生成当前格式",
    output_too_large: "生成内容过大",
  };
  return messages[error.code] ?? error.message;
}
