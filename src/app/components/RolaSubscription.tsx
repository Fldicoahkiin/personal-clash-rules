import { ArrowRight, Copy, DownloadSimple, LockKey, PlugsConnected } from "@phosphor-icons/react";
import { type FC, type FormEvent, useReducer } from "react";

import { SubscriptionApiError, subscriptionErrorText } from "../features/subscriptions/api";
import { requestRola, rolaLocalOrigin, type RolaExitDraft, type RolaPreview, type RolaResult, type RolaSetup } from "../features/subscriptions/rola-api";
import { parseSubscriptionInput } from "../lib/subscription-input";
import styles from "./RolaSubscription.module.css";

const blankExit: RolaExitDraft = { name: "", protocol: "socks5", server: "", port: 1080, account: "", password: "", country: "us", sessionId: "main", sessionMinutes: 120 };
type State = {
  setup: RolaSetup | null; busy: string; error: string; notice: string;
  source: string; name: string; target: string; userAgent: string; preview: RolaPreview | null;
  upstream: string; exitId: string; draft: RolaExitDraft | null; rules: string; dns: string;
  result: RolaResult | null;
};
const initial: State = { setup: null, busy: "", error: "", notice: "", source: "", name: "Flacier-Rola", target: "clash-party-config", userAgent: "clash.meta", preview: null, upstream: "", exitId: "", draft: null, rules: "", dns: "", result: null };
const lines = (value: string) => value.split(/\r?\n/u).map(line => line.trim()).filter(line => line && !line.startsWith("#"));

