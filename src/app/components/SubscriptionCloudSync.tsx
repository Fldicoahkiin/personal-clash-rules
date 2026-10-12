import { CloudArrowUp } from "@phosphor-icons/react";
import { useState } from "react";
import { publishLocalSubscription, subscriptionErrorText, type ConvertedSubscription } from "../features/subscriptions/api";
import type { ClientFormat } from "../features/subscriptions/client-formats";
import { SubscriptionResult } from "./SubscriptionResult";

export function SubscriptionCloudSync({ localUrl, format }: { localUrl: string; format: ClientFormat }) {
  const [result, setResult] = useState<ConvertedSubscription | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  async function publish() {
    setPending(true);
    setError("");
    try { setResult(await publishLocalSubscription(localUrl)); setCopied(false); }
    catch (error) { setError(subscriptionErrorText(error)); }
    finally { setPending(false); }
  }
  return <section aria-label="本地同步到云端" className="subscription-result-notes subscription-cloud-sync">
    <h3>本地读取，云端分发</h3>
    <p>把节点、订阅名称和用量发送到你自己的 rules.flacier.com，生成手机也能使用的固定链接。包含节点账号密码；不会发送给公共转换服务。</p>
    <p>首次同步后，本地服务运行期间按订阅更新间隔同步。电脑休眠、服务停止或读取失败时，云端保留上次内容，用量不会实时更新；失败后 15 分钟重试。修改输入重新生成会创建另一条同步任务。</p>
    <button type="button" className="button button-secondary" onClick={() => void publish()} disabled={pending}>
      <CloudArrowUp aria-hidden="true" />{pending ? "正在同步" : result ? "再次同步此链接" : "同步到我的 CF"}
    </button>
    {error ? <p role="alert" className="field-error">{error}</p> : null}
    {result ? <SubscriptionResult copied={copied} result={result} format={format} onCopy={() => {
      void navigator.clipboard.writeText(result.url).then(() => setCopied(true)).catch(() => setError("未能复制，请手动复制链接"));
    }} /> : null}
  </section>;
}
