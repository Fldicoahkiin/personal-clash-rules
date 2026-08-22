import {
  ArrowRight,
  Check,
  Copy,
  DownloadSimple,
  FileCode,
  ShieldCheck,
} from "@phosphor-icons/react";
import { useReducer, useState } from "react";

import {
  convertRules,
  type ConvertResult,
  type InputFormat,
  type OutputFormat,
} from "../lib/convert-rules";

interface FormState {
  input: string;
  inputFormat: InputFormat;
  outputFormat: OutputFormat;
  policy: string;
  providerName: string;
  providerUrl: string;
}

type FormAction = {
  [Key in keyof FormState]: { key: Key; value: FormState[Key] };
}[keyof FormState];

const sample = [
  "# V2Fly domain-list-community format",
  "openai.com",
  "full:chat.openai.com",
  "regexp:^chatgpt-[0-9]+\\.example\\.com$",
].join("\n");

function reducer(state: FormState, action: FormAction): FormState {
  return { ...state, [action.key]: action.value };
}

export function ConverterWorkspace() {
  const [form, dispatch] = useReducer(reducer, {
    input: "",
    inputFormat: "v2fly",
    outputFormat: "classical-text",
    policy: "AI",
    providerName: "personal-ai",
    providerUrl: `${window.location.origin}/rules/ai/openai.list`,
  });
  const [conversion, setConversion] = useState<{
    result: ConvertResult | null;
    error: string;
    copied: boolean;
  }>({ result: null, error: "", copied: false });

  function update<Key extends keyof FormState>(key: Key, value: FormState[Key]) {
    dispatch({ key, value } as FormAction);
  }

  function convert() {
    try {
      const result = convertRules(form);
      setConversion({ result, error: "", copied: false });
    } catch (error) {
      setConversion({
        result: null,
        error: error instanceof Error ? error.message : "规则转换失败。",
        copied: false,
      });
    }
  }

  async function copyOutput() {
    if (!conversion.result) {
      return;
    }
    await navigator.clipboard.writeText(conversion.result.output);
    setConversion((current) => ({ ...current, copied: true }));
    window.setTimeout(
      () => setConversion((current) => ({ ...current, copied: false })),
      1600,
    );
  }

  function downloadOutput() {
    if (!conversion.result) {
      return;
    }
    const extension = form.outputFormat.endsWith("-text") ? "list" : "yaml";
    const blob = new Blob([conversion.result.output], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${form.providerName || "rules"}.${extension}`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section
      className="converter-section page-width"
      id="converter"
      aria-labelledby="converter-title"
    >
      <header className="plain-heading">
        <h2 id="converter-title">转换规则</h2>
        <p>V2Fly · Mihomo · YAML</p>
      </header>

      <div className="converter-grid">
        <article className="workspace-card input-card">
          <header className="card-header">
            <span className="card-index">输入</span>
            <button
              className="text-button"
              type="button"
              onClick={() => update("input", sample)}
            >
              载入示例
            </button>
          </header>

          <label className="field">
            <span>输入格式</span>
            <select
              value={form.inputFormat}
              onChange={(event) =>
                update("inputFormat", event.target.value as InputFormat)
              }
            >
              <option value="v2fly">V2Fly data</option>
              <option value="classical">Mihomo classical</option>
              <option value="domain">Mihomo domain</option>
              <option value="yaml">YAML payload</option>
            </select>
          </label>
          <label className="field grow-field">
            <span>原始规则</span>
            <textarea
              value={form.input}
              onChange={(event) => update("input", event.target.value)}
              placeholder="每行一条规则，注释以 # 开头"
              spellCheck="false"
            />
          </label>

          <div className="form-row">
            <label className="field">
              <span>输出格式</span>
              <select
                value={form.outputFormat}
                onChange={(event) =>
                  update("outputFormat", event.target.value as OutputFormat)
                }
              >
                <option value="classical-text">Classical text</option>
                <option value="classical-yaml">Classical YAML</option>
                <option value="domain-text">Domain text</option>
                <option value="provider-snippet">Provider 片段</option>
              </select>
            </label>
            <label className="field">
              <span>策略组</span>
              <input
                value={form.policy}
                onChange={(event) => update("policy", event.target.value)}
                placeholder="AI"
              />
            </label>
          </div>

          {form.outputFormat === "provider-snippet" ? (
            <div className="provider-fields">
              <label className="field">
                <span>Provider 名称</span>
                <input
                  value={form.providerName}
                  onChange={(event) => update("providerName", event.target.value)}
                  spellCheck="false"
                />
              </label>
              <label className="field">
                <span>Provider URL</span>
                <input
                  type="url"
                  value={form.providerUrl}
                  onChange={(event) => update("providerUrl", event.target.value)}
                  spellCheck="false"
                />
              </label>
            </div>
          ) : null}

          <button className="button button-primary convert-button" onClick={convert}>
            开始转换
            <ArrowRight aria-hidden="true" />
          </button>
        </article>

        <article className="workspace-card output-card" aria-live="polite">
          <header className="card-header">
            <span className="card-index">输出</span>
            {conversion.result ? (
              <span className="result-count">{conversion.result.count} 条</span>
            ) : null}
          </header>

          {conversion.error ? (
            <div className="result-state error-state" role="alert">
              <FileCode aria-hidden="true" />
              <h3>转换失败</h3>
              <p>{conversion.error}</p>
            </div>
          ) : conversion.result ? (
            <>
              <pre className="output-code">
                <code>{conversion.result.output}</code>
              </pre>
              {conversion.result.warnings.length > 0 ? (
                <details className="warning-list">
                  <summary>{conversion.result.warnings.length} 条处理提示</summary>
                  <ul>
                    {conversion.result.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
              <div className="output-actions">
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={() => void copyOutput()}
                >
                  {conversion.copied ? (
                    <Check aria-hidden="true" />
                  ) : (
                    <Copy aria-hidden="true" />
                  )}
                  {conversion.copied ? "已复制" : "复制"}
                </button>
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={downloadOutput}
                >
                  <DownloadSimple aria-hidden="true" />
                  下载
                </button>
              </div>
            </>
          ) : (
            <div className="result-state empty-state">
              <ShieldCheck aria-hidden="true" />
              <h3>等待输入</h3>
              <p>输入规则后运行转换。</p>
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
