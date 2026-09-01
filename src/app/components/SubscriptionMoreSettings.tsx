import { Plus, X } from "@phosphor-icons/react";
import type { FC } from "react";

import type { DnsMode, NodeSortMode } from "../features/subscriptions/api";

type RenameRuleDraft = {
  id: string;
  pattern: string;
  replacement: string;
};

type SubscriptionMoreSettingsProps = {
  addCountryFlag: boolean;
  allowClientFallback: boolean;
  dnsMode: DnsMode;
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
    key: "addCountryFlag" | "allowClientFallback" | "showNodeType" | "skipCertVerify" | "tfo" | "udp" | "xudp",
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
  addCountryFlag,
  allowClientFallback,
  dnsMode,
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
  return (
    <details className="subscription-more-settings">
      <summary>进阶设置</summary>
      <div className="subscription-settings-grid">
        <label className="field">
          <span className="field-label">
            <strong>订阅请求 UA</strong>
            <small>用于请求机场订阅</small>
          </span>
          <input
            value={sourceUserAgent}
            onChange={(event) => onTextChange("sourceUserAgent", event.target.value)}
            placeholder="mihomo/1.19"
            maxLength={128}
            spellCheck="false"
          />
        </label>
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
        <label className="field">
          <span className="field-label">
            <strong>Clash DNS</strong>
            <small>仅影响 Clash Party 与 Mihomo 完整配置</small>
          </span>
          <select
            value={dnsMode}
            onChange={(event) => onDnsModeChange(event.target.value as DnsMode)}
          >
            <option value="doh">内置 DoH</option>
            <option value="system">使用系统 DNS</option>
          </select>
        </label>
        <label className="field subscription-sort">
          <span className="field-label">
            <strong>排序</strong>
            <small>客户端直读时仅支持来源顺序</small>
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
              checked={allowClientFallback}
              onChange={(event) => onBooleanChange("allowClientFallback", event.target.checked)}
            />
            <span className="subscription-option-copy">
              <strong>客户端直读备用</strong>
              <small>机场拒绝 Worker 时，仅供 Clash Party 与 Mihomo 使用</small>
            </span>
          </label>
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
