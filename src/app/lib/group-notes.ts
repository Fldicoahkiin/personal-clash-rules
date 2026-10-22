// The only hand-written copy about policy groups: what each group is for and why it starts where it does.
// Rule order, exits, rule files and example domains are derived from the config and the published lists.

export interface GroupNote {
  purpose: string;
  /** Why the group starts on a non-default exit; groups that follow GLOBAL use followsGlobalReason. */
  defaultReason?: string;
  /** Order constraints the rule files alone cannot show. */
  orderNote?: string;
  /** Title for policies that are not proxy groups. */
  title?: string;
}

export const followsGlobalReason = "默认跟随 GLOBAL：直连只来自白名单规则，其余服务都走代理。单独成组是为了能单独改选出口。";

export const groupNotes: Record<string, GroupNote> = {
  DIRECT: {
    title: "直连白名单",
    purpose: "本机与局域网、远程控制和支付、QQ 与微信、网易云音乐，以及国内服务域名和国内 IP。",
    defaultReason: "直连只来自这些规则；没有规则命中的流量不会回落直连，而是交给「🐟 未匹配流量」走代理。",
    orderNote: "分三处：前置白名单最先匹配；国内域名列表排在 Apple、Steam 下载、哔哩哔哩和境外例外之后，让这些服务保留可选出口，又排在 AI 进程规则之前，Claude 或 Codex 访问国内网站时仍然直连；GEOIP,CN 在所有域名规则之后，用目标 IP 补判国内地址。",
  },
  "APPLE-DOWNLOAD": {
    purpose: "App Store 应用和系统更新的下载地址。",
    defaultReason: "默认直连，下载走 Apple 国内节点。",
    orderNote: "这些下载域名包含在 App Store 和 iCloud 的域名后缀里，所以排在 Apple 规则的最前面。",
  },
  "APPLE-SYSTEM": {
    purpose: "设备激活、推送、证书校验、时间同步、系统更新与恢复，以及 iCloud 专用代理的接入端点。",
    defaultReason: "默认直连：这些是系统级连接，不随所选代理节点变化。",
  },
  APPLE: { purpose: "Apple 账号登录、App Store 与 Apple 开发者网站。" },
  ICLOUD: { purpose: "iCloud 与 CloudKit 同步。" },
  "APPLE-MEDIA": { purpose: "Apple Music、Apple TV、图书、播客、健身与新闻。" },
  "APPLE-INTELLIGENCE": { purpose: "Siri、搜索、地图与 Apple 智能。" },
  "STEAM-DOWNLOAD": {
    purpose: "Steam 客户端更新和游戏内容下载。",
    orderNote: "部分下载 CDN 与国内列表的境外例外重叠，排在它们之前，才能保留可单独选择的出口。",
  },
  BILIBILI: {
    purpose: "哔哩哔哩视频、直播、漫画与相关服务。",
    defaultReason: "国内服务，默认直连；单独成组，需要时可在客户端改选代理出口。",
    orderNote: "与国内域名列表有重叠，排在它之前，才能保留可单独选择的出口。",
  },
  DEFAULT: {
    purpose: "没有任何规则命中的流量，以及国内列表中实际属于境外服务的域名。",
    defaultReason: "默认跟随 GLOBAL：未命中规则的流量不回落直连。",
    orderNote: "境外例外排在国内域名列表之前，否则会被国内列表直连。",
  },
  CLAUDE: {
    purpose: "Claude 应用、Claude Code 进程，以及 Anthropic 的网站与 API。",
    defaultReason: "默认跟随「🤖 AI」，与其他 AI 服务用同一个出口；需要时可单独给 Claude 选节点。",
    orderNote: "API 地址按 IP 匹配且不解析域名，放在所有域名规则之后，只兜底直接连 IP 的请求。",
  },
  AI: {
    purpose: "OpenAI、Grok、Gemini、AI 编程工具和其他 AI 服务，以及 Codex 进程。",
    defaultReason: "默认跟随 GLOBAL。登录会话需要稳定出口时，把这一组固定到某个地区或节点，不要留在自动选择，自动测速会换节点。",
  },
  "STEAM-ONLINE": { purpose: "Steam 聊天、连通性检测、匹配与中继服务。" },
  STEAM: { purpose: "Steam 商店、社区与账户。" },
  DISCORD: { purpose: "Discord 应用、附件、媒体与语音。" },
  DEV: { purpose: "代码托管、软件包仓库、容器镜像与常用开发者网站。" },
  ANIGAMER: {
    purpose: "巴哈姆特动画疯。",
    defaultReason: "默认使用「🇹🇼 台湾」节点组：动画疯按台湾地区提供内容。",
  },
  MEDIA: { purpose: "YouTube、Netflix、Disney+、Spotify、Twitch 等境外影音服务。" },
  TELEGRAM: { purpose: "Telegram、t.me 与 telegra.ph。" },
  X: { purpose: "X / Twitter 及其图片与短链接。" },
  REDDIT: { purpose: "Reddit 及其媒体与静态资源。" },
  INSTAGRAM: { purpose: "Instagram 与 Threads。" },
  FACEBOOK: { purpose: "Facebook，以及其他应用共用的 fbcdn 资源。" },
  LINKEDIN: { purpose: "LinkedIn 及其静态资源。" },
  TIKTOK: { purpose: "TikTok；国内抖音走国内服务规则，不在这一组。" },
};
