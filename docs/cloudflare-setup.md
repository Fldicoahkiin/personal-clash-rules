# Cloudflare

## Workers Builds

- Repository: `Fldicoahkiin/personal-clash-rules`
- Production branch: `main`
- Build command: `pnpm build`
- Deploy command: `npx wrangler deploy`
- Worker name: `personal-clash-rules`

## D1

创建数据库并绑定为 `DB`，再按文件名顺序执行 [`migrations/`](../migrations)。

## Variables

| 名称 | 类型 |
| --- | --- |
| `DATA_ENCRYPTION_KEY` | Secret，32 字节 base64url |
| `CONTROL_API_TOKEN` | Secret，管理页令牌 |
| `SUB_STORE_URL` | Secret，`https://substore.flacier.com` |
| `SUB_STORE_TOKEN` | Secret，与 VPS `.env` 相同 |
| `ACCESS_TEAM_DOMAIN` | Secret，可选 |
| `ACCESS_AUD` | Secret，可选 |
| `ACCESS_ADMIN_EMAIL` | Secret，可选 |
| `SUB_STORE_ACCESS_CLIENT_ID` | Secret，可选 |
| `SUB_STORE_ACCESS_CLIENT_SECRET` | Secret，可选 |

`/manage` 接受管理令牌；启用 Cloudflare Access 后也可使用 Access 登录。Worker 默认通过 Bearer Token 访问 Sub-Store；Access Service Token 为可选替代。

## Domains

- `rules.flacier.com` → Worker public site and subscription links
- `substore.flacier.com` → Tunnel to the private Sub-Store backend
- `sub.flacier.com` → optional alias for `/manage`
