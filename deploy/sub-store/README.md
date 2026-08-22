# Sub-Store

固定使用官方 `2.36.39` release；Caddy 校验 Worker 发送的 Bearer Token，VPS 只监听 `127.0.0.1:3010`。

```bash
cp .env.example .env
docker compose up -d --build
docker compose ps
```

Cloudflare 控制台配置：

1. 创建 Tunnel，把 `substore.flacier.com` 指向 `http://localhost:3010`。
2. 在 VPS 的 `.env` 设置随机 `SUB_STORE_TOKEN`。
3. 在 Worker 中保存相同的 `SUB_STORE_TOKEN`，并设置 `SUB_STORE_URL=https://substore.flacier.com`。

如果账号已启用 Cloudflare Access，也可以改用 Service Token。后端版本与校验值写在 [Dockerfile](Dockerfile)，数据保存在 `sub-store-data` volume。
