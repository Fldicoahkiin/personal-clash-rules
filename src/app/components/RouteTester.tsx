import { ArrowDown, ArrowRight, Check } from "@phosphor-icons/react";
import { type FormEvent, useEffect, useReducer, useRef } from "react";

import {
  loadRulePreview,
  createRuleSet,
  matchUrl,
  type LoadedRuleSet,
  type RouteMatch,
} from "../lib/rule-matcher";
import { createRouteSteps } from "../lib/route-steps";
import { useRuleManifest } from "../lib/rule-files";
import { stationAt, type StationMatch } from "../lib/route-stations";
import { ruleTemplates, type RuleTemplateId, type RuleSelection } from "../../config/rule-templates";
import type { RulePreview } from "../../config/rule-preview";
import styles from "./RouteTester.module.css";

const sampleUrl = "https://api.openai.com/v1/models";
// Inputs to try, not claims about routing: the result always comes from the loaded rules.
const sampleHosts = ["api.openai.com", "swcdn.apple.com", "www.bilibili.com", "github.com"];

export function RouteTester({ selection, request = null, onMatch, onShowStation }: {
  selection?: RuleSelection;
  request?: { host: string; id: number } | null;
  onMatch?: (match: StationMatch | null) => void;
  onShowStation?: (position: number) => void;
} = {}) {
  const [state, update] = useReducer((state: TesterState, patch: Partial<TesterState>) => ({ ...state, ...patch }), {
    input: "", ip: "", processName: "", preset: "flacier", customUrl: "",
    request: null, active: false, pendingTest: false, preview: null, ruleSets: [], result: null,
    message: "", resultVersion: 0,
  });
  const { input, ruleSets, result, message, resultVersion } = state;
  const inputRef = useRef<HTMLInputElement>(null);
  const manifest = useRuleManifest();
  const flacier = state.preset === "flacier";
  // Flacier previews number their rule sets by position in the Mihomo rule list; the rule set id must also
  // agree, so a page and Worker built from different rules never point at the wrong station.
  const position = flacier && result ? Number(result.ruleSetId) + 1 : NaN;
  const rule = Number.isInteger(position) ? stationAt(position)?.rules.find(item => item.position === position) : undefined;
  const station = rule && (!rule.provider || rule.provider.id === result?.ruleSetLabel) ? stationAt(position) : undefined;

  // Rule bodies (the domestic list alone is ~3 MB) load on the first test, not with the page.
  function reload(preset: RuleTemplateId, url: string, active: boolean) {
    return { preset, customUrl: url, result: null, ruleSets: [], preview: null,
      message: preset === "custom" && !url ? "填写远程规则地址后加载" : "",
      request: active && (preset !== "custom" || url) ? { preset, url } : null };
  }
  useEffect(() => {
    if (selection) update(reload(selection.preset, selection.url, state.active));
  }, [selection]);

  useEffect(() => {
    const controller = new AbortController();
    if (!state.request) return;
    let disposed = false;
    const timeout = window.setTimeout(() => controller.abort(), 60000);
    update({ message: "规则加载中", result: null, ruleSets: [], preview: null });
    void loadRulePreview(state.request.preset, state.request.url, controller.signal)
      .then((loaded) => {
        if (!disposed) update({ preview: loaded, ruleSets: loaded.ruleSets.map(rule => createRuleSet(rule, rule.content)), message: "" });
      })
      .catch((error: unknown) => {
        if (!disposed) update({ message: error instanceof DOMException && error.name === "AbortError"
          ? "规则加载超时，请重新加载" : error instanceof Error ? error.message : "规则加载失败" });
      })
      .finally(() => window.clearTimeout(timeout));

    return () => {
      disposed = true;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [state.request]);

  useEffect(() => {
    if (state.pendingTest && ruleSets.length) runTest(state.input);
  }, [ruleSets]);

  useEffect(() => {
    if (request) startTest(request.host);
  }, [request]);

  useEffect(() => {
    onMatch?.(station ? { position, uncertain: Boolean(result?.uncertain) } : null);
  }, [station, position, result?.uncertain, resultVersion]);

  useEffect(() => {
    function focusInput(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey
        || target?.closest("input, textarea, select, [contenteditable]")) return;
      event.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    }
    window.addEventListener("keydown", focusInput);
    return () => window.removeEventListener("keydown", focusInput);
  }, []);

  function startTest(value: string) {
    if (ruleSets.length > 0) {
      runTest(value);
      return;
    }
    if (state.preset === "custom" && !state.customUrl) {
      update({ input: value, message: "填写远程规则地址后加载" });
      return;
    }
    update({ input: value, result: null, active: true, pendingTest: true,
      request: state.request ?? { preset: state.preset, url: state.customUrl } });
  }

  function testRoute(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTest(input);
  }

  function runTest(value: string) {
    try {
      // Flacier's own groups are described from the config so the result uses their display names.
      const groups = flacier ? undefined : state.preview?.groups;
      update({ input: value, pendingTest: false, result: matchUrl(value, ruleSets, { ip: state.ip.trim(), processName: state.processName.trim(), groups }), resultVersion: resultVersion + 1, message: "" });
    } catch (error) {
      update({ input: value, pendingTest: false, result: null, message: error instanceof Error ? error.message : "请输入网址或域名" });
    }
  }

  const shownResult: RouteMatch | null = result && station && rule
    ? { ...result, ruleSetLabel: rule.provider ? manifest?.get(rule.provider.id)?.label ?? rule.provider.id : "配置内规则" }
    : result;
  const steps = createRouteSteps(shownResult);
  const conditions = [
    ruleTemplates.find(template => template.id === state.preset)?.name,
    state.processName.trim() ? `进程 ${state.processName.trim()}` : "浏览器访问",
    state.ip.trim() ? `IP ${state.ip.trim()}` : "",
  ].filter(Boolean).join(" · ");

  return (
    <section className="route-section page-width" id="tester" aria-labelledby="tester-title">
      <div className="route-main">
        <div className="route-intro">
          <h2 id="tester-title">规则测试</h2>
          <p>按所选方案的规则顺序模拟，不读取客户端的实时出口。</p>
        </div>

        <form className="route-form" onSubmit={testRoute}>
          <div className="route-form-row">
            <label htmlFor="route-url">测试网址</label>
            <input
              id="route-url"
              ref={inputRef}
              type="text"
              value={input}
              onChange={(event) => update({ input: event.target.value, result: null })}
              placeholder={sampleUrl}
              spellCheck="false"
              autoComplete="off"
              aria-keyshortcuts="/"
            />
            <kbd className="route-shortcut" aria-hidden="true">/</kbd>
            <button type="submit" disabled={state.pendingTest || (Boolean(state.request) && ruleSets.length === 0)}>
              {state.pendingTest ? "加载规则" : "测试"}
              <ArrowRight aria-hidden="true" />
            </button>
          </div>

          <div className={styles.samples} aria-label="示例">
            <span>试试</span>
            {sampleHosts.map(host => (
              <button type="button" key={host} onClick={() => startTest(host)}>{host}</button>
            ))}
          </div>

          <details className={styles.conditions}>
            <summary>
              <span>测试条件</span>
              <small>{conditions}</small>
            </summary>
            <div className={styles.controls}>
              <label className="field"><span>测试规则方案</span>
                <select value={state.preset} onChange={event => {
                  const preset = event.target.value as RuleTemplateId;
                  update(reload(preset, "", state.active));
                }}>
                  {ruleTemplates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}
                </select>
              </label>
              {state.preset === "custom" ? <label className="field"><span>测试用远程规则地址</span>
                <input type="url" value={state.customUrl} placeholder="https://example.com/rules.ini" onChange={event => update({ customUrl: event.target.value, request: null, ruleSets: [], result: null, preview: null })} />
              </label> : null}
              <button type="button" className="button button-secondary" onClick={() => update({ active: true, request: { preset: state.preset, url: state.customUrl } })}>重新加载规则</button>
              <label className="field"><span>目标 IPv4（可选）</span><input value={state.ip} onChange={event => update({ ip: event.target.value, result: null })} placeholder="仅供模拟，不会发起 DNS 查询" /></label>
              <label className="field"><span>进程名（可选）</span><input value={state.processName} onChange={event => update({ processName: event.target.value, result: null })} placeholder="例如 Firefox 或 Codex" /></label>
            </div>
            {state.preview ? <p className={styles.note}>{state.preview.name} · 规则快照 {state.preview.fingerprint.slice(0, 12)}。未填进程名时按浏览器访问处理；需要 IP 或地理数据的规则显示“无法确定”。</p> : null}
            {state.preset !== "flacier" ? <p className={styles.note}>远程方案保留原有分流意图，可能包含中国站点直连。测试结果显示配置的默认策略，不代表你的客户端当前选择。</p> : null}
          </details>
        </form>

        <div className="route-result" aria-live="polite" data-filled={result ? "" : undefined} key={resultVersion}>
          <span className="route-line" aria-hidden="true" />
          <ol className="route-steps" aria-label="规则处理过程">
            {steps.map((step) => {
              const [ruleType, ruleValue] =
                step.kind === "rule" ? step.value.split(",", 2) : ["", ""];

              return (
                <li
                  className={`route-step route-step-${step.kind}`}
                  key={step.label}
                >
                  <div className="route-step-copy">
                    <span className="route-step-label">{step.label}</span>
                    <div className="route-step-body">
                      <strong
                        className={
                          [
                            "route-value",
                            step.machine ? "route-value-machine" : "",
                            step.kind === "rule" ? "route-value-rule" : "",
                            step.kind === "result" ? "route-value-result" : "",
                          ]
                            .filter(Boolean)
                            .join(" ")
                        }
                        aria-label={step.value}
                      >
                        {ruleValue ? (
                          <>
                            <span>{ruleType},</span>
                            <span>{ruleValue}</span>
                          </>
                        ) : (
                          step.value
                        )}
                      </strong>
                      {step.detail || (step.kind === "rule" && step.state) ? (
                        <span className="route-step-meta">
                          {step.detail ? (
                            <small className="route-step-detail">{step.detail}</small>
                          ) : null}
                          {step.kind === "rule" && step.state ? (
                            <small
                              className={
                                step.state === "matched"
                                  ? "route-status route-status-matched"
                                  : "route-status route-status-default"
                              }
                            >
                              {step.status}
                            </small>
                          ) : null}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="route-marker-row">
                    <span
                      className={[
                        "route-marker",
                        step.state ? `route-marker-${step.state}` : "",
                      ].filter(Boolean).join(" ")}
                      aria-label={step.kind === "rule" ? `规则${step.status}` : undefined}
                      aria-hidden={step.kind !== "rule"}
                    >
                      {step.kind === "rule" && step.state === "matched" ? (
                        <Check aria-hidden="true" />
                      ) : null}
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>

        {station && onShowStation ? (
          <button type="button" className={styles.showStation} onClick={() => onShowStation(position)}>
            在分流线路中查看 · 第 {position} 条
            <ArrowDown aria-hidden="true" />
          </button>
        ) : null}
        {message ? <p className="route-message">{message}</p> : null}
      </div>
    </section>
  );
}

type TesterState = {
  input: string; ip: string; processName: string; preset: RuleTemplateId; customUrl: string;
  request: { preset: RuleTemplateId; url: string } | null;
  active: boolean; pendingTest: boolean;
  preview: RulePreview | null; ruleSets: LoadedRuleSet[]; result: RouteMatch | null;
  message: string; resultVersion: number;
};
