import type { FC } from "react";
import type { DnsSettings } from "../../config/dns-settings";
import styles from "./MihomoDnsSettings.module.css";

type MihomoDnsSettingsProps = { settings: DnsSettings; onChange: (value: DnsSettings) => void; proxyDns: boolean; shadowrocket?: boolean };

export const MihomoDnsSettings: FC<MihomoDnsSettingsProps> = ({ settings, onChange, proxyDns, shadowrocket = false }) => (
  <div className={`field subscription-sort ${styles.settings}`}>
    {proxyDns ? <>
      <label className="field">
        <span>节点引导 DNS</span>
        <select value={settings.bootstrapMode} onChange={event => onChange({ ...settings, bootstrapMode: event.target.value as DnsSettings["bootstrapMode"] })}>
          <option value="system">系统 DNS · 仅用于建立代理</option>
          {!shadowrocket || settings.bootstrapMode === "upstream" ? <option value="upstream">继承机场的独立节点 DNS{shadowrocket ? "（此客户端不支持）" : ""}</option> : null}
          <option value="custom">自定义 · IP 地址 DoH</option>
        </select>
        <small>解析节点和 DNS 服务的域名，不处理普通网站查询。系统 DNS 可能由本地运营商提供；若它指回 Mihomo，请改用可直达的引导 DNS，避免循环。</small>
      </label>
      {settings.bootstrapMode === "custom" ? <label className="field">
        <span>引导 DoH 地址</span>
        <textarea rows={2} value={settings.bootstrap.join("\n")} onChange={event => onChange({ ...settings, bootstrap: event.target.value.split("\n") })} placeholder="https://1.1.1.1/dns-query" />
        <small>每行一个，最多 4 个；须由你的本地网络直接访问。服务器端验证不能证明本地可达。</small>
      </label> : null}
      <label className="field">
        <span>网站查询 DoH</span>
        <textarea rows={2} value={settings.nameservers.join("\n")} onChange={event => onChange({ ...settings, nameservers: event.target.value.split("\n") })} />
        <small>{shadowrocket ? "每行一个 HTTPS 地址；通过首页选中的节点。备用 DNS 也通过代理，不添加系统 DNS 备用。请先导入并选择可用节点。" : "每行一个 HTTPS 地址；通过 DNS-PROXY 组。节点为空时拒绝查询，不退回系统 DNS；可在客户端选择该组的节点。"}</small>
      </label>
    </> : null}
    <label className={styles.ipv6}><input type="checkbox" checked={settings.ipv6} onChange={event => onChange({ ...settings, ipv6: event.target.checked })} /> 允许 IPv6</label>
    <small>默认关闭生成配置的 IPv6 与 DNS AAAA 返回，不修改操作系统。客户端覆写仍可能覆盖此设置。</small>
  </div>
);
