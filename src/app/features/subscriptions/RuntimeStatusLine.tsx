import type { FC } from "react";

import type { RuntimeStatus } from "./api";

type RuntimeStatusLineProps = {
  failed: boolean;
  loading: boolean;
  status: RuntimeStatus | undefined;
};

const databaseText: Record<RuntimeStatus["database"], string> = {
  ready: "D1 已连接",
  migration_required: "D1 待迁移",
};

const converterText: Record<RuntimeStatus["converter"], string> = {
  ready: "转换服务可用",
  not_configured: "转换服务未配置",
  unreachable: "转换服务无响应",
};

export const RuntimeStatusLine: FC<RuntimeStatusLineProps> = ({ failed, loading, status }) => (
  <div className="runtime-status-line" aria-label="运行状态">
    <strong>运行状态</strong>
    {failed ? (
      <span className="is-error"><i aria-hidden="true" />状态不可用</span>
    ) : loading || !status ? (
      <span>正在检查</span>
    ) : (
      <>
        <span className={status.database === "ready" ? "is-ready" : "is-error"}>
          <i aria-hidden="true" />
          {databaseText[status.database]}
        </span>
        <span className={status.converter === "ready" ? "is-ready" : "is-error"}>
          <i aria-hidden="true" />
          {converterText[status.converter]}
        </span>
        <span>每 6 小时自动刷新</span>
      </>
    )}
  </div>
);
