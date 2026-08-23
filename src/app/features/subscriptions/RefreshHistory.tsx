import type { FC } from "react";

import type { RefreshRun } from "./api";

type RefreshHistoryProps = {
  runs: RefreshRun[];
};

const statusText: Record<RefreshRun["status"], string> = {
  succeeded: "成功",
  failed: "失败",
  running: "未完成",
};

const errorText: Record<string, string> = {
  "Sub-Store did not respond": "转换服务无响应",
  "Sub-Store URL is not configured": "转换服务未配置",
  "Subscription conversion failed": "转换失败",
  "Stored source could not be decrypted": "来源解密失败",
};

function formatTime(run: RefreshRun): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(run.finishedAt ?? run.startedAt));
}

export const RefreshHistory: FC<RefreshHistoryProps> = ({ runs }) => {
  if (runs.length === 0) {
    return null;
  }

  return (
    <details className="refresh-history">
      <summary>刷新记录</summary>
      <div className="refresh-history-table-wrap">
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>结果</th>
              <th>节点</th>
              <th>格式</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id}>
                <td>{formatTime(run)}</td>
                <td>
                  <strong className={`refresh-history-status is-${run.status}`}>
                    {statusText[run.status]}
                  </strong>
                  {run.error ? <small>{errorText[run.error] ?? run.error}</small> : null}
                </td>
                <td>{run.nodeCount ?? "—"}</td>
                <td>{run.targetCount ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
};
