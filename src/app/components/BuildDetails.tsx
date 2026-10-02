import { useEffect, useState } from "react";
import { type BuildInfo, type VersionInfo } from "../../config/build-info";
import { fetchSiteVersion, versionFailureText } from "../lib/site-version";

const dateFormat = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});

export function BuildDetails({ build, version, failed = false, failureText = "读取失败", retry }: {
  build: BuildInfo;
  version: VersionInfo | null;
  failed?: boolean;
  failureText?: string;
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
          : failed && !version ? <>{failureText}{retry && <button type="button" onClick={retry}>重试</button>}</>
          : !version ? "读取中…" : version.deployment ? "未提供" : "未部署"}</dd></div>
        <div><dt>提交</dt><dd>{build.commit
          ? <a href={`https://github.com/Fldicoahkiin/personal-clash-rules/commit/${build.commit}`}
              title={build.commit} target="_blank" rel="noreferrer">{build.commit.slice(0, 7)}</a>
          : "未知"}{build.dirty && <span> · 本地修改</span>}</dd></div>
      </dl>
      <span className="build-timezone">UTC+8</span>
      {stale && <p className="build-version-notice" role="status">页面与后端版本不同，请刷新页面。</p>}
      {failed && version && <p className="build-version-notice" role="status">{failureText}，显示上次读取的版本。{retry && <button type="button" onClick={retry}>重试</button>}</p>}
    </div>
  );
}

export function SiteVersion({ build }: { build: BuildInfo }) {
  const [version, setVersion] = useState<VersionInfo | null>(null);
  const [failed, setFailed] = useState(false);
  const [failureText, setFailureText] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    setFailed(false);
    async function load() {
      try {
        const data = await fetchSiteVersion(controller.signal);
        if (!disposed) setVersion(data);
      } catch (error) {
        if (!disposed) { setFailed(true); setFailureText(versionFailureText(error)); }
      }
    }
    void load();
    const online = () => setAttempt(value => value + 1);
    window.addEventListener("online", online);
    return () => { disposed = true; controller.abort(); window.removeEventListener("online", online); };
  }, [attempt]);
  return <BuildDetails build={build} version={version} failed={failed} failureText={failureText} retry={() => setAttempt((value) => value + 1)} />;
}
