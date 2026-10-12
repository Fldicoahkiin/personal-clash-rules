import { ArrowRight, Copy, DownloadSimple, LockKey } from "@phosphor-icons/react";
import { type FC, type FormEvent, useReducer } from "react";
import { defaultDnsSettings } from "../../config/dns-settings";
import { SubscriptionApiError, subscriptionErrorText, type OutputTarget } from "../features/subscriptions/api";
import { requestCloudRola, saveRolaManagement, type RolaCloudResult, type RolaExitDraft, type RolaManagement, type RolaPreview } from "../features/subscriptions/rola-api";
import { parseSubscriptionInput } from "../lib/subscription-input";
import styles from "./RolaSubscription.module.css";

type State = {
  source: string; sourceMode: "convert" | "snapshot"; snapshot: string; filename: string;
  name: string; target: OutputTarget; userAgent: string; preview: RolaPreview | null; upstream: string;
  connectionMode: "chain" | "direct"; groupName: string;
  exit: RolaExitDraft; rules: string; dns: string; busy: string; error: string; notice: string;
  result: RolaCloudResult | null; management: RolaManagement | null;
};
const initial: State = {
  source: "", sourceMode: "convert", snapshot: "", filename: "", name: "Flacier-Rola", target: "clash-party-config", userAgent: "clash.meta", preview: null, upstream: "",
  connectionMode: "chain", groupName: "家宽出口",
  exit: { authMode: "literal", name: "Rola", protocol: "socks5", server: "", port: 9004, account: "", password: "", country: "", sessionId: "main", sessionMinutes: 120 },
  rules: ["anthropic.com", "claude.ai", "claude.com", "clau.de", "claudemcpclient.com", "claudeusercontent.com", "openai.com", "chatgpt.com", "oaistatic.com", "oaiusercontent.com", "github.com", "githubusercontent.com", "githubassets.com"].map(host => `DOMAIN-SUFFIX,${host}`).join("\n"),
  dns: defaultDnsSettings.nameservers.join("\n"), busy: "", error: "", notice: "", result: null, management: null,
};
const lines = (value: string) => value.split(/\r?\n/u).map(line => line.trim()).filter(line => line && !line.startsWith("#"));
const targets: Array<[OutputTarget, string]> = [["clash-party-config", "Clash Party"], ["clash-verge-config", "Clash Verge"], ["flclash-config", "FlClash"], ["mihomo-config", "Mihomo"]];
function failure(error: unknown) {
  if (error instanceof SubscriptionApiError) {
    if (error.code === "source_response_too_large") return "机场原始响应超过 1 MiB，请减少来源中的节点或规则。";
    if (error.code === "request_too_large") return "提交的请求超过 512 KiB；上传快照最多 256 KiB。";
    return subscriptionErrorText(error);
  }
  return error instanceof Error ? error.message : "操作失败，当前代理未改变。";
}

