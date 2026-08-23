import type { NodeSortMode } from "../features/subscriptions/api";

type SubscriptionMoreSettingsProps = {
  excludePattern: string;
  includePattern: string;
  renamePattern: string;
  renameReplacement: string;
  sortMode: NodeSortMode;
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

export function SubscriptionMoreSettings({
  excludePattern,
  includePattern,
  renamePattern,
  renameReplacement,
  sortMode,
  onSortChange,
  onTextChange,
}: SubscriptionMoreSettingsProps) {
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
        <label className="field">
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
      </div>
    </details>
  );
}
