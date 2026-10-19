import { useState } from "react";
import { localSyncTasks, subscriptionErrorText, type LocalSyncTask } from "../features/subscriptions/api";

export function SubscriptionSyncTasks({ backend }: { backend: string }) {
  const [tasks, setTasks] = useState<LocalSyncTask[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function load(change?: { localId: string; paused: boolean }) {
    setPending(true); setError("");
    try { setTasks(await localSyncTasks(backend, change)); }
    catch (error) { setError(subscriptionErrorText(error, backend)); }
    finally { setPending(false); }
  }
  return <section className="subscription-result-notes subscription-sync-tasks" aria-label="本地同步任务">
    <button className="button button-secondary" type="button" disabled={pending} onClick={() => void load()}>查看 / 刷新同步任务</button>
    {error ? <p role="alert">{error}</p> : null}
    {tasks?.length === 0 ? <p>还没有云端同步任务。</p> : null}
    {tasks?.map(task => <div key={task.localId}>
      <p>{task.name} · {task.paused ? "已暂停" : task.error ? `待重试（${task.error}）` : "自动同步已开启"}</p>
      <p>最近同步：{task.syncedAt ? new Date(task.syncedAt).toLocaleString("zh-CN") : "尚未成功"}</p>
      {task.url ? <p><code>{task.url}</code></p> : null}
      <button className="button button-secondary" type="button" disabled={pending} onClick={() => void load({ localId: task.localId, paused: !task.paused })}>{task.paused ? "恢复自动同步" : "暂停自动同步"}</button>
    </div>)}
    {tasks && tasks.length > 0 ? <p>暂停只停止后续上传，云端链接和已下载配置仍保留。</p> : null}
  </section>;
}