export const RolaCloudSubscription: FC = () => {
  const [state, patch] = useReducer((current: State, next: Partial<State>) => ({ ...current, ...next }), initial);
  function change(next: Partial<State>) { patch({ ...next, result: null, error: "", notice: "" }); }
  function sourceChange(next: Partial<State>) { change({ ...next, preview: null, upstream: "" }); }
  function editExit(next: Partial<RolaExitDraft>) { change({ exit: { ...state.exit, ...next } }); }
  async function run(busy: string, work: () => Promise<void>) {
    patch({ busy, error: "", notice: "" });
    try { await work(); } catch (error) { patch({ error: failure(error) }); }
    finally { patch({ busy: "" }); }
  }
  async function readNodes() {
    patch({ preview: null, upstream: "", result: null });
    await run("preview", async () => {
      if (state.sourceMode === "snapshot" && !state.snapshot) throw new Error("请选择未叠加家宽的完整配置文件。");
      const preview = await requestCloudRola<RolaPreview>("/preview", { target: state.target, name: state.name, sourceUserAgent: state.userAgent,
        ...(state.sourceMode === "snapshot" ? { snapshot: state.snapshot } : { sources: parseSubscriptionInput(state.source) }) });
      patch({ preview });
    });
  }
  async function generate(event: FormEvent) {
    event.preventDefault();
    patch({ result: null });
    await run("generate", async () => {
      if (!state.preview || (state.connectionMode === "chain" && !state.upstream)) throw new Error("请先读取基础订阅；机场串联模式还需选择前置节点。");
      const result = await requestCloudRola<RolaCloudResult>("/chains", { baseId: state.preview.baseId, connectionMode: state.connectionMode, groupName: state.groupName, upstreamNode: state.upstream,
        exit: state.exit, rules: lines(state.rules), dns: lines(state.dns) });
      patch({ result, management: { url: result.url, revokeToken: result.revokeToken } });
    });
  }
  async function upload(file: File | undefined, management = false) {
    if (!file) return;
    if (!management) sourceChange({ snapshot: "", filename: "" });
    await run("file", async () => {
      if (file.size > (management ? 4096 : 256 * 1024)) throw new Error(management ? "管理文件不能超过 4 KiB。" : "配置文件不能超过 256 KiB。");
      const content = await file.text();
      if (!management) { sourceChange({ snapshot: content, filename: file.name }); return; }
      const value: unknown = JSON.parse(content);
      if (!value || typeof value !== "object" || !("url" in value) || !("revokeToken" in value) || typeof value.url !== "string" || typeof value.revokeToken !== "string") throw new Error("管理文件无效。");
      patch({ management: { url: value.url, revokeToken: value.revokeToken }, notice: "管理文件已载入，尚未删除订阅。" });
    });
  }
  async function revoke() {
    if (!state.management || !window.confirm("删除这条云端串联订阅？客户端已下载的文件不会被删除；跨地区生效可能有延迟。")) return;
    await run("revoke", async () => {
      await requestCloudRola("/revoke", state.management);
      patch({ result: state.result?.url === state.management?.url ? null : state.result, management: null, notice: "已提交删除。KV 跨地区生效可能有延迟；若链接泄漏，请同时更换供应商密码。" });
    });
  }
  return <div className={styles.workspace}>
    <div className={styles.privacy}><LockKey size={22} aria-hidden="true" /><div><strong>云端家宽订阅</strong><p>机场来源和 Rola 账号密码会通过 HTTPS 提交到本站 Cloudflare，保存 90 天。CF 直接读取不需要本地服务；本地同步来源的更新仍依赖电脑。生成链接不会导入或切换当前代理。</p><p>链接持有者可以读取完整节点凭据，请勿公开分享。预览草稿保留 1 小时；生成后请保存管理文件，以便删除云端订阅。</p></div></div>
    <form onSubmit={generate}><fieldset className={styles.fields} disabled={Boolean(state.busy)}>
      <section className={styles.step} aria-labelledby="cloud-airport-title"><h2 id="cloud-airport-title">1. 读取基础订阅</h2>
        <label className="field"><span>家宽接入方式</span><select value={state.connectionMode} onChange={event => change({ connectionMode: event.target.value as State["connectionMode"], upstream: "" })}><option value="chain">机场前置 → 家宽</option><option value="direct">直接接入家宽（不经过机场）</option></select></label>
        <p className={styles.note}>{state.connectionMode === "direct" ? "设备直接连接家宽网关，不是直接访问目标网站。普通 SOCKS5／HTTP 不加密代理账号、密码和目标地址；网站 HTTPS 仍独立加密。仅在了解这一差异并已验通时选择，不会由串联失败自动切换。" : "选择一个已验通的加密机场作为前置。串联连接失败不会自动改为直接接入家宽。"}</p>
        <label className="field"><span>机场来源方式</span><select value={state.sourceMode} onChange={event => sourceChange({ sourceMode: event.target.value as State["sourceMode"] })}><option value="convert">CF 读取订阅／节点链接（默认）</option><option value="snapshot">上传完整配置快照（不自动更新机场）</option></select></label>
        {state.sourceMode === "convert" ? <label className="field"><span>机场订阅或节点链接</span><textarea rows={4} value={state.source} onChange={event => sourceChange({ source: event.target.value })} autoComplete="off" spellCheck={false} placeholder="每行一个来源，最多 3 个；不要在这里填家宽凭据" /></label> : <>
          <label className="field"><span>未叠加 Rola 的完整 Mihomo 配置</span><input type="file" accept=".yaml,.yml" onChange={event => void upload(event.target.files?.[0])} /></label><p className={styles.note}>{state.filename || "尚未选择文件"} · 最多 256 KiB。仅保存上传时的节点、DNS 和规则；不会刷新机场节点或用量，也不会伪造流量响应头。节点变动后需上传新快照。</p>
        </>}
        {state.sourceMode === "convert" ? <p className={styles.note}>也可填写「本地读取，云端分发」生成的本站链接。多个来源请先在普通转换中合并并同步，再将那一个链接填在这里；不用让 CF 重新请求机场。</p> : null}
        <div className={styles.grid}><label className="field"><span>输出客户端</span><select value={state.target} onChange={event => sourceChange({ target: event.target.value as OutputTarget })}>{targets.map(([target, label]) => <option key={target} value={target}>{label}</option>)}</select></label><label className="field"><span>订阅名称</span><input value={state.name} onChange={event => sourceChange({ name: event.target.value })} maxLength={64} /></label></div>
        <details className={styles.help}><summary>请求 UA 与资源限制</summary><label className="field"><span>订阅请求 UA</span><input value={state.userAgent} onChange={event => sourceChange({ userAgent: event.target.value })} list="cloud-rola-ua" /><datalist id="cloud-rola-ua"><option value="clash.meta" /><option value="mihomo/1.19" /><option value="ClashForAndroid/2.5.12" /></datalist></label><p>最多 3 个来源、500 个机场节点；单个机场原始响应最多 1 MiB，上传快照或转换后的基础配置最多 256 KiB。每次来源读取限时 20 秒。若机场拒绝请求，生成会停止并显示可用的请求编号，不切换第三方后端或输出空节点。</p></details>
        <button className="button" type="button" onClick={() => void readNodes()}>{state.busy === "preview" ? "正在读取" : state.sourceMode === "snapshot" ? "上传并读取节点" : "读取机场节点"}</button>
        {state.preview ? <>{state.connectionMode === "chain" ? <label className="field"><span>前置机场节点</span><select value={state.upstream} onChange={event => change({ upstream: event.target.value })}><option value="">请选择一个加密节点</option>{state.preview.nodes.map(node => <option key={node.name} value={node.name} disabled={!node.selectable}>{node.name} · {node.type}{node.selectable ? "" : " · 不可串联"}</option>)}</select></label> : null}<p className={styles.note}>读取 {state.preview.result.nodeStats.read} 个 · 输出 {state.preview.result.nodeStats.output} 个 · 跳过不兼容节点 {state.preview.result.nodeStats.skipped} 个。{state.preview.result.usage.combined ? "已读取机场用量，订阅刷新时继续继承；Rola 额度独立计费，不相加。" : "未取得可更新的机场用量，不伪造额度。"}</p></> : null}
        {state.preview?.sourceMode === "local-sync" ? <p className={styles.note}>来源是本地同步记录，不是 CF 对机场的实时读取；节点和用量以最近一次本地同步为准。</p> : null}
      </section>
      <section className={styles.step} aria-labelledby="cloud-exit-title"><h2 id="cloud-exit-title">2. 设置 Rola 出口</h2>
        <div className={styles.grid}>
          <label className="field"><span>家宽分组名称</span><input value={state.groupName} maxLength={64} onChange={event => change({ groupName: event.target.value })} /></label>
          <label className="field"><span>家宽节点备注</span><input value={state.exit.name} maxLength={64} onChange={event => editExit({ name: event.target.value })} /></label>
          <label className="field"><span>账号格式</span><select value={state.exit.authMode} onChange={event => editExit({ authMode: event.target.value as "literal" | "dynamic", country: event.target.value === "dynamic" ? "us" : "" })}><option value="literal">现成节点 · 用户名原样使用</option><option value="dynamic">动态住宅 · 拼接国家与会话</option></select></label>
          <label className="field"><span>代理协议</span><select value={state.exit.protocol} onChange={event => editExit({ protocol: event.target.value as "socks5" | "http" })}><option value="socks5">SOCKS5</option><option value="http">HTTP</option></select></label>
          <label className="field"><span>家宽网关地址</span><input value={state.exit.server} onChange={event => editExit({ server: event.target.value.trim() })} autoComplete="off" placeholder="IP 或域名，不带协议" /></label>
          <label className="field"><span>家宽端口</span><input type="number" min={1} max={65535} value={state.exit.port} onChange={event => editExit({ port: Number(event.target.value) })} /></label>
          <label className="field"><span>家宽账号</span><input type="password" value={state.exit.account} onChange={event => editExit({ account: event.target.value })} autoComplete="off" spellCheck={false} /></label>
          <label className="field"><span>家宽密码</span><input type="password" value={state.exit.password} onChange={event => editExit({ password: event.target.value })} autoComplete="new-password" /></label>
          <label className="field"><span>国家代码{state.exit.authMode === "literal" ? "（可留空，仅标签）" : ""}</span><input value={state.exit.country} maxLength={2} onChange={event => editExit({ country: event.target.value.toLowerCase() })} placeholder="us / jp / sg" /></label>
          {state.exit.authMode === "dynamic" ? <><label className="field"><span>会话标识</span><input value={state.exit.sessionId} maxLength={32} onChange={event => editExit({ sessionId: event.target.value })} /></label><label className="field"><span>会话保持分钟数</span><input type="number" min={1} max={120} value={state.exit.sessionMinutes} onChange={event => editExit({ sessionMinutes: Number(event.target.value) })} /></label></> : null}
        </div><p className={styles.note}>现成节点不会追加用户名后缀；动态会话不代表固定或独享 IP。账号密码不存浏览器本地存储，点击生成时上传 CF。生成只验证配置，不证明供应商网关可以连接。</p>
      </section>
      <section className={styles.step} aria-labelledby="cloud-rules-title"><h2 id="cloud-rules-title">3. 编辑经家宽的域名规则</h2>
        <label className="field"><span>家宽分流规则</span><textarea rows={8} className={styles.rules} value={state.rules} onChange={event => change({ rules: event.target.value })} spellCheck={false} /></label>
        <p className={styles.note}>每行 <code>DOMAIN,api.example.com</code> 或 <code>DOMAIN-SUFFIX,example.com</code>，最多 500 条。这些域名只经 Rola，不自动改走直连；其他流量遵循基础配置规则。</p>
        <details className={styles.help}><summary>DNS 与连接边界</summary><label className="field"><span>经家宽的 DoH（每行一个 IP 地址 HTTPS URL）</span><textarea rows={3} value={state.dns} onChange={event => change({ dns: event.target.value })} spellCheck={false} /></label><p>匹配域名经 Rola 解析，节点网关使用独立引导 DNS；生成文件关闭 IPv6，匹配域名的 UDP 被拒绝以便应用尝试 TCP。机场到 SOCKS5／HTTP 网关这一段不视为加密，请使用 HTTPS 访问目标。</p><p>Shadowrocket 的代理串联需要单独适配。这里输出的 Mihomo 配置不会自动调整设备的 DNS 覆写、TUN 或 PAC。</p></details>
      </section>
      <div className={styles.chain}><span>{state.connectionMode === "direct" ? "设备（不经机场）" : state.upstream || "前置机场节点"}</span><ArrowRight aria-hidden="true" /><span>Rola 家宽</span><ArrowRight aria-hidden="true" /><span>匹配域名</span></div>
      <button className="button button-primary" type="submit" disabled={!state.preview || (state.connectionMode === "chain" && !state.upstream) || !state.exit.account || !state.exit.password}>{state.busy === "generate" ? "正在生成" : "上传到 CF 并生成家宽订阅"}</button>
    </fieldset></form>
    {state.error ? <p role="alert" className="field-error">{state.error}</p> : null}
    {state.notice ? <p role="status">{state.notice}</p> : null}
    {state.result ? <section className={styles.result} aria-label="云端家宽生成结果"><h2>云端家宽订阅已生成，尚未导入</h2><p>{state.result.summary.connectionMode === "direct" ? "直接接入家宽" : "机场前置串联"} · {state.result.summary.groupName} · {state.result.summary.inlineNodes} 个节点 · {state.result.summary.protectedRules} 条家宽规则 · {state.result.summary.country}</p><code>{state.result.url}</code><div className={styles.actions}>
      <button className="button" type="button" onClick={() => { void navigator.clipboard.writeText(state.result!.url).then(() => patch({ notice: "链接已复制，尚未导入。" }), () => patch({ error: "剪贴板不可用，请手动复制。" })); }}><Copy aria-hidden="true" />复制云端订阅链接</button><a className="button" href={state.result.url} download referrerPolicy="no-referrer"><DownloadSimple aria-hidden="true" />下载候选配置</a><button className="button" type="button" onClick={() => saveRolaManagement(state.result!)}><DownloadSimple aria-hidden="true" />保存管理文件</button>
    </div><p>{state.result.sourceMode === "snapshot" ? "固定配置快照：不会自动刷新机场节点和用量。" : state.result.sourceMode === "local-sync" ? "继承本地同步的节点和用量。电脑离线或读取失败时保留旧内容并标记同步过期；所选前置节点消失或不安全时拒绝更新，不改为直连。" : "客户端每 6 小时请求更新；来源失败时最多回用 24 小时内的有效结果，用量也可能滞后。所选前置节点消失或不安全时拒绝更新，不改为直连。"} 云端记录保存至 {new Date(state.result.expiresAt).toLocaleString("zh-CN")}，不是机场或家宽套餐的到期时间。</p><p>请先测试再导入。修改后生成新链接，不会影响旧链接；管理文件包含订阅链接与删除码，也请保密。</p></section> : null}
    <details className={styles.help}><summary>删除云端订阅</summary><label className="field"><span>载入之前保存的管理文件</span><input type="file" accept=".json" disabled={Boolean(state.busy)} onChange={event => void upload(event.target.files?.[0], true)} /></label>{state.management ? <><p>将删除：<code>{state.management.url}</code></p><button className="button" type="button" disabled={Boolean(state.busy)} onClick={() => void revoke()}>删除此云端订阅</button></> : <p>本页新生成的订阅可直接删除；刷新页面后请载入管理文件。删除不会清除客户端已下载的文件。</p>}</details>
  </div>;
};
