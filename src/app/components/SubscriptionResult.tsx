import { ArrowUpRight, Check, Copy } from "@phosphor-icons/react";

import type {
  ConvertedSubscription,
  SubscriptionUsage,
  SubscriptionUsageSource,
} from "../features/subscriptions/api";
import type { ClientFormat } from "../features/subscriptions/client-formats";
import { buildClientAction } from "../lib/client-import";

type SubscriptionResultProps = {
  copied: boolean;
  format: ClientFormat;
  result: ConvertedSubscription;
  onCopy: () => void;
};

const byteUnits = ["B", "KB", "MB", "GB", "TB", "PB"];

function formatBytes(rawValue: string): string {
  const value = BigInt(rawValue);
  let divisor = 1n;
  let unit = 0;
  while (unit < byteUnits.length - 1 && value >= divisor * 1024n) {
    divisor *= 1024n;
    unit += 1;
  }
  const whole = value / divisor;
  const decimal = (value % divisor) * 10n / divisor;
  return `${whole}${decimal > 0n ? `.${decimal}` : ""} ${byteUnits[unit]}`;
}

function formatUsage(usage: SubscriptionUsage): string {
  const used = BigInt(usage.upload) + BigInt(usage.download);
  const remaining = BigInt(usage.total) - used;
  return `已用 ${formatBytes(String(used))} / ${formatBytes(usage.total)} · 剩余 ${formatBytes(String(remaining > 0n ? remaining : 0n))}`;
}

function formatExpiry(expire?: string): string {
  if (expire === "0") return "长期有效";
  if (!expire) return "未返回到期";
  const date = new Date(Number(expire) * 1000);
  if (Number.isNaN(date.getTime())) return "到期信息无效";
  const formatted = new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Shanghai",
    year: "numeric",
  }).format(date);
  return `到期 ${formatted}`;
}

function usageStatus(source: SubscriptionUsageSource): string {
  if (source.status === "available") return "已读取";
  if (source.status === "missing") return "未返回";
  return "Worker 不可见";
}

export function SubscriptionResult({
  copied,
  format,
  result,
  onCopy,
}: SubscriptionResultProps) {
  const clientAction = format.clientId
    ? buildClientAction(format.clientId, result.url, result.profileName)
    : null;
  const clientDirect = result.sourceMode === "mihomo-provider";
  const localBackend = ["127.0.0.1", "localhost"].includes(new URL(result.url).hostname);
  const pairedConfig = result.target === "shadowrocket-config";
  const deduplicated = result.nodeStats.deduplicated ?? 0;
  const countValue = (value: number | null, fallback: string) => (
    value === null ? fallback : String(value)
  );

  return (
    <div className="subscription-result" aria-live="polite">
      <div className="subscription-result-copy">
        <span>{format.name}</span>
        {pairedConfig ? <p>两个资源需配套导入：节点订阅负责节点与用量；配置负责分组、规则和 DNS。修改来源或重命名后，请同时更新两者。</p> : null}
        {pairedConfig && localBackend ? <p role="note">这是电脑本机链接，iPhone 无法访问。请下载两个文件传到手机，或在手机可达的可信后端生成；离线文件不会自动刷新用量。</p> : null}
        <code>{result.url}</code>
        <dl className="subscription-result-meta">
          <div>
            <dt>模式</dt>
            <dd>{result.sourceMode === "local-sync" ? "本地读取 · 云端分发" : clientDirect ? "客户端直读" : localBackend ? "本地转换" : "Worker 转换"}</dd>
          </div>
          <div>
            <dt>读取</dt>
            <dd>{countValue(result.nodeStats.read, "由客户端读取")}</dd>
          </div>
          <div>
            <dt>输出</dt>
            <dd>{countValue(result.nodeStats.output, "由客户端确认")}</dd>
          </div>
          <div>
            <dt>跳过不兼容节点</dt>
            <dd>{countValue(result.nodeStats.skipped, "由客户端确认")}</dd>
          </div>
          {deduplicated > 0 ? <div><dt>重复节点</dt><dd>{deduplicated}</dd></div> : null}
        </dl>
        {result.nodeStats.read !== null && result.nodeStats.output !== null && result.nodeStats.skipped !== null
          && result.nodeStats.read - result.nodeStats.output - result.nodeStats.skipped - deduplicated > 0
          ? <p>筛选移除 {result.nodeStats.read - result.nodeStats.output - result.nodeStats.skipped - deduplicated} 个节点</p> : null}
        {clientDirect ? (
          <div className="subscription-result-notes">
            <p>此配置尚未验证能读取到节点，不代表转换成功；若客户端只显示 COMPATIBLE，请保留原机场订阅并检查资源下载错误。</p>
            <p>Worker 无法统计节点，也无法重新排序；节点保持来源顺序。</p>
            {result.usage.sources.some((source) => source.status === "client-only") ? (
              <p>
                机场未向 Worker 返回用量，
                {format.name === "Clash Party"
                  ? "Clash Party 会显示“远程”。"
                  : "生成链接不会显示用量。"}
              </p>
            ) : null}
          </div>
        ) : null}
        {result.sourceMode === "local-sync"
          ? <p>最近同步：{result.syncedAt ? new Date(result.syncedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "未知"}（UTC+8）。这是同步时的节点和用量，不是 CF 对机场的实时查询。云端刷新不会删除未同步的节点。</p>
          : !clientDirect ? <p>有效来源缓存 5 分钟；刷新失败时最多回用 24 小时内的完整有效配置，用量也可能是旧数据。成功刷新会移除上游已撤回的节点。</p> : null}
        {result.usage.sources.length > 0 ? (
          <div className="subscription-usage">
            <div className="subscription-usage-total">
              <strong>合计流量</strong>
              <span>
                {result.usage.combined
                  ? formatUsage(result.usage.combined)
                  : "未合并"}
              </span>
              <small>
                {result.usage.combined
                  ? formatExpiry(result.usage.combined.expire)
                  : "未返回到期"}
              </small>
            </div>
            <ul>
              {result.usage.sources.map((source) => (
                <li key={source.name}>
                  <span>{source.name}</span>
                  <span>{usageStatus(source)}</span>
                  <strong>{source.usage ? formatUsage(source.usage) : "—"}</strong>
                  <small>{source.usage ? formatExpiry(source.usage.expire) : "—"}</small>
                </li>
              ))}
            </ul>
            <p>独立机场分别计费，合计余额不能在机场间互转；串联家宽的额度不计入机场合计。来源缺少用量时不伪造总额。</p>
          </div>
        ) : null}
      </div>
      <div className="subscription-result-actions">
        {pairedConfig && result.nodeUrl ? <>
          {!localBackend ? <a className="button button-primary" href={buildClientAction("shadowrocket", result.nodeUrl, result.profileName).value}>1. 添加节点订阅</a> : null}
          <a className="button button-secondary" href={result.nodeUrl} download>下载节点文件</a>
        </> : null}
        <button className="button button-secondary" type="button" onClick={onCopy}>
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {copied ? "已复制" : "复制链接"}
        </button>
        <a className="button button-secondary" href={result.url} download>下载配置</a>
        {clientAction?.kind === "link" && !(pairedConfig && localBackend) ? (
          <a className="button button-primary" href={clientAction.value}>
            {format.icon ? (
              <img src={format.icon} alt="" width="20" height="20" />
            ) : null}
            {pairedConfig ? "2. 添加配置" : clientDirect ? "导入待验证配置" : "一键导入"}
            <ArrowUpRight aria-hidden="true" />
          </a>
        ) : null}
      </div>
    </div>
  );
}
