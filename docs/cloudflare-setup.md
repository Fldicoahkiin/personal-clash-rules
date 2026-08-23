# Cloudflare

这套部署只使用一个 Worker 和一个 D1 数据库。Worker 同时提供网页、管理 API、定时刷新与固定订阅链接。

## Git 部署

在 Cloudflare 控制台打开 **Workers & Pages → Create → Import a repository**，连接：

- Repository: `Fldicoahkiin/personal-clash-rules`
- Production branch: `main`
- Build command: `pnpm build`
- Deploy command: `pnpm exec wrangler d1 migrations apply flacier-subscriptions --remote && pnpm exec wrangler deploy`

每次推送 `main` 后由 Cloudflare 构建并部署，不需要在本机执行部署命令。

## D1

数据库名为 `flacier-subscriptions`，绑定名为 `DB`。`wrangler.jsonc` 已包含数据库 ID 和迁移目录；Deploy command 会在发布前应用尚未执行的迁移。

## Secrets

在 Worker 的 **Settings → Variables and Secrets** 添加：

| 名称 | 用途 |
| --- | --- |
| `DATA_ENCRYPTION_KEY` | 加密订阅来源和固定链接令牌，32 字节 base64url |
| `CONTROL_API_TOKEN` | 进入 `/manage` 的管理令牌 |
| `ACCESS_TEAM_DOMAIN` | Cloudflare Access，可选 |
| `ACCESS_AUD` | Cloudflare Access，可选 |
| `ACCESS_ADMIN_EMAIL` | Cloudflare Access，可选 |

## 域名

在 Worker 的 **Settings → Domains & Routes** 添加 `rules.flacier.com`。

## 检查

部署后打开：

```text
https://rules.flacier.com/health
https://rules.flacier.com/api/manage/session
https://rules.flacier.com/manage
```
