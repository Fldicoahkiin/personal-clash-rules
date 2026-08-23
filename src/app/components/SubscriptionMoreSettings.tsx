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
  sortMode: NodeSortMode;
  tfo: boolean;
  udp: boolean;
  onBooleanChange: (
    key: "addCountryFlag" | "showNodeType" | "skipCertVerify" | "tfo" | "udp",
    value: boolean,
  ) => void;
  onTextChange: (
    key:
      | "excludePattern"
      | "includePattern"
      | "renamePattern"
      | "renameReplacement",
    value: string,
  ) => void;
  onSortChange: (value: NodeSortMode) => void;
};

export const SubscriptionMoreSettings: FC<SubscriptionMoreSettingsProps> = ({
  addCountryFlag,
  excludePattern,
  includePattern,
  renamePattern,
  renameReplacement,
  showNodeType,
  skipCertVerify,
  sortMode,
  tfo,
  udp,
  onBooleanChange,
  onSortChange,
  onTextChange,
}) => {
  return (
    <details className="subscription-more-settings">
      <summary>更多设置</summary>
      <div className="subscription-settings-grid">
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
