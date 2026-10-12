import { useState } from "react";
import { parseProxyEndpoint, proxyEndpointUri, type ProxyEndpoint } from "../lib/proxy-endpoint";

export function ProxyEndpointInput({ onAdd }: { onAdd: (uri: string) => void }) {
  const [input, setInput] = useState<ProxyEndpoint>({ protocol: "socks5", server: "", port: 9004, username: "", password: "", name: "我的家宽" });
  const [quick, setQuick] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  function edit(value: Partial<ProxyEndpoint>) { setInput({ ...input, ...value }); setError(""); setNotice(""); }
  function readQuick() {
    try { edit(parseProxyEndpoint(quick)); setQuick(""); }
    catch (error) { setError(error instanceof Error ? error.message : "格式无效"); }
  }
  function add() {
    try {
      onAdd(proxyEndpointUri(input));
      setInput({ ...input, password: "", username: "" });
      setNotice("已加入上方来源列表，尚未上传或导入。可继续添加其他节点。");
      setError("");
    } catch (error) { setError(error instanceof Error ? error.message : "节点设置无效"); }
  }
  return <details className="subscription-more"><summary>添加独立 IP／家宽代理</summary>
    <p>选择供应商实际提供的协议。这里只合并节点；需要独立家宽分组或前置机场时，请使用「Rola 家宽出口」。</p>
    <label className="field"><span>快速粘贴（可选）</span><input type="password" autoComplete="new-password" value={quick} onChange={event => setQuick(event.target.value)} placeholder="主机:端口:账号:密码" /></label>
    <button className="button button-secondary" type="button" onClick={readQuick}>拆分到字段</button>
    <div className="subscription-settings-grid">
      <label className="field"><span>独立代理协议</span><select value={input.protocol} onChange={event => edit({ protocol: event.target.value as ProxyEndpoint["protocol"] })}><option value="socks5">SOCKS5</option><option value="http">HTTP</option><option value="https">HTTPS（供应商需支持 TLS）</option></select></label>
      <label className="field"><span>节点备注</span><input value={input.name} maxLength={64} onChange={event => edit({ name: event.target.value })} /></label>
      <label className="field"><span>代理地址</span><input value={input.server} autoComplete="off" onChange={event => edit({ server: event.target.value })} /></label>
      <label className="field"><span>代理端口</span><input type="number" min={1} max={65535} value={input.port} onChange={event => edit({ port: Number(event.target.value) })} /></label>
      <label className="field"><span>代理账号</span><input value={input.username} type="password" autoComplete="off" onChange={event => edit({ username: event.target.value })} /></label>
      <label className="field"><span>代理密码</span><input value={input.password} type="password" autoComplete="new-password" onChange={event => edit({ password: event.target.value })} /></label>
    </div>
    <button className="button button-secondary" type="button" onClick={add}>加入来源列表</button>
    {error ? <p className="field-error" role="alert">{error}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    <small>账号密码不会写入浏览器存储；生成订阅时会提交到所选后端。裸代理地址不提供套餐用量，不能据此猜测额度。</small>
  </details>;
}
