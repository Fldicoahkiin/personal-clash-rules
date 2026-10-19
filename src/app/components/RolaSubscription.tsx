import { ArrowRight, Copy, DownloadSimple, LockKey, PlugsConnected } from "@phosphor-icons/react";
import { type FC, type FormEvent, useReducer, useState } from "react";
import { RolaCloudSubscription } from "./RolaCloudSubscription";

import { SubscriptionApiError, subscriptionErrorText, type ConvertedSubscription, type OutputTarget } from "../features/subscriptions/api";
import { additionalRolaExitError, createRolaCloudBase, maxAdditionalRolaExits, requestRola, rolaExitLabel, rolaLocalOrigin, rolaPlatformError, type RolaExitDraft, type RolaPreview, type RolaResult, type RolaSetup } from "../features/subscriptions/rola-api";
import { parseSubscriptionInput } from "../lib/subscription-input";
import styles from "./RolaSubscription.module.css";

const blankExit: RolaExitDraft = { authMode: "literal", name: "", platform: "Rola", protocol: "socks5", server: "", port: 1080, account: "", password: "", country: "", sessionId: "main", sessionMinutes: 120 };
type State = {
  setup: RolaSetup | null; busy: string; error: string; notice: string;
  source: string; name: string; target: OutputTarget; userAgent: string; preview: RolaPreview | null;
  upstream: string; exitId: string; draft: RolaExitDraft | null; rules: string; dns: string;
  additionalExitIds: string[];
  connectionMode: "chain" | "direct"; groupName: string; policyGroup: "" | "AI";
  result: RolaResult | null; cloudBase: ConvertedSubscription | null;
};
const initial: State = { setup: null, busy: "", error: "", notice: "", source: "", name: "Flacier-Rola", target: "clash-party-config", userAgent: "clash.meta", preview: null, upstream: "", exitId: "", additionalExitIds: [], draft: null, rules: "", dns: "", result: null, cloudBase: null, connectionMode: "chain", groupName: "家宽出口", policyGroup: "" };
const lines = (value: string) => value.split(/\r?\n/u).map(line => line.trim()).filter(line => line && !line.startsWith("#"));

export const RolaSubscription: FC = () => {
  const [backend, setBackend] = useState("cloud");
  return <div className={styles.workspace}>
    <label className="field"><span>家宽订阅后端</span><select value={backend} onChange={event => setBackend(event.target.value)}><option value="cloud">Cloudflare 云端（默认）</option><option value="local">本地服务 · 私密覆写</option></select></label>
    {backend === "cloud" ? <RolaCloudSubscription /> : <LocalRolaSubscription />}
  </div>;
};

