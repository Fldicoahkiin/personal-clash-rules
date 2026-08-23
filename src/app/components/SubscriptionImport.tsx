import { LinkSimple } from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type FormEvent, useReducer } from "react";

import {
  clearControlToken,
  createConvertedSubscription,
  setControlToken,
  subscriptionErrorText,
  subscriptionQueries,
  type ConvertedSubscription,
  type NodeSortMode,
  type OutputTarget,
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
  copied: boolean;
  error: string;
  excludePattern: string;
  includePattern: string;
  name: string;
  renamePattern: string;
  renameReplacement: string;
  result: ConvertedSubscription | null;
  showToken: boolean;
  sourceText: string;
  sortMode: NodeSortMode;
  target: OutputTarget;
  token: string;
};

type FormAction = {
  [Key in keyof FormState]: { key: Key; value: FormState[Key] };
}[keyof FormState];

const initialState: FormState = {
  copied: false,
  error: "",
  excludePattern: "",
  includePattern: "",
  name: "个人订阅",
  renamePattern: "",
  renameReplacement: "",
  result: null,
  showToken: false,
  sourceText: "",
  sortMode: "source",
  target: "mihomo-config",
  token: "",
};

function reducer(state: FormState, action: FormAction): FormState {
  return { ...state, [action.key]: action.value };
}

const allFormats = [
  ...completeConfigFormats,
  ...nodeResourceFormats,
  ...secondaryFormats,
];

export function SubscriptionImport() {
  const [form, dispatch] = useReducer(reducer, initialState);
  const sessionQuery = useQuery(subscriptionQueries.session());
  const authenticated = sessionQuery.data?.authenticated === true;
  const selectedFormat = allFormats.find((format) => format.target === form.target)
    ?? completeConfigFormats[0];

  const generateMutation = useMutation({
    mutationFn: () => createConvertedSubscription({
      name: form.name.trim() || "个人订阅",
      nodeSettings: {
        includePattern: form.includePattern,
        excludePattern: form.excludePattern,
        renameRules: form.renamePattern
          ? [{ pattern: form.renamePattern, replacement: form.renameReplacement }]
          : [],
        sortMode: form.sortMode,
      },
      sources: parseSubscriptionInput(form.sourceText),
      target: form.target,
    }),
    onSuccess: (result) => {
      dispatch({ key: "result", value: result });
      dispatch({ key: "error", value: "" });
    },
    onError: (error) => {
      dispatch({ key: "error", value: subscriptionErrorText(error) });
    },
  });

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

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validateInput()) {
      return;
    }
    if (!authenticated) {
      dispatch({ key: "showToken", value: true });
      return;
    }
    generateMutation.mutate();
  }

  async function unlockAndGenerate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.token.trim()) {
      return;
    }
    setControlToken(form.token);
    const session = await sessionQuery.refetch();
    if (!session.data?.authenticated) {
      clearControlToken();
      dispatch({ key: "error", value: "管理令牌不正确" });
      return;
    }
    dispatch({ key: "token", value: "" });
    dispatch({ key: "showToken", value: false });
    generateMutation.mutate();
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
        <h1 id="subscription-title">订阅转换</h1>
        <p>合并订阅和节点，生成一个固定链接。</p>
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

        <SubscriptionMoreSettings
          excludePattern={form.excludePattern}
          includePattern={form.includePattern}
          renamePattern={form.renamePattern}
          renameReplacement={form.renameReplacement}
          sortMode={form.sortMode}
          onTextChange={(key, value) => dispatch({ key, value })}
          onSortChange={(value) => dispatch({ key: "sortMode", value })}
        />

        <div className="subscription-action-row">
          <span>{selectedFormat.name}</span>
          <div>
            <a className="button button-secondary" href="/manage">
              管理已有订阅
            </a>
            <button
              className="button button-primary"
              type="submit"
              disabled={generateMutation.isPending || sessionQuery.isLoading}
            >
              <LinkSimple aria-hidden="true" />
              {generateMutation.isPending ? "正在生成" : "生成订阅链接"}
            </button>
          </div>
        </div>
      </form>

      {form.showToken && !authenticated ? (
        <form
          className="subscription-token"
          onSubmit={(event) => void unlockAndGenerate(event)}
        >
          <label className="field">
            <span>管理令牌</span>
            <input
              type="password"
              value={form.token}
              onChange={(event) => dispatch({
                key: "token",
                value: event.target.value,
              })}
              autoComplete="off"
              autoFocus
            />
          </label>
          <button
            className="button button-primary"
            type="submit"
            disabled={!form.token.trim()}
          >
            验证并生成
          </button>
        </form>
      ) : null}

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
