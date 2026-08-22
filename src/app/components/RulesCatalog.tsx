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
    category: "Steam",
    coverage: "商店、社区、游戏服务与单独下载流量",
    strategy: "STEAM",
    href: "/rules/gaming/steam.list",
    count: "2 sets",
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
