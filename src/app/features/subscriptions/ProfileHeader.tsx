import {
  ArrowClockwise,
  Check,
  PencilSimple,
  Trash,
  X,
} from "@phosphor-icons/react";
import type { FC, FormEvent } from "react";
import { useState } from "react";

type ProfileHeaderProps = {
  name: string;
  refreshTime: string;
  sourceCount: number;
  refreshing: boolean;
  renaming: boolean;
  deleting: boolean;
  onRefresh: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
};

export const ProfileHeader: FC<ProfileHeaderProps> = ({
  name,
  refreshTime,
  sourceCount,
  refreshing,
  renaming,
  deleting,
  onRefresh,
  onRename,
  onDelete,
}) => {
  const [editing, setEditing] = useState(false);
  const [nextName, setNextName] = useState(name);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function submitRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = nextName.trim();
    if (value && value !== name) {
      onRename(value);
    }
    setEditing(false);
  }

  function cancelRename() {
    setNextName(name);
    setEditing(false);
  }

  return (
    <header className="profile-heading">
      <div className="profile-heading-copy">
        {editing ? (
          <form className="profile-rename" onSubmit={submitRename}>
            <input
              value={nextName}
              onChange={(event) => setNextName(event.target.value)}
              maxLength={64}
              aria-label="方案名称"
              autoFocus
            />
            <button type="submit" disabled={renaming || !nextName.trim()} aria-label="保存名称">
              <Check aria-hidden="true" />
            </button>
            <button type="button" onClick={cancelRename} aria-label="取消改名">
              <X aria-hidden="true" />
            </button>
          </form>
        ) : (
          <h1>{name}</h1>
        )}
        <p>{refreshTime}</p>
      </div>
      <div className="profile-heading-actions">
        <button
          className="profile-text-action"
          type="button"
          disabled={renaming || deleting}
          onClick={() => {
            setNextName(name);
            setEditing(true);
            setConfirmDelete(false);
          }}
        >
          <PencilSimple aria-hidden="true" />
          改名
        </button>
        <button
          className={confirmDelete ? "profile-text-action is-danger" : "profile-text-action"}
          type="button"
          disabled={renaming || deleting}
          onClick={() => {
            if (confirmDelete) {
              onDelete();
            } else {
              setEditing(false);
              setConfirmDelete(true);
            }
          }}
        >
          <Trash aria-hidden="true" />
          {confirmDelete ? "确认删除" : "删除"}
        </button>
        <button
          className="button button-primary"
          type="button"
          disabled={refreshing || sourceCount === 0}
          onClick={onRefresh}
        >
          <ArrowClockwise aria-hidden="true" />
          {refreshing ? "正在刷新" : "刷新全部格式"}
        </button>
      </div>
    </header>
  );
};
