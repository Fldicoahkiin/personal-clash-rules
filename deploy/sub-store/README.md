# Sub-Store

固定使用官方 Sub-Store `2.36.39` 和 cloudflared `2026.8.2`。Caddy 校验 Worker 发送的 Bearer Token；VPS 只在 `127.0.0.1:3010` 留一个本机检查端口，公网请求通过 Tunnel 到达 Caddy。

## Cloudflare

在 Cloudflare 控制台创建远程管理的 Tunnel：

1. Tunnel 名称使用 `flacier-sub-store`。
2. Public hostname 使用 `substore.flacier.com`。
3. Service 使用 `http://gateway:8080`。
4. 从安装命令中复制 Tunnel Token，保存到 VPS 的 `deploy/sub-store/secrets/cloudflare-tunnel-token`。不要把 Token 写进 `.env` 或提交到 Git。

Token 文件只需要一行原始 Token，并限制为当前用户读取。

## VPS

```bash
cp .env.example .env
mkdir -p secrets
chmod 700 secrets
touch secrets/cloudflare-tunnel-token
chmod 600 secrets/cloudflare-tunnel-token
docker compose up -d --build
docker compose ps
```

启动前在 `.env` 设置随机 `SUB_STORE_TOKEN`，并把 Cloudflare 控制台给出的 Tunnel Token 写入上面的 Token 文件。

检查实际转换接口：

```bash
pnpm check:sub-store
```

## Worker

在 Workers Builds 的生产环境保存：

- `SUB_STORE_URL=https://substore.flacier.com`
- `SUB_STORE_TOKEN`：与 VPS `.env` 相同

如果账号已启用 Cloudflare Access，也可以改用 Service Token。后端版本与校验值写在 [Dockerfile](Dockerfile)，数据保存在 `sub-store-data` volume。
