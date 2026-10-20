import { Plus, X } from "@phosphor-icons/react";
import type { FC } from "react";

import type { DnsMode, NodeSortMode } from "../features/subscriptions/api";
import type { DnsSettings } from "../../config/dns-settings";
import { MihomoDnsSettings } from "./MihomoDnsSettings";

type RenameRuleDraft = {
  id: string;
  pattern: string;
  replacement: string;
};

const sourceUserAgentPresets = [
  { label: "clash.meta（推荐）", value: "clash.meta" },
  { label: "Clash Party", value: "ClashParty/2.0" },
  { label: "Clash", value: "Clash/1.18.0" },
  { label: "Clash Verge", value: "clash-verge" },
  { label: "FlClash", value: "FlClash" },
  { label: "Shadowrocket", value: "Shadowrocket" },
  { label: "Mihomo", value: "mihomo/1.19" },
] as const;

type SubscriptionMoreSettingsProps = {
  dnsSettings?: DnsSettings;
  onDnsSettingsChange?: (value: DnsSettings) => void;
  addCountryFlag: boolean;
  dnsMode: DnsMode;
  supportsDns?: boolean;
  shadowrocket?: boolean;
  excludePattern: string;
  includePattern: string;
  renameRules: RenameRuleDraft[];
  showNodeType: boolean;
  skipCertVerify: boolean;
  sourceUserAgent: string;
  sortMode: NodeSortMode;
  tfo: boolean;
  udp: boolean;
  updateIntervalHours: number;
  xudp: boolean;
  onBooleanChange: (
    key: "addCountryFlag" | "showNodeType" | "skipCertVerify" | "tfo" | "udp" | "xudp",
    value: boolean,
  ) => void;
  onDnsModeChange: (value: DnsMode) => void;
  onRenameRulesChange: (value: RenameRuleDraft[]) => void;
  onTextChange: (
    key:
      | "excludePattern"
      | "includePattern"
      | "sourceUserAgent",
    value: string,
  ) => void;
  onSortChange: (value: NodeSortMode) => void;
  onUpdateIntervalChange: (value: number) => void;
};

