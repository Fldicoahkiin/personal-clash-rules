import { ArrowCounterClockwise } from "@phosphor-icons/react";
import { useState } from "react";

import {
  parseGeneratedSubscriptionUrl,
  type LoadedSubscriptionForm,
} from "../lib/generated-subscription";

type SubscriptionLinkLoaderProps = {
  onLoad: (form: LoadedSubscriptionForm) => void;
};

export function SubscriptionLinkLoader({ onLoad }: SubscriptionLinkLoaderProps) {
  const [link, setLink] = useState("");
  const [error, setError] = useState("");

  function load() {
    try {
      onLoad(parseGeneratedSubscriptionUrl(link));
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "订阅链接无法读取");
    }
  }

  return (
    <details className="subscription-link-loader">
      <summary>从已生成链接载入</summary>
      <div className="subscription-link-loader-fields">
        <label className="field">
          <span>订阅链接</span>
          <input
            type="url"
            value={link}
            onChange={(event) => setLink(event.target.value)}
            placeholder="https://rules.flacier.com/s/..."
            autoComplete="off"
            spellCheck="false"
          />
        </label>
        <button
          className="button button-secondary"
          type="button"
          disabled={!link.trim()}
          onClick={load}
        >
          <ArrowCounterClockwise aria-hidden="true" />
          载入
        </button>
      </div>
      {error ? <p className="subscription-link-error" role="alert">{error}</p> : null}
    </details>
  );
}
