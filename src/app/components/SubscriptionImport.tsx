import { ArrowUpRight, Check, Copy } from "@phosphor-icons/react";
import { useMemo, useState } from "react";

import {
  buildClientAction,
  type ClientId,
} from "../lib/client-import";

const clients: Array<{ id: ClientId; label: string; icon: string }> = [
  { id: "mihomo", label: "Mihomo", icon: "/client-icons/mihomo.png" },
  { id: "stash", label: "Stash", icon: "/client-icons/stash.png" },
  { id: "surge", label: "Surge", icon: "/client-icons/surge.png" },
  { id: "loon", label: "Loon", icon: "/client-icons/loon.png" },
  {
    id: "quantumult-x",
    label: "Quantumult X",
    icon: "/client-icons/quantumult-x.png",
  },
  { id: "sing-box", label: "sing-box", icon: "/client-icons/sing-box.png" },
  {
    id: "shadowrocket",
    label: "Shadowrocket",
    icon: "/client-icons/shadowrocket.png",
  },
  { id: "egern", label: "Egern", icon: "/client-icons/egern.png" },
  {
    id: "surfboard",
    label: "Surfboard",
    icon: "/client-icons/surfboard.png",
  },
];

export function SubscriptionImport() {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("个人订阅");
  const [client, setClient] = useState<ClientId>("mihomo");
  const [copied, setCopied] = useState(false);

  const selectedClient = clients.find((item) => item.id === client) ?? clients[0];
  const result = useMemo(() => {
    if (!url.trim()) {
      return { action: null, error: "" };
    }
    try {
      return { action: buildClientAction(client, url, name), error: "" };
    } catch {
      return { action: null, error: "订阅地址无效" };
    }
  }, [client, name, url]);

  async function copyAction() {
    if (!result.action) {
      return;
    }
    await navigator.clipboard.writeText(result.action.value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <section
      className="subscription-section page-width"
      id="subscription"
      aria-labelledby="subscription-title"
    >
      <header className="plain-heading">
        <h2 id="subscription-title">导入订阅</h2>
      </header>

      <div className="subscription-workspace">
        <div className="subscription-fields">
          <label className="field subscription-url">
            <span>订阅地址</span>
            <input
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://example.com/subscription"
              spellCheck="false"
              autoComplete="off"
            />
          </label>
          <label className="field subscription-name">
            <span>名称</span>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
        </div>

        <div className="client-picker" aria-label="选择客户端">
          {clients.map((item) => (
            <button
              className={client === item.id ? "is-active" : ""}
              type="button"
              key={item.id}
              onClick={() => setClient(item.id)}
              aria-pressed={client === item.id}
            >
              <img src={item.icon} alt="" width="20" height="20" />
              <span>{item.label}</span>
            </button>
          ))}
        </div>

        <div className="subscription-action-row">
          <span>{result.action?.kind === "link" ? "直接导入" : "复制地址"}</span>
          <div>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => void copyAction()}
              disabled={!result.action}
            >
              {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
              {copied ? "已复制" : "复制"}
            </button>
            {result.action?.kind === "link" ? (
              <a className="button button-primary" href={result.action.value}>
                打开 {selectedClient.label}
                <ArrowUpRight aria-hidden="true" />
              </a>
            ) : null}
          </div>
        </div>
        {result.error ? <p className="field-error">{result.error}</p> : null}
      </div>
    </section>
  );
}
