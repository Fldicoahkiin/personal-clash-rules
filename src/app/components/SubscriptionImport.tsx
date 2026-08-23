import { LinkSimple } from "@phosphor-icons/react";
import { type FormEvent, useReducer } from "react";

import {
  createConvertedSubscription,
  subscriptionErrorText,
  type ConvertedSubscription,
  type NodeSortMode,
  type OutputTarget,
  type RulePreset,
} from "../features/subscriptions/api";
import {
  completeConfigFormats,
  nodeResourceFormats,
  secondaryFormats,
} from "../features/subscriptions/client-formats";
import { parseSubscriptionInput } from "../lib/subscription-input";
import { SubscriptionFormatPicker } from "./SubscriptionFormatPicker";
import { SubscriptionMoreSettings } from "./SubscriptionMoreSettings";
import { SubscriptionResult } from "./SubscriptionResult";

type FormState = {
  addCountryFlag: boolean;
  copied: boolean;
  error: string;
  excludePattern: string;
  includePattern: string;
  name: string;
  renamePattern: string;
  renameReplacement: string;
  result: ConvertedSubscription | null;
  rulePreset: RulePreset;
  pending: boolean;
  showNodeType: boolean;
  skipCertVerify: boolean;
  sourceText: string;
  sortMode: NodeSortMode;
  target: OutputTarget;
  tfo: boolean;
  udp: boolean;
};

type FormAction = {
  [Key in keyof FormState]: { key: Key; value: FormState[Key] };
}[keyof FormState];

const initialState: FormState = {
  addCountryFlag: true,
  copied: false,
  error: "",
  excludePattern: "",
  includePattern: "",
  name: "",
  renamePattern: "",
  renameReplacement: "",
  result: null,
  rulePreset: "flacier",
  pending: false,
  showNodeType: false,
  skipCertVerify: false,
  sourceText: "",
  sortMode: "source",
  target: "clash-party-config",
  tfo: false,
  udp: true,
};

function reducer(state: FormState, action: FormAction): FormState {
  const next = { ...state, [action.key]: action.value };
  if (
    action.key !== "copied"
    && action.key !== "error"
    && action.key !== "pending"
    && action.key !== "result"
  ) {
    next.result = null;
  }
  return next;
}

const allFormats = [
  ...completeConfigFormats,
  ...nodeResourceFormats,
  ...secondaryFormats,
];

export function SubscriptionImport() {
  const [form, dispatch] = useReducer(reducer, initialState);
  const selectedFormat = allFormats.find((format) => format.target === form.target)
    ?? completeConfigFormats[0];
  const supportsRulePreset = form.target === "clash-party-config"
    || form.target === "mihomo-config";

  function validateInput(): boolean {
    if (!form.sourceText.trim()) {
      dispatch({ key: "error", value: "请粘贴订阅地址或节点链接" });
      return false;
    }
    try {
      parseSubscriptionInput(form.sourceText);
    } catch (error) {
      dispatch({
        key: "error",
        value: error instanceof Error ? error.message : "输入内容无法识别",
      });
      return false;
    }
    try {
      for (const pattern of [
        form.includePattern,
        form.excludePattern,
        form.renamePattern,
      ]) {
        if (pattern) {
          new RegExp(pattern, "u");
        }
      }
      dispatch({ key: "error", value: "" });
      return true;
    } catch {
      dispatch({ key: "error", value: "更多设置里的正则格式有误" });
      return false;
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validateInput()) {
      return;
    }
    dispatch({ key: "pending", value: true });
    try {
      const result = await createConvertedSubscription({
        name: form.name.trim(),
        nodeSettings: {
          addCountryFlag: form.addCountryFlag,
          includePattern: form.includePattern,
          excludePattern: form.excludePattern,
          renameRules: form.renamePattern
            ? [{ pattern: form.renamePattern, replacement: form.renameReplacement }]
            : [],
          showNodeType: form.showNodeType,
          skipCertVerify: form.skipCertVerify,
          sortMode: form.sortMode,
          tfo: form.tfo,
          udp: form.udp,
        },
        rulePreset: form.rulePreset,
        sources: parseSubscriptionInput(form.sourceText),
        target: form.target,
      });
      dispatch({ key: "result", value: result });
      dispatch({ key: "error", value: "" });
    } catch (error) {
      dispatch({ key: "error", value: subscriptionErrorText(error) });
    } finally {
      dispatch({ key: "pending", value: false });
    }
  }

  async function copyResult() {
    if (!form.result) {
      return;
    }
    await navigator.clipboard.writeText(form.result.url);
    dispatch({ key: "copied", value: true });
    window.setTimeout(() => dispatch({ key: "copied", value: false }), 1400);
  }

  return (
    <section
      className="subscription-section page-width"
      id="subscription"
      aria-labelledby="subscription-title"
    >
      <header className="subscription-heading">
        <h1 id="subscription-title">Flacierの订阅转换</h1>
        <p>合并订阅 · 选择规则 · 生成链接</p>
      </header>

      <form className="subscription-workspace" onSubmit={submit}>
        <div className="subscription-fields">
          <label className="field subscription-source">
            <span>订阅或节点</span>
            <textarea
              value={form.sourceText}
              onChange={(event) => dispatch({
                key: "sourceText",
                value: event.target.value,
              })}
              placeholder={"每行一个订阅地址或节点链接\n多个地址也可以用 | 分隔"}
              spellCheck="false"
              autoComplete="off"
            />
          </label>
          <label className="field subscription-name">
            <span>订阅名称</span>
            <input
              type="text"
              value={form.name}
              onChange={(event) => dispatch({
                key: "name",
                value: event.target.value,
              })}
              placeholder="留空"
              maxLength={64}
            />
          </label>
        </div>

        <SubscriptionFormatPicker
          target={form.target}
          onChange={(target) => {
            dispatch({ key: "target", value: target });
            dispatch({ key: "result", value: null });
          }}
        />

        {supportsRulePreset ? (
          <label className="field subscription-rule-preset">
            <span>规则方案</span>
            <select
              value={form.rulePreset}
              onChange={(event) => dispatch({
                key: "rulePreset",
                value: event.target.value as RulePreset,
              })}
            >
              <option value="flacier">Flacier 分流</option>
              <option value="global">全局代理</option>
            </select>
          </label>
        ) : null}

        <SubscriptionMoreSettings
          addCountryFlag={form.addCountryFlag}
          excludePattern={form.excludePattern}
          includePattern={form.includePattern}
          renamePattern={form.renamePattern}
          renameReplacement={form.renameReplacement}
          showNodeType={form.showNodeType}
          skipCertVerify={form.skipCertVerify}
          sortMode={form.sortMode}
          tfo={form.tfo}
          udp={form.udp}
          onBooleanChange={(key, value) => dispatch({ key, value })}
          onTextChange={(key, value) => dispatch({ key, value })}
          onSortChange={(value) => dispatch({ key: "sortMode", value })}
        />

        <div className="subscription-action-row">
          <span>{selectedFormat.name}</span>
          <div>
            <button
              className="button button-primary"
              type="submit"
              disabled={form.pending}
            >
              <LinkSimple aria-hidden="true" />
              {form.pending ? "正在生成" : "生成订阅链接"}
            </button>
          </div>
        </div>
      </form>

      {form.error ? (
        <p className="field-error" role="alert">{form.error}</p>
      ) : null}

      {form.result ? (
        <SubscriptionResult
          copied={form.copied}
          format={selectedFormat}
          result={form.result}
          onCopy={() => void copyResult()}
        />
      ) : null}
    </section>
  );
}
