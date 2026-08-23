import { Plus } from "@phosphor-icons/react";
import type { FC, FormEvent } from "react";
import { useState } from "react";

import type { ProfileSummary } from "./api";

type ProfileRailProps = {
  profiles: ProfileSummary[];
  activeId: string | undefined;
  creating: boolean;
  onSelect: (profileId: string) => void;
  onCreate: (name: string) => void;
};

export const ProfileRail: FC<ProfileRailProps> = ({
  profiles,
  activeId,
  creating,
  onSelect,
  onCreate,
}) => {
  const [name, setName] = useState("个人订阅");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = name.trim();
    if (value) {
      onCreate(value);
    }
  }

  return (
    <aside className="profile-rail" aria-label="订阅方案">
      <div className="profile-rail-title">
        <h1>订阅方案</h1>
        <span>{profiles.length}</span>
      </div>
      <div className="profile-list">
        {profiles.map((profile) => (
          <button
            className={profile.id === activeId ? "is-active" : ""}
            type="button"
            key={profile.id}
            onClick={() => onSelect(profile.id)}
          >
            <strong>{profile.name}</strong>
            <span>{profile.sourceCount} 个来源 · {profile.outputCount} 种格式</span>
          </button>
        ))}
      </div>
      <form className="profile-create" onSubmit={submit}>
        <label htmlFor="new-profile-name">新方案</label>
        <div>
          <input
            id="new-profile-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={64}
          />
          <button type="submit" disabled={creating || !name.trim()} aria-label="创建方案">
            <Plus aria-hidden="true" />
          </button>
        </div>
      </form>
    </aside>
  );
};
