import { LinkSimple } from "@phosphor-icons/react";
import { type FormEvent, useReducer } from "react";

import {
  createConvertedSubscription,
  subscriptionErrorText,
  type ConvertedSubscription,
  type DnsMode,
  type NodeRenameRule,
  type NodeSortMode,
  type OutputTarget,
  type RulePreset,
} from "../features/subscriptions/api";
import {
  completeConfigFormats,
  nodeResourceFormats,
  secondaryFormats,
} from "../features/subscriptions/client-formats";
import type { LoadedSubscriptionForm } from "../lib/generated-subscription";
import { parseSubscriptionInput } from "../lib/subscription-input";
import { SubscriptionFormatPicker } from "./SubscriptionFormatPicker";
import { SubscriptionLinkLoader } from "./SubscriptionLinkLoader";
import { SubscriptionMoreSettings } from "./SubscriptionMoreSettings";
import { SubscriptionResult } from "./SubscriptionResult";

type FormState = {
  addCountryFlag: boolean;
  allowClientFallback: boolean;
  copied: boolean;
  dnsMode: DnsMode;
  error: string;
  excludePattern: string;
  includePattern: string;
  name: string;
  renameRules: RenameRuleDraft[];
  result: ConvertedSubscription | null;
  rulePreset: RulePreset;
  pending: boolean;
  showNodeType: boolean;
  skipCertVerify: boolean;
  sourceUserAgent: string;
  sourceText: string;
  sortMode: NodeSortMode;
  target: OutputTarget;
  tfo: boolean;
  udp: boolean;
  updateIntervalHours: number;
  xudp: boolean;
};

type RenameRuleDraft = NodeRenameRule & { id: string };

type FieldAction = {
  [Key in keyof FormState]: { key: Key; value: FormState[Key] };
}[keyof FormState];
type FormAction = FieldAction | { key: "load"; value: LoadedSubscriptionForm };

const initialState: FormState = {
  addCountryFlag: true,
  allowClientFallback: false,
  copied: false,
  dnsMode: "doh",
  error: "",
  excludePattern: "",
  includePattern: "",
  name: "Flacierの分流规则",
  renameRules: [{ id: "rename-initial", pattern: "", replacement: "" }],
  result: null,
  rulePreset: "flacier",
  pending: false,
  showNodeType: false,
  skipCertVerify: false,
  sourceUserAgent: "mihomo/1.19",
  sourceText: "",
  sortMode: "source",
  target: "clash-party-config",
  tfo: false,
  udp: true,
  updateIntervalHours: 6,
  xudp: false,
};

function reducer(state: FormState, action: FormAction): FormState {
  if (action.key === "load") {
    return {
      ...state,
      ...action.value,
      renameRules: action.value.renameRules.length > 0
        ? action.value.renameRules.map((rule) => ({
            ...rule,
            id: crypto.randomUUID(),
          }))
        : [{ id: crypto.randomUUID(), pattern: "", replacement: "" }],
      copied: false,
      error: "",
      pending: false,
      result: null,
    };
  }
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
  const selectedFormat = allFormats.find((format) => format.target === form.target) ?? completeConfigFormats[0];
  const supportsRulePreset = form.target === "clash-party-config" || form.target === "mihomo-config";

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
        ...form.renameRules.map((rule) => rule.pattern),
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
        dnsMode: form.dnsMode,
        fallbackMode: form.allowClientFallback ? "mihomo-provider" : "error",
        name: form.name.trim(),
        nodeSettings: {
          addCountryFlag: form.addCountryFlag,
          includePattern: form.includePattern,
          excludePattern: form.excludePattern,
          renameRules: form.renameRules
            .filter((rule) => rule.pattern.trim())
            .map(({ pattern, replacement }) => ({ pattern, replacement })),
          showNodeType: form.showNodeType,
          skipCertVerify: form.skipCertVerify,
          sortMode: form.sortMode,
          tfo: form.tfo,
          udp: form.udp,
          xudp: form.xudp,
        },
        rulePreset: form.rulePreset,
        sourceUserAgent: form.sourceUserAgent,
        sources: parseSubscriptionInput(form.sourceText),
        target: form.target,
        updateIntervalHours: form.updateIntervalHours,
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
            <span>输出名称</span>
            <input
              type="text"
              value={form.name}
              onChange={(event) => dispatch({
                key: "name",
                value: event.target.value,
              })}
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
              <option value="direct">全局直连</option>
            </select>
          </label>
        ) : null}

        <SubscriptionMoreSettings
          addCountryFlag={form.addCountryFlag}
          allowClientFallback={form.allowClientFallback}
          dnsMode={form.dnsMode}
          excludePattern={form.excludePattern}
          includePattern={form.includePattern}
          renameRules={form.renameRules}
          showNodeType={form.showNodeType}
          skipCertVerify={form.skipCertVerify}
          sourceUserAgent={form.sourceUserAgent}
          sortMode={form.sortMode}
          tfo={form.tfo}
          udp={form.udp}
          updateIntervalHours={form.updateIntervalHours}
          xudp={form.xudp}
          onBooleanChange={(key, value) => dispatch({ key, value })}
          onDnsModeChange={(value) => dispatch({ key: "dnsMode", value })}
          onRenameRulesChange={(value) => dispatch({ key: "renameRules", value })}
          onTextChange={(key, value) => dispatch({ key, value })}
          onUpdateIntervalChange={(value) => dispatch({ key: "updateIntervalHours", value })}
          onSortChange={(value) => dispatch({ key: "sortMode", value })}
        />

        <SubscriptionLinkLoader onLoad={(value) => dispatch({ key: "load", value })} />

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
