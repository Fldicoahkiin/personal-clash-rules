import {
  Check,
  Eye,
  EyeSlash,
  LinkSimple,
  Pause,
  PencilSimple,
  Play,
  Plugs,
  Trash,
  X,
} from "@phosphor-icons/react";
import type { FC, FormEvent } from "react";
import { useState } from "react";

import type { SubscriptionSource } from "./api";

type SourceListRowProps = {
  source: SubscriptionSource;
  busy: boolean;
  onEnabledChange: (sourceId: string, enabled: boolean) => void;
  onUpdate: (sourceId: string, name: string, value?: string) => void;
  onDelete: (sourceId: string) => void;
};

export const SourceListRow: FC<SourceListRowProps> = ({
  source,
  busy,
  onEnabledChange,
  onUpdate,
  onDelete,
}) => {
  const [editing, setEditing] = useState(false);
  const [nextName, setNextName] = useState(source.name);
  const [nextValue, setNextValue] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = nextName.trim();
    if (!name) {
      return;
    }
    onUpdate(source.id, name, nextValue.trim() || undefined);
    setEditing(false);
    setNextValue("");
    setRevealed(false);
  }

  return (
    <div className={source.enabled ? "source-row" : "source-row is-disabled"}>
      <span className="source-type-icon">
        {source.type === "subscription"
          ? <LinkSimple aria-hidden="true" />
          : <Plugs aria-hidden="true" />}
      </span>
      <div className="source-row-copy">
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
          disabled={busy}
          onClick={() => {
            setNextName(source.name);
            setNextValue("");
            setConfirmDelete(false);
            setEditing((current) => !current);
          }}
        >
          <PencilSimple aria-hidden="true" />
          编辑
        </button>
        <button
          className="source-toggle"
          type="button"
          disabled={busy}
          onClick={() => onEnabledChange(source.id, !source.enabled)}
        >
          {source.enabled
            ? <Pause aria-hidden="true" />
            : <Play aria-hidden="true" />}
          {source.enabled ? "停用" : "启用"}
        </button>
        <button
          className={confirmDelete ? "text-danger is-confirming" : "text-danger"}
          type="button"
          disabled={busy}
          onClick={() => {
            if (confirmDelete) {
              onDelete(source.id);
            } else {
              setEditing(false);
              setConfirmDelete(true);
            }
          }}
        >
          <Trash aria-hidden="true" />
          {confirmDelete ? "确认移除" : "移除"}
        </button>
      </div>

      {editing ? (
        <form className="source-edit" onSubmit={submit}>
          <label className="field">
            <span>名称</span>
            <input
              value={nextName}
              onChange={(event) => setNextName(event.target.value)}
              maxLength={80}
              autoFocus
            />
          </label>
          <label className="field source-secret-field">
            <span>替换{source.type === "subscription" ? "订阅地址" : "节点 URI"}</span>
            <span className="source-secret-input">
              <input
                type={revealed ? "text" : "password"}
                value={nextValue}
                onChange={(event) => setNextValue(event.target.value)}
                placeholder="留空保留原内容"
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
          <button className="source-edit-save" type="submit" disabled={busy || !nextName.trim()}>
            <Check aria-hidden="true" />
            保存
          </button>
          <button className="source-edit-cancel" type="button" onClick={() => setEditing(false)}>
            <X aria-hidden="true" />
            取消
          </button>
        </form>
      ) : null}
    </div>
  );
};
