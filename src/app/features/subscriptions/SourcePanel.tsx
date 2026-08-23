import { Eye, EyeSlash, LinkSimple, Pause, Play, Plugs, Trash } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { FC, FormEvent } from "react";
import { useState } from "react";

import {
  addSubscriptionSource,
  removeSubscriptionSource,
  setSubscriptionSourceEnabled,
  subscriptionErrorText,
  subscriptionQueries,
  type SourceType,
  type SubscriptionSource,
} from "./api";

type SourcePanelProps = {
  profileId: string;
  sources: SubscriptionSource[];
  onNotice: (message: string, tone?: "error" | "success") => void;
};

export const SourcePanel: FC<SourcePanelProps> = ({ profileId, sources, onNotice }) => {
  const queryClient = useQueryClient();
  const [type, setType] = useState<SourceType>("subscription");
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  async function refreshQueries() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: subscriptionQueries.all }),
      queryClient.invalidateQueries({ queryKey: subscriptionQueries.detail(profileId).queryKey }),
    ]);
  }

  const addMutation = useMutation({
    mutationFn: () => addSubscriptionSource(profileId, { name, type, value }),
    onSuccess: async () => {
      setName("");
      setValue("");
      await refreshQueries();
      onNotice("来源已保存", "success");
    },
    onError: (error) => onNotice(subscriptionErrorText(error), "error"),
  });

  const deleteMutation = useMutation({
    mutationFn: removeSubscriptionSource,
    onSuccess: async () => {
      setConfirmDelete(null);
      await refreshQueries();
      onNotice("来源已移除", "success");
    },
    onError: (error) => onNotice(subscriptionErrorText(error), "error"),
  });

  const enabledMutation = useMutation({
    mutationFn: ({ sourceId, enabled }: { sourceId: string; enabled: boolean }) => (
      setSubscriptionSourceEnabled(sourceId, enabled)
    ),
    onSuccess: async (_, input) => {
      await refreshQueries();
      onNotice(input.enabled ? "来源已启用" : "来源已停用", "success");
    },
    onError: (error) => onNotice(subscriptionErrorText(error), "error"),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (name.trim() && value.trim()) {
      addMutation.mutate();
    }
  }

  return (
    <section className="control-section" aria-labelledby="sources-title">
      <header className="control-section-title">
        <div>
          <h2 id="sources-title">订阅来源</h2>
          <p>保存后不再显示原始地址。</p>
        </div>
      </header>

      {sources.length > 0 ? (
        <div className="source-list">
          {sources.map((source) => (
            <div className={source.enabled ? "source-row" : "source-row is-disabled"} key={source.id}>
              <span className="source-type-icon">
                {source.type === "subscription"
                  ? <LinkSimple aria-hidden="true" />
                  : <Plugs aria-hidden="true" />}
              </span>
              <div>
                <strong>{source.name}</strong>
                <span>
                  {source.type === "subscription" ? "远程订阅" : "单个节点"}
                  {source.enabled ? "" : " · 已停用"}
                </span>
              </div>
              <div className="source-row-actions">
                <button
                  className="source-toggle"
                  type="button"
                  disabled={enabledMutation.isPending || deleteMutation.isPending}
                  onClick={() => enabledMutation.mutate({
                    sourceId: source.id,
                    enabled: !source.enabled,
                  })}
                >
                  {source.enabled
                    ? <Pause aria-hidden="true" />
                    : <Play aria-hidden="true" />}
                  {source.enabled ? "停用" : "启用"}
                </button>
                <button
                  className={confirmDelete === source.id ? "text-danger is-confirming" : "text-danger"}
                  type="button"
                  disabled={deleteMutation.isPending || enabledMutation.isPending}
                  onClick={() => {
                    if (confirmDelete === source.id) {
                      deleteMutation.mutate(source.id);
                    } else {
                      setConfirmDelete(source.id);
                    }
                  }}
                >
                  <Trash aria-hidden="true" />
                  {confirmDelete === source.id ? "确认移除" : "移除"}
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="control-empty">还没有订阅来源。</p>
      )}

      <form className="source-create" onSubmit={submit}>
        <div className="source-type-tabs" aria-label="来源类型">
          <button
            className={type === "subscription" ? "is-active" : ""}
            type="button"
            onClick={() => setType("subscription")}
          >
            <LinkSimple aria-hidden="true" />
            订阅地址
          </button>
          <button
            className={type === "node" ? "is-active" : ""}
            type="button"
            onClick={() => setType("node")}
          >
            <Plugs aria-hidden="true" />
            单个节点
          </button>
        </div>
        <label className="field">
          <span>名称</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={type === "subscription" ? "主订阅" : "备用节点"}
            maxLength={80}
          />
        </label>
        <label className="field source-secret-field">
          <span>{type === "subscription" ? "订阅地址" : "节点 URI"}</span>
          <span className="source-secret-input">
            <input
              type={revealed ? "text" : "password"}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={type === "subscription" ? "https://…" : "vless://…"}
              spellCheck="false"
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => setRevealed((current) => !current)}
              aria-label={revealed ? "隐藏内容" : "显示内容"}
            >
              {revealed ? <EyeSlash aria-hidden="true" /> : <Eye aria-hidden="true" />}
            </button>
          </span>
        </label>
        <button
          className="button button-primary source-submit"
          type="submit"
          disabled={addMutation.isPending || !name.trim() || !value.trim()}
        >
          {addMutation.isPending ? "正在保存" : "保存来源"}
        </button>
      </form>
    </section>
  );
};
