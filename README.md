# personal-clash-rules

个人分流规则、订阅入口和规则转换工具。

[在线页面](https://rules.flacier.com/) ·
[Mihomo 覆写](https://rules.flacier.com/overrides/clash-party.yaml) ·
[规则目录](public/rules/manifest.yaml)

![Personal Clash Rules architecture](docs/architecture.svg)

## 策略

| 策略 | 内容 | 初始项 |
| --- | --- | --- |
| `AI` | OpenAI、Claude、Grok、Gemini、Codex | `GLOBAL` |
| `STEAM` | 商店与社区 | `DIRECT` |
| `STEAM-DOWNLOAD` | 客户端与游戏下载 | `DIRECT` |
| `STEAM-ONLINE` | 聊天、匹配与中继 | `DIRECT` |
| `BILIBILI` | 视频、直播与漫画 | `DIRECT` |
| `ANIGAMER` | 巴哈姆特动画疯 | `TW` |
| `DISCORD` | 应用、媒体与语音 | `GLOBAL` |
| `DEV` | GitHub、npm、PyPI、Docker、Rust | `GLOBAL` |
| `MEDIA` | YouTube、Netflix、Disney+、Spotify、Twitch | `GLOBAL` |
| `SOCIAL` | X、Reddit、Instagram、Telegram、TikTok | `GLOBAL` |

节点名称分组：`US`、`JP`、`SG`、`HK`、`TW`、`KR`、`EU`。

## 覆写

```text
https://rules.flacier.com/overrides/clash-party.yaml
```

规则文件位于 [`public/rules`](public/rules)，格式为 Mihomo `classical` 文本。

## 更新

```bash
pnpm sync:rules
pnpm check
```

GitHub Actions 每周同步 Bilibili 与 Bahamut 规则。

## 开发

```bash
pnpm install
pnpm dev
pnpm build
```

Cloudflare Workers 从 GitHub `main` 分支构建。

## License

[MIT](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md)
