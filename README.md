# personal-clash-rules

个人使用的 Mihomo 规则、Clash Party 覆写和订阅转换页面。

[在线页面](https://rules.flacier.com/) ·
[Clash Party 覆写](https://rules.flacier.com/overrides/clash-party.yaml) ·
[规则目录](public/rules/manifest.yaml)

![Personal Clash Rules architecture](docs/architecture.svg)

## 规则

| 策略 | 内容 | 默认 |
| --- | --- | --- |
| `AI` | OpenAI、Claude、Grok、Gemini、Codex 等 AI 服务 | `GLOBAL` |
| `STEAM` | Steam 商店、社区与平台服务 | `DIRECT` |
| `STEAM-DOWNLOAD` | Steam 客户端更新与游戏内容下载 | `DIRECT` |
| `STEAM-ONLINE` | Steam 聊天、连通性、匹配与中继服务 | `DIRECT` |
| `BILIBILI` | Bilibili 视频、直播、漫画与游戏 | `DIRECT` |
| `ANIGAMER` | 巴哈姆特动画疯 | `TW` |
| `DISCORD` | Discord 应用、附件、媒体与语音 | `GLOBAL` |
| `DEV` | GitHub、GitLab、npm、PyPI、Docker、Rust | `GLOBAL` |
| `MEDIA` | YouTube、Netflix、Disney+、Spotify、Twitch | `GLOBAL` |
| `SOCIAL` | X、Reddit、Instagram、Telegram、TikTok | `GLOBAL` |

地区组包括 `US`、`JP`、`SG`、`HK`、`TW`、`KR` 和 `EU`。节点名称需包含国家代码、国家名或城市名，例如 `TW Taipei 01`。

规则采用 Mihomo `classical` 文本格式。完整列表见 [`public/rules`](public/rules)。

## Clash Party

覆写地址：

```text
https://rules.flacier.com/overrides/clash-party.yaml
```

1. 在 Clash Party 的「覆写」页面导入上面的地址。
2. 编辑订阅，为订阅选择该覆写。
3. 使用规则模式，在服务策略组中选择直连、全局或地区节点。

参考 [Clash Party 覆写文档](https://clashparty.org/docs/guide/override)。

## 更新规则

GitHub Actions 每周一同步 `v2fly/domain-list-community` 的 Bilibili 与 Bahamut 数据。Steam 分类由本仓库维护。

手动同步和检查：

```bash
pnpm sync:rules
pnpm check
```

## 开发与部署

```bash
pnpm install
pnpm dev
pnpm build
```

Cloudflare Workers 通过 GitHub 的 `main` 分支构建。配置见 [`wrangler.jsonc`](wrangler.jsonc)。

## License

[MIT](LICENSE)。部分域名来自 MIT 许可的 [`v2fly/domain-list-community`](https://github.com/v2fly/domain-list-community)，说明见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。
