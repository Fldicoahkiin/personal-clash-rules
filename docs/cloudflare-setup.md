# Cloudflare

## Workers Builds

- Repository: `Fldicoahkiin/personal-clash-rules`
- Production branch: `main`
- Build command: `pnpm build`
- Deploy command after D1 is approved: `npx wrangler d1 migrations apply flacier-subscriptions --remote && npx wrangler deploy`
- Worker name: `personal-clash-rules`

## D1

创建数据库并绑定为 `DB`。首次部署前先在 Workers Builds 的 Deploy command 中加入上面的迁移命令；后续构建只会执行尚未应用的迁移。

D1 免费档当前包含每日 500 万行读取、10 万行写入和总计 5 GB 存储；单个免费数据库上限 500 MB。Workers 免费档包含每日 10 万次动态请求，静态资源请求不计入该额度。个人订阅管理通常低于这些额度，达到每日上限后相应操作会失败并在次日重置。

定时任务每轮最多刷新两个方案，使 Sub-Store 请求数保持在 Workers 免费档单次 50 个外部请求以内；其余方案按最久未刷新顺序留到下一轮。

- [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)
- [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)

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
- `substore.flacier.com` → remotely managed Tunnel → `gateway:8080` → Sub-Store
- `sub.flacier.com` → optional alias for `/manage`

Tunnel 在 Cloudflare 控制台创建。VPS 使用 [`deploy/sub-store/compose.yaml`](../deploy/sub-store/compose.yaml) 中的固定版本 cloudflared，并从 Docker Secret 读取 Tunnel Token；Token 不写入仓库或容器命令行。

## Verify

部署完成后依次检查：

```text
GET https://rules.flacier.com/health
GET https://rules.flacier.com/api/manage/session
GET https://substore.flacier.com/healthz
```

前两个接口应返回 `200` 且带 `Cache-Control: no-store`。第三个接口应返回 `ok`；订阅源、节点 URI、管理令牌与 Tunnel Token 都不写入 Git。