export const SubscriptionMoreSettings: FC<SubscriptionMoreSettingsProps> = ({
  dnsSettings,
  onDnsSettingsChange,
  addCountryFlag,
  dnsMode,
  supportsDns = true,
  shadowrocket = false,
  excludePattern,
  includePattern,
  renameRules,
  showNodeType,
  skipCertVerify,
  sourceUserAgent,
  sortMode,
  tfo,
  udp,
  updateIntervalHours,
  xudp,
  onBooleanChange,
  onDnsModeChange,
  onRenameRulesChange,
  onSortChange,
  onTextChange,
  onUpdateIntervalChange,
}) => {
  const hasPresetUserAgent = sourceUserAgentPresets.some(
    (preset) => preset.value === sourceUserAgent,
  );

  return (
    <details className="subscription-more-settings">
      <summary>进阶设置</summary>
      <div className="subscription-settings-grid">
        <div className="field subscription-user-agent">
          <span className="field-label">
            <strong>订阅请求 UA</strong>
            <small>用于请求机场订阅</small>
          </span>
          <select
            aria-label="订阅请求 UA 预设"
            value={hasPresetUserAgent ? sourceUserAgent : "custom"}
            onChange={(event) => onTextChange(
              "sourceUserAgent",
              event.target.value === "custom" ? "" : event.target.value,
            )}
          >
            {sourceUserAgentPresets.map((preset) => (
              <option key={preset.value} value={preset.value}>{preset.label}</option>
            ))}
            <option value="custom">自定义</option>
          </select>
          {!hasPresetUserAgent ? (
            <input
              aria-label="自定义订阅请求 UA"
              value={sourceUserAgent}
              onChange={(event) => onTextChange("sourceUserAgent", event.target.value)}
              placeholder="例如 CustomClient/1.0"
              maxLength={128}
              spellCheck="false"
            />
          ) : null}
        </div>
        <label className="field">
          <span className="field-label">
            <strong>更新间隔</strong>
            <small>控制配置和节点源刷新</small>
          </span>
          <select
            value={updateIntervalHours}
            onChange={(event) => onUpdateIntervalChange(Number(event.target.value))}
          >
            <option value={1}>每小时</option>
            <option value={6}>每 6 小时</option>
            <option value={12}>每 12 小时</option>
            <option value={24}>每天</option>
          </select>
        </label>
        <label className="field">
          <span className="field-label">
            <strong>保留节点</strong>
            <small>仅保留名称匹配的节点</small>
          </span>
          <input
            value={includePattern}
            onChange={(event) => onTextChange("includePattern", event.target.value)}
            placeholder="US|JP|SG"
            maxLength={256}
            spellCheck="false"
          />
        </label>
        <label className="field">
          <span className="field-label">
            <strong>排除节点</strong>
            <small>移除名称匹配的节点</small>
          </span>
          <input
            value={excludePattern}
            onChange={(event) => onTextChange("excludePattern", event.target.value)}
            placeholder="过期|剩余|官网"
            maxLength={256}
            spellCheck="false"
          />
        </label>
        <fieldset className="subscription-rename-rules">
          <legend className="field-label">
            <strong>节点重命名</strong>
            <small>按顺序执行正则替换</small>
          </legend>
          <div className="subscription-rename-list">
            {renameRules.map((rule) => (
              <div className="subscription-rename-row" key={rule.id}>
                <label className="field">
                  <span className="field-label">
                    <strong>名称匹配</strong>
                    <small>正则匹配节点名称</small>
                  </span>
                  <input
                    value={rule.pattern}
                    onChange={(event) => onRenameRulesChange(renameRules.map((candidate) => (
                      candidate.id === rule.id
                        ? { ...candidate, pattern: event.target.value }
                        : candidate
                    )))}
                    placeholder="^US-"
                    maxLength={128}
                    spellCheck="false"
                  />
                </label>
                <label className="field">
                  <span className="field-label">
                    <strong>替换为</strong>
                    <small>替换匹配到的名称</small>
                  </span>
                  <input
                    value={rule.replacement}
                    onChange={(event) => onRenameRulesChange(renameRules.map((candidate) => (
                      candidate.id === rule.id
                        ? { ...candidate, replacement: event.target.value }
                        : candidate
                    )))}
                    placeholder="United States "
                    maxLength={128}
                    spellCheck="false"
                  />
                </label>
                <button
                  className="subscription-rename-remove"
                  type="button"
                  aria-label="删除这条重命名"
                  disabled={renameRules.length === 1}
                  onClick={() => onRenameRulesChange(renameRules.filter((candidate) => candidate.id !== rule.id))}
                >
                  <X aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
          <button
            className="subscription-rename-add"
            type="button"
            disabled={renameRules.length >= 12}
            onClick={() => onRenameRulesChange([
              ...renameRules,
              { id: crypto.randomUUID(), pattern: "", replacement: "" },
            ])}
          >
            <Plus aria-hidden="true" />
            添加重命名
          </button>
        </fieldset>
        {supportsDns ? <label className="field">
          <span className="field-label">
            <strong>{shadowrocket ? "Shadowrocket DNS" : "Clash DNS"}</strong>
            <small>{shadowrocket ? "写入配套 .conf；不会改变当前设备设置" : "适用于 Clash Verge、FlClash、Clash Party 与 Mihomo 完整配置"}</small>
          </span>
          <select
            value={dnsMode}
            onChange={(event) => onDnsModeChange(event.target.value as DnsMode)}
          >
            {!shadowrocket || dnsMode === "upstream" ? <option value="upstream">保留原订阅 DNS{shadowrocket ? "（此客户端不支持，请重新选择）" : ""}</option> : null}
            <option value="doh">代理解析 · 加密 DoH</option>
            <option value="system">使用系统 DNS</option>
          </select>
        </label> : null}
        {supportsDns && dnsSettings && onDnsSettingsChange ? <MihomoDnsSettings settings={dnsSettings} onChange={onDnsSettingsChange} proxyDns={dnsMode === "doh"} shadowrocket={shadowrocket} /> : null}
        {supportsDns && dnsMode !== "doh" ? <p>此模式沿用系统或机场的解析出口，不保证 DNS 经代理。上游 DNS 依赖原策略组时会停止转换并提示。</p> : null}
        <label className="field subscription-sort">
          <span className="field-label">
            <strong>排序</strong>
          </span>
          <select
            value={sortMode}
            onChange={(event) => onSortChange(event.target.value as NodeSortMode)}
          >
            <option value="source">保持来源顺序</option>
            <option value="name-asc">名称升序</option>
            <option value="name-desc">名称降序</option>
          </select>
        </label>
        <div className="subscription-option-list" aria-label="节点选项">
          <label>
            <input
              type="checkbox"
              checked={addCountryFlag}
              onChange={(event) => onBooleanChange("addCountryFlag", event.target.checked)}
            />
            <span className="subscription-option-copy">
              <strong>国家旗帜</strong>
              <small>按节点名称识别国家或地区</small>
            </span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={showNodeType}
              onChange={(event) => onBooleanChange("showNodeType", event.target.checked)}
            />
            <span className="subscription-option-copy">
              <strong>节点类型</strong>
              <small>在名称前显示协议类型</small>
            </span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={udp}
              onChange={(event) => onBooleanChange("udp", event.target.checked)}
            />
            <span className="subscription-option-copy">
              <strong>UDP</strong>
              <small>用于语音、游戏和 QUIC</small>
            </span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={xudp}
              onChange={(event) => onBooleanChange("xudp", event.target.checked)}
            />
            <span className="subscription-option-copy">
              <strong>XUDP</strong>
              <small>为 VMess 与 VLESS 使用 XUDP</small>
            </span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={skipCertVerify}
              onChange={(event) => onBooleanChange("skipCertVerify", event.target.checked)}
            />
            <span className="subscription-option-copy">
              <strong>跳过证书验证</strong>
              <small>仅用于证书异常的 TLS 节点</small>
            </span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={tfo}
              onChange={(event) => onBooleanChange("tfo", event.target.checked)}
            />
            <span className="subscription-option-copy">
              <strong>TCP Fast Open</strong>
              <small>仅对支持 TFO 的连接生效</small>
            </span>
          </label>
        </div>
      </div>
    </details>
  );
};
