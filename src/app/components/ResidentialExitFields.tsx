import type { FC } from "react";
import { rolaExitLabel, rolaPlatformError, type AdditionalRolaExitDraft } from "../features/subscriptions/rola-api";
import styles from "./RolaSubscription.module.css";

type ResidentialExitFieldsProps = {
  exit: AdditionalRolaExitDraft;
  onChange: (next: Partial<AdditionalRolaExitDraft>) => void;
};

export const ResidentialExitFields: FC<ResidentialExitFieldsProps> = ({ exit, onChange }) => <>
  <div className={styles.grid}>
    <label className="field"><span>平台（留空默认 Rola）</span><input value={exit.platform ?? "Rola"} maxLength={24} autoComplete="off" spellCheck={false} aria-invalid={Boolean(rolaPlatformError(exit.platform))} onChange={event => onChange({ platform: event.target.value })} /></label>
    <label className="field"><span>出口 IP（可选）</span><input value={exit.exitIp ?? ""} maxLength={45} autoComplete="off" spellCheck={false} onChange={event => onChange({ exitIp: event.target.value })} /></label>
    <label className="field"><span>出口区域（与 IP 一起填写）</span><input value={exit.region ?? ""} maxLength={32} placeholder="例如：美国 Las Vegas" onChange={event => onChange({ region: event.target.value })} /></label>
    <label className="field"><span>备用备注（未填 IP／区域时使用）</span><input value={exit.name} maxLength={64} onChange={event => onChange({ name: event.target.value })} /></label>
    <label className="field"><span>代理协议</span><select value={exit.protocol} onChange={event => onChange({ protocol: event.target.value as "http" | "socks5" })}><option value="socks5">SOCKS5</option><option value="http">HTTP</option></select></label>
    <label className="field"><span>家宽网关地址</span><input value={exit.server} autoComplete="off" placeholder="IP 或域名，不带协议" onChange={event => onChange({ server: event.target.value.trim() })} /></label>
    <label className="field"><span>家宽端口</span><input type="number" min={1} max={65535} value={exit.port} onChange={event => onChange({ port: Number(event.target.value) })} /></label>
    <label className="field"><span>家宽账号</span><input type="password" value={exit.account} autoComplete="off" spellCheck={false} onChange={event => onChange({ account: event.target.value })} /></label>
    <label className="field"><span>家宽密码</span><input type="password" value={exit.password} autoComplete="new-password" onChange={event => onChange({ password: event.target.value })} /></label>
    <label className="field"><span>国家代码（用于国家分组，可留空）</span><input value={exit.country} maxLength={2} placeholder="us / jp / sg" onChange={event => onChange({ country: event.target.value.toLowerCase() })} /></label>
  </div>
  {rolaPlatformError(exit.platform) ? <p className="field-error" role="alert">{rolaPlatformError(exit.platform)}</p> : null}
  <p className={styles.note}>节点名称：{Boolean(exit.exitIp) !== Boolean(exit.region) ? "请补齐出口 IP 和区域" : rolaExitLabel(exit)}。账号原样使用；出口 IP 仅用于备注，不替代接入网关。</p>
</>;
