import { ArrowUpRight } from "@phosphor-icons/react";

const catalog = [
  {
    category: "国内服务",
    coverage: "geosite:cn 与 geolocation-cn 合并，约 11 万个国内域名；明确业务规则优先",
    strategy: "DIRECT",
    href: "/rules/direct/china-domains.list",
    count: "1 个",
  },
  {
    category: "境外例外",
    coverage: "国内列表覆盖到、但属于境外服务的域名，排在国内列表之前",
    strategy: "未匹配流量",
    href: "/rules/direct/china-exceptions.list",
    count: "1 个",
  },
  {
    category: "QQ / 微信",
    coverage: "登录、图片、头像、文件与小程序相关域名",
    strategy: "DIRECT",
    href: "/rules/direct/tencent-messaging.list",
    count: "1 个",
  },
  {
    category: "网易云音乐",
    coverage: "音乐接口、封面、音频与视频相关域名",
    strategy: "DIRECT",
    href: "/rules/direct/netease-music.list",
    count: "1 个",
  },
  {
    category: "AI",
    coverage: "OpenAI · Claude（含 API IP）· Grok · Gemini · Coding · General",
    strategy: "AI",
    href: "/rules/ai/openai.list",
    count: "7 个",
  },
  {
    category: "Apple",
    coverage: "账号与 App Store、iCloud、媒体、Siri 与 Apple 智能、下载、系统端点",
    strategy: "APPLE 等 6 组，下载与系统默认 DIRECT",
    href: "/rules/apple/services.list",
    count: "6 个",
  },
  {
    category: "Steam Platform",
    coverage: "商店、社区、账户与平台静态资源",
    strategy: "STEAM",
    href: "/rules/gaming/steam.list",
    count: "1 个",
  },
  {
    category: "Steam Download",
    coverage: "客户端更新与游戏内容下载",
    strategy: "STEAM-DOWNLOAD",
    href: "/rules/gaming/steam-download.list",
    count: "1 个",
  },
  {
    category: "Steam Online",
    coverage: "聊天、连通性、匹配与 Steam 中继服务",
    strategy: "STEAM-ONLINE",
    href: "/rules/gaming/steam-online.list",
    count: "1 个",
  },
  {
    category: "Bilibili",
    coverage: "视频、直播、漫画与相关服务",
    strategy: "BILIBILI / 默认直连",
    href: "/rules/media/bilibili.list",
    count: "1 个",
  },
  {
    category: "AniGamer",
    coverage: "巴哈姆特动画疯与媒体分发",
    strategy: "ANIGAMER",
    href: "/rules/media/anigamer.list",
    count: "1 个",
  },
  {
    category: "Discord",
    coverage: "应用、附件、媒体与语音服务",
    strategy: "DISCORD",
    href: "/rules/messaging/discord.list",
    count: "1 个",
  },
  {
    category: "Developer",
    coverage: "GitHub、GitLab、npm、PyPI、Docker 与 Rust",
    strategy: "DEV",
    href: "/rules/developer/developer.list",
    count: "1 个",
  },
  {
    category: "Media",
    coverage: "YouTube、Netflix、Disney+、Spotify 与 Twitch",
    strategy: "MEDIA",
    href: "/rules/media/media.list",
    count: "1 个",
  },
  {
    category: "Telegram",
    coverage: "Telegram、t.me 与 telegra.ph",
    strategy: "TELEGRAM / 默认代理",
    href: "/rules/social/telegram.list",
    count: "1 个",
  },
  {
    category: "X / Twitter",
    coverage: "X、Twitter、图片与短链接",
    strategy: "X / 默认代理",
    href: "/rules/social/x.list",
    count: "1 个",
  },
  {
    category: "Reddit",
    coverage: "Reddit、媒体与静态资源",
    strategy: "REDDIT / 默认代理",
    href: "/rules/social/reddit.list",
    count: "1 个",
  },
  {
    category: "Instagram / Threads",
    coverage: "Instagram、Threads 与 cdninstagram；fbcdn 归 Facebook",
    strategy: "INSTAGRAM / 默认代理",
    href: "/rules/social/instagram.list",
    count: "1 个",
  },
  {
    category: "Facebook",
    coverage: "Facebook 与 fbcdn 共享静态资源",
    strategy: "FACEBOOK / 默认代理",
    href: "/rules/social/facebook.list",
    count: "1 个",
  },
  {
    category: "LinkedIn",
    coverage: "LinkedIn 与 licdn 静态资源",
    strategy: "LINKEDIN / 默认代理",
    href: "/rules/social/linkedin.list",
    count: "1 个",
  },
  {
    category: "TikTok",
    coverage: "TikTok 与 tiktokcdn；不包含国内抖音",
    strategy: "TIKTOK / 默认代理",
    href: "/rules/social/tiktok.list",
    count: "1 个",
  },
  {
    category: "Social 兼容汇总",
    coverage: "保留旧规则链接；域名全部由以上应用组匹配",
    strategy: "不单独成组",
    href: "/rules/social/social.list",
    count: "1 个",
  },
];

export function RulesCatalog() {
  return (
    <section
      className="rules-section page-width"
      id="rules"
      aria-labelledby="rules-title"
    >
      <header className="plain-heading">
        <h2 id="rules-title">规则集</h2>
        <p>原始文件</p>
      </header>

      <div className="rules-table" role="table" aria-label="规则目录">
        <div className="rules-table-head" role="row">
          <span role="columnheader">分类</span>
          <span role="columnheader">范围</span>
          <span role="columnheader">策略</span>
          <span role="columnheader">文件</span>
        </div>
        {catalog.map((item) => (
          <div className="rules-row" role="row" key={item.category}>
            <span className="rules-category" role="cell">
              {item.category}
              <small>{item.count}</small>
            </span>
            <span className="rules-coverage" role="cell">
              {item.coverage}
            </span>
            <code role="cell">{item.strategy}</code>
            <a href={item.href} role="cell" target="_blank" rel="noreferrer">
              查看
              <ArrowUpRight aria-hidden="true" />
            </a>
          </div>
        ))}
      </div>
    </section>
  );
}
