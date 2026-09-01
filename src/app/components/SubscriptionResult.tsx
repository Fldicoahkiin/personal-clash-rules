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
  const used = (BigInt(usage.upload) + BigInt(usage.download)).toString();
  return `${formatBytes(used)} / ${formatBytes(usage.total)}`;
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
  const countValue = (value: number | null, fallback: string) => (
    value === null ? fallback : String(value)
  );

  return (
    <div className="subscription-result" aria-live="polite">
      <div className="subscription-result-copy">
        <span>{format.name}</span>
        <code>{result.url}</code>
        <dl className="subscription-result-meta">
          <div>
            <dt>模式</dt>
            <dd>{clientDirect ? "客户端直读" : "Worker 转换"}</dd>
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
        </dl>
        {clientDirect ? (
          <div className="subscription-result-notes">
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
        {result.usage.sources.length > 0 ? (
          <div className="subscription-usage">
            <div className="subscription-usage-total">
              <strong>合计流量</strong>
              <span>
                {result.usage.combined
                  ? formatUsage(result.usage.combined)
                  : "未合并"}
              </span>
            </div>
            <ul>
              {result.usage.sources.map((source) => (
                <li key={source.name}>
                  <span>{source.name}</span>
                  <span>{usageStatus(source)}</span>
                  <strong>{source.usage ? formatUsage(source.usage) : "—"}</strong>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      <div className="subscription-result-actions">
        <button className="button button-secondary" type="button" onClick={onCopy}>
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {copied ? "已复制" : "复制链接"}
        </button>
        {clientAction?.kind === "link" ? (
          <a className="button button-primary" href={clientAction.value}>
            打开 {format.name}
            <ArrowUpRight aria-hidden="true" />
          </a>
        ) : null}
      </div>
    </div>
  );
}
