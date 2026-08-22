import {
  ArrowRight,
  Check,
  Copy,
  LinkSimple,
} from "@phosphor-icons/react";
import { useMemo, useState } from "react";

function buildImportLink(url: string, name: string): string {
  const subscription = new URL(url);
  if (subscription.protocol !== "http:" && subscription.protocol !== "https:") {
    throw new Error("订阅地址必须使用 HTTP 或 HTTPS。");
  }
  const params = new URLSearchParams({ url: subscription.toString() });
  if (name.trim()) {
    params.set("name", name.trim());
  }
  return `mihomo://install-config?${params.toString()}`;
}

export function SubscriptionImport() {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("Flacier Personal");
  const [copied, setCopied] = useState(false);
  const result = useMemo(() => {
    if (!url.trim()) {
      return { value: "", error: "" };
    }
    try {
      return { value: buildImportLink(url, name), error: "" };
    } catch (error) {
      return {
        value: "",
        error: error instanceof Error ? error.message : "订阅地址无法识别。",
      };
    }
  }, [name, url]);

  async function copyResult() {
    if (!result.value) {
      return;
    }
    await navigator.clipboard.writeText(result.value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <section
      className="subscription-section page-width"
      id="subscription"
      aria-labelledby="subscription-title"
    >
      <div className="section-heading compact-heading">
        <div>
          <p className="section-kicker">01 · SUBSCRIPTION</p>
          <h2 id="subscription-title">订阅导入链接</h2>
        </div>
        <p>
          生成 Clash Party 官方 URL Scheme。地址只在当前浏览器处理，不经过本站服务器。
        </p>
      </div>

      <div className="subscription-card">
        <label className="field subscription-url">
          <span>订阅地址</span>
          <span className="input-shell">
            <LinkSimple aria-hidden="true" />
            <input
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://example.com/subscription"
              spellCheck="false"
              autoComplete="off"
            />
          </span>
        </label>
        <label className="field subscription-name">
          <span>配置名称</span>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Flacier Personal"
          />
        </label>
        <div className="subscription-actions">
          <button
            className="button button-secondary"
            type="button"
            onClick={() => void copyResult()}
            disabled={!result.value}
          >
            {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            {copied ? "已复制" : "复制链接"}
          </button>
          <a
            className={`button button-primary${result.value ? "" : " is-disabled"}`}
            href={result.value || undefined}
            aria-disabled={!result.value}
            onClick={(event) => {
              if (!result.value) {
                event.preventDefault();
              }
            }}
          >
            打开 Clash Party
            <ArrowRight aria-hidden="true" />
          </a>
        </div>
        {result.error ? <p className="field-error">{result.error}</p> : null}
      </div>
    </section>
  );
}
