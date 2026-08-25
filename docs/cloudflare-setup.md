# Cloudflare

这套部署只使用一个 Worker。Worker 同时提供网页、订阅转换、KV 短链接和规则文件。

## Git 部署

在 Cloudflare 控制台打开 **Workers & Pages → Create → Import a repository**，连接：

- Repository: `Fldicoahkiin/personal-clash-rules`
- Production branch: `main`
- Build command: `pnpm build`
- Deploy command: `pnpm exec wrangler deploy`

每次推送 `main` 后由 Cloudflare 构建并部署，不需要在本机执行部署命令。

`wrangler.jsonc` 已声明 `SUBSCRIPTIONS` KV 绑定。Cloudflare 首次构建时自动创建对应的 KV 命名空间。

## 域名

在 Worker 的 **Settings → Domains & Routes** 添加 `rules.flacier.com`。

## 检查

部署后打开：

```text
https://rules.flacier.com/health
https://rules.flacier.com/
```
