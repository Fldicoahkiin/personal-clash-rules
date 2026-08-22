import { ArrowClockwise, CheckCircle, X } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";

import {
  createSubscriptionProfile,
  refreshSubscriptionProfile,
  setControlToken,
  SubscriptionApiError,
  subscriptionErrorText,
  subscriptionQueries,
} from "./api";
import { ControlHeader } from "./ControlHeader";
import { LinkPanel } from "./LinkPanel";
import { ProfileRail } from "./ProfileRail";
import { SourcePanel } from "./SourcePanel";

type Notice = { message: string; tone: "error" | "success" };

function formatRefreshTime(value: string | null): string {
  if (!value) {
    return "尚未刷新";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function SubscriptionConsole() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [controlToken, setControlTokenInput] = useState("");
  const profilesQuery = useQuery(subscriptionQueries.list());
  const profileId = selectedId ?? profilesQuery.data?.[0]?.id;
  const detailQuery = useQuery({
    ...subscriptionQueries.detail(profileId ?? ""),
    enabled: Boolean(profileId),
  });

  function showNotice(message: string, tone: "error" | "success" = "success") {
    setNotice({ message, tone });
  }

  const createMutation = useMutation({
    mutationFn: createSubscriptionProfile,
    onSuccess: async (profile) => {
      setSelectedId(profile.id);
      await queryClient.invalidateQueries({ queryKey: subscriptionQueries.all });
      showNotice("方案已创建");
    },
    onError: (error) => showNotice(subscriptionErrorText(error), "error"),
  });

  const refreshMutation = useMutation({
    mutationFn: refreshSubscriptionProfile,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: subscriptionQueries.all }),
        queryClient.invalidateQueries({
          queryKey: subscriptionQueries.detail(profileId ?? "").queryKey,
        }),
      ]);
      showNotice("所有客户端配置已更新");
    },
    onError: (error) => showNotice(subscriptionErrorText(error), "error"),
  });

  const authError = profilesQuery.error instanceof SubscriptionApiError
    && profilesQuery.error.status === 401;
  const profile = detailQuery.data;

  function unlockControl(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!controlToken.trim()) {
      return;
    }
    setControlToken(controlToken);
    void profilesQuery.refetch();
  }

  return (
    <div className="control-shell">
      <ControlHeader />
      {notice ? (
        <div className={`control-notice is-${notice.tone}`} role="status">
          <span>{notice.message}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="关闭提示">
            <X aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {authError ? (
        <main className="control-gate">
          <h1>进入订阅管理</h1>
          <form className="control-token-form" onSubmit={unlockControl}>
            <label htmlFor="control-token">管理令牌</label>
            <input
              id="control-token"
              type="password"
              value={controlToken}
              onChange={(event) => setControlTokenInput(event.target.value)}
              autoComplete="current-password"
            />
            <button className="button button-primary" type="submit" disabled={!controlToken.trim()}>
              进入
            </button>
          </form>
        </main>
      ) : profilesQuery.isLoading ? (
        <main className="control-loading">正在读取订阅方案</main>
      ) : profilesQuery.isError ? (
        <main className="control-gate">
          <h1>管理页暂时不可用</h1>
          <p>{subscriptionErrorText(profilesQuery.error)}</p>
        </main>
      ) : (
        <main className="control-layout">
          <ProfileRail
            profiles={profilesQuery.data ?? []}
            activeId={profileId}
            creating={createMutation.isPending}
            onSelect={setSelectedId}
            onCreate={(name) => createMutation.mutate(name)}
          />

          <div className="control-main">
            {profile ? (
              <>
                <header className="profile-heading">
                  <div>
                    <h1>{profile.name}</h1>
                    <p>{formatRefreshTime(profile.latestRefresh?.finishedAt ?? null)}</p>
                  </div>
                  <button
                    className="button button-primary"
                    type="button"
                    disabled={refreshMutation.isPending || profile.sources.length === 0}
                    onClick={() => refreshMutation.mutate(profile.id)}
                  >
                    <ArrowClockwise aria-hidden="true" />
                    {refreshMutation.isPending ? "正在刷新" : "刷新全部格式"}
                  </button>
                </header>

                <ol className="conversion-line" aria-label="订阅生成状态">
                  <li className={profile.sources.length > 0 ? "is-ready" : ""}>
                    <span className="conversion-node" />
                    <strong>订阅来源</strong>
                    <small>{profile.sources.length || "—"}</small>
                  </li>
                  <li className={(profile.latestRefresh?.nodeCount ?? 0) > 0 ? "is-ready" : ""}>
                    <span className="conversion-node" />
                    <strong>有效节点</strong>
                    <small>{profile.latestRefresh?.nodeCount ?? "—"}</small>
                  </li>
                  <li className={profile.outputs.length > 0 ? "is-ready" : ""}>
                    <span className="conversion-node" />
                    <strong>客户端格式</strong>
                    <small>{profile.outputs.length || "—"}</small>
                  </li>
                  <li className={profile.links.some((link) => link.enabled) ? "is-ready" : ""}>
                    <span className="conversion-node" />
                    <strong>固定链接</strong>
                    <small>{profile.links.filter((link) => link.enabled).length || "—"}</small>
                  </li>
                </ol>

                {profile.latestRefresh?.status === "succeeded" ? (
                  <p className="refresh-result">
                    <CheckCircle aria-hidden="true" />
                    {profile.latestRefresh.nodeCount} 个节点，{profile.latestRefresh.targetCount} 种格式
                  </p>
                ) : null}

                <SourcePanel profileId={profile.id} sources={profile.sources} onNotice={showNotice} />
                <LinkPanel profile={profile} onNotice={showNotice} />
              </>
            ) : detailQuery.isLoading ? (
              <div className="control-loading">正在读取方案</div>
            ) : profilesQuery.data?.length === 0 ? (
              <div className="control-empty-state">
                <h1>创建第一个订阅方案</h1>
                <p>左侧填写名称后创建。</p>
              </div>
            ) : (
              <div className="control-empty-state">
                <h1>方案无法打开</h1>
                <p>{subscriptionErrorText(detailQuery.error)}</p>
              </div>
            )}
          </div>
        </main>
      )}
    </div>
  );
}
