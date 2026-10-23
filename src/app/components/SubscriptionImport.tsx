import { LinkSimple } from "@phosphor-icons/react";
import { type FormEvent, useReducer, useState } from "react";

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
import { SubscriptionCloudSync } from "./SubscriptionCloudSync";
import { SubscriptionSyncTasks } from "./SubscriptionSyncTasks";
import { RolaCloudSubscription } from "./RolaCloudSubscription";
import { ProxyEndpointInput } from "./ProxyEndpointInput";
import { ruleTemplates, type RuleSelection } from "../../config/rule-templates";
import { defaultDnsSettings, parseDnsSettings, type DnsSettings } from "../../config/dns-settings";

type FormState = {
  dnsSettings: DnsSettings;
  backend: string;
  backendMode: "current" | "local" | "custom";
  addCountryFlag: boolean;
  copied: boolean;
  dnsMode: DnsMode;
  error: string;
  excludePattern: string;
  includePattern: string;
  name: string;
  renameRules: RenameRuleDraft[];
  result: ConvertedSubscription | null;
  revision: number;
  rulePreset: RulePreset;
  ruleTemplateUrl: string;
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
type FormAction = FieldAction
  | { key: "load"; value: LoadedSubscriptionForm }
  | { key: "settle"; revision: number; result: ConvertedSubscription | null; error: string };

const initialState: FormState = {
  dnsSettings: defaultDnsSettings,
  backend: "",
  backendMode: "current",
  addCountryFlag: true,
  copied: false,
  dnsMode: "doh",
  error: "",
  excludePattern: "",
  includePattern: "",
  name: "Flacierの分流规则",
  renameRules: [{ id: "rename-initial", pattern: "", replacement: "" }],
  result: null,
  revision: 0,
  rulePreset: "flacier",
  ruleTemplateUrl: "",
  pending: false,
  showNodeType: false,
  skipCertVerify: false,
  sourceUserAgent: "clash.meta",
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
      revision: state.revision + 1,
    };
  }
  // A response for inputs that changed while it was pending is discarded.
  if (action.key === "settle") {
    return action.revision === state.revision ? { ...state, result: action.result, error: action.error } : state;
  }
  const next = { ...state, [action.key]: action.value };
  if (
    action.key !== "copied"
    && action.key !== "error"
    && action.key !== "pending"
    && action.key !== "result"
  ) {
    next.result = null;
    next.revision = state.revision + 1;
  }
  return next;
}

const allFormats = [
  ...completeConfigFormats,
  ...nodeResourceFormats,
  ...secondaryFormats,
];

