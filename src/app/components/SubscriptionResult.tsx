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

  return (
    <div className="subscription-result" aria-live="polite">
      <div>
        <span>{format.name}</span>
        <code>{result.url}</code>
        {result.sourceMode === "mihomo-provider" ? (
          <small>机场节点由 Clash Party / Mihomo 直接更新</small>
        ) : null}
      </div>
      <div>
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
