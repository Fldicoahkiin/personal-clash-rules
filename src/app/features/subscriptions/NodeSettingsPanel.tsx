import { Plus, Trash } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { FC, FormEvent } from "react";
import { useState } from "react";

import {
  subscriptionErrorText,
  subscriptionQueries,
  updateSubscriptionNodeSettings,
  type NodeRenameRule,
  type NodeSettings,
  type NodeSortMode,
} from "./api";

type EditableRenameRule = NodeRenameRule & { id: string };

type NodeSettingsPanelProps = {
  profileId: string;
  settings: NodeSettings;
  onNotice: (message: string, tone?: "error" | "success") => void;
};

function editableRules(rules: NodeRenameRule[]): EditableRenameRule[] {
  return rules.map((rule) => ({ ...rule, id: crypto.randomUUID() }));
}

function isPatternValid(pattern: string, allowEmpty: boolean): boolean {
  if (!pattern.trim()) {
    return allowEmpty;
  }
  try {
    new RegExp(pattern, "u");
    return true;
  } catch {
    return false;
  }
}

export const NodeSettingsPanel: FC<NodeSettingsPanelProps> = ({
  profileId,
  settings,
  onNotice,
}) => {
  const queryClient = useQueryClient();
  const [includePattern, setIncludePattern] = useState(settings.includePattern);
  const [excludePattern, setExcludePattern] = useState(settings.excludePattern);
  const [renameRules, setRenameRules] = useState(() => editableRules(settings.renameRules));
  const [sortMode, setSortMode] = useState<NodeSortMode>(settings.sortMode);

  const includeValid = isPatternValid(includePattern, true);
  const excludeValid = isPatternValid(excludePattern, true);
  const renameRulesValid = renameRules.every((rule) => (
    isPatternValid(rule.pattern, false)
  ));
  const savedRules = renameRules.map(({ pattern, replacement }) => ({
    pattern,
    replacement,
  }));
  const changed = includePattern !== settings.includePattern
    || excludePattern !== settings.excludePattern
    || sortMode !== settings.sortMode
    || JSON.stringify(savedRules) !== JSON.stringify(settings.renameRules);

  const saveMutation = useMutation({
    mutationFn: (next: NodeSettings) => updateSubscriptionNodeSettings(profileId, next),
    onSuccess: async (saved) => {
      setIncludePattern(saved.includePattern);
      setExcludePattern(saved.excludePattern);
      setRenameRules(editableRules(saved.renameRules));
      setSortMode(saved.sortMode);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: subscriptionQueries.all }),
        queryClient.invalidateQueries({
          queryKey: subscriptionQueries.detail(profileId).queryKey,
        }),
      ]);
      onNotice("节点处理已保存", "success");
    },
    onError: (error) => onNotice(subscriptionErrorText(error), "error"),
  });

  function updateRule(
    id: string,
    field: keyof NodeRenameRule,
    value: string,
  ) {
    setRenameRules((current) => current.map((rule) => (
      rule.id === id ? { ...rule, [field]: value } : rule
    )));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!includeValid || !excludeValid || !renameRulesValid || !changed) {
      return;
    }
    saveMutation.mutate({
      includePattern,
      excludePattern,
      renameRules: savedRules,
      sortMode,
    });
  }

  return (
    <section className="control-section" aria-labelledby="node-settings-title">
      <header className="control-section-title">
        <div>
          <h2 id="node-settings-title">节点处理</h2>
          <p>按顺序筛选、改名和排序。</p>
        </div>
      </header>

      <form className="node-settings-form" onSubmit={submit}>
        <div className="node-filter-grid">
          <label className="field">
            <span>保留</span>
            <input
              value={includePattern}
              onChange={(event) => setIncludePattern(event.target.value)}
              placeholder="US|JP|Singapore"
              maxLength={256}
              spellCheck="false"
              aria-invalid={!includeValid}
            />
            {!includeValid ? <small className="field-error">正则格式有误</small> : null}
          </label>
          <label className="field">
            <span>排除</span>
            <input
              value={excludePattern}
              onChange={(event) => setExcludePattern(event.target.value)}
              placeholder="过期|剩余|倍率"
              maxLength={256}
              spellCheck="false"
              aria-invalid={!excludeValid}
            />
            {!excludeValid ? <small className="field-error">正则格式有误</small> : null}
          </label>
          <label className="field">
            <span>排序</span>
            <select
              value={sortMode}
              onChange={(event) => setSortMode(event.target.value as NodeSortMode)}
            >
              <option value="source">保持来源顺序</option>
              <option value="name-asc">名称升序</option>
              <option value="name-desc">名称降序</option>
            </select>
          </label>
        </div>

        <fieldset className="node-rename-fieldset">
          <legend>改名</legend>
          <div className="node-rename-heading">
            <small>从上到下执行</small>
            <button
              type="button"
              onClick={() => setRenameRules((current) => [
                ...current,
                { id: crypto.randomUUID(), pattern: "", replacement: "" },
              ])}
              disabled={renameRules.length >= 12}
            >
              <Plus aria-hidden="true" />
              添加改名
            </button>
          </div>
          {renameRules.length > 0 ? (
            <div className="node-rename-list">
              {renameRules.map((rule, index) => {
                const patternValid = isPatternValid(rule.pattern, false);
                return (
                  <div className="node-rename-row" key={rule.id}>
                    <label className="field">
                      <span>匹配</span>
                      <input
                        value={rule.pattern}
                        onChange={(event) => updateRule(rule.id, "pattern", event.target.value)}
                        placeholder="^🇺🇸\\s*"
                        maxLength={128}
                        spellCheck="false"
                        aria-invalid={!patternValid}
                      />
                      {!patternValid ? (
                        <small className="field-error">
                          {rule.pattern.trim() ? "正则格式有误" : "请输入匹配内容"}
                        </small>
                      ) : null}
                    </label>
                    <label className="field">
                      <span>替换为</span>
                      <input
                        value={rule.replacement}
                        onChange={(event) => updateRule(rule.id, "replacement", event.target.value)}
                        placeholder="US "
                        maxLength={128}
                        spellCheck="false"
                      />
                    </label>
                    <button
                      className="node-rename-remove"
                      type="button"
                      onClick={() => setRenameRules((current) => (
                        current.filter((item) => item.id !== rule.id)
                      ))}
                      aria-label={`删除第 ${index + 1} 条改名规则`}
                    >
                      <Trash aria-hidden="true" />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : null}
        </fieldset>

        <div className="node-settings-actions">
          <small>保存后，下次刷新开始使用。</small>
          <button
            className="button button-primary"
            type="submit"
            disabled={
              saveMutation.isPending
              || !changed
              || !includeValid
              || !excludeValid
              || !renameRulesValid
            }
          >
            {saveMutation.isPending ? "正在保存" : "保存节点处理"}
          </button>
        </div>
      </form>
    </section>
  );
};