export function SubscriptionImport({ onRuleSelectionChange }: { onRuleSelectionChange?: (selection: RuleSelection) => void } = {}) {
  const [rolaMode, setRolaMode] = useState(false);
  const [form, updateForm] = useReducer(reducer, initialState);
  function dispatch(action: FormAction) {
    updateForm(action);
    const preset = action.key === "load" ? action.value.rulePreset : action.key === "rulePreset" ? action.value : form.rulePreset;
    const url = action.key === "load" ? action.value.ruleTemplateUrl : action.key === "ruleTemplateUrl" ? action.value : form.ruleTemplateUrl;
    if (["load", "rulePreset", "ruleTemplateUrl"].includes(action.key) && preset !== "global" && preset !== "direct") onRuleSelectionChange?.({ preset, url });
  }
  const selectedFormat = allFormats.find((format) => format.target === form.target) ?? completeConfigFormats[0];
  const supportsRulePreset = ["clash-party-config", "clash-verge-config", "flclash-config", "mihomo-config"].includes(form.target);
  const shadowrocketConfig = form.target === "shadowrocket-config";
  const supportsDns = supportsRulePreset || shadowrocketConfig;
  const backend = form.backendMode === "local" ? "http://127.0.0.1:25500" : form.backendMode === "custom" ? form.backend.replace(/\/+$/u, "") : "";

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
      dispatch({ key: "error", value: "进阶设置里的正则格式有误" });
      return false;
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validateInput()) {
      return;
    }
    const revision = form.revision;
    dispatch({ key: "pending", value: true });
    try {
      if (backend) {
        const url = new URL(backend);
        if (url.username || url.password || url.search || url.hash || url.pathname !== "/"
          || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))) {
          dispatch({ key: "error", value: "后端请使用 HTTPS 地址，或本机 HTTP 地址" });
          return;
        }
      }
      let dnsSettings = defaultDnsSettings;
      try {
        if (supportsDns) dnsSettings = parseDnsSettings({ ...form.dnsSettings, bootstrap: form.dnsSettings.bootstrap.map(value => value.trim()).filter(Boolean), nameservers: form.dnsSettings.nameservers.map(value => value.trim()).filter(Boolean) });
      } catch {
        dispatch({ key: "error", value: "请检查 DNS 设置：每项填写 1–4 个 HTTPS DoH 地址，不带路由后缀" });
        return;
      }
      const result = await createConvertedSubscription({
        dnsSettings,
        dnsMode: form.dnsMode,
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
        rulePreset: supportsRulePreset ? form.rulePreset : "flacier",
        ruleTemplateUrl: form.ruleTemplateUrl,
        sourceUserAgent: form.sourceUserAgent,
        sources: parseSubscriptionInput(form.sourceText),
        target: form.target,
        updateIntervalHours: form.updateIntervalHours,
      }, backend);
      dispatch({ key: "settle", revision, result, error: "" });
    } catch (error) {
      dispatch({ key: "settle", revision, result: null, error: subscriptionErrorText(error, backend) });
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
        <h2 id="subscription-title">订阅转换</h2>
        <p>可以合并多个订阅，选好规则后生成客户端链接。</p>
      </header>

      <label className="field subscription-rule-preset">
        <span>转换方式</span>
        <select value={rolaMode ? "rola" : "standard"} onChange={event => setRolaMode(event.target.value === "rola")}>
          <option value="standard">普通订阅转换</option>
          <option value="rola">Rola 家宽出口（可选机场前置）</option>
        </select>
      </label>
      {rolaMode ? <RolaCloudSubscription /> : <>
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
          <small>家宽代理可填 socks5://用户:密码@主机:端口，或带账号密码的 HTTP／HTTPS 节点链接。合并不等于代理链。</small>
          <ProxyEndpointInput onAdd={uri => dispatch({ key: "sourceText", value: [form.sourceText.trim(), uri].filter(Boolean).join("\n") })} />
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

        <div className="subscription-settings-grid">
          <label className="field">
            <span>转换后端</span>
            <select value={form.backendMode} onChange={(event) => dispatch({ key: "backendMode", value: event.target.value as FormState["backendMode"] })}>
              <option value="current">当前站点后端</option>
              <option value="local">本地后端 · 127.0.0.1:25500</option>
              <option value="custom">自定义 Flacier 后端</option>
            </select>
          </label>
          {form.backendMode === "custom" ? <label className="field"><span>后端地址</span><input type="url" value={form.backend} onChange={(event) => dispatch({ key: "backend", value: event.target.value })} placeholder="https://your-converter.example" required /></label> : null}
        </div>
        {form.backendMode === "local" ? <p className="subscription-result-notes">先运行 <code>pnpm start:local</code>；需通过代理读取机场时加 <code>--proxy http://127.0.0.1:你的混合端口</code>，仅影响本地转换进程。本机链接只供这台电脑使用；浏览器拒绝连接时，<a href="http://127.0.0.1:25500/" target="_blank" rel="noreferrer">打开本地页面</a>。</p> : null}
        {form.backendMode === "custom" ? <p className="subscription-result-notes">订阅凭据将发送给此后端。此处使用 Flacier API，不是 Subconverter 的 /sub 接口。</p> : null}

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
              {ruleTemplates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}
              {["global", "direct"].includes(form.rulePreset) ? <option value={form.rulePreset}>旧链接 · {form.rulePreset === "global" ? "全局代理" : "全局直连"}</option> : null}
            </select>
          </label>
        ) : null}

        {supportsRulePreset && form.rulePreset === "custom" ? <label className="field"><span>远程规则地址</span><input type="url" value={form.ruleTemplateUrl} onChange={event => dispatch({ key: "ruleTemplateUrl", value: event.target.value })} required placeholder="https://example.com/rules.ini" /><small>支持 ruleset 和 custom_proxy_group；不执行脚本或导入本地文件。</small></label> : null}

        <SubscriptionMoreSettings
          dnsSettings={form.dnsSettings}
          onDnsSettingsChange={value => dispatch({ key: "dnsSettings", value })}
          supportsDns={supportsDns}
          shadowrocket={shadowrocketConfig}
          addCountryFlag={form.addCountryFlag}
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

        {form.target === "shadowrocket" ? <p className="subscription-result-notes">Shadowrocket 此处导入节点与用量。分流和 DNS 使用客户端的「配置」，不会包含在节点订阅中。</p> : null}
        {shadowrocketConfig ? <p className="subscription-result-notes">生成配套的两个链接：先添加节点订阅，再添加规则与 DNS 配置。使用 Flacier 分流；DNS 经首页选中的节点。不要把本机 127.0.0.1 链接导入手机。</p> : null}

        <SubscriptionLinkLoader backend={backend} onLoad={(value) => dispatch({ key: "load", value })} />

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

      {(form.backendMode === "local" || (form.backendMode === "current" && typeof window !== "undefined" && ["127.0.0.1", "localhost"].includes(window.location.hostname)))
        ? <SubscriptionSyncTasks backend={backend} /> : null}

      {form.error ? (
        <p className="field-error" role="alert">{form.error}</p>
      ) : null}

      {form.result ? (
        <>
        <SubscriptionResult
          copied={form.copied}
          format={selectedFormat}
          result={form.result}
          onCopy={() => void copyResult()}
        />
        {form.result.sourceMode === "convert" && ["127.0.0.1", "localhost"].includes(new URL(form.result.url).hostname)
          ? <SubscriptionCloudSync key={form.result.url} localUrl={form.result.url} format={selectedFormat} /> : null}
        </>
      ) : null}
      </>}
    </section>
  );
}
