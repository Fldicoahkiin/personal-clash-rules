import { ArrowUpRight, Check, Copy, FileCode, LinkSimple, Prohibit } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { FC, FormEvent } from "react";
import { useState } from "react";

import { buildClientAction } from "../../lib/client-import";
import {
  createSubscriptionLink,
  revokeSubscriptionLink,
  subscriptionErrorText,
  subscriptionQueries,
  type ProfileDetail,
} from "./api";
import {
  completeConfigFormats,
  nodeResourceFormats,
  secondaryFormats,
  type ClientFormat,
} from "./client-formats";

type LinkPanelProps = {
  profile: ProfileDetail;
  onNotice: (message: string, tone?: "error" | "success") => void;
};

type FormatRowProps = {
  format: ClientFormat;
  url: string | undefined;
  profileName: string;
  copied: string | null;
  onCopy: (target: string, url: string) => void;
};

const FormatRow: FC<FormatRowProps> = ({ format, url, profileName, copied, onCopy }) => {
  const action = url && format.clientId
    ? buildClientAction(format.clientId, url, profileName)
    : null;
  const isCopied = copied === format.target;
  const CopyIcon = !url ? Prohibit : isCopied ? Check : Copy;
  const copyLabel = !url ? "未生成" : isCopied ? "已复制" : "复制";
  return (
    <div className="format-row">
      {format.icon
        ? <img src={format.icon} alt="" width="24" height="24" />
        : <FileCode aria-hidden="true" />}
      <strong>{format.name}</strong>
      <button
        type="button"
        disabled={!url}
        onClick={() => url && onCopy(format.target, url)}
      >
        <CopyIcon aria-hidden="true" />
        {copyLabel}
      </button>
      {action?.kind === "link" ? (
        <a href={action.value} aria-label={`打开 ${format.name}`}>
          <ArrowUpRight aria-hidden="true" />
        </a>
      ) : null}
    </div>
  );
};

