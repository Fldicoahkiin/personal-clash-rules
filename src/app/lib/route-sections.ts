import { mihomoProfileRules } from "../../config/mihomo-policy";
import { exitPath, policyDisplayName } from "./policy-groups";

// The overview groups the Mihomo rule list by purpose. Each section starts at the first rule with its anchor
// prefix and runs to the next section, so a rule added inside a section joins it without an edit here.
const sectionAnchors = [
  { id: "process", name: "进程白名单", anchor: "PROCESS-NAME,", note: "ToDesk、微信、QQ、网易云音乐这些应用，按进程名直连。" },
  { id: "stun", name: "浏览器 STUN", anchor: "AND,((NETWORK,UDP),(DST-PORT", note: "网页视频通话用 STUN 探测公网地址。这组只管 UDP：浏览器的走代理，代理带不动就拦下；Claude 桌面端的直接拦下。" },
  { id: "allowlist", name: "直连白名单", anchor: "DOMAIN-SUFFIX,todesk.com,", note: "支付宝、ToDesk、局域网、腾讯通讯和网易云音乐的域名。" },
  { id: "apple", name: "Apple", anchor: "RULE-SET,apple-download,", note: "系统更新和 App 下载直连；Apple 账号、iCloud、媒体和 Apple 智能走代理。" },
  { id: "domestic", name: "国内与例外", anchor: "RULE-SET,steam-download,", note: "Steam 下载和哔哩哔哩各自成组；IP 查询这类例外走代理；其余国内网站直连。" },
  { id: "ai", name: "AI", anchor: "PROCESS-NAME-REGEX,(?i)^claude", note: "Claude 单独一组，其他 AI 服务一组。出口带不动 UDP 时拦下，连接退回 TCP，不会换出口。" },
  { id: "services", name: "常用服务", anchor: "RULE-SET,steam-online,", note: "Steam、Discord、开发工具、巴哈姆特、流媒体和社交网站，各走各的分组。" },
  { id: "anthropic-ip", name: "Anthropic IP", anchor: "RULE-SET,ai-anthropic-ip,", note: "直接用 IP 地址连 Anthropic 的流量，不经过域名。" },
  { id: "china-ip", name: "国内 IP", anchor: "GEOIP,CN,", note: "前面都没认出来、但目标是国内 IP 的流量直连。" },
  { id: "rest", name: "其余流量", anchor: "MATCH,", note: "规则里没有的网站都走代理，不会悄悄直连。" },
] as const;

export interface RouteSection {
  id: string;
  name: string;
  note: string;
  /** 1-based positions in the Mihomo rule list, inclusive. */
  first: number;
  last: number;
  /** How the section's traffic leaves; rules limited to UDP fallbacks do not count. */
  modes: Array<"直连" | "代理">;
  /** Proxy groups the section sends traffic to, without emoji; empty when everything goes direct. */
  exits: string[];
  /** Every rule is limited to UDP, so a web request never matches here. */
  udpOnly: boolean;
}

function policyOf(rule: string): string {
  const parts = rule.split(",");
  return parts.at(parts.at(-1) === "no-resolve" ? -2 : -1)!;
}

/** A Mihomo group name without its leading emoji, as the site shows it. */
export function plainName(name: string): string {
  return name.replace(/^[^\p{L}\p{N}]+/u, "").trim();
}

const starts = sectionAnchors.map(section => {
  const index = mihomoProfileRules.findIndex(rule => rule.startsWith(section.anchor));
  if (index < 0) throw new Error(`Route section ${section.id} has no rule starting with ${section.anchor}`);
  return index + 1;
});

export const routeSections: RouteSection[] = sectionAnchors.map((section, i) => {
  const first = starts[i];
  const last = i + 1 < starts.length ? starts[i + 1] - 1 : mihomoProfileRules.length;
  const policies = mihomoProfileRules.slice(first - 1, last).map(policyOf).filter(policy => policy !== "REJECT");
  const paths = policies.map(policy => ({ policy, direct: exitPath(policy).direct }));
  const modes = (["直连", "代理"] as const).filter(mode => paths.some(path => path.direct === (mode === "直连")));
  const exits = [...new Set(paths.filter(path => !path.direct && path.policy !== "DIRECT").map(path => plainName(policyDisplayName(path.policy))))];
  const udpOnly = mihomoProfileRules.slice(first - 1, last).every(rule => rule.includes("(NETWORK,UDP)"));
  return { id: section.id, name: section.name, note: section.note, first, last, modes, exits, udpOnly };
});

export function sectionAt(position: number): RouteSection | undefined {
  return routeSections.find(section => section.first <= position && position <= section.last);
}

/** Where a section sends proxied traffic, short enough for one line. */
export function sectionExit(section: RouteSection): string {
  return section.exits.length <= 2 ? section.exits.join("、") : `${section.exits.length} 个分组`;
}
