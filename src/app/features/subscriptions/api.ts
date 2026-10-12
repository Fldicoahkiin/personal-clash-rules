import type { UpstreamFailure } from "../../../config/upstream-failure";

export type OutputTarget =
  | "clash-party-config"
  | "clash-verge-config"
  | "flclash-config"
  | "mihomo-config"
  | "stash-config"
  | "surge-config"
  | "surfboard-config"
  | "loon-config"
  | "egern-config"
  | "sing-box-config"
  | "shadowrocket-config"
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
export type RulePreset = import("../../../config/rule-templates").RuleTemplateId | "global" | "direct";
export type SourceMode = "convert" | "mihomo-provider";
export type FallbackMode = "error" | "mihomo-provider";
export type DnsMode = "doh" | "system" | "upstream";

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
    deduplicated?: number;
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
  nodeUrl?: string;
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
  upstream?: unknown;
}

export class SubscriptionApiError extends Error {
  readonly upstream?: UpstreamFailure;
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    upstream?: unknown,
  ) {
    super(message);
    if (upstream && typeof upstream === "object" && !Array.isArray(upstream)) {
      const value = upstream as Record<string, unknown>;
      if (typeof value.status === "number" && Number.isInteger(value.status) && value.status >= 100 && value.status <= 599
        && typeof value.challenge === "boolean" && typeof value.cloudflare === "boolean"
        && (value.responseType === "html" || value.responseType === "json" || value.responseType === "other")
        && typeof value.redirects === "number" && Number.isInteger(value.redirects) && value.redirects >= 0 && value.redirects <= 5
        && typeof value.checkedAt === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value.checkedAt)) {
        this.upstream = { status: value.status, challenge: value.challenge, cloudflare: value.cloudflare,
          responseType: value.responseType, redirects: value.redirects, checkedAt: value.checkedAt,
          ...(typeof value.rayId === "string" && /^[a-f0-9]{16,32}(?:-[a-z]{3})?$/iu.test(value.rayId) ? { rayId: value.rayId } : {}) };
      }
    }
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
    body.upstream,
  );
}

export async function createConvertedSubscription(input: {
  dnsSettings?: import("../../../config/dns-settings").DnsSettings;
  dnsMode: DnsMode;
  fallbackMode: FallbackMode;
  name: string;
  nodeSettings: NodeSettings;
  rulePreset: RulePreset;
  ruleTemplateUrl?: string;
  sourceUserAgent: string;
  sources: Array<{ name: string; type: SourceType; value: string }>;
  target: OutputTarget;
  updateIntervalHours: number;
}, backend = ""): Promise<ConvertedSubscription> {
  const response = await fetch(`${backend}/api/subscriptions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) {
    throw await apiError(response);
  }
  return await response.json() as ConvertedSubscription;
}

export function subscriptionErrorText(error: unknown): string {
  if (!(error instanceof SubscriptionApiError)) {
    return "无法连接转换后端；本地版请先运行 pnpm start:local，或打开本地页面";
  }
  if (error.code === "source_failed") {
    const upstream = error.upstream;
    const evidence = upstream ? ` 上游 HTTP ${upstream.status}${upstream.rayId ? ` · 请求编号 ${upstream.rayId}` : ""}。` : "";
    if (upstream?.challenge) return `机场返回了 Cloudflare 浏览器验证页，不是节点配置。请机场提供供客户端读取的订阅接口，或允许本站 Worker 读取；重复生成和修改本地 DNS 不能完成这个验证。${evidence}`;
    if (upstream?.status === 429 || /HTTP 429$/u.test(error.message)) return `机场限制了请求频率，请等待后再试；当前订阅和代理未改变。${evidence}`;
    if (upstream?.status === 401) return `机场要求有效的订阅凭据，请在机场面板确认订阅地址仍有效。${evidence}`;
    if (upstream?.status === 403 || /HTTP 403$/u.test(error.message)) return `机场拒绝当前后端读取（403），现有证据不能确认具体拦截规则。请机场核对该请求；不会自动切换后端或输出空节点。${evidence}`;
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
    rate_limited: "请求太频繁，请稍后重试",
    no_nodes_found: "有来源返回空内容或没有可识别节点，本次不发布残缺配置；已有链接将尝试保留最近一次有效结果",
    invalid_node_pattern: "正则格式有误，请检查更多设置",
    invalid_node_settings: "节点处理设置有误",
    invalid_rule_preset: "规则方案无效",
    invalid_rule_template: "请填写远程规则模板地址",
    unsupported_rule_template: "此 INI 模板含未支持的指令，请使用 ACL4SSR 默认、多国或无自动测速模板",
    invalid_dns_mode: "DNS 模板无效",
    invalid_dns_settings: "DNS 设置有误；请使用最多 4 个不带路由后缀的 HTTPS DoH 地址",
    invalid_dns_bootstrap: "自定义引导 DNS 必须使用 IP 地址的 DoH，避免先解析 DNS 自身造成循环",
    upstream_dns_dependency: "上游 DNS 依赖原策略组、接口或规则，不能单独继承；请选代理解析并配置独立引导 DNS",
    upstream_bootstrap_unavailable: "上游没有独立的节点 DNS 和引导 DNS；请选择系统或自定义引导",
    dns_requires_proxy: "纯直连方案不能使用代理 DNS；请明确选择系统或上游 DNS",
    upstream_dns_unavailable: "此来源没有可继承的 DNS：请使用单个完整 Clash 订阅，或选择内置 DoH",
    shadowrocket_dns_mode: "Shadowrocket 不能直接继承 Mihomo DNS；请选择代理 DoH，并使用系统或自定义引导 DNS",
    shadowrocket_node_name: "节点名称含配置分隔符，请用重命名移除逗号、等号、引号、分号或换行，再生成 Shadowrocket 配置",
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