export const LinkPanel: FC<LinkPanelProps> = ({ profile, onNotice }) => {
  const queryClient = useQueryClient();
  const activeLinks = profile.links.filter((link) => link.enabled && link.urls);
  const [activeLinkId, setActiveLinkId] = useState<string | null>(null);
  const [linkName, setLinkName] = useState("默认链接");
  const [copied, setCopied] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const activeLink = activeLinks.find((link) => link.id === activeLinkId) ?? activeLinks[0];
  const universalUrl = activeLink?.universalUrl;
  const availableTargets = new Set(profile.outputs.map((output) => output.target));

  async function refreshQueries() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: subscriptionQueries.all }),
      queryClient.invalidateQueries({ queryKey: subscriptionQueries.detail(profile.id).queryKey }),
    ]);
  }

  const createMutation = useMutation({
    mutationFn: () => createSubscriptionLink(profile.id, linkName),
    onSuccess: async () => {
      await refreshQueries();
      onNotice("固定链接已创建", "success");
    },
    onError: (error) => onNotice(subscriptionErrorText(error), "error"),
  });
  const revokeMutation = useMutation({
    mutationFn: (linkId: string) => revokeSubscriptionLink(linkId),
    onSuccess: async () => {
      setConfirmRevoke(false);
      setActiveLinkId(null);
      await refreshQueries();
      onNotice("固定链接已停用", "success");
    },
    onError: (error) => onNotice(subscriptionErrorText(error), "error"),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (linkName.trim()) {
      createMutation.mutate();
    }
  }

  async function copyUrl(target: string, url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(target);
      window.setTimeout(() => setCopied(null), 1400);
    } catch {
      onNotice("无法复制，请手动选择链接", "error");
    }
  }

  return (
    <section className="control-section" aria-labelledby="links-title">
      <header className="control-section-title link-section-title">
        <div>
          <h2 id="links-title">订阅链接</h2>
          <p>刷新后地址不变。</p>
        </div>
        {activeLinks.length > 1 ? (
          <label className="compact-select">
            <span>固定链接</span>
            <select
              value={activeLink?.id ?? ""}
              onChange={(event) => setActiveLinkId(event.target.value)}
            >
              {activeLinks.map((link) => (
                <option key={link.id} value={link.id}>{link.name}</option>
              ))}
            </select>
          </label>
        ) : null}
      </header>

      {activeLink?.urls ? (
        <>
          {universalUrl ? (
            <div className="universal-link-row">
              <div className="universal-link-label">
                <LinkSimple aria-hidden="true" />
                <span>
                  <strong>通用节点链接</strong>
                  <small>自动识别客户端</small>
                </span>
              </div>
              <code title={universalUrl}>{universalUrl}</code>
              <button
                className="button button-secondary universal-link-copy"
                type="button"
                aria-label={copied === "universal"
                  ? "通用链接已复制"
                  : "复制通用链接"}
                onClick={() => void copyUrl("universal", universalUrl)}
              >
                {copied === "universal" ? (
                  <Check aria-hidden="true" />
                ) : (
                  <Copy aria-hidden="true" />
                )}
                {copied === "universal" ? "已复制" : "复制"}
              </button>
            </div>
          ) : null}
          <div className="format-block">
            <div className="format-block-title">
              <h3>完整配置</h3>
              <span>节点 · 策略组 · 规则</span>
            </div>
            <div className="format-grid config-format-grid">
              {completeConfigFormats.map((format) => (
                <FormatRow
                  key={format.target}
                  format={format}
                  url={availableTargets.has(format.target)
                    ? activeLink.urls?.[format.target]
                    : undefined}
                  profileName={profile.name}
                  copied={copied}
                  onCopy={(target, url) => void copyUrl(target, url)}
                />
              ))}
            </div>
          </div>
          <div className="format-block">
            <div className="format-block-title">
              <h3>节点资源</h3>
              <span>只含节点</span>
            </div>
            <div className="format-grid">
              {nodeResourceFormats.map((format) => (
                <FormatRow
                  key={format.target}
                  format={format}
                  url={availableTargets.has(format.target)
                    ? activeLink.urls?.[format.target]
                    : undefined}
                  profileName={profile.name}
                  copied={copied}
                  onCopy={(target, url) => void copyUrl(target, url)}
                />
              ))}
            </div>
          </div>
          <details className="secondary-formats">
            <summary>其他节点格式</summary>
            <div>
              {secondaryFormats.map((format) => (
                <FormatRow
                  key={format.target}
                  format={format}
                  url={availableTargets.has(format.target)
                    ? activeLink.urls?.[format.target]
                    : undefined}
                  profileName={profile.name}
                  copied={copied}
                  onCopy={(target, url) => void copyUrl(target, url)}
                />
              ))}
            </div>
          </details>
          <button
            className={confirmRevoke ? "link-revoke is-confirming" : "link-revoke"}
            type="button"
            disabled={revokeMutation.isPending}
            onClick={() => {
              if (confirmRevoke) {
                revokeMutation.mutate(activeLink.id);
              } else {
                setConfirmRevoke(true);
              }
            }}
          >
            <Prohibit aria-hidden="true" />
            {confirmRevoke ? "确认停用这个链接" : "停用这个链接"}
          </button>
        </>
      ) : (
        <div className="link-empty">
          <LinkSimple aria-hidden="true" />
          <p>还没有固定链接。</p>
        </div>
      )}

      <form className="link-create" onSubmit={submit}>
        <label className="field">
          <span>链接名称</span>
          <input
            value={linkName}
            onChange={(event) => setLinkName(event.target.value)}
            maxLength={80}
          />
        </label>
        <button
          className="button button-secondary"
          type="submit"
          disabled={createMutation.isPending || !linkName.trim()}
        >
          {createMutation.isPending ? "正在创建" : "新建固定链接"}
        </button>
      </form>
    </section>
  );
};