export const RolaSubscription: FC = () => {
  const [state, patch] = useReducer((current: State, next: Partial<State>) => ({ ...current, ...next }), initial);
  const origin = rolaLocalOrigin(window.location);
  function change(next: Partial<State>) { patch({ ...next, result: null, error: "", notice: "" }); }
  function sourceChange(next: Partial<State>) { change({ ...next, preview: null, upstream: "" }); }
  function editExit(next: Partial<RolaExitDraft>) { if (state.draft) change({ draft: { ...state.draft, ...next } }); }
  async function run(label: string, work: () => Promise<void>) {
    patch({ busy: label, error: "", notice: "", result: null });
    try { await work(); }
    catch (error) { patch({ error: error instanceof SubscriptionApiError ? subscriptionErrorText(error) : error instanceof Error ? error.message : "本地操作失败。" }); }
    finally { patch({ busy: "" }); }
  }
  async function connect() {
    await run("连接", async () => {
      const setup = await requestRola<RolaSetup>("");
      patch({ setup, rules: state.rules || setup.defaults.rules.join("\n"), dns: state.dns || setup.defaults.dns.join("\n"), notice: "已连接本地服务。尚未连接 Rola，也未修改代理。" });
    });
  }
  async function readNodes() {
    patch({ preview: null, upstream: "" });
    await run("读取节点", async () => {
      if (!state.source.trim()) throw new Error("请先填写机场订阅或节点链接。");
      const preview = await requestRola<RolaPreview>("/preview", {
        sources: parseSubscriptionInput(state.source), name: state.name,
        sourceUserAgent: state.userAgent, target: state.target,
      });
      patch({ preview });
    });
  }
  async function saveExit() {
    await run("保存出口", async () => {
      if (!state.draft || !state.setup) return;
      const exit = await requestRola<RolaSetup["exits"][number]>("/exits", state.draft);
      patch({ setup: { ...state.setup, exits: [...state.setup.exits.filter(item => item.id !== exit.id), exit] }, exitId: exit.id, draft: null, notice: "出口已保存在本机；账号密码输入已清空。已生成的旧订阅不会随之改变。" });
    });
  }
  async function generate(event: FormEvent) {
    event.preventDefault();
    await run("生成订阅", async () => {
      if (!state.preview || !state.upstream || !state.exitId || state.draft) throw new Error("请读取并选择前置节点，再保存或选择 Rola 出口。");
      const result = await requestRola<RolaResult>("/chains", { baseId: state.preview.baseId, target: state.target,
        exitId: state.exitId, upstreamNode: state.upstream, rules: lines(state.rules), dns: lines(state.dns) });
      patch({ result });
    });
  }

  const selectedExit = state.setup?.exits.find(exit => exit.id === state.exitId);
  const selectableCount = state.preview?.nodes.filter(node => node.selectable).length || 0;
  return <div className={styles.workspace}>
    <div className={styles.privacy}>
      <LockKey aria-hidden="true" size={22} />
      <div><strong>Rola 串联 · 凭据只存本机</strong><p>浏览器只向本地后端发送机场来源和 Rola 凭据，不进入 Cloudflare、云端 KV 或浏览器本地存储。生成的是新订阅，不会导入或切换当前代理。</p></div>
    </div>
    <div className={styles.connection}>
      <button className="button" type="button" onClick={() => void connect()} disabled={Boolean(state.busy)}><PlugsConnected aria-hidden="true" />{state.busy === "连接" ? "正在连接" : state.setup ? "重新连接本地服务" : "连接本地服务"}</button>
      <span>{state.setup ? "已连接" : "尚未连接"} · <code>{origin}</code></span>
    </div>
    <details className={styles.help}><summary>本地服务怎么启动？</summary><p>在项目目录先运行 <code>pnpm build</code>，再运行 <code>pnpm start:local</code>。需要经过现有机场代理读取订阅时，加 <code>--proxy http://127.0.0.1:你的混合端口</code>；这只影响转换进程。</p><p>浏览器阻止本地网络访问时，<a href={`${origin}/#subscription`} target="_blank" rel="noreferrer">打开同一网站的本地页面</a>，再选择「机场 → Rola」。不要把本地后端暴露到公网。</p></details>
    {state.setup ? <form onSubmit={generate}>
      <fieldset disabled={Boolean(state.busy)} className={styles.fields}>
        <section className={styles.step} aria-labelledby="rola-airport-title">
          <h2 id="rola-airport-title">1. 选择前置机场节点</h2>
          <label className="field"><span>机场订阅或节点</span><textarea rows={4} value={state.source} onChange={event => sourceChange({ source: event.target.value })} autoComplete="off" spellCheck={false} placeholder="每行一个机场订阅地址或节点链接；不要在这里填 Rola 账号密码" /></label>
          <div className={styles.grid}>
            <label className="field"><span>输出客户端</span><select value={state.target} onChange={event => sourceChange({ target: event.target.value })}><option value="clash-party-config">Clash Party</option><option value="clash-verge-config">Clash Verge</option><option value="flclash-config">FlClash</option><option value="mihomo-config">Mihomo</option></select></label>
            <label className="field"><span>输出名称</span><input value={state.name} maxLength={64} onChange={event => sourceChange({ name: event.target.value })} /></label>
          </div>
          <details className={styles.help}><summary>机场请求设置</summary><label className="field"><span>订阅请求 UA</span><input value={state.userAgent} onChange={event => sourceChange({ userAgent: event.target.value })} list="rola-user-agents" /><datalist id="rola-user-agents"><option value="clash.meta" /><option value="mihomo/1.19" /><option value="ClashForAndroid/2.5.12" /></datalist></label><p>使用 Flacier 分流、独立系统引导 DNS 和代理 DoH；每 6 小时请求更新。不使用客户端直读兜底。</p></details>
          <button type="button" className="button" onClick={() => void readNodes()}>{state.busy === "读取节点" ? "正在读取" : "读取机场节点"}</button>
          {state.preview ? <>
            <label className="field"><span>前置机场节点</span><select value={state.upstream} onChange={event => change({ upstream: event.target.value })}><option value="">请选择一个节点</option>{state.preview.nodes.map(node => <option key={node.name} value={node.name} disabled={!node.selectable}>{node.name} · {node.type}{node.selectable ? "" : " · 不可串联"}</option>)}</select></label>
            <p className={styles.note}>读取 {state.preview.result.nodeStats.read} 个，输出 {state.preview.result.nodeStats.output} 个，其中 {selectableCount} 个可作前置节点。未加密、跳过证书验证或已有代理链的节点不可选。</p>
            <p className={styles.note}>{state.preview.result.usage.combined ? "已读取机场用量，更新订阅时继续继承机场的 Subscription-Userinfo。" : "机场未返回用量响应头，不伪造额度或到期时间。"} Rola 按另一份额度计费，不与机场相加。</p>
          </> : null}
        </section>
        <section className={styles.step} aria-labelledby="rola-exit-title">
          <h2 id="rola-exit-title">2. 选择 Rola 出口</h2>
          <label className="field"><span>本机保存的出口</span><select value={state.exitId} onChange={event => change({ exitId: event.target.value, draft: null })}><option value="">请选择出口</option>{state.setup.exits.map(exit => <option key={exit.id} value={exit.id}>{exit.name} · {exit.country.toUpperCase()} · {exit.sessionMinutes} 分钟</option>)}</select></label>
          <div className={styles.actions}><button className="button" type="button" onClick={() => change({ draft: { ...blankExit } })}>添加 Rola 出口</button>{selectedExit ? <button className="button" type="button" onClick={() => change({ draft: { ...selectedExit, account: "", password: "" } })}>编辑所选出口</button> : null}</div>
          {state.draft ? <div className={styles.editor}>
            <div className={styles.grid}>
              <label className="field"><span>出口名称</span><input value={state.draft.name} onChange={event => editExit({ name: event.target.value })} maxLength={64} /></label>
              <label className="field"><span>Rola 协议</span><select value={state.draft.protocol} onChange={event => editExit({ protocol: event.target.value as "http" | "socks5" })}><option value="socks5">SOCKS5</option><option value="http">HTTP</option></select></label>
              <label className="field"><span>Rola 网关</span><input value={state.draft.server} onChange={event => editExit({ server: event.target.value.trim() })} placeholder="填写控制台给出的网关，不带协议" autoComplete="off" /></label>
              <label className="field"><span>端口</span><input type="number" min={1} max={65535} value={state.draft.port} onChange={event => editExit({ port: Number(event.target.value) })} /></label>
              <label className="field"><span>基础账号{state.draft.id ? "（留空保持）" : ""}</span><input type="password" value={state.draft.account} onChange={event => editExit({ account: event.target.value })} autoComplete="off" spellCheck={false} /></label>
              <label className="field"><span>代理密码{state.draft.id ? "（留空保持）" : ""}</span><input type="password" value={state.draft.password} onChange={event => editExit({ password: event.target.value })} autoComplete="new-password" /></label>
              <label className="field"><span>出口国家代码</span><input value={state.draft.country} onChange={event => editExit({ country: event.target.value.toLowerCase() })} list="rola-countries" maxLength={2} /><datalist id="rola-countries"><option value="us">美国</option><option value="jp">日本</option><option value="sg">新加坡</option><option value="gb">英国</option><option value="de">德国</option></datalist></label>
              <label className="field"><span>会话标识</span><input value={state.draft.sessionId} onChange={event => editExit({ sessionId: event.target.value })} maxLength={32} /></label>
              <label className="field"><span>会话保持分钟数</span><input type="number" min={1} max={120} value={state.draft.sessionMinutes} onChange={event => editExit({ sessionMinutes: Number(event.target.value) })} /></label>
            </div>
            <p className={styles.note}>填动态住宅的基础账号，不带国家或会话后缀。相同会话会尽量保持出口，1–120 分钟，不代表固定或独享 IP。保存不测试 Rola 连通性，也不扣 Rola 测试流量。</p>
            <div className={styles.actions}><button className="button" type="button" onClick={() => void saveExit()}>保存到本机</button><button className="button" type="button" onClick={() => change({ draft: null })}>取消编辑</button></div>
          </div> : null}
        </section>
        <section className={styles.step} aria-labelledby="rola-rules-title">
          <h2 id="rola-rules-title">3. 编辑经 Rola 的分流规则</h2>
          <label className="field"><span>域名规则（每行一条）</span><textarea className={styles.rules} value={state.rules} onChange={event => change({ rules: event.target.value })} rows={8} spellCheck={false} /></label>
          <p className={styles.note}><code>DOMAIN,api.example.com</code> 精确匹配；<code>DOMAIN-SUFFIX,example.com</code> 包含子域名。可用 # 注释。这些规则优先经 Rola，连接失败不直连；未匹配的流量仍按 Flacier 分流。默认包括 OpenAI、Claude 和 GitHub。</p>
          <details className={styles.help}><summary>DNS 与协议边界</summary><label className="field"><span>经 Rola 的 DoH（每行一个 IP 地址 HTTPS URL）</span><textarea value={state.dns} onChange={event => change({ dns: event.target.value })} rows={3} spellCheck={false} /></label><p>匹配域名使用这些 DoH 经 Rola 解析；机场与 Rola 网关由独立引导 DNS 解析，避免循环。生成文件关闭 IPv6，匹配域名的 UDP 被拒绝以便应用尝试 TCP；不覆盖当前客户端开关。</p><p>SOCKS5／HTTP 的机场到 Rola 网关这一段不视为已加密，访问目标仍应使用 HTTPS。DNS 泄漏与实际出口需导入后另行检查，生成成功不等于网络验收通过。</p></details>
        </section>
        <div className={styles.chain}><span>{state.upstream || "前置机场节点"}</span><ArrowRight aria-hidden="true" /><span>{selectedExit?.name || "Rola 出口"}</span><ArrowRight aria-hidden="true" /><span>匹配的域名</span></div>
        <button className="button button-primary" type="submit" disabled={!state.preview || !state.upstream || !state.exitId || Boolean(state.draft)}>{state.busy === "生成订阅" ? "正在生成" : "生成本地串联订阅"}</button>
      </fieldset>
    </form> : null}
    {state.notice ? <p role="status">{state.notice}</p> : null}
    {state.error ? <p className="field-error" role="alert">{state.error}</p> : null}
    {state.result ? <section className={styles.result} aria-live="polite" aria-label="Rola 生成结果">
      <h2>本地串联订阅已生成，尚未导入</h2><p>{state.result.summary.inlineNodes} 个节点 · {state.result.summary.protectedRules} 条 Rola 域名规则 · {state.result.summary.country}</p>
      <code>{state.result.url}</code>
      <div className={styles.actions}><button className="button" type="button" onClick={() => { void navigator.clipboard.writeText(state.result!.url).then(() => patch({ notice: "本地链接已复制。" }), () => patch({ error: "无法写入剪贴板，请手动复制链接。" })); }}><Copy aria-hidden="true" />复制本机订阅链接</button><a className="button" href={state.result.url} download="Flacier-Rola.yaml" referrerPolicy="no-referrer"><DownloadSimple aria-hidden="true" />下载候选配置</a></div>
      <p>链接只能供这台电脑使用，刷新时本地服务需保持运行。iPhone／Android 无法访问这台电脑的 127.0.0.1；可私下传输下载文件，但文件不会自动更新。Shadowrocket 的「代理通过」需要单独配置，不会拿 Mihomo 文件冒充适配。</p>
      <p>文件和链接都应视为敏感信息，下载文件内含节点凭据。保存出口或修改规则后需生成新链接，不会改变旧订阅。</p>
    </section> : null}
  </div>;
};
