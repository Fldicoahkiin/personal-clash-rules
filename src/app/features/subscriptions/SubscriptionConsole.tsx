import { CheckCircle, WarningCircle, X } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";

import {
  createSubscriptionProfile,
  clearControlToken,
  removeSubscriptionProfile,
  renameSubscriptionProfile,
  refreshSubscriptionProfile,
  setControlToken,
  SubscriptionApiError,
  subscriptionErrorText,
  subscriptionQueries,
} from "./api";
import { ControlHeader } from "./ControlHeader";
import { LinkPanel } from "./LinkPanel";
import { ProfileHeader } from "./ProfileHeader";
import { ProfileRail } from "./ProfileRail";
import { RefreshHistory } from "./RefreshHistory";
import { RuntimeStatusLine } from "./RuntimeStatusLine";
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
  const sessionQuery = useQuery(subscriptionQueries.session());
  const authenticated = sessionQuery.data?.authenticated === true;
  const profilesQuery = useQuery({
    ...subscriptionQueries.list(),
    enabled: authenticated,
  });
  const statusQuery = useQuery({
    ...subscriptionQueries.status(),
    enabled: authenticated,
  });
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
    onSuccess: async (refresh) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: subscriptionQueries.all }),
        queryClient.invalidateQueries({
          queryKey: subscriptionQueries.detail(profileId ?? "").queryKey,
        }),
      ]);
      showNotice(refresh.unavailableTargets.length > 0
        ? `已更新 ${refresh.targetCount} 个输出，${refresh.unavailableTargets.length} 个未生成`
        : "所有输出已更新");
    },
    onError: (error) => showNotice(subscriptionErrorText(error), "error"),
  });

  const renameMutation = useMutation({
    mutationFn: ({ profileId, name }: { profileId: string; name: string }) => (
      renameSubscriptionProfile(profileId, name)
    ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: subscriptionQueries.all });
      showNotice("方案已改名");
    },
    onError: (error) => showNotice(subscriptionErrorText(error), "error"),
  });

  const deleteMutation = useMutation({
    mutationFn: removeSubscriptionProfile,
    onSuccess: async () => {
      setSelectedId(null);
      await queryClient.invalidateQueries({ queryKey: subscriptionQueries.all });
      showNotice("方案已删除");
    },
    onError: (error) => showNotice(subscriptionErrorText(error), "error"),
  });

  const authError = profilesQuery.error instanceof SubscriptionApiError
    && profilesQuery.error.status === 401;
  const profile = detailQuery.data;

  async function unlockControl(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!controlToken.trim()) {
      return;
    }
    setControlToken(controlToken);
    const result = await sessionQuery.refetch();
    if (result.error) {
      showNotice(subscriptionErrorText(result.error), "error");
      return;
    }
    if (!result.data?.authenticated) {
      clearControlToken();
      showNotice("管理令牌不正确", "error");
      return;
    }
    setNotice(null);
    setControlTokenInput("");
    await profilesQuery.refetch();
  }

  return (
    <div className="control-shell">
      <ControlHeader
        onExit={authenticated ? () => {
          clearControlToken();
          window.location.reload();
        } : undefined}
      />
      {notice ? (
        <div className={`control-notice is-${notice.tone}`} role="status">
          <span>{notice.message}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="关闭提示">
            <X aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {sessionQuery.isLoading ? (
        <main className="control-loading">正在检查管理权限</main>
      ) : sessionQuery.isError ? (
        <main className="control-gate">
          <h1>管理页暂时不可用</h1>
          <p>{subscriptionErrorText(sessionQuery.error)}</p>
        </main>
      ) : !authenticated || authError ? (
        <main className="control-gate">
          <h1>进入订阅管理</h1>
          <form className="control-token-form" onSubmit={unlockControl}>
            <label htmlFor="control-token">管理令牌</label>
            <input
              id="control-token"
              type="password"
              value={controlToken}
              onChange={(event) => setControlTokenInput(event.target.value)}
              name="control-token"
              autoComplete="off"
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
                <ProfileHeader
                  name={profile.name}
                  refreshTime={formatRefreshTime(profile.latestRefresh?.finishedAt ?? null)}
                  sourceCount={profile.sources.filter((source) => source.enabled).length}
                  refreshing={refreshMutation.isPending}
                  renaming={renameMutation.isPending}
                  deleting={deleteMutation.isPending}
                  onRefresh={() => refreshMutation.mutate(profile.id)}
                  onRename={(name) => renameMutation.mutate({ profileId: profile.id, name })}
                  onDelete={() => deleteMutation.mutate(profile.id)}
                />

                <RuntimeStatusLine
                  failed={statusQuery.isError}
                  loading={statusQuery.isLoading}
                  status={statusQuery.data}
                />

                <ol className="conversion-line" aria-label="订阅生成状态">
                  <li className={profile.sources.some((source) => source.enabled) ? "is-ready" : ""}>
                    <span className="conversion-node" />
                    <strong>启用来源</strong>
                    <small>{profile.sources.filter((source) => source.enabled).length || "—"}</small>
                  </li>
                  <li className={(profile.latestRefresh?.nodeCount ?? 0) > 0 ? "is-ready" : ""}>
                    <span className="conversion-node" />
                    <strong>有效节点</strong>
                    <small>{profile.latestRefresh?.nodeCount ?? "—"}</small>
                  </li>
                  <li className={profile.outputs.length > 0 ? "is-ready" : ""}>
                    <span className="conversion-node" />
                    <strong>生成输出</strong>
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
                    {profile.latestRefresh.nodeCount} 个节点，{profile.latestRefresh.targetCount} 个输出
                  </p>
                ) : null}
                {profile.latestRefresh?.status === "failed" ? (
                  <p className="refresh-result is-error">
                    <WarningCircle aria-hidden="true" />
                    上次刷新失败，请检查订阅来源或转换服务
                  </p>
                ) : null}
                {profile.latestRefresh?.status === "running" ? (
                  <p className="refresh-result is-pending">
                    <WarningCircle aria-hidden="true" />
                    上次刷新未完成，可以重试
                  </p>
                ) : null}

                <RefreshHistory runs={profile.refreshHistory} />

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
