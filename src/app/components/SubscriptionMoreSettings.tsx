import type { FC } from "react";

import type { NodeSortMode } from "../features/subscriptions/api";

type SubscriptionMoreSettingsProps = {
  addCountryFlag: boolean;
  excludePattern: string;
  includePattern: string;
  renamePattern: string;
  renameReplacement: string;
  showNodeType: boolean;
  skipCertVerify: boolean;
  sourceUserAgent: string;
  sortMode: NodeSortMode;
  tfo: boolean;
  udp: boolean;
  updateIntervalHours: number;
  onBooleanChange: (
    key: "addCountryFlag" | "showNodeType" | "skipCertVerify" | "tfo" | "udp",
    value: boolean,
  ) => void;
  onTextChange: (
    key:
      | "excludePattern"
      | "includePattern"
      | "renamePattern"
      | "renameReplacement"
      | "sourceUserAgent",
    value: string,
  ) => void;
  onSortChange: (value: NodeSortMode) => void;
  onUpdateIntervalChange: (value: number) => void;
};

export const SubscriptionMoreSettings: FC<SubscriptionMoreSettingsProps> = ({
  addCountryFlag,
  excludePattern,
  includePattern,
  renamePattern,
  renameReplacement,
  showNodeType,
  skipCertVerify,
  sourceUserAgent,
  sortMode,
  tfo,
  udp,
  updateIntervalHours,
  onBooleanChange,
  onSortChange,
  onTextChange,
  onUpdateIntervalChange,
}) => {
  return (
    <details className="subscription-more-settings">
      <summary>进阶设置</summary>
      <div className="subscription-settings-grid">
        <label className="field">
          <span>订阅请求 UA</span>
          <input
            value={sourceUserAgent}
            onChange={(event) => onTextChange("sourceUserAgent", event.target.value)}
            placeholder="mihomo/1.19"
            maxLength={128}
            spellCheck="false"
          />
        </label>
        <label className="field">
          <span>更新间隔</span>
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
          <span>保留节点</span>
          <input
            value={includePattern}
            onChange={(event) => onTextChange("includePattern", event.target.value)}
            placeholder="US|JP|SG"
            maxLength={256}
            spellCheck="false"
          />
        </label>
        <label className="field">
          <span>排除节点</span>
          <input
            value={excludePattern}
            onChange={(event) => onTextChange("excludePattern", event.target.value)}
            placeholder="过期|剩余|官网"
            maxLength={256}
            spellCheck="false"
          />
        </label>
        <label className="field">
          <span>名称匹配</span>
          <input
            value={renamePattern}
            onChange={(event) => onTextChange("renamePattern", event.target.value)}
            placeholder="^🇺🇸\\s*"
            maxLength={128}
            spellCheck="false"
          />
        </label>
        <label className="field">
          <span>替换为</span>
          <input
            value={renameReplacement}
            onChange={(event) => onTextChange("renameReplacement", event.target.value)}
            placeholder="US "
            maxLength={128}
            spellCheck="false"
          />
        </label>
        <label className="field subscription-sort">
          <span>排序</span>
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
            <span>添加国家旗帜</span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={showNodeType}
              onChange={(event) => onBooleanChange("showNodeType", event.target.checked)}
            />
            <span>显示节点类型</span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={udp}
              onChange={(event) => onBooleanChange("udp", event.target.checked)}
            />
            <span>启用 UDP</span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={skipCertVerify}
              onChange={(event) => onBooleanChange("skipCertVerify", event.target.checked)}
            />
            <span>跳过证书验证</span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={tfo}
              onChange={(event) => onBooleanChange("tfo", event.target.checked)}
            />
            <span>TCP Fast Open</span>
          </label>
        </div>
      </div>
    </details>
  );
};
