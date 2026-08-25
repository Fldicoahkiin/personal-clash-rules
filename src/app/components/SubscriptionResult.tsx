import { ArrowUpRight, Check, Copy } from "@phosphor-icons/react";

import type { ConvertedSubscription } from "../features/subscriptions/api";
import type { ClientFormat } from "../features/subscriptions/client-formats";
import { buildClientAction } from "../lib/client-import";

type SubscriptionResultProps = {
  copied: boolean;
  format: ClientFormat;
  result: ConvertedSubscription;
  onCopy: () => void;
};

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
            <dt>跳过</dt>
            <dd>{countValue(result.nodeStats.skipped, "由客户端确认")}</dd>
          </div>
        </dl>
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
