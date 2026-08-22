import { ArrowUpRight } from "@phosphor-icons/react";

const catalog = [
  {
    category: "AI",
    coverage: "OpenAI · Claude · Grok · Gemini · Coding · General",
    strategy: "AI",
    href: "/rules/ai/openai.list",
    count: "6 sets",
  },
  {
    category: "Steam Platform",
    coverage: "商店、社区、账户与平台静态资源",
    strategy: "STEAM",
    href: "/rules/gaming/steam.list",
    count: "1 set",
  },
  {
    category: "Steam Download",
    coverage: "客户端更新与游戏内容下载",
    strategy: "STEAM-DOWNLOAD",
    href: "/rules/gaming/steam-download.list",
    count: "1 set",
  },
  {
    category: "Steam Online",
    coverage: "聊天、连通性、匹配与 Steam 中继服务",
    strategy: "STEAM-ONLINE",
    href: "/rules/gaming/steam-online.list",
    count: "1 set",
  },
  {
    category: "Bilibili",
    coverage: "视频、直播、漫画与相关服务",
    strategy: "BILIBILI",
    href: "/rules/media/bilibili.list",
    count: "1 set",
  },
  {
    category: "AniGamer",
    coverage: "巴哈姆特动画疯与媒体分发",
    strategy: "ANIGAMER",
    href: "/rules/media/anigamer.list",
    count: "1 set",
  },
  {
    category: "Discord",
    coverage: "应用、附件、媒体与语音服务",
    strategy: "DISCORD",
    href: "/rules/messaging/discord.list",
    count: "1 set",
  },
  {
    category: "Developer",
    coverage: "GitHub、GitLab、npm、PyPI、Docker 与 Rust",
    strategy: "DEV",
    href: "/rules/developer/developer.list",
    count: "1 set",
  },
  {
    category: "Media",
    coverage: "YouTube、Netflix、Disney+、Spotify 与 Twitch",
    strategy: "MEDIA",
    href: "/rules/media/media.list",
    count: "1 set",
  },
  {
    category: "Social",
    coverage: "X、Reddit、Instagram、Telegram 与 TikTok",
    strategy: "SOCIAL",
    href: "/rules/social/social.list",
    count: "1 set",
  },
];

export function RulesCatalog() {
  return (
    <section
      className="rules-section page-width"
      id="rules"
      aria-labelledby="rules-title"
    >
      <div className="section-heading">
        <div>
          <p className="section-kicker">04 · RULE CATALOG</p>
          <h2 id="rules-title">已整理的规则</h2>
        </div>
        <p>文本采用 Mihomo classical provider 格式，可单独引用，也可直接使用仓库覆写。</p>
      </div>

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