const LocalRolaSubscription: FC = () => {
  const [state, patch] = useReducer((current: State, next: Partial<State>) => ({ ...current, ...next }), initial);
  const origin = rolaLocalOrigin(window.location);
  function change(next: Partial<State>) { patch({ ...next, result: null, cloudBase: null, error: "", notice: "" }); }
  function sourceChange(next: Partial<State>) { change({ ...next, preview: null, upstream: "" }); }
  function editExit(next: Partial<RolaExitDraft>) { if (state.draft) change({ draft: { ...state.draft, ...next } }); }
  async function run(label: string, work: () => Promise<void>) {
    patch({ busy: label, error: "", notice: "", result: null, cloudBase: null });
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
      const invalidPlatform = rolaPlatformError(state.draft.platform);
      if (invalidPlatform) throw new Error(invalidPlatform);
      const exit = await requestRola<RolaSetup["exits"][number]>("/exits", state.draft);
      patch({ setup: { ...state.setup, exits: [...state.setup.exits.filter(item => item.id !== exit.id), exit] }, exitId: exit.id, additionalExitIds: state.additionalExitIds.filter(id => id !== exit.id), draft: null, notice: "出口已保存在本机；账号密码输入已清空。已生成的旧订阅不会随之改变。" });
    });
  }
  async function generate(event: FormEvent) {
    event.preventDefault();
    await run("生成订阅", async () => {
      if (!state.preview || (state.connectionMode === "chain" && !state.upstream) || !state.exitId || state.draft) throw new Error("请读取基础订阅并保存家宽出口；机场串联还需选择前置节点。");
      const extraError = additionalRolaExitError(state.connectionMode, state.additionalExitIds.length);
      if (extraError) throw new Error(extraError);
      const result = await requestRola<RolaResult>("/chains", { baseId: state.preview.baseId, target: state.target,
        exitId: state.exitId, additionalExitIds: state.additionalExitIds, connectionMode: state.connectionMode, groupName: state.groupName, policyGroup: state.policyGroup, upstreamNode: state.upstream, rules: lines(state.rules), dns: lines(state.dns) });
      patch({ result });
    });
  }
  async function generateCloudBase() {
    patch({ busy: "生成云端基础", error: "", notice: "", cloudBase: null });
    try {
      const cloudBase = await createRolaCloudBase({ sources: parseSubscriptionInput(state.source),
        name: state.name, sourceUserAgent: state.userAgent, target: state.target });
      patch({ cloudBase });
    } catch (error) {
      patch({ error: error instanceof SubscriptionApiError ? subscriptionErrorText(error) : "云端基础订阅生成失败；本地结果仍保留，未切换代理。" });
    } finally { patch({ busy: "" }); }
  }

  const selectedExit = state.setup?.exits.find(exit => exit.id === state.exitId);
  const selectableCount = state.preview?.nodes.filter(node => node.selectable).length || 0;
  const extrasError = additionalRolaExitError(state.connectionMode, state.additionalExitIds.length);
  const platformError = rolaPlatformError(state.draft?.platform);
  return <div className={styles.workspace}>
    <div className={styles.privacy}>
      <LockKey aria-hidden="true" size={22} />
      <div><strong>Rola 家宽 · 凭据只存本机</strong><p>Rola 账号密码只发往本地后端，不进入 Cloudflare、云端 KV 或浏览器本地存储。默认在本机生成；另行点击「生成云端基础订阅」时，仅机场来源发送到 Cloudflare。不会导入或切换当前代理。</p></div>
    </div>
    <div className={styles.connection}>
      <button className="button" type="button" onClick={() => void connect()} disabled={Boolean(state.busy)}><PlugsConnected aria-hidden="true" />{state.busy === "连接" ? "正在连接" : state.setup ? "重新连接本地服务" : "连接本地服务"}</button>
      <span>{state.setup ? "已连接" : "尚未连接"} · <code>{origin}</code></span>
    </div>
    <details className={styles.help}><summary>本地服务怎么启动？</summary><p>在项目目录先运行 <code>pnpm build</code>，再运行 <code>pnpm start:local</code>。需要经过现有机场代理读取订阅时，加 <code>--proxy http://127.0.0.1:你的混合端口</code>；这只影响转换进程。</p><p>浏览器阻止本地网络访问时，<a href={`${origin}/#subscription`} target="_blank" rel="noreferrer">打开同一网站的本地页面</a>，再选择「Rola 家宽出口」。不要把本地后端暴露到公网。</p></details>
    {state.setup ? <form onSubmit={generate}>
      <fieldset disabled={Boolean(state.busy)} className={styles.fields}>
        <section className={styles.step} aria-labelledby="rola-airport-title">
          <h2 id="rola-airport-title">1. 读取基础订阅</h2>
          <label className="field"><span>家宽接入方式</span><select value={state.connectionMode} onChange={event => change({ connectionMode: event.target.value as State["connectionMode"], upstream: "" })}><option value="chain">机场前置 → 家宽</option><option value="direct">直接接入家宽（不经过机场）</option></select></label>
          <p className={styles.note}>{state.connectionMode === "direct" ? "设备直接连接家宽网关，不是直接访问目标网站。普通 SOCKS5／HTTP 不加密代理账号、密码和目标地址；网站 HTTPS 仍独立加密。仅在了解差异并已验通时选择，不会由串联失败自动切换。" : "选择已验通的加密机场作前置，串联失败不会自动改为直接接入家宽。"}</p>
          <label className="field"><span>机场订阅或节点</span><textarea rows={4} value={state.source} onChange={event => sourceChange({ source: event.target.value })} autoComplete="off" spellCheck={false} placeholder="每行一个机场订阅地址或节点链接；不要在这里填 Rola 账号密码" /></label>
          <div className={styles.grid}>
            <label className="field"><span>输出客户端</span><select value={state.target} onChange={event => sourceChange({ target: event.target.value as OutputTarget })}><option value="clash-party-config">Clash Party</option><option value="clash-verge-config">Clash Verge</option><option value="flclash-config">FlClash</option><option value="mihomo-config">Mihomo</option></select></label>
            <label className="field"><span>输出名称</span><input value={state.name} maxLength={64} onChange={event => sourceChange({ name: event.target.value })} /></label>
          </div>
          <details className={styles.help}><summary>机场请求设置</summary><label className="field"><span>订阅请求 UA</span><input value={state.userAgent} onChange={event => sourceChange({ userAgent: event.target.value })} list="rola-user-agents" /><datalist id="rola-user-agents"><option value="clash.meta" /><option value="mihomo/1.19" /><option value="ClashForAndroid/2.5.12" /></datalist></label><p>使用 Flacier 分流、独立系统引导 DNS 和代理 DoH；每 6 小时请求更新。不使用客户端直读兜底。</p></details>
          <button type="button" className="button" onClick={() => void readNodes()}>{state.busy === "读取节点" ? "正在读取" : "读取机场节点"}</button>
          {state.preview ? <>
            {state.connectionMode === "chain" ? <label className="field"><span>前置机场节点</span><select value={state.upstream} onChange={event => change({ upstream: event.target.value })}><option value="">请选择一个节点</option>{state.preview.nodes.map(node => <option key={node.name} value={node.name} disabled={!node.selectable}>{node.name} · {node.type}{node.selectable ? "" : " · 不可串联"}</option>)}</select></label> : null}
            <p className={styles.note}>读取 {state.preview.result.nodeStats.read} 个，输出 {state.preview.result.nodeStats.output} 个，其中 {selectableCount} 个可作前置节点。未加密、跳过证书验证或已有代理链的节点不可选。</p>
            <p className={styles.note}>{state.preview.result.usage.combined ? "已读取机场用量，更新订阅时继续继承机场的 Subscription-Userinfo。" : "机场未返回用量响应头，不伪造额度或到期时间。"} Rola 按另一份额度计费，不与机场相加。</p>
          </> : null}
        </section>
        <section className={styles.step} aria-labelledby="rola-exit-title">
          <h2 id="rola-exit-title">2. 选择 Rola 出口</h2>
          <label className="field"><span>家宽分组名称</span><input value={state.groupName} maxLength={64} onChange={event => change({ groupName: event.target.value })} /></label>
          <label className="field"><span>本机保存的首个出口</span><select value={state.exitId} onChange={event => change({ exitId: event.target.value, additionalExitIds: state.additionalExitIds.filter(id => id !== event.target.value), draft: null })}><option value="">请选择出口</option>{state.setup.exits.map(exit => <option key={exit.id} value={exit.id}>{rolaExitLabel(exit)}</option>)}</select></label>
          <div className={styles.actions}><button className="button" type="button" onClick={() => change({ draft: { ...blankExit } })}>添加 Rola 出口</button>{selectedExit ? <button className="button" type="button" onClick={() => change({ draft: { ...selectedExit, account: "", password: "" } })}>编辑所选出口</button> : null}</div>
          {state.draft ? <div className={styles.editor}>
            <div className={styles.grid}>
              <label className="field"><span>账号格式</span><select value={state.draft.authMode} onChange={event => editExit({ authMode: event.target.value as "literal" | "dynamic", country: event.target.value === "dynamic" ? "us" : "" })}><option value="literal">现成节点 · 用户名原样使用</option><option value="dynamic">Rola 动态住宅 · 拼接国家与会话</option></select></label>
              <label className="field"><span>平台（留空默认 Rola）</span><input value={state.draft.platform ?? "Rola"} maxLength={24} autoComplete="off" spellCheck={false} aria-invalid={Boolean(platformError)} onChange={event => editExit({ platform: event.target.value })} /></label>
              <label className="field"><span>出口 IP（可选）</span><input value={state.draft.exitIp ?? ""} onChange={event => editExit({ exitIp: event.target.value })} maxLength={45} autoComplete="off" spellCheck={false} placeholder="供应商或检测显示的出口 IP" /></label>
              <label className="field"><span>出口区域（与 IP 一起填写）</span><input value={state.draft.region ?? ""} onChange={event => editExit({ region: event.target.value })} maxLength={32} placeholder="例如：美国 Las Vegas" /></label>
              <label className="field"><span>备用备注（未填 IP／区域时使用）</span><input value={state.draft.name} onChange={event => editExit({ name: event.target.value })} maxLength={64} /></label>
              <label className="field"><span>Rola 协议</span><select value={state.draft.protocol} onChange={event => editExit({ protocol: event.target.value as "http" | "socks5" })}><option value="socks5">SOCKS5</option><option value="http">HTTP</option></select></label>
              <label className="field"><span>Rola 网关</span><input value={state.draft.server} onChange={event => editExit({ server: event.target.value.trim() })} placeholder="填写控制台给出的网关，不带协议" autoComplete="off" /></label>
              <label className="field"><span>端口</span><input type="number" min={1} max={65535} value={state.draft.port} onChange={event => editExit({ port: Number(event.target.value) })} /></label>
              <label className="field"><span>{state.draft.authMode === "literal" ? "代理账号" : "基础账号"}{state.draft.id ? "（留空保持）" : ""}</span><input type="password" value={state.draft.account} onChange={event => editExit({ account: event.target.value })} autoComplete="off" spellCheck={false} /></label>
              <label className="field"><span>代理密码{state.draft.id ? "（留空保持）" : ""}</span><input type="password" value={state.draft.password} onChange={event => editExit({ password: event.target.value })} autoComplete="new-password" /></label>
              <label className="field"><span>出口国家代码{state.draft.authMode === "literal" ? "（用于国家分组，可留空）" : ""}</span><input value={state.draft.country} onChange={event => editExit({ country: event.target.value.toLowerCase() })} list="rola-countries" maxLength={2} /><datalist id="rola-countries"><option value="us">美国</option><option value="jp">日本</option><option value="sg">新加坡</option><option value="gb">英国</option><option value="de">德国</option></datalist></label>
              {state.draft.authMode === "dynamic" ? <><label className="field"><span>会话标识</span><input value={state.draft.sessionId} onChange={event => editExit({ sessionId: event.target.value })} maxLength={32} /></label>
              <label className="field"><span>会话保持分钟数</span><input type="number" min={1} max={120} value={state.draft.sessionMinutes} onChange={event => editExit({ sessionMinutes: Number(event.target.value) })} /></label></> : null}
            </div>
            {platformError ? <p className="field-error" role="alert">{platformError}</p> : null}
            <p className={styles.note}>节点名称：{Boolean(state.draft.exitIp) !== Boolean(state.draft.region) ? "请补齐出口 IP 和区域" : rolaExitLabel(state.draft)}。出口 IP 只用于备注，不会替代下方接入网关；请填写实际检测或供应商确认的信息，不自动推断地区。旧订阅不会自动改名。</p>
            <p className={styles.note}>{state.draft.authMode === "literal" ? "现成节点的账号与密码原样使用，不追加国家或会话后缀，也不据此推断是否为固定、独享 IP。" : "填动态住宅的基础账号，不带国家或会话后缀。相同会话会尽量保持出口，1–120 分钟，不代表固定或独享 IP。"}保存不测试 Rola 连通性，也不扣 Rola 测试流量。</p>
            <div className={styles.actions}><button className="button" type="button" disabled={Boolean(platformError)} onClick={() => void saveExit()}>保存到本机</button><button className="button" type="button" onClick={() => change({ draft: null })}>取消编辑</button></div>
          </div> : null}
          <div className={styles.editor} role="group" aria-label="附加家宽出口">
            <h3>附加家宽出口（{state.additionalExitIds.length}/{maxAdditionalRolaExits}）</h3>
            <p className={styles.note}>先保存各个出口，再勾选同订阅中的附加项。最多再选 7 个原样账号出口，与首个出口放在同一家宽组中手动选择，不会互相串联；仅支持直接接入。</p>
            {state.setup.exits.filter(exit => exit.id !== state.exitId).map(exit => {
              const checked = state.additionalExitIds.includes(exit.id);
              return <label key={exit.id}><input type="checkbox" checked={checked}
                disabled={!checked && (state.connectionMode !== "direct" || state.additionalExitIds.length >= maxAdditionalRolaExits || exit.authMode !== "literal")}
                onChange={event => change({ additionalExitIds: event.target.checked ? [...state.additionalExitIds, exit.id] : state.additionalExitIds.filter(id => id !== exit.id) })} /> {rolaExitLabel(exit)}{exit.authMode !== "literal" ? " · 动态账号不支持作为附加项" : ""}</label>;
            })}
            {extrasError ? <p className="field-error" role="alert">{extrasError}</p> : null}
          </div>
        </section>
        <section className={styles.step} aria-labelledby="rola-rules-title">
          <h2 id="rola-rules-title">3. 编辑经 Rola 的分流规则</h2>
          <label className="field"><span>域名规则使用的策略组</span><select value={state.policyGroup} onChange={event => change({ policyGroup: event.target.value as State["policyGroup"] })}><option value="">专用家宽组（只走家宽）</option><option value="AI">AI（可在客户端选择出口）</option></select></label>
          <label className="field"><span>域名规则（每行一条）</span><textarea className={styles.rules} value={state.rules} onChange={event => change({ rules: event.target.value })} rows={8} spellCheck={false} /></label>
          <p className={styles.note}><code>DOMAIN,api.example.com</code> 精确匹配；<code>DOMAIN-SUFFIX,example.com</code> 包含子域名，可用 # 注释。匹配域名及其 DNS 跟随所选策略组；选择 AI 时默认家宽，也可手动切换到机场。家宽组同时加入手动选择、全局和 AI，不自动回退直连。</p>
          <details className={styles.help}><summary>DNS 与协议边界</summary><label className="field"><span>DoH（每行一个 IP 地址 HTTPS URL）</span><textarea value={state.dns} onChange={event => change({ dns: event.target.value })} rows={3} spellCheck={false} /></label><p>匹配域名使用这些 DoH，跟随上面选定的策略组；机场与 Rola 网关由独立引导 DNS 解析，避免循环。生成文件关闭 IPv6，匹配域名的 UDP 被拒绝以便应用尝试 TCP；不覆盖当前客户端开关。</p><p>连接到 SOCKS5／HTTP 网关这一段不视为已加密，访问目标仍应使用 HTTPS。DNS 泄漏与实际出口需导入后另行检查，生成成功不等于网络验收通过。</p></details>
        </section>
        <div className={styles.chain}><span>{state.connectionMode === "direct" ? "设备（不经机场）" : state.upstream || "前置机场节点"}</span><ArrowRight aria-hidden="true" /><span>{state.additionalExitIds.length ? `${state.groupName} · ${state.additionalExitIds.length + 1} 个独立出口，选择其一` : selectedExit ? rolaExitLabel(selectedExit) : "Rola 出口"}</span><ArrowRight aria-hidden="true" /><span>匹配的域名</span></div>
        <button className="button button-primary" type="submit" disabled={!state.preview || (state.connectionMode === "chain" && !state.upstream) || !state.exitId || Boolean(state.draft) || Boolean(extrasError)}>{state.busy === "生成订阅" ? "正在生成" : "生成本地家宽订阅"}</button>
      </fieldset>
    </form> : null}
    {state.notice ? <p role="status">{state.notice}</p> : null}
    {state.error ? <p className="field-error" role="alert">{state.error}</p> : null}
    {state.result ? <section className={styles.result} aria-live="polite" aria-label="Rola 生成结果">
      <h2>本地家宽订阅已生成，尚未导入</h2><p>{state.result.summary.connectionMode === "direct" ? "直接接入家宽" : "机场前置串联"} · {state.result.summary.groupName} · {state.result.summary.inlineNodes} 个节点 · {state.result.summary.protectedRules} 条 Rola 域名规则 · {state.result.summary.country}</p>
      {state.result.summary.dnsSelection ? <p>{state.result.summary.dnsSelection}</p> : null}
      <code>{state.result.url}</code>
      <div className={styles.actions}><button className="button" type="button" onClick={() => { void navigator.clipboard.writeText(state.result!.url).then(() => patch({ notice: "本地链接已复制。" }), () => patch({ error: "无法写入剪贴板，请手动复制链接。" })); }}><Copy aria-hidden="true" />复制本机订阅链接</button><a className="button" href={state.result.url} download="Flacier-Rola.yaml" referrerPolicy="no-referrer"><DownloadSimple aria-hidden="true" />下载候选配置</a></div>
      <p>链接只能供这台电脑使用，刷新时本地服务需保持运行。iPhone／Android 无法访问这台电脑的 127.0.0.1；可私下传输下载文件，但文件不会自动更新。Shadowrocket 的「代理通过」需要单独配置，不会拿 Mihomo 文件冒充适配。</p>
      <p>文件和链接都应视为敏感信息，下载文件内含节点凭据。保存出口或修改规则后需生成新链接，不会改变旧订阅。</p>
      <a className="button" href={state.result.overrideUrl} download="Flacier-Rola-private.js" referrerPolicy="no-referrer"><DownloadSimple aria-hidden="true" />下载 Clash Party 本地私密覆写</a>
      <p>云端基础订阅 + 本地覆写：将此 JS 文件作为本地覆写导入 Clash Party，只绑定对应的基础订阅，不全局启用。文件内有凭据，不能上传云端或 WebDAV；云端更新后仍在本机叠加。前置节点消失或 DNS 条件变化会拒绝覆写，不替换成直连。</p>
      <button className="button" type="button" disabled={Boolean(state.busy)} onClick={() => void generateCloudBase()}>{state.busy === "生成云端基础" ? "正在生成云端基础" : "生成云端基础订阅（仅机场来源）"}</button>
      <p>此操作将当前机场来源提交给 rules.flacier.com 保存和转换，不包含 Rola 账号密码、出口或私密规则。云端链接单独使用只有机场出口；要走家宽，仍需在本机绑定上面的私密覆写。</p>
      {state.cloudBase ? <div><h3>云端基础订阅 · 不含家宽凭据</h3><code>{state.cloudBase.url}</code><p>读取 {state.cloudBase.nodeStats.read} 个，输出 {state.cloudBase.nodeStats.output} 个机场节点。{state.cloudBase.usage.combined ? "机场用量已继承。" : "机场未提供用量，未伪造额度。"}</p><button className="button" type="button" onClick={() => { void navigator.clipboard.writeText(state.cloudBase!.url).then(() => patch({ notice: "云端基础链接已复制；尚未导入。" }), () => patch({ error: "无法写入剪贴板，请手动复制链接。" })); }}><Copy aria-hidden="true" />复制云端基础链接</button></div> : null}
    </section> : null}
  </div>;
};
