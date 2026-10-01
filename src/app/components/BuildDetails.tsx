import { useEffect, useState } from "react";
import { isVersionInfo, type BuildInfo, type VersionInfo } from "../../config/build-info";

const dateFormat = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});

export function BuildDetails({ build, version, failed = false, retry }: {
  build: BuildInfo;
  version: VersionInfo | null;
  failed?: boolean;
  retry?: () => void;
}) {
  const stale = version && (version.build.commit !== build.commit || version.build.builtAt !== build.builtAt);
  const deployedAt = version?.deployment?.createdAt;
  return (
    <div className="build-details">
      <dl className="build-details-list" aria-label="网站版本">
        <div><dt>构建时间</dt><dd>{build.builtAt
          ? <time dateTime={build.builtAt}>{dateFormat.format(new Date(build.builtAt))}</time>
          : "开发模式"}</dd></div>
        <div><dt title="Cloudflare 版本创建时间，不是流量切换时间">部署版本时间</dt><dd>{deployedAt
          ? <time dateTime={deployedAt}>{dateFormat.format(new Date(deployedAt))}</time>
          : failed ? <>读取失败{retry && <button type="button" onClick={retry}>重试</button>}</>
          : !version ? "读取中…" : version.deployment ? "未提供" : "未部署"}</dd></div>
        <div><dt>提交</dt><dd>{build.commit
          ? <a href={`https://github.com/Fldicoahkiin/personal-clash-rules/commit/${build.commit}`}
              title={build.commit} target="_blank" rel="noreferrer">{build.commit.slice(0, 7)}</a>
          : "未知"}{build.dirty && <span> · 本地修改</span>}</dd></div>
      </dl>
      <span className="build-timezone">UTC+8</span>
      {stale && <p className="build-version-notice" role="status">页面与后端版本不同，请刷新页面。</p>}
    </div>
  );
}

export function SiteVersion({ build }: { build: BuildInfo }) {
  const [version, setVersion] = useState<VersionInfo | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    let disposed = false;
    setFailed(false);
    async function load() {
      try {
        const response = await fetch("/api/version", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Version request failed");
        const data: unknown = await response.json();
        if (!isVersionInfo(data)) throw new Error("Invalid version metadata");
        if (!disposed) setVersion(data);
      } catch {
        if (!disposed) setFailed(true);
      } finally {
        clearTimeout(timeout);
      }
    }
    void load();
    return () => { disposed = true; clearTimeout(timeout); controller.abort(); };
  }, [attempt]);
  return <BuildDetails build={build} version={version} failed={failed} retry={() => setAttempt((value) => value + 1)} />;
}
